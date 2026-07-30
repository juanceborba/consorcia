// tests/fondo-reserva.test.js — Fondo de reserva en la liquidación (S3-21)
//
// LO QUE SE DEFIENDE ACÁ, en orden de importancia:
//
// 1. **La regla se resuelve POR PERÍODO, no "la actual".** Es la razón de ser
//    del versionado: liquidar mayo con la regla que rige en julio cambiaría el
//    importe de un período ya cerrado. Es la primera prueba del archivo.
// 2. **La liquidación reconcilia con el fondo adentro**: Σ detalles =
//    ordinarias + extraordinarias + fondo, al centavo y con cero tolerancia,
//    igual que el resto del motor.
// 3. **El aporte no contamina los otros dos subtotales.** El fondo es el tercer
//    corte de la Ley 941: si sumara a `totalOrdinarias`, el recibo mostraría un
//    subtotal de ordinarias que no coincide con la suma de sus gastos.
// 4. **El snapshot explica el número emitido**: cambiar la regla después no
//    puede reescribir lo que ya se liquidó.
// 5. El contrato del alta (validaciones cruzadas, vigencia ocupada) y el 409 de
//    la baja de una regla ya usada.
//
// Requiere el stack levantado con el seed (make up && make db-seed).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import { LiquidacionEngine } from '../src/core/liquidacion.engine.js';
import { calcularAporte, reglaVigente } from '../src/services/fondo-reserva.js';

const SUFIJO = Date.now();
// Períodos propios y lejanos de los que usan los otros specs y los E2E.
const PERIODO = '2025-02';
const PERIODO_VIEJO = '2025-01';

describe('fondo de reserva (S3-21)', () => {
  let server, baseUrl, admin, gestor, orgA, edificio, unidades, proveedor, rubroHoja;
  const reglasCreadas = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor2@demo.com', 'demo1234'));
    orgA = admin.user.organizacionId;

    // San Martín: el seed lo deja sin esquemas ni reglas, así que el reparto por
    // defecto del fondo es el coeficiente puro.
    edificio = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, activo: true, nombre: { contains: 'San Mart' } },
      select: { id: true },
    });
    unidades = await prisma.unidad.findMany({
      where: { edificioId: edificio.id },
      select: { id: true, numero: true, coeficiente: true },
      orderBy: { numero: 'asc' },
    });
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true },
    });
    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Fondo E2E ${SUFIJO}` },
    });
    assert.ok(edificio && unidades.length > 0 && rubroHoja);
  });

  after(async () => {
    const liquidaciones = await prisma.liquidacion.findMany({
      where: { edificioId: edificio.id, periodo: { in: [PERIODO, PERIODO_VIEJO] } },
      select: { id: true },
    });
    const ids = liquidaciones.map((l) => l.id);
    if (ids.length > 0) {
      await prisma.recibo.deleteMany({ where: { liquidacionId: { in: ids } } });
      await prisma.liquidacionDetalle.deleteMany({ where: { liquidacionId: { in: ids } } });
      await prisma.liquidacion.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.gasto.deleteMany({ where: { proveedorId: proveedor.id } });
    await prisma.reglaFondoReserva.deleteMany({ where: { edificioId: edificio.id } });
    await prisma.proveedor.delete({ where: { id: proveedor.id } });
    await cerrarApp(server);
  });

  const crearRegla = (body, token = admin.accessToken) =>
    apiFetch(baseUrl, `/api/edificios/${edificio.id}/fondo-reserva`, {
      method: 'POST',
      token,
      body,
    });

  const crearGasto = (body) =>
    apiFetch(baseUrl, `/api/edificios/${edificio.id}/gastos`, {
      method: 'POST',
      token: admin.accessToken,
      body: {
        proveedorId: proveedor.id,
        rubroId: rubroHoja.id,
        categoria: 'A',
        fechaGasto: `${body.periodo}-10`,
        ...body,
      },
    });

  // ─── 1. El cálculo, sin DB ───

  describe('cálculo del aporte', () => {
    const totales = { totalOrdinarias: '100000.00', totalExtraordinarias: '50000.00' };

    it('ORDINARIAS aplica el porcentaje solo sobre las ordinarias', () => {
      const aporte = calcularAporte({ base: 'ORDINARIAS', porcentaje: '5' }, totales);
      assert.equal(aporte.toFixed(2), '5000.00');
    });

    it('TOTAL aplica el porcentaje sobre la suma de los dos', () => {
      const aporte = calcularAporte({ base: 'TOTAL', porcentaje: '5' }, totales);
      assert.equal(aporte.toFixed(2), '7500.00');
    });

    it('MONTO_FIJO ignora los totales del período', () => {
      const aporte = calcularAporte({ base: 'MONTO_FIJO', montoFijo: '12345.67' }, totales);
      assert.equal(aporte.toFixed(2), '12345.67');
    });

    it('sin regla no hay aporte, y no es un error', () => {
      assert.equal(calcularAporte(null, totales).toFixed(2), '0.00');
    });

    it('redondea a 2 decimales, como todo monto del sistema', () => {
      // 3,33% de 1.000,01 = 33,3003…
      const aporte = calcularAporte(
        { base: 'ORDINARIAS', porcentaje: '3.33' },
        { totalOrdinarias: '1000.01', totalExtraordinarias: '0' }
      );
      assert.equal(aporte.toFixed(2), '33.30');
    });
  });

  // ─── 2. El contrato del alta ───

  describe('alta de reglas', () => {
    it('crea la regla y la devuelve con su descripción', async () => {
      const { status, data } = await crearRegla({
        vigenciaDesde: PERIODO_VIEJO,
        base: 'ORDINARIAS',
        porcentaje: 2,
        motivo: `Asamblea ${SUFIJO}`,
      });
      assert.equal(status, 201);
      assert.equal(data.descripcion, '2,00% de las expensas ordinarias');
      reglasCreadas.push(data.id);
    });

    it('rechaza MONTO_FIJO sin monto', async () => {
      const { status, data } = await crearRegla({
        vigenciaDesde: '2025-06',
        base: 'MONTO_FIJO',
      });
      assert.equal(status, 422);
      assert.equal(data.error.code, 'VALIDACION_FALLIDA');
    });

    it('rechaza porcentaje y monto fijo juntos', async () => {
      const { status } = await crearRegla({
        vigenciaDesde: '2025-06',
        base: 'ORDINARIAS',
        porcentaje: 5,
        montoFijo: 1000,
      });
      assert.equal(status, 422);
    });

    it('dos reglas con la misma vigencia serían ambiguas → 409', async () => {
      const { status, data } = await crearRegla({
        vigenciaDesde: PERIODO_VIEJO,
        base: 'ORDINARIAS',
        porcentaje: 9,
      });
      assert.equal(status, 409);
      assert.equal(data.error.code, 'VIGENCIA_OCUPADA');
    });

    it('el gestor no configura el fondo: es del org_admin', async () => {
      const { status } = await crearRegla(
        { vigenciaDesde: '2025-09', base: 'ORDINARIAS', porcentaje: 1 },
        gestor.accessToken
      );
      assert.equal(status, 403);
    });
  });

  // ─── 3. La resolución por período (el corazón de S3-21) ───

  describe('resolución de la regla vigente', () => {
    it('liquidar un período usa la regla que regía ENTONCES, no la última', async () => {
      const { status, data } = await crearRegla({
        vigenciaDesde: PERIODO,
        base: 'ORDINARIAS',
        porcentaje: 7,
      });
      assert.equal(status, 201);
      reglasCreadas.push(data.id);

      const enEnero = await reglaVigente(orgA, edificio.id, PERIODO_VIEJO);
      const enFebrero = await reglaVigente(orgA, edificio.id, PERIODO);
      assert.equal(String(enEnero.porcentaje), '2');
      assert.equal(String(enFebrero.porcentaje), '7');
    });

    it('un período anterior a toda regla no aporta nada', async () => {
      assert.equal(await reglaVigente(orgA, edificio.id, '2024-01'), null);
    });
  });

  // ─── 4. El motor ───

  describe('la liquidación con fondo', () => {
    it('suma el aporte como TERCER subtotal y reconcilia al centavo', async () => {
      const gastos = [
        { id: 'g1', monto: '100000.00', categoria: 'A', esOrdinario: true },
        { id: 'g2', monto: '40000.00', categoria: 'A', esOrdinario: false },
      ];
      const calculada = await LiquidacionEngine.calcularLiquidacion(
        edificio.id,
        PERIODO,
        gastos,
        unidades,
        // 7% de las ordinarias = 7.000,00
        { fondoReserva: { aporte: new Decimal('7000.00'), esquema: null } }
      );

      assert.equal(calculada.totalOrdinarias, '100000.00');
      assert.equal(calculada.totalExtraordinarias, '40000.00');
      assert.equal(calculada.totalFondoReserva, '7000.00');
      assert.equal(calculada.totalGeneral, '147000.00');

      // Cero tolerancia: la suma de TODOS los detalles es el total general.
      const suma = calculada.detalles.reduce(
        (acc, d) => acc.plus(new Decimal(d.montoAsignado)),
        new Decimal(0)
      );
      assert.equal(suma.toFixed(2), '147000.00');

      // Y el aporte tiene sus propios detalles, uno por UF, sin gasto detrás.
      const delFondo = calculada.detalles.filter((d) => d.tipo === 'FONDO_RESERVA');
      assert.equal(delFondo.length, unidades.length);
      assert.ok(delFondo.every((d) => d.gastoId === null));
      const sumaFondo = delFondo.reduce(
        (acc, d) => acc.plus(new Decimal(d.montoAsignado)),
        new Decimal(0)
      );
      assert.equal(sumaFondo.toFixed(2), '7000.00');
    });

    it('sin regla vigente, la liquidación es la de antes de S3-21', async () => {
      const calculada = await LiquidacionEngine.calcularLiquidacion(
        edificio.id,
        PERIODO,
        [{ id: 'g1', monto: '1000.00', categoria: 'A', esOrdinario: true }],
        unidades
      );
      assert.equal(calculada.totalFondoReserva, '0.00');
      assert.equal(calculada.totalGeneral, '1000.00');
      assert.ok(calculada.detalles.every((d) => d.tipo === 'GASTO'));
    });
  });

  // ─── 5. Punta a punta por la API ───

  describe('generar la liquidación por la API', () => {
    it('aplica la regla del período y guarda el snapshot', async () => {
      const { status: statusGasto } = await crearGasto({
        concepto: `Fondo ordinario ${SUFIJO}`,
        monto: '200000.00',
        esOrdinario: true,
        periodo: PERIODO,
      });
      assert.equal(statusGasto, 201);

      const { status, data } = await apiFetch(
        baseUrl,
        `/api/edificios/${edificio.id}/liquidaciones`,
        { method: 'POST', token: admin.accessToken, body: { periodo: PERIODO } }
      );
      assert.equal(status, 201);

      // 7% de 200.000 (la regla vigente en PERIODO, no la de enero)
      assert.equal(data.totalFondoReserva, '14000.00');
      assert.equal(data.totalOrdinarias, '200000.00');
      assert.equal(data.totalGeneral, '214000.00');
      // Snapshot: con qué se calculó, para poder explicarlo después.
      assert.equal(data.fondoReserva.base, 'ORDINARIAS');
      assert.equal(data.fondoReserva.descripcion, '7,00% de las expensas ordinarias');

      // Cada UF trae su aporte y su total lo incluye.
      const uf = data.unidades[0];
      assert.ok(new Decimal(uf.fondoReserva).greaterThan(0));
      assert.equal(
        new Decimal(uf.ordinarias).plus(uf.extraordinarias).plus(uf.fondoReserva).toFixed(2),
        uf.total
      );
      // Y el fondo NO se sumó a las ordinarias del consorcio.
      const sumaUnidades = data.unidades.reduce(
        (acc, u) => acc.plus(new Decimal(u.ordinarias)),
        new Decimal(0)
      );
      assert.equal(sumaUnidades.toFixed(2), '200000.00');
    });

    it('la regla usada por una liquidación no se puede borrar', async () => {
      const usada = await prisma.liquidacion.findFirst({
        where: { edificioId: edificio.id, periodo: PERIODO },
        select: { reglaFondoReservaId: true },
      });
      const { status, data } = await apiFetch(
        baseUrl,
        `/api/fondo-reserva/${usada.reglaFondoReservaId}`,
        { method: 'DELETE', token: admin.accessToken }
      );
      assert.equal(status, 409);
      assert.equal(data.error.code, 'REGLA_EN_USO');
    });

    it('una regla que no liquidó nada sí se borra', async () => {
      const { data: nueva } = await crearRegla({
        vigenciaDesde: '2027-12',
        base: 'MONTO_FIJO',
        montoFijo: 5000,
      });
      const { status } = await apiFetch(baseUrl, `/api/fondo-reserva/${nueva.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      });
      assert.equal(status, 204);
    });

    it('el listado dice cuál rige hoy, que puede no ser la primera', async () => {
      const { status, data } = await apiFetch(
        baseUrl,
        `/api/edificios/${edificio.id}/fondo-reserva`,
        { token: admin.accessToken }
      );
      assert.equal(status, 200);
      assert.ok(data.data.length >= 2);
      // Las reglas del spec son de 2025 y hoy es más tarde: rige la más nueva.
      assert.equal(data.vigente.vigenciaDesde, PERIODO);
    });
  });
});
