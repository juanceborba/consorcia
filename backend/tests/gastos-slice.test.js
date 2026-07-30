// tests/gastos-slice.test.js — Slice de gastos + motor contable (S3-06)
// Contrato: docs/sprints/S3-gastos-liquidacion.md (S3-06) · PRD-04-02 (gastos) ·
// PRD-04-03 (estados de la liquidación) · PRD-02-05 §4 / PRD-06-01 §3 (recibo
// Ley 941) · policies cerbos/policies/{gasto,liquidacion,recibo}.yaml.
//
// Esta suite NO repite lo que ya cubren gastos/liquidaciones/recibos/
// esquemas-reparto/cuotas.test.js (cada endpoint por separado). Acá se prueba lo
// que solo se ve recorriendo la CADENA COMPLETA gasto → liquidación → recibo:
//   · la plata no se crea ni se pierde en ningún salto: el reparto se verifica
//     contra un cálculo manual con decimal.js hecho en el test (sin llamar al
//     motor), y cada recibo emitido reproduce los detalles de SU UF;
//   · el congelamiento se propaga hacia atrás: con la liquidación enviada, el
//     gasto de origen ya no se edita ni se borra;
//   · la máquina de estados no se saltea en el camino real (enviar sin aprobar,
//     aprobar/enviar dos veces sobre la misma liquidación);
//   · autorización y aislamiento a lo largo de TODA la cadena: el gestor la
//     recorre en modo lectura y la org B no toca ninguna de sus piezas.
//
// Los tests corren en orden (node:test, `--test-concurrency=1`) y comparten la
// liquidación de PERIODO_CADENA: el valor del escenario está en recorrerla de
// punta a punta. Todo lo creado se limpia en el after().
//
// Los períodos son de 2015 a propósito: recibos.test.js trabaja en 2016,
// liquidaciones.test.js en 2017 y gastos/cuotas/esquemas en 2018+. El índice
// único parcial de liquidaciones es por (organización, edificio, período), así
// que dos suites en el mismo período se bloquearían con 409.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import { raizStorage } from '../src/services/almacenamiento.js';

const SUFIJO = randomUUID().slice(0, 8);

const PERIODO_CADENA = '2015-01'; // gasto → liquidar → aprobar → enviar → recibo
const PERIODO_SIN_APROBAR = '2015-02'; // enviar sin aprobar → 409
const PERIODO_ORG_B = '2015-03'; // aislamiento entre organizaciones
const PERIODOS = [PERIODO_CADENA, PERIODO_SIN_APROBAR, PERIODO_ORG_B];

// Los tres gastos de la cadena. Los dos "limpios" son múltiplos de 10: con
// coeficientes de 3 decimales, monto × coeficiente da 2 decimales EXACTOS, así
// que el reparto se puede verificar al centavo sin replicar el ajuste del motor.
// El "sucio" no cierra redondo y fuerza ese ajuste: ahí se verifica que la suma
// cierre exacta y que ninguna UF se desvíe de su proporción.
const GASTOS_CADENA = [
  { clave: 'limpioOrd', monto: '48000.00', esOrdinario: true, exacto: true },
  { clave: 'sucioOrd', monto: '1234.57', esOrdinario: true, exacto: false },
  { clave: 'limpioExt', monto: '9000.00', esOrdinario: false, exacto: true },
];

const TOTAL_ORDINARIAS = '49234.57'; // 48000.00 + 1234.57
const TOTAL_EXTRAORDINARIAS = '9000.00';
const TOTAL_GENERAL = '58234.57';

describe('slice de gastos: cadena gasto → liquidación → recibo (S3-06)', () => {
  let server;
  let baseUrl;
  let admin; // org_admin de la org A (Torre Palermo + San Martín)
  let gestor; // gestor de la org A, solo Torre Palermo
  let adminSur; // org_admin de la org B (Edificio Lomas)
  let orgA;
  let orgB;
  let torre;
  let lomas;
  let matriculaOrgA;
  let unidadesTorre; // [{ id, numero, coeficiente: Decimal }]
  let proveedor;
  let proveedorSur;
  let rubroHoja;

  // Estado que atraviesa la cadena (se llena en los primeros tests).
  const gastosCadena = {}; // clave → gasto creado
  let liquidacion; // la de PERIODO_CADENA, ya con preview
  let recibos; // los emitidos al enviarla

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    const organizacionA = await prisma.organizacion.findUnique({
      where: { id: orgA },
      select: { matriculaRPA: true },
    });
    matriculaOrgA = organizacionA.matriculaRPA;
    assert.ok(matriculaOrgA, 'la organización del seed debe tener matrícula RPA (Ley 941)');

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

    const filas = await prisma.unidad.findMany({
      where: { edificioId: torre.id },
      select: { id: true, numero: true, coeficiente: true },
    });
    unidadesTorre = filas.map((u) => ({ ...u, coeficiente: new Decimal(u.coeficiente) }));
    const suma = unidadesTorre.reduce((acc, u) => acc.plus(u.coeficiente), new Decimal(0));
    assert.equal(
      suma.toFixed(6),
      '1.000000',
      'Torre Palermo debe tener Σcoeficientes = 1 (correr `make db-seed`)'
    );

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Servicios Slice ${SUFIJO}` },
    });
    proveedorSur = await prisma.proveedor.create({
      data: { organizacionId: orgB, razonSocial: `Servicios Sur Slice ${SUFIJO}` },
    });
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: { not: null }, activo: true },
      select: { id: true },
    });
    assert.ok(rubroHoja, 'el maestro de rubros debe estar seedeado (S3-13)');
  });

  after(async () => {
    const edificioIds = [torre?.id, lomas?.id].filter(Boolean);
    const liquidaciones = await prisma.liquidacion.findMany({
      where: { periodo: { in: PERIODOS }, edificioId: { in: edificioIds } },
      select: { id: true },
    });
    const ids = liquidaciones.map((l) => l.id);

    // Los PDFs se borran antes que sus filas: la key sale del registro.
    const emitidos = await prisma.recibo.findMany({
      where: { liquidacionId: { in: ids } },
      select: { storageKey: true },
    });
    for (const { storageKey } of emitidos) {
      await fs.rm(path.join(raizStorage(), storageKey), { force: true });
    }

    await prisma.recibo.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacionDetalle.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacion.deleteMany({ where: { id: { in: ids } } });
    await prisma.gasto.deleteMany({ where: { concepto: { contains: SUFIJO } } });
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
        concepto: `Gasto slice ${SUFIJO}`,
        monto: '1000.00',
        categoria: 'A',
        fechaGasto: '2015-01-15',
        periodo: PERIODO_CADENA,
        esOrdinario: true,
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

  // Descarga cruda: apiFetch parsea JSON y el recibo es binario.
  async function descargar(token, reciboId) {
    const res = await fetch(`${baseUrl}/api/recibos/${reciboId}/descargar`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.headers.get('content-type')?.includes('application/json')) {
      return { status: res.status, data: await res.json() };
    }
    return {
      status: res.status,
      tipo: res.headers.get('content-type'),
      buffer: Buffer.from(await res.arrayBuffer()),
    };
  }

  // ─── 1. El reparto contra un cálculo manual con decimal.js ───

  it('liquidar el período reparte cada gasto según el coeficiente y cierra al centavo', async () => {
    for (const g of GASTOS_CADENA) {
      const { status, data } = await crearGasto(admin.accessToken, torre.id, {
        monto: g.monto,
        esOrdinario: g.esOrdinario,
        concepto: `Gasto ${g.clave} ${SUFIJO}`,
      });
      assert.equal(status, 201, JSON.stringify(data));
      gastosCadena[g.clave] = data;
    }

    const { status, data } = await liquidar(admin.accessToken, torre.id, PERIODO_CADENA);
    assert.equal(status, 201, JSON.stringify(data));
    liquidacion = data;

    assert.equal(data.estado, 'BORRADOR');
    assert.equal(data.periodo, PERIODO_CADENA);
    assert.equal(data.matriculaRPA, matriculaOrgA);
    assert.equal(data.totalOrdinarias, TOTAL_ORDINARIAS);
    assert.equal(data.totalExtraordinarias, TOTAL_EXTRAORDINARIAS);
    assert.equal(data.totalGeneral, TOTAL_GENERAL);
    assert.equal(data.resumen.cantidadGastos, GASTOS_CADENA.length);
    assert.equal(data.resumen.cantidadUnidades, unidadesTorre.length);

    // Los detalles persistidos, por gasto y por UF: la fuente de verdad.
    const detalles = await prisma.liquidacionDetalle.findMany({
      where: { liquidacionId: data.id },
      select: {
        unidadId: true,
        gastoId: true,
        montoAsignado: true,
        coeficienteAplicado: true,
        esquemaNombre: true,
        cuotaNumero: true,
      },
    });
    assert.equal(detalles.length, unidadesTorre.length * GASTOS_CADENA.length);

    for (const g of GASTOS_CADENA) {
      const gastoId = gastosCadena[g.clave].id;
      const delGasto = detalles.filter((d) => d.gastoId === gastoId);
      assert.equal(delGasto.length, unidadesTorre.length, g.clave);

      // Ni esquema de reparto ni plan de cuotas: son gastos A de imputación
      // única, así que el peso ES el coeficiente de la UF. Sin esto, el cálculo
      // manual de abajo no tendría por qué coincidir.
      for (const d of delGasto) {
        assert.equal(d.esquemaNombre, null, `${g.clave}: reparto por coeficiente`);
        assert.equal(d.cuotaNumero, null, `${g.clave}: imputación única`);
      }

      const monto = new Decimal(g.monto);
      const porUnidad = new Map(delGasto.map((d) => [d.unidadId, new Decimal(d.montoAsignado)]));
      let ajustadas = 0;

      for (const u of unidadesTorre) {
        // Cálculo manual, sin tocar el motor: monto × coeficiente de la UF.
        const esperado = monto.times(u.coeficiente);
        const asignado = porUnidad.get(u.id);
        assert.ok(asignado, `${g.clave}: falta el detalle de la UF ${u.numero}`);
        // Y el coeficiente auditado en la fila es el de la UF.
        const aplicado = new Decimal(
          delGasto.find((d) => d.unidadId === u.id).coeficienteAplicado
        );
        assert.equal(aplicado.toFixed(6), u.coeficiente.toFixed(6), `${g.clave} ${u.numero}`);

        if (g.exacto) {
          // Monto múltiplo de 10 × coeficiente de 3 decimales: exacto, cero ajuste.
          assert.equal(
            asignado.toFixed(2),
            esperado.toFixed(2),
            `${g.clave}: la UF ${u.numero} debe pagar monto × coeficiente exacto`
          );
        } else {
          // Con ajuste de centavos: la desviación de la proporción es de
          // centavos, no de pesos, y se concentra en UNA sola UF.
          const desvio = asignado.minus(esperado).abs();
          assert.ok(
            desvio.lt('0.10'),
            `${g.clave}: la UF ${u.numero} se desvía ${desvio} de su proporción`
          );
          if (!asignado.equals(esperado.toDecimalPlaces(2))) ajustadas += 1;
        }
      }

      // La suma del gasto cierra EXACTA (cero tolerancia, decisión del motor).
      const sumaGasto = delGasto.reduce((acc, d) => acc.plus(d.montoAsignado), new Decimal(0));
      assert.equal(sumaGasto.toFixed(2), monto.toFixed(2), `${g.clave}: Σ detalles = monto`);
      if (!g.exacto) {
        assert.ok(ajustadas <= 1, `${g.clave}: el ajuste de centavos cae en una sola UF`);
      }
    }

    // Y el total general es la suma de TODOS los detalles.
    const sumaTotal = detalles.reduce((acc, d) => acc.plus(d.montoAsignado), new Decimal(0));
    assert.equal(sumaTotal.toFixed(2), TOTAL_GENERAL);

    // La preview por UF reproduce esa suma, separada ord/ext.
    const sumaFilas = data.unidades.reduce((acc, u) => acc.plus(u.total), new Decimal(0));
    const sumaOrd = data.unidades.reduce((acc, u) => acc.plus(u.ordinarias), new Decimal(0));
    const sumaExt = data.unidades.reduce((acc, u) => acc.plus(u.extraordinarias), new Decimal(0));
    assert.equal(sumaFilas.toFixed(2), TOTAL_GENERAL);
    assert.equal(sumaOrd.toFixed(2), TOTAL_ORDINARIAS);
    assert.equal(sumaExt.toFixed(2), TOTAL_EXTRAORDINARIAS);
  });

  // ─── 2. Aprobar y enviar: el recibo reproduce los detalles de su UF ───

  it('aprobar y enviar emite un recibo por UF con los totales de esa UF', async () => {
    const aprobada = await accion(admin.accessToken, liquidacion.id, 'aprobar');
    assert.equal(aprobada.status, 200, JSON.stringify(aprobada.data));
    assert.equal(aprobada.data.estado, 'APROBADA');
    assert.ok(aprobada.data.approvedBy, 'aprobar registra quién aprobó');

    const enviada = await accion(admin.accessToken, liquidacion.id, 'enviar');
    assert.equal(enviada.status, 200, JSON.stringify(enviada.data));
    assert.equal(enviada.data.estado, 'ENVIADA');
    assert.equal(enviada.data.recibos.emitidos, unidadesTorre.length);
    recibos = enviada.data.recibos.data;

    // Los totales de la preview por UF, indexados por número de unidad.
    const preview = new Map(liquidacion.unidades.map((u) => [u.unidadId, u]));

    let sumaRecibos = new Decimal(0);
    for (const recibo of recibos) {
      const fila = preview.get(recibo.unidadId);
      assert.ok(fila, `el recibo ${recibo.numero} apunta a una UF de la liquidación`);
      assert.equal(recibo.periodo, PERIODO_CADENA);
      assert.equal(recibo.matriculaRPA, matriculaOrgA);
      // Lo que el propietario recibe es exactamente lo que se liquidó para su UF.
      assert.equal(recibo.totalOrdinarias, fila.ordinarias, `ord de ${fila.numero}`);
      assert.equal(recibo.totalExtraordinarias, fila.extraordinarias, `ext de ${fila.numero}`);
      assert.equal(recibo.totalGeneral, fila.total, `total de ${fila.numero}`);
      sumaRecibos = sumaRecibos.plus(recibo.totalGeneral);
    }

    // Ni un centavo se crea ni se pierde entre la liquidación y los recibos.
    assert.equal(sumaRecibos.toFixed(2), TOTAL_GENERAL);
    assert.equal(new Set(recibos.map((r) => r.unidadId)).size, unidadesTorre.length);
    assert.equal(new Set(recibos.map((r) => r.numero)).size, unidadesTorre.length);

    // El PDF de cada recibo existe en el storage con los bytes declarados, y su
    // QR lleva la matrícula RPA (Ley 941) y el total de la UF.
    const filas = await prisma.recibo.findMany({
      where: { liquidacionId: liquidacion.id },
      select: { id: true, storageKey: true, bytes: true, qrData: true, totalGeneral: true },
    });
    for (const fila of filas) {
      const stat = await fs.stat(path.join(raizStorage(), fila.storageKey));
      assert.equal(stat.size, fila.bytes, `el PDF ${fila.storageKey} no tiene los bytes declarados`);
      const qr = JSON.parse(fila.qrData);
      assert.equal(qr.matriculaRPA, matriculaOrgA);
      assert.equal(qr.periodo, PERIODO_CADENA);
      assert.equal(qr.totalGeneral, new Decimal(fila.totalGeneral).toFixed(2));
    }

    // Y la descarga entrega un PDF real (control de punta a punta del binario).
    const pdf = await descargar(admin.accessToken, recibos[0].id);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.tipo, 'application/pdf');
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  });

  // ─── 3. El congelamiento se propaga hacia atrás ───

  it('con la liquidación enviada, el gasto de origen ya no se edita ni se borra', async () => {
    const gastoId = gastosCadena.limpioOrd.id;

    const edicion = await apiFetch(baseUrl, `/api/gastos/${gastoId}`, {
      method: 'PUT',
      body: { monto: '1.00' },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 409);
    assert.equal(edicion.data.error.code, 'LIQUIDACION_APROBADA');

    const baja = await apiFetch(baseUrl, `/api/gastos/${gastoId}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 409);
    assert.equal(baja.data.error.code, 'LIQUIDACION_APROBADA');

    // La UI apaga las acciones con este flag, sin adivinar el estado.
    const detalle = await apiFetch(baseUrl, `/api/gastos/${gastoId}`, { token: admin.accessToken });
    assert.equal(detalle.status, 200);
    assert.equal(detalle.data.editable, false);
    assert.ok(detalle.data.liquidaciones.some((l) => l.estado === 'ENVIADA'));

    // Y el monto es el original: ningún intento de edición lo tocó.
    assert.equal(detalle.data.monto, '48000.00');
  });

  it('el período liquidado no se puede volver a liquidar y aprobar/enviar de nuevo falla', async () => {
    // Un gasto nuevo en un período ya liquidado no reabre el período.
    const suelto = await crearGasto(admin.accessToken, torre.id, {
      monto: '500.00',
      concepto: `Gasto tardio ${SUFIJO}`,
    });
    assert.equal(suelto.status, 201);

    const otra = await liquidar(admin.accessToken, torre.id, PERIODO_CADENA);
    assert.equal(otra.status, 409);
    assert.equal(otra.data.error.code, 'PERIODO_YA_LIQUIDADO');

    for (const nombre of ['aprobar', 'enviar']) {
      const res = await accion(admin.accessToken, liquidacion.id, nombre);
      assert.equal(res.status, 409, nombre);
      assert.equal(res.data.error.code, 'ESTADO_INVALIDO', nombre);
    }

    // Y el segundo `enviar` no duplicó recibos.
    const emitidos = await prisma.recibo.count({ where: { liquidacionId: liquidacion.id } });
    assert.equal(emitidos, unidadesTorre.length);
  });

  it('enviar sin aprobar no emite nada: la liquidación sigue en BORRADOR', async () => {
    const alta = await crearGasto(admin.accessToken, torre.id, {
      monto: '3000.00',
      periodo: PERIODO_SIN_APROBAR,
      fechaGasto: '2015-02-10',
      concepto: `Gasto sin aprobar ${SUFIJO}`,
    });
    assert.equal(alta.status, 201);

    const { data: borrador } = await liquidar(admin.accessToken, torre.id, PERIODO_SIN_APROBAR);
    assert.equal(borrador.estado, 'BORRADOR');

    const envio = await accion(admin.accessToken, borrador.id, 'enviar');
    assert.equal(envio.status, 409);
    assert.equal(envio.data.error.code, 'ESTADO_INVALIDO');

    const { data: sinRecibos } = await apiFetch(
      baseUrl,
      `/api/liquidaciones/${borrador.id}/recibos`,
      { token: admin.accessToken }
    );
    assert.equal(sinRecibos.estado, 'BORRADOR');
    assert.equal(sinRecibos.data.length, 0);
  });

  // ─── 4. Autorización a lo largo de la cadena ───

  it('el gestor recorre la cadena en modo lectura: no liquida, no aprueba, no envía', async () => {
    const gastos = await apiFetch(
      baseUrl,
      `/api/edificios/${torre.id}/gastos?periodo=${PERIODO_CADENA}`,
      { token: gestor.accessToken }
    );
    assert.equal(gastos.status, 200);
    assert.ok(gastos.data.data.some((g) => g.id === gastosCadena.limpioOrd.id));

    const detalle = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}`, {
      token: gestor.accessToken,
    });
    assert.equal(detalle.status, 200);
    assert.equal(detalle.data.totalGeneral, TOTAL_GENERAL);

    const lista = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}/recibos`, {
      token: gestor.accessToken,
    });
    assert.equal(lista.status, 200);
    assert.equal(lista.data.data.length, unidadesTorre.length);

    const pdf = await descargar(gestor.accessToken, recibos[0].id);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.tipo, 'application/pdf');

    // Escritura: emitir expensas es un acto de administración (PRD-04-03 §2).
    const intentoLiquidar = await liquidar(gestor.accessToken, torre.id, '2015-04');
    assert.equal(intentoLiquidar.status, 403);
    assert.equal(intentoLiquidar.data.error.code, 'ACCESO_DENEGADO');

    for (const nombre of ['aprobar', 'enviar', 'anular']) {
      const res = await accion(gestor.accessToken, liquidacion.id, nombre);
      assert.equal(res.status, 403, nombre);
      assert.equal(res.data.error.code, 'ACCESO_DENEGADO', nombre);
    }

    // Y la liquidación quedó como estaba.
    const despues = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}`, {
      token: admin.accessToken,
    });
    assert.equal(despues.data.estado, 'ENVIADA');
  });

  // ─── 5. Aislamiento entre organizaciones sobre toda la cadena ───

  it('la org B no toca ninguna pieza de la cadena de la org A', async () => {
    // Gasto ajeno: 404 en las tres operaciones (un 403 confirmaría el id).
    for (const [metodo, body] of [
      ['GET', undefined],
      ['PUT', { monto: '1.00' }],
      ['DELETE', undefined],
    ]) {
      const res = await apiFetch(baseUrl, `/api/gastos/${gastosCadena.limpioOrd.id}`, {
        method: metodo,
        body,
        token: adminSur.accessToken,
      });
      assert.equal(res.status, 404, metodo);
      assert.equal(res.data.error.code, 'GASTO_NO_ENCONTRADO', metodo);
    }

    // Liquidación ajena: lectura, recibos y acciones de estado.
    const detalle = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}`, {
      token: adminSur.accessToken,
    });
    assert.equal(detalle.status, 404);

    const lista = await apiFetch(baseUrl, `/api/liquidaciones/${liquidacion.id}/recibos`, {
      token: adminSur.accessToken,
    });
    assert.equal(lista.status, 404);

    for (const nombre of ['aprobar', 'enviar', 'anular']) {
      const res = await accion(adminSur.accessToken, liquidacion.id, nombre);
      assert.equal(res.status, 404, nombre);
    }

    // Recibo ajeno: ni lo lee ni lo descarga.
    const pdf = await descargar(adminSur.accessToken, recibos[0].id);
    assert.equal(pdf.status, 404);

    // Liquidar un edificio ajeno tampoco: el edificio no es de su organización.
    const intento = await liquidar(adminSur.accessToken, torre.id, PERIODO_ORG_B);
    assert.equal(intento.status, 403);
    assert.equal(intento.data.error.code, 'FUERA_DE_ORGANIZACION');

    // Control positivo: la org B recorre SU propia cadena con SU matrícula.
    const propio = await apiFetch(baseUrl, `/api/edificios/${lomas.id}/gastos`, {
      method: 'POST',
      token: adminSur.accessToken,
      body: {
        proveedorId: proveedorSur.id,
        rubroId: rubroHoja.id,
        concepto: `Gasto sur slice ${SUFIJO}`,
        monto: '5000.00',
        categoria: 'A',
        fechaGasto: '2015-03-05',
        periodo: PERIODO_ORG_B,
        esOrdinario: true,
      },
    });
    assert.equal(propio.status, 201, JSON.stringify(propio.data));

    const propiaLiq = await liquidar(adminSur.accessToken, lomas.id, PERIODO_ORG_B);
    assert.equal(propiaLiq.status, 201, JSON.stringify(propiaLiq.data));
    assert.equal(propiaLiq.data.totalGeneral, '5000.00');
    assert.notEqual(propiaLiq.data.matriculaRPA, matriculaOrgA);

    const aprobada = await accion(adminSur.accessToken, propiaLiq.data.id, 'aprobar');
    assert.equal(aprobada.status, 200);
    const enviada = await accion(adminSur.accessToken, propiaLiq.data.id, 'enviar');
    assert.equal(enviada.status, 200);
    assert.equal(enviada.data.recibos.emitidos, 5, 'Edificio Lomas tiene 5 UFs en el seed');
    for (const recibo of enviada.data.recibos.data) {
      assert.equal(recibo.matriculaRPA, propiaLiq.data.matriculaRPA);
    }
  });
});
