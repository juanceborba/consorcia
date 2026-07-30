// tests/recibos.test.js — Recibos PDF + QR Ley 941 + enviar (S3-05)
// Spec: PRD-02-05 §4 (generador) · PRD-06-01 §3 (datos obligatorios del recibo,
// separación ord/ext, QR) · PRD-04-03 §1 (APROBADA → ENVIADA) ·
// policies cerbos/policies/liquidacion.yaml + recibo.yaml
//
// Corre contra el stack dockerizado con el seed S1-03/S4-10, con
// `admin@demo.com` (org_admin de Org A), `gestor@demo.com` (gestor de Org A,
// solo Torre Palermo) y `admin.sur@demo.com` (org_admin de Org B).
//
// Los períodos son de 2016 a propósito: `liquidaciones.test.js` trabaja en 2017 y
// `gastos.test.js`/el smoke en 2019+. El índice único parcial de liquidaciones es
// por (organización, edificio, período), así que dos suites en el mismo período
// se bloquearían con 409.
//
// El contenido del PDF se verifica sobre los bytes descargados: se inflan los
// content streams (FlateDecode) y se decodifican los operadores `[<hex>] TJ`.
// Es unas 20 líneas y evita sumar una dependencia de parsing de PDF al backend.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import { generarReciboPDF, armarQrData, pesos } from '../src/core/recibos.generator.js';
import { raizStorage } from '../src/services/almacenamiento.js';

const SUFIJO = randomUUID().slice(0, 8);

const PERIODO_ENVIO = '2016-01'; // camino feliz: aprobar → enviar → descargar
const PERIODO_BORRADOR = '2016-02'; // enviar sin aprobar → 409
const PERIODO_ORG_B = '2016-03'; // aislamiento entre organizaciones
const PERIODOS = [PERIODO_ENVIO, PERIODO_BORRADOR, PERIODO_ORG_B];

// ─── Lectura del PDF sin dependencias ───

// Texto de un PDF de pdfkit: inflar cada content stream y concatenar los
// fragmentos `<hex>` de cada operador TJ (pdfkit parte las corridas por kerning,
// así que los fragmentos de un mismo TJ se pegan sin separador).
function textoDelPdf(buffer) {
  let crudo = '';
  let i = 0;
  for (;;) {
    const inicio = buffer.indexOf('stream', i);
    if (inicio === -1) break;
    const fin = buffer.indexOf('endstream', inicio);
    if (fin === -1) break;
    let desde = inicio + 'stream'.length;
    while (buffer[desde] === 13 || buffer[desde] === 10) desde += 1;
    try {
      crudo += inflateSync(buffer.subarray(desde, fin)).toString('latin1');
    } catch {
      /* no todos los streams son texto comprimido (la imagen del QR, p. ej.) */
    }
    i = fin + 'endstream'.length;
  }

  return [...crudo.matchAll(/\[(.*?)\]\s*TJ/gs)]
    .map((tj) =>
      [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join('')
    )
    .join('\n');
}

describe('recibos (S3-05)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let adminSur;
  let orgA;
  let orgB;
  let torre;
  let lomas;
  let proveedor;
  let proveedorSur;
  let rubroHoja;
  let matriculaOrgA;
  let organizacionA;
  let ufsTorre;

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    organizacionA = await prisma.organizacion.findUnique({
      where: { id: orgA },
      select: { nombre: true, cuit: true, matriculaRPA: true },
    });
    matriculaOrgA = organizacionA.matriculaRPA;
    assert.ok(matriculaOrgA, 'la organización del seed debe tener matrícula RPA (Ley 941)');

    torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgA, nombre: 'Torre Palermo' },
      select: { id: true, nombre: true, direccion: true },
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

    const unidadesTorre = await prisma.unidad.findMany({
      where: { edificioId: torre.id },
      select: { coeficiente: true },
    });
    ufsTorre = unidadesTorre.length;
    const suma = unidadesTorre.reduce((acc, u) => acc.plus(u.coeficiente), new Decimal(0));
    assert.equal(
      suma.toFixed(6),
      '1.000000',
      'Torre Palermo debe tener Σcoeficientes = 1 (correr `make db-seed`)'
    );

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Servicios Recibos ${SUFIJO}` },
    });
    proveedorSur = await prisma.proveedor.create({
      data: { organizacionId: orgB, razonSocial: `Servicios Sur Recibos ${SUFIJO}` },
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

    // Los PDFs generados se borran del storage antes que sus registros (la key
    // sale de la fila): el volumen del contenedor no se queda con basura.
    const recibos = await prisma.recibo.findMany({
      where: { liquidacionId: { in: ids } },
      select: { storageKey: true },
    });
    for (const { storageKey } of recibos) {
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
        concepto: `Gasto ${SUFIJO}`,
        monto: '1000.00',
        categoria: 'A',
        fechaGasto: '2016-01-15',
        periodo: PERIODO_ENVIO,
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

  // Descarga cruda (apiFetch parsea JSON, acá hace falta el binario).
  async function descargar(token, reciboId) {
    const res = await fetch(`${baseUrl}/api/recibos/${reciboId}/descargar`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.headers.get('content-type')?.includes('application/json')) {
      return { status: res.status, tipo: res.headers.get('content-type'), data: await res.json() };
    }
    return {
      status: res.status,
      tipo: res.headers.get('content-type'),
      disposicion: res.headers.get('content-disposition'),
      buffer: Buffer.from(await res.arrayBuffer()),
    };
  }

  let liquidacionEnviada;
  let recibosEmitidos;

  // ─── Estado inválido (decisión 8 de la ruta) ───

  it('enviar una liquidación en BORRADOR → 409 ESTADO_INVALIDO y no emite nada', async () => {
    await crearGasto(admin.accessToken, torre.id, {
      monto: '4000.00',
      periodo: PERIODO_BORRADOR,
      fechaGasto: '2016-02-10',
    });
    const { data: borrador } = await liquidar(admin.accessToken, torre.id, PERIODO_BORRADOR);
    assert.equal(borrador.estado, 'BORRADOR');

    const enviar = await accion(admin.accessToken, borrador.id, 'enviar');
    assert.equal(enviar.status, 409, JSON.stringify(enviar.data));
    assert.equal(enviar.data.error.code, 'ESTADO_INVALIDO');
    assert.equal(enviar.data.error.estadoActual, 'BORRADOR');

    // El estado no se movió y no quedó ningún recibo colgado.
    const despues = await prisma.liquidacion.findUnique({
      where: { id: borrador.id },
      select: { estado: true },
    });
    assert.equal(despues.estado, 'BORRADOR');
    assert.equal(await prisma.recibo.count({ where: { liquidacionId: borrador.id } }), 0);

    // Y la lista de recibos existe igual: vacía mientras no se envió.
    const lista = await apiFetch(baseUrl, `/api/liquidaciones/${borrador.id}/recibos`, {
      token: admin.accessToken,
    });
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.data.data, []);
    assert.equal(lista.data.estado, 'BORRADOR');
  });

  // ─── Camino feliz: APROBADA → ENVIADA con un recibo por UF ───

  it('enviar una liquidación APROBADA → ENVIADA con un recibo por UF', async () => {
    // Un ordinario + un extraordinario: el recibo tiene que separar los dos.
    const montos = [
      { monto: '12345.67', categoria: 'A', esOrdinario: true },
      { monto: '5000.00', categoria: 'A', esOrdinario: false, concepto: `Pintura ${SUFIJO}` },
    ];
    for (const g of montos) {
      const { status } = await crearGasto(admin.accessToken, torre.id, g);
      assert.equal(status, 201);
    }

    const { data: liquidacion } = await liquidar(admin.accessToken, torre.id, PERIODO_ENVIO);
    const aprobada = await accion(admin.accessToken, liquidacion.id, 'aprobar');
    assert.equal(aprobada.status, 200);

    const enviada = await accion(admin.accessToken, liquidacion.id, 'enviar');
    assert.equal(enviada.status, 200, JSON.stringify(enviada.data));
    assert.equal(enviada.data.estado, 'ENVIADA');
    assert.equal(enviada.data.recibos.emitidos, ufsTorre);
    assert.equal(enviada.data.recibos.data.length, ufsTorre);

    liquidacionEnviada = enviada.data;
    recibosEmitidos = enviada.data.recibos.data;

    // La suma de los recibos cierra al centavo con el total de la liquidación.
    const suma = recibosEmitidos.reduce((acc, r) => acc.plus(r.totalGeneral), new Decimal(0));
    assert.equal(suma.toFixed(2), enviada.data.totalGeneral);

    const sumaOrd = recibosEmitidos.reduce((acc, r) => acc.plus(r.totalOrdinarias), new Decimal(0));
    const sumaExt = recibosEmitidos.reduce(
      (acc, r) => acc.plus(r.totalExtraordinarias),
      new Decimal(0)
    );
    assert.equal(sumaOrd.toFixed(2), enviada.data.totalOrdinarias);
    assert.equal(sumaExt.toFixed(2), enviada.data.totalExtraordinarias);

    // Numeración correlativa sin huecos: {periodo}-0001 .. -000N (Ley 941 §3.1).
    const numeros = recibosEmitidos.map((r) => r.numero).sort();
    assert.deepEqual(
      numeros,
      Array.from({ length: ufsTorre }, (_, i) => `${PERIODO_ENVIO}-${String(i + 1).padStart(4, '0')}`)
    );

    // Cada recibo copia la matrícula RPA del acto y apunta a su propia descarga.
    for (const recibo of recibosEmitidos) {
      assert.equal(recibo.matriculaRPA, matriculaOrgA);
      assert.equal(recibo.periodo, PERIODO_ENVIO);
      assert.equal(recibo.storageDriver, 'filesystem');
      assert.ok(recibo.bytes > 0);
      assert.equal(recibo.descargaUrl, `/api/recibos/${recibo.id}/descargar`);
    }

    // Y el QR del período quedó en la liquidación (`Liquidacion.qrData`).
    const fila = await prisma.liquidacion.findUnique({
      where: { id: liquidacion.id },
      select: { qrData: true },
    });
    const qrPeriodo = JSON.parse(fila.qrData);
    assert.equal(qrPeriodo.matriculaRPA, matriculaOrgA);
    assert.equal(qrPeriodo.periodo, PERIODO_ENVIO);
    assert.equal(qrPeriodo.recibos, ufsTorre);
  });

  it('enviar dos veces → 409 ESTADO_INVALIDO, sin duplicar recibos (decisión 8)', async () => {
    const repetida = await accion(admin.accessToken, liquidacionEnviada.id, 'enviar');
    assert.equal(repetida.status, 409);
    assert.equal(repetida.data.error.code, 'ESTADO_INVALIDO');
    assert.equal(repetida.data.error.estadoActual, 'ENVIADA');

    assert.equal(
      await prisma.recibo.count({ where: { liquidacionId: liquidacionEnviada.id } }),
      ufsTorre
    );
  });

  it('GET /api/liquidaciones/:id/recibos lista los recibos emitidos con su UF', async () => {
    const { status, data } = await apiFetch(
      baseUrl,
      `/api/liquidaciones/${liquidacionEnviada.id}/recibos`,
      { token: admin.accessToken }
    );
    assert.equal(status, 200);
    assert.equal(data.estado, 'ENVIADA');
    assert.equal(data.periodo, PERIODO_ENVIO);
    assert.equal(data.data.length, ufsTorre);

    // Cada recibo trae identificada su unidad funcional, y no hay dos por UF.
    const unidades = new Set(data.data.map((r) => r.unidad.numero));
    assert.equal(unidades.size, ufsTorre);
    assert.ok(unidades.has('1A'), 'la UF 1A del seed debe tener recibo');
  });

  // ─── Descarga y contenido del PDF (Ley 941) ───

  it('el PDF descargado es un recibo Ley 941: matrícula RPA, separación ord/ext y total de la UF', async () => {
    const recibo = recibosEmitidos.find((r) => r.unidad.numero === '1A');
    const { status, tipo, disposicion, buffer } = await descargar(admin.accessToken, recibo.id);

    assert.equal(status, 200);
    assert.ok(tipo.includes('application/pdf'), `content-type inesperado: ${tipo}`);
    assert.match(disposicion, /attachment; filename="recibo-2016-01-\d{4}\.pdf"/);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');

    // Integridad: el sha256 persistido es el del archivo servido.
    assert.equal(createHash('sha256').update(buffer).digest('hex'), recibo.sha256);
    assert.equal(buffer.length, recibo.bytes);

    const texto = textoDelPdf(buffer);
    // Requisitos de PRD-06-01 §3.1 que el recibo ya cubre.
    assert.match(texto, new RegExp(`Matrícula RPA: ${matriculaOrgA}`));
    assert.ok(texto.includes(`Consorcio ${torre.nombre}`), 'denominación del consorcio');
    assert.ok(texto.includes(torre.direccion), 'domicilio del consorcio');
    assert.ok(texto.includes(`CUIT: ${organizacionA.cuit}`), 'CUIT del administrador');
    assert.ok(texto.includes('Unidad: 1A'), 'identificación de la UF');
    assert.ok(texto.includes('Período: Enero 2016 (2016-01)'), 'período');
    // §3.2: la separación ordinarias / extraordinarias es obligatoria.
    assert.ok(texto.includes('EXPENSAS ORDINARIAS'));
    assert.ok(texto.includes('EXPENSAS EXTRAORDINARIAS'));
    assert.ok(texto.includes('TOTAL A PAGAR'));
    assert.ok(texto.includes('Ley 941'), 'el pie legal cita la Ley 941');

    // Los importes de la UF, en el formato argentino que imprime el generador.
    assert.ok(texto.includes(pesos(recibo.totalGeneral)), 'el total de la UF aparece en el PDF');
    assert.ok(texto.includes(pesos(recibo.totalOrdinarias)), 'el subtotal de ordinarias');
    assert.ok(texto.includes(pesos(recibo.totalExtraordinarias)), 'el subtotal de extraordinarias');

    // S3-09: el PDF imprime EL MISMO detalle agrupado que muestra la preview
    // (`core/detalle-agrupado.js`). Se compara contra la preview de la propia
    // liquidación en vez de contra literales del seed: lo que esta aserción
    // protege es justamente que las dos salidas no puedan divergir.
    const { data: preview } = await apiFetch(
      baseUrl,
      `/api/liquidaciones/${liquidacionEnviada.id}`,
      { token: admin.accessToken }
    );
    const uf = preview.unidades.find((u) => u.numero === '1A');
    assert.ok(uf.secciones.length > 0, 'la preview de la UF trae su detalle agrupado');

    for (const seccion of uf.secciones) {
      for (const rubro of seccion.rubros) {
        assert.ok(texto.includes(rubro.nombre), `el rubro "${rubro.nombre}" se imprime`);
        for (const sub of rubro.subrubros) {
          if (sub.nombre) {
            assert.ok(texto.includes(sub.nombre), `el subrubro "${sub.nombre}" se imprime`);
          }
          for (const item of sub.items) {
            assert.ok(
              texto.includes(item.conceptoImpreso),
              `el concepto "${item.conceptoImpreso}" se imprime`
            );
            assert.ok(texto.includes(pesos(item.monto)), 'el importe del ítem se imprime');
          }
        }
      }
    }
  });

  it('el QR del recibo lleva matrícula, período, UF, totales, fecha y verificación', async () => {
    const recibo = recibosEmitidos.find((r) => r.unidad.numero === '1A');
    const fila = await prisma.recibo.findUnique({
      where: { id: recibo.id },
      select: { qrData: true, fechaEmision: true },
    });

    const qr = JSON.parse(fila.qrData);
    assert.equal(qr.consorcio, torre.nombre);
    assert.equal(qr.matriculaRPA, matriculaOrgA);
    assert.equal(qr.periodo, PERIODO_ENVIO);
    assert.equal(qr.unidad, '1A');
    assert.equal(qr.recibo, recibo.numero);
    assert.equal(qr.totalOrdinarias, recibo.totalOrdinarias);
    assert.equal(qr.totalExtraordinarias, recibo.totalExtraordinarias);
    assert.equal(qr.totalGeneral, recibo.totalGeneral);
    assert.equal(qr.fechaEmision, new Date(fila.fechaEmision).toISOString());
    assert.ok(qr.verificacion.endsWith(`/r/${recibo.id}`), 'la URL del QR referencia al recibo');

    // La URL de verificación también se imprime en el pie del PDF.
    const { buffer } = await descargar(admin.accessToken, recibo.id);
    assert.ok(textoDelPdf(buffer).includes(qr.verificacion));
  });

  // ─── Determinismo del generador (PRD-02-05: motor determinístico) ───

  it('el generador es determinístico: mismo input → mismos bytes', async () => {
    const datos = {
      numero: '2016-01-0001',
      periodo: '2016-01',
      fechaEmision: new Date('2016-01-31T12:00:00.000Z'),
      matriculaRPA: 'RPA-0001',
      administrador: { nombre: 'Administración Test', cuit: '30-11111111-1' },
      consorcio: {
        nombre: 'Consorcio Test',
        direccion: 'Calle 1',
        ciudad: 'CABA',
        provincia: 'CABA',
      },
      unidad: { numero: '1A', tipo: 'departamento', m2: '50.00', coeficiente: '0.100000' },
      propietarios: ['Test, Ana'],
      // El detalle llega agrupado (`core/detalle-agrupado.js`): el generador ya
      // no arma la jerarquía, la imprime.
      secciones: [
        {
          id: 'ordinarias',
          titulo: 'Expensas ordinarias',
          total: '100.00',
          rubros: [
            {
              id: 'r-personal',
              nombre: 'Personal',
              total: '100.00',
              subrubros: [
                {
                  id: 's-sueldos',
                  nombre: 'Sueldos y cargas',
                  total: '100.00',
                  items: [
                    { gastoId: 'g1', conceptoImpreso: 'Sueldos', monto: '100.00' },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'extraordinarias',
          titulo: 'Expensas extraordinarias',
          total: '50.00',
          rubros: [
            {
              id: 'r-obras',
              nombre: 'Obras',
              total: '50.00',
              subrubros: [
                {
                  id: '__directo__',
                  nombre: null,
                  total: '50.00',
                  items: [{ gastoId: 'g2', conceptoImpreso: 'Obra', monto: '50.00' }],
                },
              ],
            },
          ],
        },
      ],
      totalOrdinarias: '100.00',
      totalExtraordinarias: '50.00',
      totalGeneral: '150.00',
      totalesConsorcio: { ordinarias: '1000.00', extraordinarias: '500.00', general: '1500.00' },
      verificacionUrl: 'http://localhost:5173/r/determinismo',
    };

    const uno = await generarReciboPDF(datos);
    const dos = await generarReciboPDF(datos);
    assert.ok(uno.buffer.equals(dos.buffer), 'dos generaciones del mismo recibo deben ser idénticas');
    assert.equal(uno.qrData, armarQrData(datos));

    // Y el formato de los montos es el argentino, sin depender del ICU del runtime.
    const texto = textoDelPdf(uno.buffer);
    assert.ok(texto.includes('$ 150,00'), 'total con coma decimal');
    assert.ok(texto.includes('$ 1.500,00'), 'miles con punto');
  });

  // ─── Autorización (cerbos/policies/recibo.yaml) ───

  it('el gestor lee y descarga los recibos de su edificio, pero no puede enviar', async () => {
    const recibo = recibosEmitidos[0];

    const lista = await apiFetch(
      baseUrl,
      `/api/liquidaciones/${liquidacionEnviada.id}/recibos`,
      { token: gestor.accessToken }
    );
    assert.equal(lista.status, 200);
    assert.equal(lista.data.data.length, ufsTorre);

    const descarga = await descargar(gestor.accessToken, recibo.id);
    assert.equal(descarga.status, 200);
    assert.ok(descarga.tipo.includes('application/pdf'));

    // Enviar es del org_admin: el gestor cae en el DENY de liquidacion.yaml.
    const otra = await prisma.liquidacion.findFirst({
      where: { edificioId: torre.id, periodo: PERIODO_BORRADOR },
      select: { id: true },
    });
    const enviar = await accion(gestor.accessToken, otra.id, 'enviar');
    assert.equal(enviar.status, 403);
    assert.equal(enviar.data.error.code, 'ACCESO_DENEGADO');
  });

  it('el staff de otra organización no descarga ni lista recibos ajenos (404)', async () => {
    const recibo = recibosEmitidos[0];

    const descarga = await descargar(adminSur.accessToken, recibo.id);
    assert.equal(descarga.status, 404);
    assert.equal(descarga.data.error.code, 'RECIBO_NO_ENCONTRADO');

    const lista = await apiFetch(
      baseUrl,
      `/api/liquidaciones/${liquidacionEnviada.id}/recibos`,
      { token: adminSur.accessToken }
    );
    assert.equal(lista.status, 404);
    assert.equal(lista.data.error.code, 'LIQUIDACION_NO_ENCONTRADA');

    const enviar = await accion(adminSur.accessToken, liquidacionEnviada.id, 'enviar');
    assert.equal(enviar.status, 404);
  });

  it('la org B emite sus propios recibos con SU matrícula RPA', async () => {
    const gasto = await crearGasto(adminSur.accessToken, lomas.id, {
      proveedorId: proveedorSur.id,
      monto: '900.00',
      periodo: PERIODO_ORG_B,
      fechaGasto: '2016-03-10',
    });
    assert.equal(gasto.status, 201, JSON.stringify(gasto.data));

    const { data: liquidacion } = await liquidar(adminSur.accessToken, lomas.id, PERIODO_ORG_B);
    await accion(adminSur.accessToken, liquidacion.id, 'aprobar');
    const enviada = await accion(adminSur.accessToken, liquidacion.id, 'enviar');
    assert.equal(enviada.status, 200, JSON.stringify(enviada.data));

    const { matriculaRPA: matriculaOrgB } = await prisma.organizacion.findUnique({
      where: { id: orgB },
      select: { matriculaRPA: true },
    });
    assert.notEqual(matriculaOrgB, matriculaOrgA);
    for (const recibo of enviada.data.recibos.data) {
      assert.equal(recibo.matriculaRPA, matriculaOrgB);
    }

    const { buffer } = await descargar(adminSur.accessToken, enviada.data.recibos.data[0].id);
    const texto = textoDelPdf(buffer);
    assert.ok(texto.includes(`Matrícula RPA: ${matriculaOrgB}`));
    assert.ok(!texto.includes(matriculaOrgA), 'ningún dato de la org A en un recibo de la org B');
  });

  it('404 en un recibo inexistente', async () => {
    const { status, data } = await descargar(admin.accessToken, randomUUID());
    assert.equal(status, 404);
    assert.equal(data.error.code, 'RECIBO_NO_ENCONTRADO');
  });
});
