// tests/cuotas.test.js — Cuotas de gastos extraordinarios (S3-19)
// Spec: issue #67 · research docs/investigacion/ordinarias-extraordinarias-y-categorias.md
// (brecha 1) · PRD-06-01 §3.2 (el mockup del recibo dibuja "cuota 3/6").
//
// Lo que se defiende acá, en orden de importancia:
//
// 1. Σ cuotas = monto de la factura, EXACTO (el ajuste de centavos va en la
//    última cuota). Es la misma garantía de cero tolerancia que el reparto por UF.
// 2. La liquidación de un período imputa LA CUOTA, no la obra entera.
// 3. Un gasto en cuotas pertenece a los N períodos de su plan (si no, desaparece
//    de la lista en todos los meses menos el primero).
// 4. El rótulo "cuota k/N" es un SNAPSHOT: editar el plan no reescribe un recibo
//    ya emitido.
// 5. El candado de liquidación sigue valiendo con cuotas (409).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import { planDeCuotas, sumarPeriodo, LiquidacionError } from '../src/core/liquidacion.engine.js';

const SUFIJO = randomUUID().slice(0, 8);

// Períodos propios (2018) para no cruzarse con los de los otros specs.
const P1 = '2018-01';
const P2 = '2018-02';
const P3 = '2018-03';
const PERIODOS = [P1, P2, P3];

describe('plan de cuotas: el motor (S3-19)', () => {
  it('divide en N cuotas mensuales consecutivas y la suma es exacta', () => {
    const cuotas = planDeCuotas('1000.00', 3, '2026-07');

    assert.deepEqual(
      cuotas.map((c) => c.periodo),
      ['2026-07', '2026-08', '2026-09']
    );
    assert.deepEqual(
      cuotas.map((c) => c.monto),
      ['333.33', '333.33', '333.34'] // el resto va en la última
    );
    const suma = cuotas.reduce((acc, c) => acc.plus(new Decimal(c.monto)), new Decimal(0));
    assert.equal(suma.toFixed(2), '1000.00');
  });

  it('cruza el año sin tocar Date', () => {
    const cuotas = planDeCuotas('600000', 6, '2026-11');
    assert.deepEqual(
      cuotas.map((c) => c.periodo),
      ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']
    );
    assert.equal(sumarPeriodo('2026-12', 1), '2027-01');
    assert.equal(sumarPeriodo('2026-01', -1), '2025-12');
  });

  it('la suma cierra exacta para cualquier cantidad de cuotas', () => {
    // 7, 11 y 13 no dividen redondo a ningún monto "lindo": son justo los casos
    // donde un redondeo por cuota dejaría diferencia contra el total.
    for (const n of [2, 7, 11, 13, 120]) {
      for (const monto of ['1000.00', '0.05', '99999.99', '1234567.89']) {
        const cuotas = planDeCuotas(monto, n, '2026-01');
        const suma = cuotas.reduce((acc, c) => acc.plus(new Decimal(c.monto)), new Decimal(0));
        assert.equal(suma.toFixed(2), new Decimal(monto).toFixed(2), `${monto} en ${n} cuotas`);
        assert.equal(cuotas.length, n);
      }
    }
  });

  it('rechaza un plan de menos de 2 cuotas y un período inválido', () => {
    assert.throws(() => planDeCuotas('100', 1, '2026-01'), (err) => {
      assert.ok(err instanceof LiquidacionError);
      assert.equal(err.codigo, 'CUOTAS_INVALIDAS');
      return true;
    });
    assert.throws(() => planDeCuotas('100', 3, '2026-13'), (err) => {
      assert.equal(err.codigo, 'PERIODO_INVALIDO');
      return true;
    });
  });
});

describe('cuotas de gastos extraordinarios: la API (S3-19)', () => {
  let server;
  let baseUrl;
  let admin;
  let orgA;
  let torre;
  let proveedor;
  let rubroHoja;
  const gastosCreados = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    orgA = admin.user.organizacionId;

    torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true },
    });
    assert.ok(torre && rubroHoja, 'el seed debe traer Torre Palermo y el maestro de rubros');

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Obras ${SUFIJO}` },
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

    // Las cuotas caen por CASCADE con el gasto.
    await prisma.gasto.deleteMany({
      where: { OR: [{ id: { in: gastosCreados } }, { concepto: { contains: SUFIJO } }] },
    });
    await prisma.proveedor.deleteMany({ where: { razonSocial: { contains: SUFIJO } } });

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: admin.refreshToken },
    });
    await cerrarApp(server);
  });

  // ─── Helpers ───

  const obraBase = (extra = {}) => ({
    proveedorId: proveedor.id,
    rubroId: rubroHoja.id,
    concepto: `Pintura fachada ${SUFIJO}`,
    monto: '1000.00',
    categoria: 'A',
    esOrdinario: false,
    fechaGasto: '2018-01-10',
    periodo: P1,
    ...extra,
  });

  async function crearObra(body) {
    const res = await apiFetch(baseUrl, `/api/edificios/${torre.id}/gastos`, {
      method: 'POST',
      token: admin.accessToken,
      body,
    });
    if (res.status === 201) gastosCreados.push(res.data.id);
    return res;
  }

  const listar = (query) =>
    apiFetch(baseUrl, `/api/edificios/${torre.id}/gastos?${query}`, {
      token: admin.accessToken,
    });

  const liquidar = (periodo) =>
    apiFetch(baseUrl, `/api/edificios/${torre.id}/liquidaciones`, {
      method: 'POST',
      token: admin.accessToken,
      body: { periodo },
    });

  // ─── Alta ───

  it('el alta con cuotasTotal genera el plan y Σ cuotas = el total de la factura', async () => {
    const { status, data } = await crearObra(obraBase({ monto: '1000.00', cuotasTotal: 3 }));

    assert.equal(status, 201);
    assert.equal(data.monto, '1000.00', 'el gasto sigue siendo la factura completa');
    assert.equal(data.cuotasTotal, 3);
    assert.equal(data.cuotas.length, 3);
    assert.deepEqual(
      data.cuotas.map((c) => [c.numero, c.periodo, c.monto]),
      [
        [1, P1, '333.33'],
        [2, P2, '333.33'],
        [3, P3, '333.34'],
      ]
    );
    const suma = data.cuotas.reduce((acc, c) => acc.plus(new Decimal(c.monto)), new Decimal(0));
    assert.equal(suma.toFixed(2), data.monto);
  });

  it('un gasto sin cuotasTotal queda de imputación única (el default no cambió)', async () => {
    const { status, data } = await crearObra(
      obraBase({ concepto: `Sin plan ${SUFIJO}`, periodo: P2 })
    );
    assert.equal(status, 201);
    assert.equal(data.cuotasTotal, null);
    assert.deepEqual(data.cuotas, []);
  });

  it('una ordinaria no se imputa en cuotas (422)', async () => {
    const { status, data } = await crearObra(
      obraBase({ concepto: `Ordinaria ${SUFIJO}`, esOrdinario: true, cuotasTotal: 3 })
    );
    assert.equal(status, 422);
    assert.equal(data.error.code, 'VALIDACION_FALLIDA');
    assert.match(data.error.message, /extraordinario/);
  });

  it('rechaza un plan de 1 cuota o de más de 120 (422)', async () => {
    for (const cuotasTotal of [1, 121]) {
      const { status } = await crearObra(obraBase({ cuotasTotal }));
      assert.equal(status, 422, `cuotasTotal ${cuotasTotal} debe ser rechazado`);
    }
  });

  // ─── Lista ───

  it('un gasto en cuotas aparece en TODOS los períodos de su plan, con el monto imputado', async () => {
    const { data } = await listar(`periodo=${P3}`);
    const fila = data.data.find((g) => g.concepto === `Pintura fachada ${SUFIJO}`);

    assert.ok(fila, 'la obra tiene que aparecer en el período de su cuota 3, no solo en el primero');
    assert.equal(fila.monto, '1000.00', 'el monto de la factura sigue disponible');
    assert.equal(fila.montoImputado, '333.34', 'lo que aporta a ESTE período es la cuota');
    assert.deepEqual(fila.cuota, {
      id: fila.cuota.id,
      numero: 3,
      cuotasTotal: 3,
    });
  });

  it('los totales del filtro suman imputados y reconcilian con sus dos cortes', async () => {
    const { data } = await listar(`periodo=${P1}`);
    const totales = data.totales;

    // En P1 solo hay una imputación nuestra: la cuota 1 de la obra. El período es
    // de 2018, así que ningún otro gasto del seed cae acá.
    assert.equal(totales.monto, '333.33');
    assert.equal(totales.extraordinarios.monto, '333.33');
    assert.equal(totales.ordinarios.monto, '0.00');
    assert.equal(totales.porCategoria.A.monto, '333.33');

    // Los dos cortes reconcilian con el total (invariante de S3-08b).
    const porTipo = new Decimal(totales.ordinarios.monto).plus(totales.extraordinarios.monto);
    const porCategoria = ['A', 'B', 'C'].reduce(
      (acc, k) => acc.plus(totales.porCategoria[k].monto),
      new Decimal(0)
    );
    assert.equal(porTipo.toFixed(2), totales.monto);
    assert.equal(porCategoria.toFixed(2), totales.monto);
  });

  it('sin filtro de período la fila es la factura, no una imputación', async () => {
    const { data } = await listar(`q=Pintura fachada ${SUFIJO}`);
    const fila = data.data.find((g) => g.concepto === `Pintura fachada ${SUFIJO}`);
    assert.equal(fila.montoImputado, null);
    assert.equal(fila.cuota, null);
    assert.equal(fila.monto, '1000.00');
  });

  // ─── Liquidación ───

  it('la liquidación de un período imputa LA CUOTA, no la obra entera', async () => {
    const { status, data } = await liquidar(P1);

    assert.equal(status, 201);
    assert.equal(data.totalExtraordinarias, '333.33', 'la obra entera son 1000: se imputa la cuota 1');
    assert.equal(data.totalGeneral, '333.33');

    // La suma de los detalles por UF = el total (cero tolerancia, DoD del sprint).
    const suma = data.unidades.reduce((acc, u) => acc.plus(new Decimal(u.total)), new Decimal(0));
    assert.equal(suma.toFixed(2), data.totalGeneral);

    // El rótulo "cuota k/N" viaja en la preview, por gasto y por UF.
    const conCuota = data.unidades.flatMap((u) => u.pesos).filter((p) => p.cuotasTotal !== null);
    assert.ok(conCuota.length > 0, 'la preview debe exponer la cuota imputada');
    assert.ok(conCuota.every((p) => p.cuotaNumero === 1 && p.cuotasTotal === 3));
  });

  it('el período siguiente liquida la cuota siguiente del mismo gasto', async () => {
    const { status, data } = await liquidar(P2);

    assert.equal(status, 201);
    // P2 tiene la cuota 2 de la obra (333.33) + el gasto de imputación única (1000).
    assert.equal(data.totalExtraordinarias, '1333.33');

    const detalles = await prisma.liquidacionDetalle.findMany({
      where: { liquidacionId: data.id, cuotaNumero: { not: null } },
      select: { cuotaNumero: true, cuotasTotal: true, gastoCuotaId: true },
    });
    assert.ok(detalles.length > 0);
    assert.ok(
      detalles.every((d) => d.cuotaNumero === 2 && d.cuotasTotal === 3 && d.gastoCuotaId),
      'el detalle guarda el snapshot de la cuota y su id'
    );
  });

  it('un período sin ninguna imputación responde 422 SIN_GASTOS', async () => {
    const { status, data } = await liquidar('2018-11');
    assert.equal(status, 422);
    assert.equal(data.error.code, 'SIN_GASTOS');
  });

  // ─── Edición y candado ───

  it('editar el monto regenera el plan completo', async () => {
    const { data: creado } = await crearObra(
      obraBase({ concepto: `Regenerar ${SUFIJO}`, monto: '900.00', cuotasTotal: 3, periodo: P3 })
    );
    assert.deepEqual(
      creado.cuotas.map((c) => c.monto),
      ['300.00', '300.00', '300.00']
    );

    const { status, data } = await apiFetch(baseUrl, `/api/gastos/${creado.id}`, {
      method: 'PUT',
      token: admin.accessToken,
      body: { monto: '1000.00' },
    });

    assert.equal(status, 200);
    assert.equal(data.cuotas.length, 3, 'sigue siendo un plan de 3, no se duplicaron las filas');
    assert.deepEqual(
      data.cuotas.map((c) => c.monto),
      ['333.33', '333.33', '333.34']
    );
  });

  it('cuotasTotal: null borra el plan y vuelve a imputación única', async () => {
    const { data: creado } = await crearObra(
      obraBase({ concepto: `Sin plan otra vez ${SUFIJO}`, cuotasTotal: 4, periodo: P3 })
    );
    const { status, data } = await apiFetch(baseUrl, `/api/gastos/${creado.id}`, {
      method: 'PUT',
      token: admin.accessToken,
      body: { cuotasTotal: null },
    });

    assert.equal(status, 200);
    assert.equal(data.cuotasTotal, null);
    assert.deepEqual(data.cuotas, []);
  });

  it('un gasto con una cuota ya liquidada y aprobada no se edita ni se borra (409)', async () => {
    // La liquidación de P1 (creada arriba) tiene la cuota 1 de la obra.
    const liquidacion = await prisma.liquidacion.findFirst({
      where: { periodo: P1, edificioId: torre.id },
      select: { id: true },
    });
    const aprobada = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}/aprobar`, {
      method: 'POST',
      token: admin.accessToken,
    });
    assert.equal(aprobada.status, 200, 'la aprobación es el candado que congela el gasto');

    const obraId = gastosCreados[0];
    const edicion = await apiFetch(baseUrl, `/api/gastos/${obraId}`, {
      method: 'PUT',
      token: admin.accessToken,
      body: { cuotasTotal: 6 },
    });
    assert.equal(edicion.status, 409);
    assert.equal(edicion.data.error.code, 'LIQUIDACION_APROBADA');

    const borrado = await apiFetch(baseUrl, `/api/gastos/${obraId}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(borrado.status, 409);
  });
});
