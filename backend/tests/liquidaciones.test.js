// tests/liquidaciones.test.js — Endpoints de liquidación (S3-04)
// Spec: PRD-04-03 §1 (máquina de estados) / §4.1 (preview) ·
// policy cerbos/policies/liquidacion.yaml · motor src/core/liquidacion.engine.js
//
// Corre contra el stack dockerizado con el seed S1-03/S4-10. Los tres
// principales: `admin@demo.com` (org_admin de Org A), `gestor@demo.com` (gestor
// de Org A, SOLO Torre Palermo) y `admin.sur@demo.com` (org_admin de Org B).
//
// Los períodos son de 2017 a propósito: el smoke y `gastos.test.js` trabajan en
// 2019+ y el índice único parcial de liquidaciones es por
// (organizacion, edificio, periodo) — dos suites pisando el mismo período se
// bloquearían entre sí con 409.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

const SUFIJO = randomUUID().slice(0, 8);

const PERIODO = '2017-01'; // feliz: 3 gastos, liquidación completa
const PERIODO_VACIO = '2017-02'; // sin gastos → 422 SIN_GASTOS
const PERIODO_REGEN = '2017-03'; // anular → regenerar
const PERIODO_ESTADOS = '2017-04'; // aprobar 2 veces, transiciones inválidas
const PERIODO_DESCUADRE = '2017-05'; // edificio con coeficientes ≠ 1
const PERIODO_ORG_B = '2017-06'; // aislamiento entre organizaciones
const PERIODOS = [
  PERIODO,
  PERIODO_VACIO,
  PERIODO_REGEN,
  PERIODO_ESTADOS,
  PERIODO_DESCUADRE,
  PERIODO_ORG_B,
];

describe('liquidaciones (S3-04)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let adminSur;
  let orgA;
  let orgB;
  let torre; // Torre Palermo — de Org A, asignada al gestor
  let lomas; // Edificio Lomas — de Org B
  let descuadrado; // edificio de prueba de Org A con Σcoeficientes = 0.600000
  let proveedor;
  let proveedorSur; // propio de Org B
  let rubroHoja;
  let matriculaOrgA;
  let ufsTorre; // cantidad de UFs de Torre Palermo (se lee del seed, no se asume)

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    ({ matriculaRPA: matriculaOrgA } = await prisma.organizacion.findUnique({
      where: { id: orgA },
      select: { matriculaRPA: true },
    }));

    torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    lomas = await prisma.edificio.findFirst({
      where: { organizacionId: orgB, nombre: 'Edificio Lomas' },
      select: { id: true },
    });
    assert.ok(torre && lomas, 'el seed debe traer Torre Palermo y Edificio Lomas');
    assert.ok(
      gestor.user.edificiosAsignados.includes(torre.id),
      'gestor@demo.com debe tener asignada Torre Palermo'
    );

    // Edificio con la invariante rota a propósito: dos UF de 0.3 → suma 0.6.
    descuadrado = await prisma.edificio.create({
      data: {
        organizacionId: orgA,
        nombre: `Edificio Descuadrado ${SUFIJO}`,
        direccion: 'Calle Falsa 123',
        ciudad: 'CABA',
        provincia: 'CABA',
        codigoPostal: '1000',
        totalM2: '100.00',
        amenities: [],
        unidades: {
          create: [
            {
              organizacionId: orgA,
              numero: 'PB',
              tipo: 'departamento',
              m2: '50.00',
              coeficiente: '0.300000',
            },
            {
              organizacionId: orgA,
              numero: '1A',
              tipo: 'departamento',
              m2: '50.00',
              coeficiente: '0.300000',
            },
          ],
        },
      },
      select: { id: true },
    });

    // La población de UFs y la invariante de coeficientes salen de la DB: si el
    // edificio del seed quedó tocado por otra suite, el test lo dice acá y no
    // como un 422 inexplicable en el cálculo.
    const unidadesTorre = await prisma.unidad.findMany({
      where: { edificioId: torre.id },
      select: { coeficiente: true },
    });
    ufsTorre = unidadesTorre.length;
    const sumaTorre = unidadesTorre.reduce((acc, u) => acc.plus(u.coeficiente), new Decimal(0));
    assert.equal(
      sumaTorre.toFixed(6),
      '1.000000',
      'Torre Palermo debe tener Σcoeficientes = 1 (correr `make db-seed`)'
    );

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Servicios Liq ${SUFIJO}` },
    });
    proveedorSur = await prisma.proveedor.create({
      data: { organizacionId: orgB, razonSocial: `Servicios Sur Liq ${SUFIJO}` },
    });
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true },
    });
    assert.ok(rubroHoja, 'el maestro de rubros debe estar seedeado (S3-13)');
  });

  after(async () => {
    const edificioIds = [torre?.id, lomas?.id, descuadrado?.id].filter(Boolean);

    const liquidaciones = await prisma.liquidacion.findMany({
      where: { periodo: { in: PERIODOS }, edificioId: { in: edificioIds } },
      select: { id: true },
    });
    const ids = liquidaciones.map((l) => l.id);
    await prisma.liquidacionDetalle.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacion.deleteMany({ where: { id: { in: ids } } });

    await prisma.gasto.deleteMany({ where: { concepto: { contains: SUFIJO } } });

    if (descuadrado) {
      await prisma.unidad.deleteMany({ where: { edificioId: descuadrado.id } });
      await prisma.edificio.delete({ where: { id: descuadrado.id } });
    }
    await prisma.proveedor.deleteMany({ where: { razonSocial: { contains: SUFIJO } } });

    for (const sesion of [admin, gestor, adminSur]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  // ─── Helpers ───

  const crearGasto = (token, edificioId, extra = {}) =>
    apiFetch(baseUrl, `/api/edificios/${edificioId}/gastos`, {
      method: 'POST',
      token,
      body: {
        proveedorId: proveedor.id,
        rubroId: rubroHoja.id,
        concepto: `Gasto ${SUFIJO}`,
        monto: '1000.00',
        categoria: 'A',
        fechaGasto: '2017-01-15',
        periodo: PERIODO,
        ...extra,
      },
    });

  const liquidar = (token, edificioId, periodo) =>
    apiFetch(baseUrl, `/api/edificios/${edificioId}/liquidaciones`, {
      method: 'POST',
      token,
      body: { periodo },
    });

  const accion = (token, id, nombre) =>
    apiFetch(baseUrl, `/api/liquidaciones/${id}/${nombre}`, { method: 'POST', token });

  // ─── Cálculo (POST /api/edificios/:id/liquidaciones) ───

  it('calcula el período: BORRADOR con detalles por UF y totales ord/ext', async () => {
    // 3 gastos: A ordinario + B ordinario (ascensor: excluye las 2 cocheras del
    // seed) + A extraordinario. El monto con decimales fuerza el ajuste de
    // centavos del motor sobre 13 UFs.
    const montos = [
      { monto: '12345.67', categoria: 'A', esOrdinario: true },
      { monto: '8000.01', categoria: 'B', servicioEspecifico: 'ascensor', esOrdinario: true },
      { monto: '5000.00', categoria: 'A', esOrdinario: false },
    ];
    for (const g of montos) {
      const { status } = await crearGasto(admin.accessToken, torre.id, g);
      assert.equal(status, 201);
    }

    const { status, data } = await liquidar(admin.accessToken, torre.id, PERIODO);
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.estado, 'BORRADOR');
    assert.equal(data.periodo, PERIODO);
    assert.equal(data.approvedBy, null);
    // Decisión 6: la matrícula RPA se hereda de la organización del edificio.
    assert.equal(data.matriculaRPA, matriculaOrgA);

    // Totales esperados: ordinarias = A + B, extraordinarias = el A no ordinario.
    assert.equal(data.totalOrdinarias, '20345.68');
    assert.equal(data.totalExtraordinarias, '5000.00');
    assert.equal(data.totalGeneral, '25345.68');

    // Preview: una fila por UF de Torre Palermo, 3 gastos.
    assert.equal(data.resumen.cantidadGastos, 3);
    assert.equal(data.resumen.cantidadUnidades, ufsTorre);
    assert.equal(data.unidades.length, ufsTorre);

    // La suma de los detalles por UF cierra al centavo con el total general.
    const sumaFilas = data.unidades.reduce((acc, u) => acc.plus(u.total), new Decimal(0));
    assert.equal(sumaFilas.toFixed(2), data.totalGeneral);

    const sumaOrd = data.unidades.reduce((acc, u) => acc.plus(u.ordinarias), new Decimal(0));
    const sumaExt = data.unidades.reduce((acc, u) => acc.plus(u.extraordinarias), new Decimal(0));
    assert.equal(sumaOrd.toFixed(2), data.totalOrdinarias);
    assert.equal(sumaExt.toFixed(2), data.totalExtraordinarias);

    // Y la suma de los LiquidacionDetalle persistidos también (decimal.js puro).
    const detalles = await prisma.liquidacionDetalle.findMany({
      where: { liquidacionId: data.id },
      select: { montoAsignado: true },
    });
    // UFs × 3 gastos: el motor emite una fila por UF incluso con monto 0
    // (las cocheras en el gasto B).
    assert.equal(detalles.length, ufsTorre * 3);
    const sumaDetalles = detalles.reduce((acc, d) => acc.plus(d.montoAsignado), new Decimal(0));
    assert.equal(sumaDetalles.toFixed(2), '25345.68');

    // Las cocheras NO participan del gasto B (categoriaB vacía en el seed).
    const cochera = data.unidades.find((u) => u.numero === 'Coch-1');
    const departamento = data.unidades.find((u) => u.numero === '1A');
    assert.ok(new Decimal(cochera.total).lt(departamento.total));

    // S3-18: la preview expone el PESO que el motor aplicó a cada gasto de la
    // UF, para que el administrador vea el reparto antes de aprobar. La cochera
    // participa de 2 de los 3 gastos (no del B), el departamento de los 3.
    assert.equal(departamento.pesos.length, 3);
    assert.equal(cochera.pesos.length, 2);
    // En un gasto B el peso es el coeficiente RENORMALIZADO entre las UF
    // alcanzadas, así que es mayor que el coeficiente general de la UF.
    const pesos = departamento.pesos.map((p) => new Decimal(p.pesoAplicado));
    assert.ok(
      pesos.some((peso) => peso.gt(departamento.coeficiente)),
      'el gasto B renormaliza: el peso supera al coeficiente general'
    );
    // Y el peso de cada gasto es el que explica su monto asignado.
    for (const p of departamento.pesos) {
      assert.ok(new Decimal(p.montoAsignado).gt(0));
    }
  });

  it('el preview de GET /api/liquidaciones/:id coincide con el del alta', async () => {
    const { data: lista } = await apiFetch(
      baseUrl,
      `/api/edificios/${torre.id}/liquidaciones?periodo=${PERIODO}`,
      { token: admin.accessToken }
    );
    assert.equal(lista.data.length, 1);
    assert.equal(lista.data[0].estado, 'BORRADOR');
    assert.equal(lista.data[0].totalGeneral, '25345.68');

    const { status, data } = await apiFetch(baseUrl, `/api/liquidaciones/${lista.data[0].id}`, {
      token: admin.accessToken,
    });
    assert.equal(status, 200);
    assert.equal(data.totalGeneral, '25345.68');
    assert.equal(data.unidades.length, 13);
  });

  it('sin gastos en el período → 422 SIN_GASTOS', async () => {
    const { status, data } = await liquidar(admin.accessToken, torre.id, PERIODO_VACIO);
    assert.equal(status, 422);
    assert.equal(data.error.code, 'SIN_GASTOS');
  });

  it('mismo período con una liquidación vigente → 409 PERIODO_YA_LIQUIDADO', async () => {
    const { status, data } = await liquidar(admin.accessToken, torre.id, PERIODO);
    assert.equal(status, 409);
    assert.equal(data.error.code, 'PERIODO_YA_LIQUIDADO');
    assert.equal(data.error.estado, 'BORRADOR');
  });

  it('anular libera el período: se puede regenerar', async () => {
    await crearGasto(admin.accessToken, torre.id, {
      monto: '3000.00',
      periodo: PERIODO_REGEN,
      fechaGasto: '2017-03-10',
    });

    const primera = await liquidar(admin.accessToken, torre.id, PERIODO_REGEN);
    assert.equal(primera.status, 201);

    const repetida = await liquidar(admin.accessToken, torre.id, PERIODO_REGEN);
    assert.equal(repetida.status, 409);

    const anulada = await accion(admin.accessToken, primera.data.id, 'anular');
    assert.equal(anulada.status, 200);
    assert.equal(anulada.data.estado, 'ANULADA');

    const regenerada = await liquidar(admin.accessToken, torre.id, PERIODO_REGEN);
    assert.equal(regenerada.status, 201, JSON.stringify(regenerada.data));
    assert.equal(regenerada.data.estado, 'BORRADOR');
    assert.notEqual(regenerada.data.id, primera.data.id);
    assert.equal(regenerada.data.totalGeneral, '3000.00');
  });

  // ─── Máquina de estados (PRD-04-03 §1) ───

  it('aprobar registra approvedBy/approvedAt; aprobar dos veces → 409 ESTADO_INVALIDO', async () => {
    await crearGasto(admin.accessToken, torre.id, {
      monto: '2500.00',
      periodo: PERIODO_ESTADOS,
      fechaGasto: '2017-04-10',
    });
    const { data: liquidacion } = await liquidar(admin.accessToken, torre.id, PERIODO_ESTADOS);

    const aprobada = await accion(admin.accessToken, liquidacion.id, 'aprobar');
    assert.equal(aprobada.status, 200);
    assert.equal(aprobada.data.estado, 'APROBADA');
    assert.equal(aprobada.data.approvedBy, admin.user.id);
    assert.ok(aprobada.data.approvedAt, 'approvedAt debe quedar registrado');

    const repetida = await accion(admin.accessToken, liquidacion.id, 'aprobar');
    assert.equal(repetida.status, 409);
    assert.equal(repetida.data.error.code, 'ESTADO_INVALIDO');
    assert.equal(repetida.data.error.estadoActual, 'APROBADA');

    // APROBADA → ANULADA sí es válida (error grave detectado post-aprobación).
    const anulada = await accion(admin.accessToken, liquidacion.id, 'anular');
    assert.equal(anulada.status, 200);
    assert.equal(anulada.data.estado, 'ANULADA');

    // Y desde ANULADA no hay transición: ni aprobar ni volver a anular.
    const reanular = await accion(admin.accessToken, liquidacion.id, 'anular');
    assert.equal(reanular.status, 409);
    assert.equal(reanular.data.error.code, 'ESTADO_INVALIDO');

    const reaprobar = await accion(admin.accessToken, liquidacion.id, 'aprobar');
    assert.equal(reaprobar.status, 409);
    assert.equal(reaprobar.data.error.code, 'ESTADO_INVALIDO');
    assert.equal(reaprobar.data.error.estadoActual, 'ANULADA');
  });

  // ─── Gate de coeficientes (AGENTS.md, decisión 1 de la ruta) ───

  it('edificio con Σcoeficientes ≠ 1 → 422 COEFICIENTES_NO_CUADRAN', async () => {
    const { status: statusGasto } = await crearGasto(admin.accessToken, descuadrado.id, {
      monto: '1000.00',
      periodo: PERIODO_DESCUADRE,
      fechaGasto: '2017-05-10',
    });
    assert.equal(statusGasto, 201);

    const { status, data } = await liquidar(admin.accessToken, descuadrado.id, PERIODO_DESCUADRE);
    assert.equal(status, 422);
    assert.equal(data.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(data.error.sumaActual, '0.600000');
    assert.equal(data.error.delta, '0.400000');

    // No persistió nada: el gate corre antes del motor.
    const cuantas = await prisma.liquidacion.count({
      where: { edificioId: descuadrado.id, periodo: PERIODO_DESCUADRE },
    });
    assert.equal(cuantas, 0);
  });

  // ─── Autorización (cerbos/policies/liquidacion.yaml) ───

  it('el gestor lee pero no liquida ni aprueba (403 ACCESO_DENEGADO)', async () => {
    const lista = await apiFetch(baseUrl, `/api/edificios/${torre.id}/liquidaciones`, {
      token: gestor.accessToken,
    });
    assert.equal(lista.status, 200, 'el gestor lee las liquidaciones de sus edificios');

    const calcular = await liquidar(gestor.accessToken, torre.id, '2017-07');
    assert.equal(calcular.status, 403);
    assert.equal(calcular.data.error.code, 'ACCESO_DENEGADO');

    const borrador = await prisma.liquidacion.findFirst({
      where: { edificioId: torre.id, periodo: PERIODO, estado: 'BORRADOR' },
      select: { id: true },
    });
    const aprobar = await accion(gestor.accessToken, borrador.id, 'aprobar');
    assert.equal(aprobar.status, 403);
    assert.equal(aprobar.data.error.code, 'ACCESO_DENEGADO');
  });

  it('la org B no ve ni toca las liquidaciones de la org A', async () => {
    const borrador = await prisma.liquidacion.findFirst({
      where: { edificioId: torre.id, periodo: PERIODO },
      select: { id: true },
    });

    // Una liquidación de otra organización no existe (404, no 403).
    const preview = await apiFetch(baseUrl, `/api/liquidaciones/${borrador.id}`, {
      token: adminSur.accessToken,
    });
    assert.equal(preview.status, 404);
    assert.equal(preview.data.error.code, 'LIQUIDACION_NO_ENCONTRADA');

    const aprobar = await accion(adminSur.accessToken, borrador.id, 'aprobar');
    assert.equal(aprobar.status, 404);

    // Y el edificio ajeno se corta en `validarEdificio`.
    const calcular = await liquidar(adminSur.accessToken, torre.id, PERIODO_ORG_B);
    assert.equal(calcular.status, 403);
    assert.equal(calcular.data.error.code, 'FUERA_DE_ORGANIZACION');

    // La org B sí liquida lo suyo, y su lista solo trae sus propias liquidaciones.
    const gasto = await crearGasto(adminSur.accessToken, lomas.id, {
      proveedorId: proveedorSur.id,
      monto: '900.00',
      periodo: PERIODO_ORG_B,
      fechaGasto: '2017-06-10',
    });
    assert.equal(gasto.status, 201, JSON.stringify(gasto.data));

    const propia = await liquidar(adminSur.accessToken, lomas.id, PERIODO_ORG_B);
    assert.equal(propia.status, 201, JSON.stringify(propia.data));
    assert.equal(propia.data.totalGeneral, '900.00');
    assert.equal(propia.data.organizacionId, orgB);

    const lista = await apiFetch(baseUrl, `/api/edificios/${lomas.id}/liquidaciones`, {
      token: adminSur.accessToken,
    });
    assert.equal(lista.status, 200);
    assert.ok(lista.data.data.every((l) => l.organizacionId === orgB));
  });

  it('404 en una liquidación inexistente', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/liquidaciones/${randomUUID()}`, {
      token: admin.accessToken,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'LIQUIDACION_NO_ENCONTRADA');
  });
});
