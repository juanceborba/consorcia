// tests/esquemas-reparto.test.js — Esquemas de reparto configurables (S3-20)
// Spec: issue #68 · diseño docs/investigacion/esquemas-de-reparto.md
// Base legal: CCyC art. 2049, último párrafo (el reglamento puede eximir
// PARCIALMENTE a las UF sin acceso a un servicio o sector).
//
// Lo que se defiende acá, en orden de importancia:
//
// 1. RETROCOMPATIBILIDAD: un edificio sin esquemas liquida EXACTAMENTE como antes.
//    Es el requisito que hace aditivo todo el resto.
// 2. Los cuatro repartos que antes no se podían expresar: exención parcial,
//    coeficiente propio de un sector, partes iguales y cargo a una sola UF.
// 3. INMUTABILIDAD: renombrar o desactivar un esquema no reescribe un recibo
//    ya emitido (el snapshot del detalle es la única defensa).
// 4. La cadena de resolución (override del gasto → esquema del edificio →
//    general → ninguno) es determinística, y el general NO se le aplica a un
//    gasto B/C sin esquema propio.
// 5. El motor sigue cerrado: base y alcance son enums, no fórmulas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import {
  pesosDe,
  pesosDeEsquema,
  LiquidacionEngine,
  LiquidacionError,
} from '../src/core/liquidacion.engine.js';
import { esquemaAplicable } from '../src/services/esquemas-reparto.js';

const SUFIJO = randomUUID().slice(0, 8);

// Períodos propios (2017) para no cruzarse con los otros specs.
const P1 = '2017-01';
const P2 = '2017-02';
const PERIODOS = [P1, P2];

const suma = (pesos) => [...pesos.values()].reduce((a, p) => a.plus(p), new Decimal(0));
const peso = (pesos, id) => pesos.get(id).toString();

// ---------------------------------------------------------------------------
// El motor, sin base de datos
// ---------------------------------------------------------------------------

describe('esquemas de reparto: el motor (S3-20)', () => {
  // Un edificio de juguete: dos UF con ascensor, una PB con ascensor y una
  // cochera sin ascensor. Σ coeficientes = 1.
  const UNIDADES = [
    { id: 'u1', coeficiente: '0.300000', categoriaB: ['ascensor'], categoriaC: 'torre_a' },
    { id: 'u2', coeficiente: '0.300000', categoriaB: ['ascensor'], categoriaC: 'torre_a' },
    { id: 'pb', coeficiente: '0.200000', categoriaB: ['ascensor'], categoriaC: 'torre_b' },
    { id: 'coch', coeficiente: '0.200000', categoriaB: [], categoriaC: null },
  ];

  it('sin esquema, los pesos son los de siempre (retrocompatible al centavo)', () => {
    // Categoría A: el coeficiente crudo de cada UF.
    const generales = pesosDe({ categoria: 'A' }, UNIDADES);
    assert.equal(peso(generales, 'u1'), '0.3');
    assert.equal(peso(generales, 'coch'), '0.2');
    assert.equal(suma(generales).toString(), '1');

    // Categoría B: 0 en las no alcanzadas, y el reparto se renormaliza al
    // dividir por Σpesos (la cochera no paga el ascensor).
    const ascensor = pesosDe(
      { categoria: 'B', servicioEspecifico: 'ascensor' },
      UNIDADES
    );
    assert.equal(peso(ascensor, 'coch'), '0');
    assert.equal(suma(ascensor).toString(), '0.8');
  });

  it('exención parcial: "PB abona el 50% del ascensor" (CCyC art. 2049)', () => {
    const esquema = {
      id: 'e1',
      nombre: 'Ascensor (PB al 50%)',
      base: 'COEFICIENTE',
      alcance: 'SERVICIO',
      alcanceValor: 'ascensor',
      pesos: [{ unidadId: 'pb', peso: '0.5' }],
    };
    const pesos = pesosDeEsquema(esquema, UNIDADES);

    // La fila ausente vale 1: u1 y u2 quedan con su coeficiente entero.
    assert.equal(peso(pesos, 'u1'), '0.3');
    // PB con la mitad de su coeficiente…
    assert.equal(peso(pesos, 'pb'), '0.1');
    // …y la cochera fuera del alcance, en 0.
    assert.equal(peso(pesos, 'coch'), '0');

    // El reparto de $700: la mitad exenta de PB la absorben las alcanzadas.
    const distribucion = LiquidacionEngine.calcularDistribucion(
      { monto: '700.00', categoria: 'B', servicioEspecifico: 'ascensor', esquema },
      UNIDADES
    );
    const porId = new Map(distribucion.map((d) => [d.unidadId, d.monto]));
    assert.equal(porId.get('u1'), '300.00'); // 0.3 / 0.7 × 700
    assert.equal(porId.get('u2'), '300.00');
    assert.equal(porId.get('pb'), '100.00'); // 0.1 / 0.7 × 700
    assert.equal(porId.get('coch'), '0.00');
  });

  it('coeficiente propio de un sector: la segunda tabla del reglamento', () => {
    // PESOS_PROPIOS: el peso NO es proporcional al coeficiente general. Es el
    // hallazgo de corrección del research — hasta S3-20 emitíamos importes
    // distintos de los que manda el reglamento, sin ninguna señal.
    const esquema = {
      id: 'e2',
      nombre: 'Torre A (coeficiente del reglamento)',
      base: 'PESOS_PROPIOS',
      alcance: 'SECTOR',
      alcanceValor: 'torre_a',
      pesos: [
        { unidadId: 'u1', peso: '0.400000' },
        { unidadId: 'u2', peso: '0.600000' },
      ],
    };
    const distribucion = LiquidacionEngine.calcularDistribucion(
      { monto: '1000.00', categoria: 'C', sectorEspecifico: 'torre_a', esquema },
      UNIDADES
    );
    const porId = new Map(distribucion.map((d) => [d.unidadId, d.monto]));
    // 40/60, no 50/50 como daría el coeficiente general (u1 y u2 son iguales).
    assert.equal(porId.get('u1'), '400.00');
    assert.equal(porId.get('u2'), '600.00');
    assert.equal(porId.get('pb'), '0.00');
  });

  it('partes iguales: por UF, no por coeficiente', () => {
    const esquema = {
      id: 'e3',
      nombre: 'Partes iguales',
      base: 'PARTES_IGUALES',
      alcance: 'TODAS',
      alcanceValor: null,
      pesos: [],
    };
    const distribucion = LiquidacionEngine.calcularDistribucion(
      { monto: '1000.00', categoria: 'A', esquema },
      UNIDADES
    );
    // Cuatro UF, $250 cada una, aunque sus coeficientes sean 0.3 y 0.2.
    assert.deepEqual(
      distribucion.map((d) => d.monto),
      ['250.00', '250.00', '250.00', '250.00']
    );
  });

  it('cargo particular a una sola UF: alcance SELECCION', () => {
    const esquema = {
      id: 'e4',
      nombre: 'Rotura 1A',
      base: 'PARTES_IGUALES',
      alcance: 'SELECCION',
      alcanceValor: null,
      pesos: [{ unidadId: 'u1', peso: '1' }],
    };
    const distribucion = LiquidacionEngine.calcularDistribucion(
      { monto: '15000.00', categoria: 'A', esquema },
      UNIDADES
    );
    const porId = new Map(distribucion.map((d) => [d.unidadId, d.monto]));
    assert.equal(porId.get('u1'), '15000.00');
    assert.equal(porId.get('u2'), '0.00');
    assert.equal(porId.get('coch'), '0.00');
  });

  it('exención total: peso 0 en la UF bonificada (el encargado que vive ahí)', () => {
    const esquema = {
      id: 'e5',
      nombre: 'Bonificación PB',
      base: 'COEFICIENTE',
      alcance: 'TODAS',
      alcanceValor: null,
      pesos: [{ unidadId: 'pb', peso: '0' }],
    };
    const pesos = pesosDeEsquema(esquema, UNIDADES);
    assert.equal(peso(pesos, 'pb'), '0');
    assert.equal(suma(pesos).toString(), '0.8');
  });

  it('el ajuste de centavos cierra exacto también con un esquema', () => {
    // Tres UF alcanzadas y un monto que no divide redondo: el resto va a la
    // última alcanzada y la suma tiene que ser EXACTA (cero tolerancia).
    const esquema = {
      id: 'e6',
      nombre: 'Partes iguales ascensor',
      base: 'PARTES_IGUALES',
      alcance: 'SERVICIO',
      alcanceValor: 'ascensor',
      pesos: [],
    };
    for (const monto of ['100.00', '0.01', '1234567.89', '99999.99']) {
      const distribucion = LiquidacionEngine.calcularDistribucion(
        { monto, categoria: 'B', servicioEspecifico: 'ascensor', esquema },
        UNIDADES
      );
      const total = distribucion.reduce((a, d) => a.plus(new Decimal(d.monto)), new Decimal(0));
      assert.equal(total.toFixed(2), new Decimal(monto).toFixed(2), monto);
    }
  });

  it('un esquema que no alcanza a nadie falla nombrándolo, no con un desbalance mudo', () => {
    const esquema = {
      id: 'e7',
      nombre: 'Sector fantasma',
      base: 'COEFICIENTE',
      alcance: 'SECTOR',
      alcanceValor: 'torre_z',
      pesos: [],
    };
    assert.throws(
      () =>
        LiquidacionEngine.calcularDistribucion(
          { monto: '100.00', categoria: 'C', sectorEspecifico: 'torre_z', esquema },
          UNIDADES
        ),
      (err) => {
        assert.ok(err instanceof LiquidacionError);
        assert.equal(err.codigo, 'DESBALANCE_LIQUIDACION');
        assert.match(err.message, /Sector fantasma/);
        return true;
      }
    );
  });

  it('base y alcance son enums cerrados: no hay fórmulas configurables', () => {
    for (const roto of [
      { base: 'FORMULA', alcance: 'TODAS' },
      { base: 'COEFICIENTE', alcance: 'SI_LLUEVE' },
    ]) {
      assert.throws(
        () => pesosDeEsquema({ id: 'x', nombre: 'x', alcanceValor: null, pesos: [], ...roto }, UNIDADES),
        (err) => {
          assert.equal(err.codigo, 'ESQUEMA_INVALIDO');
          return true;
        }
      );
    }
  });
});

// ---------------------------------------------------------------------------
// La cadena de resolución, pura
// ---------------------------------------------------------------------------

describe('esquemas de reparto: la resolución (S3-20)', () => {
  const ASCENSOR = { id: 'a', activo: true, alcance: 'SERVICIO', alcanceValor: 'ascensor' };
  const TORRE_A = { id: 't', activo: true, alcance: 'SECTOR', alcanceValor: 'torre_a' };
  const GENERAL = { id: 'g', activo: true, alcance: 'TODAS', alcanceValor: null };
  const VIEJO = { id: 'v', activo: false, alcance: 'SERVICIO', alcanceValor: 'ascensor' };
  const TODOS = [ASCENSOR, TORRE_A, GENERAL, VIEJO];

  it('el override del gasto gana sobre todo lo demás', () => {
    const gasto = { categoria: 'B', servicioEspecifico: 'ascensor', esquemaRepartoId: 't' };
    assert.equal(esquemaAplicable(gasto, TODOS, 'g').id, 't');
  });

  it('el override se respeta aunque el esquema esté desactivado', () => {
    // Desactivar deja de OFRECER el esquema; cambiarle el reparto por debajo a un
    // gasto que ya lo eligió sería mover plata sin que nadie lo pida.
    const gasto = { categoria: 'A', esquemaRepartoId: 'v' };
    assert.equal(esquemaAplicable(gasto, TODOS, 'g').id, 'v');
  });

  it('sin override, matchea el esquema activo del servicio o del sector', () => {
    assert.equal(
      esquemaAplicable({ categoria: 'B', servicioEspecifico: 'ascensor' }, TODOS).id,
      'a'
    );
    assert.equal(
      esquemaAplicable({ categoria: 'C', sectorEspecifico: 'torre_a' }, TODOS).id,
      't'
    );
  });

  it('un B/C sin esquema propio NO cae al general', () => {
    // Si el general fuera "partes iguales entre todas", aplicarlo a un gasto de
    // calefacción haría pagar la calefacción a las UF que el reglamento eximió.
    assert.equal(
      esquemaAplicable({ categoria: 'B', servicioEspecifico: 'calefaccion' }, TODOS, 'g'),
      null
    );
  });

  it('el general aplica solo a la categoría A, y sin general devuelve null', () => {
    assert.equal(esquemaAplicable({ categoria: 'A' }, TODOS, 'g').id, 'g');
    assert.equal(esquemaAplicable({ categoria: 'A' }, TODOS, null), null);
  });
});

// ---------------------------------------------------------------------------
// La API
// ---------------------------------------------------------------------------

describe('esquemas de reparto: la API (S3-20)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let orgA;
  let torre;
  let unidades;
  let pb;
  let otroEdificio;
  let proveedor;
  let rubroHoja;
  const esquemasCreados = [];
  const gastosCreados = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    // `gestor2` tiene AMBOS edificios asignados; `gestor@demo.com` solo Torre
    // Palermo, y este spec trabaja sobre San Martín.
    ({ data: gestor } = await login(baseUrl, 'gestor2@demo.com', 'demo1234'));
    orgA = admin.user.organizacionId;

    // San Martín y no Torre Palermo: el seed deja a Torre Palermo CON el esquema
    // del ascensor configurado (art. 12 de su reglamento) y a San Martín SIN
    // nada. Este spec necesita el edificio virgen — configurarlo es justamente lo
    // que prueba, y el índice único del alcance activo rechazaría un segundo
    // esquema de ascensor en Torre Palermo (que es lo que se verifica aparte).
    torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, nombre: { contains: 'San Mart' } },
      select: { id: true },
    });
    // `activo: true`: la DB de desarrollo arrastra edificios de E2E dados de
    // baja, y `validarEdificio` los responde 404.
    otroEdificio = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, activo: true, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    unidades = await prisma.unidad.findMany({
      where: { edificioId: torre.id },
      select: { id: true, numero: true, coeficiente: true, categoriaB: true },
      orderBy: { numero: 'asc' },
    });
    pb = unidades.find((u) => u.numero === 'PB');
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true },
    });
    assert.ok(torre && otroEdificio && pb && rubroHoja, 'el seed debe traer los dos edificios');

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Ascensores ${SUFIJO}` },
    });
  });

  after(async () => {
    const liquidaciones = await prisma.liquidacion.findMany({
      where: { periodo: { in: PERIODOS } },
      select: { id: true },
    });
    const ids = liquidaciones.map((l) => l.id);
    await prisma.recibo.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacionDetalle.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacion.deleteMany({ where: { id: { in: ids } } });

    await prisma.gasto.deleteMany({
      where: { OR: [{ id: { in: gastosCreados } }, { concepto: { contains: SUFIJO } }] },
    });
    await prisma.configuracionLiquidacion.deleteMany({ where: { edificioId: torre.id } });
    // Los pesos caen por CASCADE con el esquema.
    await prisma.esquemaReparto.deleteMany({ where: { nombre: { contains: SUFIJO } } });
    await prisma.proveedor.deleteMany({ where: { razonSocial: { contains: SUFIJO } } });

    for (const sesion of [admin, gestor]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  // ─── Helpers ───

  async function crearEsquema(body, { token = admin.accessToken, edificioId } = {}) {
    const res = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioId ?? torre.id}/esquemas-reparto`,
      { method: 'POST', token, body }
    );
    if (res.status === 201) esquemasCreados.push(res.data.id);
    return res;
  }

  const listarEsquemas = (token = admin.accessToken) =>
    apiFetch(baseUrl, `/api/edificios/${torre.id}/esquemas-reparto`, { token });

  const configurar = (body, token = admin.accessToken) =>
    apiFetch(baseUrl, `/api/edificios/${torre.id}/configuracion-liquidacion`, {
      method: 'PUT',
      token,
      body,
    });

  async function crearGasto(body) {
    const res = await apiFetch(baseUrl, `/api/edificios/${torre.id}/gastos`, {
      method: 'POST',
      token: admin.accessToken,
      body,
    });
    if (res.status === 201) gastosCreados.push(res.data.id);
    return res;
  }

  const gastoBase = (extra = {}) => ({
    proveedorId: proveedor.id,
    rubroId: rubroHoja.id,
    concepto: `Abono ascensor ${SUFIJO}`,
    monto: '1000.00',
    categoria: 'B',
    servicioEspecifico: 'ascensor',
    esOrdinario: true,
    fechaGasto: '2017-01-10',
    periodo: P1,
    ...extra,
  });

  const liquidar = (periodo) =>
    apiFetch(baseUrl, `/api/edificios/${torre.id}/liquidaciones`, {
      method: 'POST',
      token: admin.accessToken,
      body: { periodo },
    });

  // ─── Alta y validaciones ───

  it('crea el esquema de exención parcial con la cláusula del reglamento', async () => {
    const { status, data } = await crearEsquema({
      nombre: `Ascensor PB al 50% ${SUFIJO}`,
      base: 'COEFICIENTE',
      alcance: 'SERVICIO',
      alcanceValor: 'ascensor',
      clausulaReglamento: 'art. 12 del reglamento de copropiedad',
      pesos: [{ unidadId: pb.id, peso: '0.5' }],
    });

    assert.equal(status, 201);
    assert.equal(data.base, 'COEFICIENTE');
    assert.equal(data.activo, true);
    assert.equal(data.clausulaReglamento, 'art. 12 del reglamento de copropiedad');
    // El peso sale como string de 6 decimales, nunca como número.
    assert.deepEqual(data.pesos, [{ unidadId: pb.id, numero: 'PB', peso: '0.500000' }]);
  });

  it('rechaza un segundo esquema activo para el mismo servicio (409): el matcheo tiene que ser único', async () => {
    const { status, data } = await crearEsquema({
      nombre: `Otro ascensor ${SUFIJO}`,
      base: 'PARTES_IGUALES',
      alcance: 'SERVICIO',
      alcanceValor: 'ascensor',
    });
    assert.equal(status, 409);
    assert.equal(data.error.code, 'ALCANCE_OCUPADO');
  });

  it('rechaza el nombre repetido en el mismo edificio (409)', async () => {
    const { status, data } = await crearEsquema({
      nombre: `Ascensor PB al 50% ${SUFIJO}`,
      base: 'PARTES_IGUALES',
      alcance: 'TODAS',
    });
    assert.equal(status, 409);
    assert.equal(data.error.code, 'ESQUEMA_DUPLICADO');
  });

  it('rechaza las incoherencias de alcance y de pesos (422)', async () => {
    const casos = [
      [{ nombre: `Sin valor ${SUFIJO}`, base: 'COEFICIENTE', alcance: 'SECTOR' }, /alcanceValor/],
      [
        { nombre: `Con valor ${SUFIJO}`, base: 'COEFICIENTE', alcance: 'TODAS', alcanceValor: 'x' },
        /no lleva valor/,
      ],
      [
        { nombre: `Selección vacía ${SUFIJO}`, base: 'PARTES_IGUALES', alcance: 'SELECCION' },
        /al menos una con peso mayor a 0/,
      ],
      [
        { nombre: `Propios vacío ${SUFIJO}`, base: 'PESOS_PROPIOS', alcance: 'TODAS' },
        /al menos una con peso mayor a 0/,
      ],
    ];
    for (const [body, mensaje] of casos) {
      const { status, data } = await crearEsquema(body);
      assert.equal(status, 422, JSON.stringify(body));
      assert.equal(data.error.code, 'VALIDACION_FALLIDA');
      assert.match(data.error.message, mensaje);
    }
  });

  it('rechaza un peso negativo y una UF de otro edificio (422)', async () => {
    const negativo = await crearEsquema({
      nombre: `Negativo ${SUFIJO}`,
      base: 'COEFICIENTE',
      alcance: 'TODAS',
      pesos: [{ unidadId: pb.id, peso: '-1' }],
    });
    assert.equal(negativo.status, 422);
    assert.match(negativo.data.error.message, /negativo/);

    const ajena = await prisma.unidad.findFirst({
      where: { edificioId: otroEdificio.id },
      select: { id: true },
    });
    const { status, data } = await crearEsquema({
      nombre: `UF ajena ${SUFIJO}`,
      base: 'COEFICIENTE',
      alcance: 'TODAS',
      pesos: [{ unidadId: ajena.id, peso: '0.5' }],
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'UNIDAD_INVALIDA');
  });

  // ─── Permisos ───

  it('el gestor lee los esquemas de su edificio pero no los crea (403)', async () => {
    const lectura = await listarEsquemas(gestor.accessToken);
    assert.equal(lectura.status, 200);
    assert.ok(Array.isArray(lectura.data.data));

    const escritura = await crearEsquema(
      { nombre: `Del gestor ${SUFIJO}`, base: 'PARTES_IGUALES', alcance: 'TODAS' },
      { token: gestor.accessToken }
    );
    assert.equal(escritura.status, 403);
  });

  // ─── Configuración del edificio ───

  it('el setup del edificio arranca vacío y eso YA significa "por coeficiente"', async () => {
    const { status, data } = await listarEsquemas();
    assert.equal(status, 200);
    assert.equal(data.configuracion.esquemaGeneralId, null);
    assert.equal(data.configuracion.esquemaGeneral, null);
  });

  it('configura el esquema general y rechaza uno de otro edificio (422)', async () => {
    const iguales = await crearEsquema({
      nombre: `Partes iguales ${SUFIJO}`,
      base: 'PARTES_IGUALES',
      alcance: 'TODAS',
    });
    assert.equal(iguales.status, 201);

    const ok = await configurar({ esquemaGeneralId: iguales.data.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.esquemaGeneralId, iguales.data.id);
    assert.equal(ok.data.esquemaGeneral.nombre, `Partes iguales ${SUFIJO}`);

    const ajeno = await crearEsquema(
      { nombre: `Ajeno ${SUFIJO}`, base: 'PARTES_IGUALES', alcance: 'TODAS' },
      { edificioId: otroEdificio.id }
    );
    assert.equal(ajeno.status, 201);
    const mal = await configurar({ esquemaGeneralId: ajeno.data.id });
    assert.equal(mal.status, 422);
    assert.equal(mal.data.error.code, 'ESQUEMA_INVALIDO');

    // Y se puede desconfigurar: vuelve el default de siempre.
    const limpio = await configurar({ esquemaGeneralId: null });
    assert.equal(limpio.status, 200);
    assert.equal(limpio.data.esquemaGeneralId, null);
  });

  // ─── El override del gasto ───

  it('el gasto adopta el esquema del edificio o trae el suyo, y rechaza uno ajeno (422)', async () => {
    const { data: esquemas } = await listarEsquemas();
    const ascensor = esquemas.data.find((e) => e.nombre === `Ascensor PB al 50% ${SUFIJO}`);
    const iguales = esquemas.data.find((e) => e.nombre === `Partes iguales ${SUFIJO}`);

    // Sin override: el gasto adopta lo del edificio (null en la columna).
    const adopta = await crearGasto(gastoBase());
    assert.equal(adopta.status, 201);
    assert.equal(adopta.data.esquemaRepartoId, null);

    // Con override: se guarda y viaja con el nombre para la UI.
    const propio = await crearGasto(
      gastoBase({ concepto: `Con override ${SUFIJO}`, esquemaRepartoId: iguales.id })
    );
    assert.equal(propio.status, 201);
    assert.equal(propio.data.esquemaRepartoId, iguales.id);
    assert.equal(propio.data.esquemaReparto.nombre, `Partes iguales ${SUFIJO}`);

    // Un esquema de otro edificio no se distingue de uno inexistente.
    const ajeno = await prisma.esquemaReparto.findFirst({
      where: { edificioId: otroEdificio.id, nombre: { contains: SUFIJO } },
      select: { id: true },
    });
    const mal = await crearGasto(
      gastoBase({ concepto: `Override ajeno ${SUFIJO}`, esquemaRepartoId: ajeno.id })
    );
    assert.equal(mal.status, 422);
    assert.equal(mal.data.error.code, 'ESQUEMA_INVALIDO');
    assert.ok(ascensor, 'el esquema del ascensor sigue en la lista');
  });

  // ─── La liquidación ───

  it('la liquidación aplica el esquema del edificio y lo deja en el snapshot', async () => {
    // Un solo gasto de ascensor en P2, sin override: matchea el esquema del
    // edificio (SERVICIO ascensor) y PB tiene que pagar la MITAD de lo que le
    // tocaría por coeficiente.
    const gasto = await crearGasto(
      gastoBase({ concepto: `Ascensor P2 ${SUFIJO}`, periodo: P2, monto: '1000.00' })
    );
    assert.equal(gasto.status, 201);

    const { status, data } = await liquidar(P2);
    assert.equal(status, 201);

    const conAscensor = unidades.filter((u) => u.categoriaB.includes('ascensor'));
    const sumaPesos = conAscensor.reduce(
      (acc, u) =>
        acc.plus(new Decimal(u.coeficiente).times(u.id === pb.id ? new Decimal('0.5') : 1)),
      new Decimal(0)
    );

    // PB es la ÚLTIMA UF alcanzada en el orden del motor, así que absorbe el
    // ajuste de centavos acumulado (nota 4 del motor): su importe se verifica por
    // diferencia contra el total, no contra el ideal.
    let asignadoAlResto = new Decimal(0);
    for (const unidad of conAscensor.filter((u) => u.id !== pb.id)) {
      const fila = data.unidades.find((f) => f.unidadId === unidad.id);
      const esperado = new Decimal(String(unidad.coeficiente)).div(sumaPesos).times(1000);
      assert.equal(fila.total, esperado.toFixed(2), `UF ${unidad.numero}`);
      asignadoAlResto = asignadoAlResto.plus(new Decimal(fila.total));
    }

    const filaDePB = data.unidades.find((f) => f.unidadId === pb.id);
    assert.equal(filaDePB.total, new Decimal(1000).minus(asignadoAlResto).toFixed(2));

    // Lo que expresa la exención parcial sin arrastrar redondeos: el PESO que se
    // le aplicó a PB es la MITAD de su coeficiente, normalizado.
    assert.equal(
      filaDePB.pesos[0].pesoAplicado,
      new Decimal(String(pb.coeficiente)).times('0.5').div(sumaPesos).toFixed(6)
    );

    // Cero tolerancia en el total: Σ por UF = el monto del gasto, EXACTO.
    const totalRepartido = data.unidades.reduce(
      (acc, f) => acc.plus(new Decimal(f.total)),
      new Decimal(0)
    );
    assert.equal(totalRepartido.toFixed(2), '1000.00');

    // El detalle dice con qué esquema se calculó: es lo que le permite al
    // administrador verificar el reparto ANTES de aprobar.
    assert.equal(filaDePB.pesos[0].esquemaNombre, `Ascensor PB al 50% ${SUFIJO}`);

    // Y el snapshot quedó persistido, no derivado del esquema vigente.
    const detalle = await prisma.liquidacionDetalle.findFirst({
      where: { liquidacionId: data.id, unidadId: pb.id },
      select: { esquemaRepartoId: true, esquemaNombre: true },
    });
    assert.equal(detalle.esquemaNombre, `Ascensor PB al 50% ${SUFIJO}`);
    assert.ok(detalle.esquemaRepartoId);
  });

  it('renombrar o desactivar el esquema NO reescribe la liquidación emitida', async () => {
    const liquidacion = await prisma.liquidacion.findFirst({
      where: { edificioId: torre.id, periodo: P2 },
      select: { id: true },
    });
    const antes = await prisma.liquidacionDetalle.findMany({
      where: { liquidacionId: liquidacion.id },
      select: { unidadId: true, esquemaNombre: true, coeficienteAplicado: true, montoAsignado: true },
      orderBy: { unidadId: 'asc' },
    });

    const esquema = await prisma.esquemaReparto.findFirst({
      where: { edificioId: torre.id, nombre: `Ascensor PB al 50% ${SUFIJO}` },
      select: { id: true },
    });
    const renombrado = await apiFetch(baseUrl, `/api/esquemas-reparto/${esquema.id}`, {
      method: 'PUT',
      token: admin.accessToken,
      body: { nombre: `Ascensor sin exención ${SUFIJO}`, pesos: [] },
    });
    assert.equal(renombrado.status, 200);
    assert.deepEqual(renombrado.data.pesos, [], 'pesos: [] vacía la tabla explícitamente');

    const despues = await prisma.liquidacionDetalle.findMany({
      where: { liquidacionId: liquidacion.id },
      select: { unidadId: true, esquemaNombre: true, coeficienteAplicado: true, montoAsignado: true },
      orderBy: { unidadId: 'asc' },
    });
    assert.deepEqual(
      despues.map((d) => [d.unidadId, d.esquemaNombre, String(d.coeficienteAplicado), String(d.montoAsignado)]),
      antes.map((d) => [d.unidadId, d.esquemaNombre, String(d.coeficienteAplicado), String(d.montoAsignado)])
    );
  });

  it('el DELETE borra el esquema sin usar y desactiva el que ya se usó', async () => {
    const sinUsar = await crearEsquema({
      nombre: `Descartable ${SUFIJO}`,
      base: 'PARTES_IGUALES',
      alcance: 'TODAS',
    });
    const borrado = await apiFetch(baseUrl, `/api/esquemas-reparto/${sinUsar.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(borrado.status, 200);
    assert.equal(borrado.data.eliminado, true);

    // El del ascensor está en una liquidación emitida: se desactiva, no se borra
    // (la FK del snapshot es RESTRICT).
    const usado = await prisma.esquemaReparto.findFirst({
      where: { edificioId: torre.id, nombre: `Ascensor sin exención ${SUFIJO}` },
      select: { id: true },
    });
    const desactivado = await apiFetch(baseUrl, `/api/esquemas-reparto/${usado.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(desactivado.status, 200);
    assert.equal(desactivado.data.eliminado, false);
    assert.equal(desactivado.data.desactivado, true);
    assert.ok(desactivado.data.referencias.liquidaciones > 0);
    assert.equal(desactivado.data.esquema.activo, false);
  });

  it('un esquema de otra organización responde 404, no 403', async () => {
    const { data: otroAdmin } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234');
    const esquema = await prisma.esquemaReparto.findFirst({
      where: { edificioId: torre.id },
      select: { id: true },
    });
    const { status, data } = await apiFetch(baseUrl, `/api/esquemas-reparto/${esquema.id}`, {
      token: otroAdmin.accessToken,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'ESQUEMA_NO_ENCONTRADO');
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: otroAdmin.refreshToken },
    });
  });
});
