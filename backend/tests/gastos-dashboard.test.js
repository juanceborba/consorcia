// tests/gastos-dashboard.test.js — Dashboard de gastos (S3-15)
// Contrato: PRD-04-02 §3.1 (KPIs), §3.2 (filtros), §3.3 (componentes),
// §3.4 (endpoints) · policy cerbos/policies/gasto.yaml · plan.middleware.js.
//
// QUÉ SE VERIFICA Y POR QUÉ
//
// 1. Cada número contra un CÁLCULO MANUAL con decimal.js hecho en el test, no
//    contra otra llamada al mismo agregador: un dashboard que se verifica solo
//    consigo mismo confirma que el código corre, no que suma bien.
// 2. LA RECONCILIACIÓN CON LA LISTA. `kpis.total` tiene que ser el MISMO número
//    que `totales.monto` de `GET /api/edificios/:id/gastos` con el mismo filtro
//    (S3-16 los pone en la misma pantalla). Es la invariante que justifica que
//    los dos endpoints compartan `whereDeGastos`.
// 3. LAS TRES IDENTIDADES INTERNAS de cada respuesta:
//    total = ordinarias + extraordinarias = A + B + C = Σ evolucionMensual.
// 4. LA IMPUTACIÓN POR CUOTAS (S3-19): con `?periodo=` un gasto en cuotas aporta
//    SU CUOTA, no la factura; con `?todo=1` aporta la factura y sus cuotas se
//    reparten en la evolución mensual. Es el punto donde un `groupBy` de Prisma
//    daría un número distinto (ver decisión 2 de gastos-dashboard.js).
// 5. AUTORIZACIÓN Y PLAN, que son dos gates distintos: el gestor lee el dashboard
//    de SU edificio pero no el consolidado (Cerbos), y una organización que no
//    llega a Business+ no ve el consolidado aunque sea org_admin
//    (`PLAN_INSUFICIENTE`).
//
// La suite crea su PROPIO edificio con 4 UFs: así los totales de `?todo=1` son
// exactos y no dependen de lo que otras suites hayan dejado en los edificios del
// seed. Los períodos son de 2014 (2015 es gastos-slice, 2016 recibos, 2017
// liquidaciones, 2018+ gastos/cuotas/esquemas). Todo se limpia en el after().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

const SUFIJO = randomUUID().slice(0, 8);

const P_ANTERIOR = '2014-01';
const P_FOCO = '2014-02';
const P_CUOTA_2 = '2014-03';
const P_CUOTA_3 = '2014-04';

const UNIDADES = 4; // 4 UFs de 0.25 → gastoPorUF = total / 4

// Los montos del escenario. Nada acá es redondo por casualidad: los totales se
// recalculan abajo con decimal.js a partir de estas filas, así que cambiar un
// monto no rompe los asserts, los mueve.
const ESCENARIO = {
  anterior: { monto: '10000.00', categoria: 'A', esOrdinario: true, fecha: '2014-01-15' },
  generalOrd: { monto: '30000.00', categoria: 'A', esOrdinario: true, fecha: '2014-02-05' },
  ascensorOrd: { monto: '12000.00', categoria: 'B', esOrdinario: true, fecha: '2014-02-10' },
  sectorExt: { monto: '5000.00', categoria: 'C', esOrdinario: false, fecha: '2014-02-20' },
  obraEnCuotas: {
    monto: '9000.00',
    categoria: 'A',
    esOrdinario: false,
    fecha: '2014-02-25',
    cuotasTotal: 3,
  },
};

const CUOTA = '3000.00'; // 9000 / 3, exacto

const suma = (...montos) => montos.reduce((acc, m) => acc.plus(m), new Decimal(0)).toFixed(2);

// Lo imputado a P_FOCO: los tres gastos del mes + UNA cuota de la obra.
const FOCO = {
  total: suma('30000.00', '12000.00', '5000.00', CUOTA),
  ordinarias: suma('30000.00', '12000.00'),
  extraordinarias: suma('5000.00', CUOTA),
  A: suma('30000.00', CUOTA),
  B: '12000.00',
  C: '5000.00',
  cantidad: 4,
};

// Todo el histórico del edificio: la obra entra por su FACTURA, no por sus cuotas.
const TODO = {
  total: suma('10000.00', '30000.00', '12000.00', '5000.00', '9000.00'),
  ordinarias: suma('10000.00', '30000.00', '12000.00'),
  extraordinarias: suma('5000.00', '9000.00'),
  A: suma('10000.00', '30000.00', '9000.00'),
  B: '12000.00',
  C: '5000.00',
  cantidad: 5,
};

describe('dashboard de gastos (S3-15)', () => {
  let server;
  let baseUrl;
  let admin; // org_admin de la org A
  let gestor; // gestor de la org A, solo Torre Palermo
  let adminSur; // org_admin de la org B (plan starter)
  let orgA;
  let orgB;
  let planOriginalA;
  let planOriginalB;
  let edificio; // el edificio propio de esta suite
  let torre; // Torre Palermo, para el caso del gestor
  let proveedorA;
  let proveedorB;
  let hojas; // { limpieza, otraDelMismoPadre, deOtroPadre }
  const creados = {}; // clave → gasto creado

  const dashboardEdificio = (query, token) =>
    apiFetch(baseUrl, `/api/edificios/${edificio.id}/gastos/dashboard${query}`, { token });

  const consolidado = (query, token, orgId = 'me') =>
    apiFetch(baseUrl, `/api/organizaciones/${orgId}/gastos/dashboard${query}`, { token });

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    // El plan se fija explícitamente (y se restaura en el after) para no depender
    // de que el seed se haya vuelto a correr con el cambio de S3-15.
    const [a, b] = await Promise.all([
      prisma.organizacion.findUnique({ where: { id: orgA }, select: { plan: true } }),
      prisma.organizacion.findUnique({ where: { id: orgB }, select: { plan: true } }),
    ]);
    planOriginalA = a.plan;
    planOriginalB = b.plan;
    await prisma.organizacion.update({ where: { id: orgA }, data: { plan: 'business' } });
    await prisma.organizacion.update({ where: { id: orgB }, data: { plan: 'starter' } });

    torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    assert.ok(torre, 'el seed debe traer Torre Palermo');

    edificio = await prisma.edificio.create({
      data: {
        organizacionId: orgA,
        nombre: `Edificio Dashboard ${SUFIJO}`,
        direccion: 'Av. Dashboard 100',
        ciudad: 'CABA',
        provincia: 'CABA',
        codigoPostal: 'C1000',
        totalM2: '400.00',
      },
      select: { id: true },
    });

    await prisma.unidad.createMany({
      data: Array.from({ length: UNIDADES }, (_, i) => ({
        organizacionId: orgA,
        edificioId: edificio.id,
        numero: `${i + 1}A`,
        tipo: 'departamento',
        m2: '100.00',
        coeficiente: '0.250000',
        categoriaB: ['ascensor'],
        categoriaC: 'torre_a',
      })),
    });

    proveedorA = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Aaa Proveedor Dash ${SUFIJO}` },
    });
    proveedorB = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Bbb Proveedor Dash ${SUFIJO}` },
    });

    // Dos hojas del MISMO rubro padre (para verificar el rollup con drill-down) y
    // una de otro padre.
    const conPadre = await prisma.rubro.findMany({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true, nombre: true, parentId: true },
      orderBy: { id: 'asc' },
    });
    const porPadre = new Map();
    for (const hoja of conPadre) {
      porPadre.set(hoja.parentId, [...(porPadre.get(hoja.parentId) ?? []), hoja]);
    }
    const padreConDos = [...porPadre.entries()].find(([, hs]) => hs.length >= 2);
    assert.ok(padreConDos, 'el maestro de rubros debe tener un rubro con 2+ subrubros (S3-13)');
    const [padreId, hermanas] = padreConDos;
    const deOtroPadre = conPadre.find((h) => h.parentId !== padreId);
    assert.ok(deOtroPadre, 'el maestro debe tener subrubros de al menos 2 padres');
    hojas = { primera: hermanas[0], segunda: hermanas[1], otroPadre: deOtroPadre };

    // --- Los gastos del escenario --------------------------------------------
    const alta = async (clave, { monto, categoria, esOrdinario, fecha, cuotasTotal }, extra) => {
      const { status, data } = await apiFetch(
        baseUrl,
        `/api/edificios/${edificio.id}/gastos`,
        {
          method: 'POST',
          token: admin.accessToken,
          body: {
            proveedorId: extra.proveedorId,
            rubroId: extra.rubroId,
            concepto: `${clave} ${SUFIJO}`,
            monto,
            categoria,
            esOrdinario,
            fechaGasto: fecha,
            periodo: extra.periodo,
            ...(categoria === 'B' ? { servicioEspecifico: 'ascensor' } : {}),
            ...(categoria === 'C' ? { sectorEspecifico: 'torre_a' } : {}),
            ...(cuotasTotal ? { cuotasTotal } : {}),
          },
        }
      );
      assert.equal(status, 201, `alta de ${clave}: ${JSON.stringify(data)}`);
      creados[clave] = data;
      return data;
    };

    await alta('anterior', ESCENARIO.anterior, {
      periodo: P_ANTERIOR,
      proveedorId: proveedorA.id,
      rubroId: hojas.primera.id,
    });
    await alta('generalOrd', ESCENARIO.generalOrd, {
      periodo: P_FOCO,
      proveedorId: proveedorA.id,
      rubroId: hojas.primera.id,
    });
    await alta('ascensorOrd', ESCENARIO.ascensorOrd, {
      periodo: P_FOCO,
      proveedorId: proveedorB.id,
      rubroId: hojas.segunda.id,
    });
    await alta('sectorExt', ESCENARIO.sectorExt, {
      periodo: P_FOCO,
      proveedorId: proveedorB.id,
      rubroId: hojas.otroPadre.id,
    });
    await alta('obraEnCuotas', ESCENARIO.obraEnCuotas, {
      periodo: P_FOCO,
      proveedorId: proveedorA.id,
      rubroId: hojas.primera.id,
    });
  });

  after(async () => {
    const ids = Object.values(creados)
      .map((g) => g?.id)
      .filter(Boolean);
    await prisma.gastoCuota.deleteMany({ where: { gastoId: { in: ids } } });
    await prisma.gasto.deleteMany({ where: { id: { in: ids } } });
    if (edificio) {
      await prisma.unidad.deleteMany({ where: { edificioId: edificio.id } });
      await prisma.gasto.deleteMany({ where: { edificioId: edificio.id } });
      await prisma.edificio.delete({ where: { id: edificio.id } });
    }
    await prisma.proveedor.deleteMany({
      where: { id: { in: [proveedorA?.id, proveedorB?.id].filter(Boolean) } },
    });
    if (planOriginalA) {
      await prisma.organizacion.update({ where: { id: orgA }, data: { plan: planOriginalA } });
    }
    if (planOriginalB) {
      await prisma.organizacion.update({ where: { id: orgB }, data: { plan: planOriginalB } });
    }
    await cerrarApp(server);
  });

  // Las tres identidades internas de §3.4, aplicables a cualquier respuesta.
  const verificarIdentidades = (d) => {
    const { kpis } = d;
    assert.equal(
      suma(kpis.totalOrdinarias, kpis.totalExtraordinarias),
      kpis.total,
      'total = ordinarias + extraordinarias'
    );
    assert.equal(
      suma(d.porCategoria.A, d.porCategoria.B, d.porCategoria.C),
      kpis.total,
      'total = A + B + C'
    );
    // La evolución de ?periodo= son 12 meses (decisión 3): el que reconcilia con
    // el KPI es SU ÚLTIMO PUNTO, no la suma de la serie. En rango/todo la serie
    // cubre exactamente el conjunto filtrado, así que suma el total.
    if (d.filtro.modo === 'periodo') {
      assert.equal(
        d.evolucionMensual.at(-1).total,
        kpis.total,
        'el último punto de la evolución es el KPI total'
      );
    } else {
      assert.equal(
        suma(...d.evolucionMensual.map((p) => p.total)),
        kpis.total,
        'total = Σ evolucionMensual'
      );
    }
    assert.equal(
      suma(...d.porRubro.map((r) => r.total)),
      kpis.total,
      'total = Σ porRubro (rollup a rubro raíz)'
    );
  };

  // ─── §3.1 KPIs con ?periodo= ───

  it('?periodo= devuelve los KPIs del período, imputando la cuota y no la factura', async () => {
    const { status, data } = await dashboardEdificio(
      `?periodo=${P_FOCO}`,
      admin.accessToken
    );
    assert.equal(status, 200, JSON.stringify(data));

    assert.equal(data.filtro.modo, 'periodo');
    assert.equal(data.filtro.periodo, P_FOCO);
    assert.equal(data.filtro.unidades, UNIDADES);

    assert.equal(data.kpis.total, FOCO.total, 'el total imputado a P_FOCO');
    assert.equal(data.kpis.totalOrdinarias, FOCO.ordinarias);
    assert.equal(data.kpis.totalExtraordinarias, FOCO.extraordinarias);
    assert.equal(data.kpis.cantidadGastos, FOCO.cantidad);
    assert.equal(data.porCategoria.A, FOCO.A);
    assert.equal(data.porCategoria.B, FOCO.B);
    assert.equal(data.porCategoria.C, FOCO.C);

    // §3.1: gasto por UF = total / UFs del edificio (cálculo manual).
    assert.equal(
      data.kpis.gastoPorUF,
      new Decimal(FOCO.total).div(UNIDADES).toFixed(2),
      'gastoPorUF = total / UFs'
    );

    verificarIdentidades(data);
  });

  it('la obra en cuotas aporta 1/3 al período y su factura completa a ?todo=1', async () => {
    const { data: foco } = await dashboardEdificio(`?periodo=${P_FOCO}`, admin.accessToken);
    const { data: todo } = await dashboardEdificio('?todo=1', admin.accessToken);

    assert.equal(foco.kpis.total, FOCO.total);
    assert.equal(todo.kpis.total, TODO.total, 'el histórico suma la FACTURA de la obra');
    assert.equal(
      new Decimal(todo.kpis.total).minus(foco.kpis.total).toFixed(2),
      suma('10000.00', '9000.00', `-${CUOTA}`),
      'la diferencia es el mes anterior + las 2 cuotas que no caen en P_FOCO'
    );

    // Y las cuotas aparecen en SUS períodos en la evolución del histórico.
    const porPeriodo = new Map(todo.evolucionMensual.map((p) => [p.periodo, p.total]));
    assert.equal(porPeriodo.get(P_CUOTA_2), CUOTA, 'cuota 2/3 en su período');
    assert.equal(porPeriodo.get(P_CUOTA_3), CUOTA, 'cuota 3/3 en su período');
    verificarIdentidades(todo);
  });

  it('?todo=1 suma el histórico completo del edificio', async () => {
    const { status, data } = await dashboardEdificio('?todo=1', admin.accessToken);
    assert.equal(status, 200);
    assert.equal(data.filtro.modo, 'todo');
    assert.equal(data.kpis.total, TODO.total);
    assert.equal(data.kpis.totalOrdinarias, TODO.ordinarias);
    assert.equal(data.kpis.totalExtraordinarias, TODO.extraordinarias);
    assert.equal(data.kpis.cantidadGastos, TODO.cantidad);
    assert.equal(data.porCategoria.A, TODO.A);
    assert.equal(data.kpis.variacionVsPeriodoAnterior, null, 'todo=1 no tiene comparable');
    verificarIdentidades(data);
  });

  // ─── Reconciliación con la lista (la razón de whereDeGastos) ───

  it('kpis.total es el MISMO número que la fila TOTAL de la lista, filtro por filtro', async () => {
    for (const query of [`?periodo=${P_FOCO}`, `?periodo=${P_CUOTA_2}`, '?todo=1']) {
      const [{ data: dash }, { data: lista }] = await Promise.all([
        dashboardEdificio(query, admin.accessToken),
        apiFetch(baseUrl, `/api/edificios/${edificio.id}/gastos${query.replace('?todo=1', '')}`, {
          token: admin.accessToken,
        }),
      ]);
      assert.equal(dash.kpis.total, lista.totales.monto, `total del dashboard vs lista (${query})`);
      assert.equal(
        dash.kpis.cantidadGastos,
        lista.totales.cantidad,
        `cantidad del dashboard vs lista (${query})`
      );
      assert.equal(dash.kpis.totalOrdinarias, lista.totales.ordinarios.monto);
      assert.equal(dash.kpis.totalExtraordinarias, lista.totales.extraordinarios.monto);
    }
  });

  // ─── §3.1 variación vs período anterior comparable ───

  it('la variación % compara contra el mes anterior y es null si no hay con qué', async () => {
    const { data: foco } = await dashboardEdificio(`?periodo=${P_FOCO}`, admin.accessToken);
    const esperada = new Decimal(FOCO.total)
      .minus(ESCENARIO.anterior.monto)
      .div(ESCENARIO.anterior.monto)
      .times(100)
      .toFixed(1);
    assert.equal(foco.kpis.variacionVsPeriodoAnterior, `+${esperada}%`);

    // P_ANTERIOR no tiene un mes previo con gastos → null (la UI lo oculta).
    const { data: anterior } = await dashboardEdificio(
      `?periodo=${P_ANTERIOR}`,
      admin.accessToken
    );
    assert.equal(anterior.kpis.total, ESCENARIO.anterior.monto);
    assert.equal(anterior.kpis.variacionVsPeriodoAnterior, null);

    // La caída de P_FOCO a P_CUOTA_2 (solo la cuota) sale con signo negativo.
    const { data: siguiente } = await dashboardEdificio(
      `?periodo=${P_CUOTA_2}`,
      admin.accessToken
    );
    assert.equal(siguiente.kpis.total, CUOTA);
    assert.ok(
      siguiente.kpis.variacionVsPeriodoAnterior.startsWith('-'),
      `esperaba una variación negativa, vino ${siguiente.kpis.variacionVsPeriodoAnterior}`
    );
  });

  // ─── §3.2 evolución mensual ───

  it('la evolución mensual son los 12 períodos que terminan en el filtro, con ceros', async () => {
    const { data } = await dashboardEdificio(`?periodo=${P_FOCO}`, admin.accessToken);
    assert.equal(data.evolucionMensual.length, 12);
    assert.equal(data.evolucionMensual.at(-1).periodo, P_FOCO, 'el último punto es el filtro');
    assert.equal(
      data.evolucionMensual.at(-1).total,
      data.kpis.total,
      'el último punto del chart es el KPI total'
    );
    assert.equal(data.evolucionMensual[0].periodo, '2013-03', '12 meses hacia atrás');
    assert.equal(data.evolucionMensual[0].total, '0.00', 'un mes sin gastos es un cero, no un hueco');

    const anterior = data.evolucionMensual.find((p) => p.periodo === P_ANTERIOR);
    assert.equal(anterior.total, ESCENARIO.anterior.monto);
  });

  // ─── §3.3 top proveedores y distribución por rubro ───

  it('topProveedores viene ordenado por monto con su porcentaje', async () => {
    const { data } = await dashboardEdificio('?todo=1', admin.accessToken);
    const mios = data.topProveedores.filter((p) =>
      [proveedorA.id, proveedorB.id].includes(p.proveedorId)
    );
    assert.equal(mios.length, 2, 'los dos proveedores del escenario están en el top');

    // A: 10000 + 30000 + 9000 = 49000 (3 gastos) · B: 12000 + 5000 = 17000 (2 gastos)
    const [primero, segundo] = mios;
    assert.equal(primero.proveedorId, proveedorA.id, 'el de mayor monto primero');
    assert.equal(primero.total, suma('10000.00', '30000.00', '9000.00'));
    assert.equal(primero.cantidad, 3);
    assert.equal(segundo.proveedorId, proveedorB.id);
    assert.equal(segundo.total, suma('12000.00', '5000.00'));
    assert.equal(segundo.cantidad, 2);

    assert.equal(
      primero.porcentaje,
      new Decimal(primero.total).div(TODO.total).times(100).toFixed(1),
      'el porcentaje es sobre el total del filtro'
    );
    assert.ok(data.topProveedores.length <= 10, 'top 10 como máximo (§3.3)');
  });

  it('porRubro rollupea las hojas a su rubro raíz y deja los subrubros para el drill-down', async () => {
    const { data } = await dashboardEdificio('?todo=1', admin.accessToken);

    const raizHermanas = data.porRubro.find((r) => r.rubroId === hojas.primera.parentId);
    assert.ok(raizHermanas, 'el rubro padre de las dos hojas aparece como raíz');
    // primera: 10000 + 30000 + 9000 · segunda: 12000
    assert.equal(raizHermanas.total, suma('10000.00', '30000.00', '9000.00', '12000.00'));
    assert.equal(raizHermanas.cantidad, 4);

    const subs = new Map(raizHermanas.subrubros.map((s) => [s.rubroId, s]));
    assert.equal(subs.size, 2, 'las dos hojas usadas cuelgan del padre');
    assert.equal(subs.get(hojas.primera.id).total, suma('10000.00', '30000.00', '9000.00'));
    assert.equal(subs.get(hojas.segunda.id).total, '12000.00');
    assert.equal(
      suma(...raizHermanas.subrubros.map((s) => s.total)),
      raizHermanas.total,
      'Σ subrubros = el total de su raíz'
    );

    const otraRaiz = data.porRubro.find((r) => r.rubroId === hojas.otroPadre.parentId);
    assert.equal(otraRaiz.total, '5000.00');
    assert.equal(
      otraRaiz.porcentaje,
      new Decimal('5000.00').div(TODO.total).times(100).toFixed(1)
    );
  });

  // ─── §3.2 rango de fechas y filtros compartidos ───

  it('?desde=&hasta= filtra por fechaGasto y suma la factura, como la lista', async () => {
    const query = '?desde=2014-02-01&hasta=2014-02-28';
    const { status, data } = await dashboardEdificio(query, admin.accessToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.filtro.modo, 'rango');

    // Los 4 gastos de febrero, por su monto de FACTURA (la obra entra con 9000).
    assert.equal(data.kpis.total, suma('30000.00', '12000.00', '5000.00', '9000.00'));
    assert.equal(data.kpis.cantidadGastos, 4);

    // La ventana anterior comparable (misma longitud, inmediatamente antes)
    // contiene el gasto del 15/01.
    const esperada = new Decimal(data.kpis.total)
      .minus(ESCENARIO.anterior.monto)
      .div(ESCENARIO.anterior.monto)
      .times(100)
      .toFixed(1);
    assert.equal(data.kpis.variacionVsPeriodoAnterior, `+${esperada}%`);

    // La evolución no clipea las cuotas que caen después del rango de fechas.
    verificarIdentidades(data);

    const { data: lista } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificio.id}/gastos${query}`,
      { token: admin.accessToken }
    );
    assert.equal(data.kpis.total, lista.totales.monto, 'mismo total que la lista');
  });

  it('los filtros de la lista también acotan el dashboard (categoría, rubro, proveedor)', async () => {
    const { data: porCategoria } = await dashboardEdificio(
      '?todo=1&categoria=B',
      admin.accessToken
    );
    assert.equal(porCategoria.kpis.total, '12000.00');
    assert.equal(porCategoria.porCategoria.A, '0.00');

    const { data: porProveedor } = await dashboardEdificio(
      `?todo=1&proveedorId=${proveedorB.id}`,
      admin.accessToken
    );
    assert.equal(porProveedor.kpis.total, suma('12000.00', '5000.00'));
    assert.equal(porProveedor.topProveedores.length, 1);

    const { data: porRubro } = await dashboardEdificio(
      `?todo=1&rubroId=${hojas.segunda.id}`,
      admin.accessToken
    );
    assert.equal(porRubro.kpis.total, '12000.00');
  });

  it('rechaza combinar dos modos de período (422)', async () => {
    const { status, data } = await dashboardEdificio(
      `?periodo=${P_FOCO}&todo=1`,
      admin.accessToken
    );
    assert.equal(status, 422);
    assert.equal(data.error.code, 'VALIDACION_FALLIDA');
    assert.match(data.error.message, /UN modo de período/);

    const { status: conRango } = await dashboardEdificio(
      `?periodo=${P_FOCO}&desde=2014-01-01`,
      admin.accessToken
    );
    assert.equal(conRango, 422);
  });

  it('un edificio sin gastos devuelve ceros, no null ni error', async () => {
    const { status, data } = await dashboardEdificio('?periodo=2013-01', admin.accessToken);
    assert.equal(status, 200);
    assert.equal(data.kpis.total, '0.00');
    assert.equal(data.kpis.cantidadGastos, 0);
    assert.equal(data.kpis.gastoPorUF, '0.00');
    assert.equal(data.kpis.variacionVsPeriodoAnterior, null);
    assert.deepEqual(data.topProveedores, []);
    assert.deepEqual(data.porRubro, []);
    assert.equal(data.porCategoria.A, '0.00');
  });

  // ─── §3.4 consolidado de la organización ───

  it('el consolidado suma todos los edificios activos de la organización', async () => {
    const { status, data } = await consolidado(`?periodo=${P_FOCO}`, admin.accessToken);
    assert.equal(status, 200, JSON.stringify(data));

    // Contra la suma de los dashboards por edificio, que es la definición de
    // "consolidado" que ve el usuario al cambiar el selector de edificio.
    const porEdificio = await Promise.all(
      data.filtro.edificios.map((id) =>
        apiFetch(baseUrl, `/api/edificios/${id}/gastos/dashboard?periodo=${P_FOCO}`, {
          token: admin.accessToken,
        })
      )
    );
    const esperado = suma(...porEdificio.map((r) => r.data.kpis.total));
    assert.equal(data.kpis.total, esperado, 'consolidado = Σ de los dashboards por edificio');
    assert.ok(data.filtro.edificios.length >= 3, 'los 2 del seed + el de esta suite');
    assert.ok(data.filtro.edificios.includes(edificio.id));

    // El gasto por UF del consolidado divide por las UFs de TODOS los edificios.
    assert.equal(
      data.kpis.gastoPorUF,
      new Decimal(data.kpis.total).div(data.filtro.unidades).toFixed(2)
    );
    verificarIdentidades(data);
  });

  it('el consolidado acepta el id de la organización activa y rechaza otro (403)', async () => {
    const { status } = await consolidado(`?periodo=${P_FOCO}`, admin.accessToken, orgA);
    assert.equal(status, 200);

    const { status: ajena, data } = await consolidado(
      `?periodo=${P_FOCO}`,
      admin.accessToken,
      orgB
    );
    assert.equal(ajena, 403);
    assert.equal(data.error.code, 'FUERA_DE_ORGANIZACION');
  });

  // ─── Autorización y plan: dos gates distintos ───

  it('el gestor lee el dashboard de su edificio pero no el consolidado', async () => {
    const { status } = await apiFetch(
      baseUrl,
      `/api/edificios/${torre.id}/gastos/dashboard?periodo=${P_FOCO}`,
      { token: gestor.accessToken }
    );
    assert.equal(status, 200, 'gestor: read de sus edificios asignados');

    // El edificio de esta suite no está asignado al gestor.
    const { status: noAsignado, data: cuerpo } = await dashboardEdificio(
      `?periodo=${P_FOCO}`,
      gestor.accessToken
    );
    assert.equal(noAsignado, 403);
    assert.equal(cuerpo.error.code, 'EDIFICIO_NO_ASIGNADO');

    const { status: consolidadoStatus, data } = await consolidado(
      `?periodo=${P_FOCO}`,
      gestor.accessToken
    );
    assert.equal(consolidadoStatus, 403, 'el consolidado de la organización no es del gestor');
    assert.equal(data.error.code, 'ACCESO_DENEGADO');
  });

  it('una organización que no llega a Business+ no ve el consolidado (PLAN_INSUFICIENTE)', async () => {
    const { status, data } = await consolidado(`?periodo=${P_FOCO}`, adminSur.accessToken);
    assert.equal(status, 403);
    assert.equal(data.error.code, 'PLAN_INSUFICIENTE');
    assert.equal(data.error.planActual, 'starter');
    assert.equal(data.error.planRequerido, 'business');

    // Pero el dashboard POR EDIFICIO sí: el gate es solo del consolidado.
    const lomas = await prisma.edificio.findFirst({
      where: { organizacionId: orgB, activo: true },
      select: { id: true },
    });
    const { status: porEdificio } = await apiFetch(
      baseUrl,
      `/api/edificios/${lomas.id}/gastos/dashboard?todo=1`,
      { token: adminSur.accessToken }
    );
    assert.equal(porEdificio, 200);
  });

  it('la org B no ve el dashboard de un edificio de la org A', async () => {
    const { status, data } = await dashboardEdificio(`?periodo=${P_FOCO}`, adminSur.accessToken);
    assert.equal(status, 403);
    assert.equal(data.error.code, 'FUERA_DE_ORGANIZACION');
  });

  it('sin token no hay dashboard', async () => {
    const { status } = await dashboardEdificio(`?periodo=${P_FOCO}`);
    assert.equal(status, 401);
  });
});
