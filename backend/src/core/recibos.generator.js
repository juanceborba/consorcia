// src/core/recibos.generator.js — Recibo de expensas PDF + QR (S3-05)
// Spec: PRD-02-05 §4 (generador) · PRD-06-01 §3 (Ley 941: datos obligatorios,
// separación ord/ext, QR) · PRD-04-03 §1 (se emite al pasar a ENVIADA).
//
// El generador es una FUNCIÓN PURA: recibe los datos ya resueltos y devuelve el
// buffer del PDF. No toca la DB ni el filesystem (eso es la ruta + el servicio
// de almacenamiento) y no llama a `new Date()` — la fecha de emisión entra por
// parámetro. Consecuencia buscada: **determinístico**, mismo input → mismos
// bytes, incluida la metadata del PDF (`CreationDate`/`ModDate` se fijan en
// `fechaEmision`). Eso hace que el sha256 que guarda el recibo sirva como
// verificación de integridad del comprobante emitido.
//
// DECISIONES:
//
// 1. **Los montos se formatean acá, sin `Intl`.** `toLocaleString('es-AR')`
//    depende del ICU del runtime (Node "small-icu" imprime otra cosa) y eso
//    rompería el determinismo entre el contenedor y CI. `pesos()` arma el
//    formato argentino a mano sobre el string de decimal.js.
//
// 2. **Contenido del QR: JSON** con matrícula RPA, período, unidad, totales y
//    fecha de emisión (backlog S3-05 y PRD-02-05 §4.2), MÁS un campo
//    `verificacion` con la URL `${APP_BASE_URL}/r/{reciboId}`. PRD-06-01 §3.3
//    pide que el QR lleve a la carpeta de comprobantes del período; esa carpeta
//    todavía no existe (es documentos, S3-10), así que el QR es autodescriptivo
//    hoy y ya trae el enlace que va a resolver a los comprobantes cuando exista,
//    sin cambiar el formato del payload. Divergencia documentada en el PRD.
//
// 3. **Lo que la Ley 941 pide y todavía no está modelado NO se imprime**:
//    vencimiento con su interés, lugar y formas de pago (PRD-04-04, cobranzas)
//    y resumen bancario / detalle de seguros (rendición mensual, S3-07+).
//    Imprimir un placeholder en un documento legal es peor que omitirlo; el
//    recibo lo declara en el pie y las secciones se suman cuando exista el dato.

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import Decimal from 'decimal.js';

// Formato argentino: miles con punto, decimales con coma, siempre 2 decimales.
export function pesos(valor) {
  const fijo = new Decimal(valor).toFixed(2);
  const negativo = fijo.startsWith('-');
  const [entero, decimales] = (negativo ? fijo.slice(1) : fijo).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}$ ${miles},${decimales}`;
}

// Coeficiente como porcentaje legible (0.076543 → "7,6543 %").
export function porcentaje(coeficiente) {
  const pct = new Decimal(coeficiente).times(100).toFixed(4);
  return `${pct.replace('.', ',')} %`;
}

// dd/mm/aaaa en UTC: la fecha impresa no puede depender del TZ del proceso
// (el contenedor corre en UTC, el host del dev en -03).
export function fechaLarga(fecha) {
  const d = new Date(fecha);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

// "2026-07" → "Julio 2026" (para el encabezado; el período crudo también se
// imprime, es el que matchea la liquidación).
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
export function periodoLegible(periodo) {
  const [anio, mes] = String(periodo).split('-');
  const nombre = MESES[Number(mes) - 1];
  return nombre ? `${nombre} ${anio}` : String(periodo);
}

// Payload del QR (decisión 2). El orden de las claves es fijo: el JSON entra al
// QR tal cual y se persiste en `Recibo.qrData`.
export function armarQrData(datos) {
  return JSON.stringify({
    consorcio: datos.consorcio.nombre,
    matriculaRPA: datos.matriculaRPA,
    periodo: datos.periodo,
    unidad: datos.unidad.numero,
    recibo: datos.numero,
    totalOrdinarias: new Decimal(datos.totalOrdinarias).toFixed(2),
    totalExtraordinarias: new Decimal(datos.totalExtraordinarias).toFixed(2),
    totalGeneral: new Decimal(datos.totalGeneral).toFixed(2),
    fechaEmision: new Date(datos.fechaEmision).toISOString(),
    verificacion: datos.verificacionUrl,
  });
}

// Título de sección con su regla horizontal. Fija la `x` en el margen
// izquierdo: pdfkit recuerda la última `x` usada, y las columnas alineadas a
// derecha la dejan corrida (todo lo que venga después saldría angosto).
function titulo(doc, texto) {
  const izquierda = doc.page.margins.left;
  const derecha = doc.page.width - doc.page.margins.right;
  doc.fontSize(11).font('Helvetica-Bold').text(texto, izquierda, doc.y);
  doc.moveTo(izquierda, doc.y + 2).lineTo(derecha, doc.y + 2).stroke();
  doc.moveDown(0.5);
}

// Una sección "EXPENSAS ORDINARIAS/EXTRAORDINARIAS": ítems por gasto + subtotal.
function seccion(doc, encabezado, items, subtotal) {
  const izquierda = doc.page.margins.left;
  const derecha = doc.page.width - doc.page.margins.right;

  titulo(doc, encabezado);

  doc.fontSize(9).font('Helvetica');
  if (items.length === 0) {
    doc.text('Sin conceptos en el período.', izquierda, doc.y);
  }
  for (const item of items) {
    const y = doc.y;
    doc.text(item.concepto, izquierda, y, { width: derecha - izquierda - 110 });
    doc.text(pesos(item.monto), derecha - 110, y, { width: 110, align: 'right' });
  }

  doc.moveDown(0.3);
  const y = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text(`Subtotal ${encabezado.toLowerCase()}`, izquierda, y, {
    width: derecha - izquierda - 110,
  });
  doc.text(pesos(subtotal), derecha - 110, y, { width: 110, align: 'right' });
  doc.font('Helvetica').text('', izquierda, doc.y).moveDown(1);
}

/**
 * Genera el PDF de un recibo de expensas de una UF.
 *
 * @param {object} datos
 * @param {string} datos.numero              Correlativo del recibo ("2026-07-0001")
 * @param {string} datos.periodo             "2026-07"
 * @param {Date|string} datos.fechaEmision   Fecha de emisión (fija el determinismo)
 * @param {string} datos.matriculaRPA        Matrícula RPA del administrador (Ley 941)
 * @param {object} datos.administrador       { nombre, cuit }
 * @param {object} datos.consorcio           { nombre, direccion, ciudad, provincia }
 * @param {object} datos.unidad              { numero, tipo, m2, coeficiente }
 * @param {string[]} datos.propietarios      Nombres de los titulares de la UF
 * @param {{concepto: string, monto: string}[]} datos.ordinarias
 * @param {{concepto: string, monto: string}[]} datos.extraordinarias
 * @param {string} datos.totalOrdinarias     Total de la UF
 * @param {string} datos.totalExtraordinarias
 * @param {string} datos.totalGeneral
 * @param {object} datos.totalesConsorcio    { ordinarias, extraordinarias, general }
 * @param {string} datos.verificacionUrl     URL que va dentro del QR
 * @returns {Promise<Buffer>} el PDF completo
 */
export async function generarReciboPDF(datos) {
  const qrData = armarQrData(datos);
  const qrBuffer = await QRCode.toBuffer(qrData, {
    type: 'png',
    width: 132,
    margin: 1,
    errorCorrectionLevel: 'H',
  });

  const fecha = new Date(datos.fechaEmision);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    // Determinismo: sin esto pdfkit estampa `new Date()` en la metadata.
    info: {
      Title: `Recibo de expensas ${datos.numero} — UF ${datos.unidad.numero}`,
      Author: datos.administrador.nombre,
      Subject: `Expensas ${periodoLegible(datos.periodo)} — ${datos.consorcio.nombre}`,
      Keywords: `expensas, ley 941, ${datos.matriculaRPA}, ${datos.periodo}`,
      Creator: 'ConsorcIA',
      Producer: 'ConsorcIA',
      CreationDate: fecha,
      ModDate: fecha,
    },
  });

  const trozos = [];
  doc.on('data', (t) => trozos.push(t));
  const listo = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });

  const izquierda = doc.page.margins.left;
  const derecha = doc.page.width - doc.page.margins.right;

  // ─── Encabezado: consorcio + administrador (Ley 941 §3.1) ───
  doc.fontSize(16).font('Helvetica-Bold').text('RECIBO DE EXPENSAS');
  doc.fontSize(10).font('Helvetica').text(`N° ${datos.numero}`);
  doc.moveDown(0.5);

  doc.fontSize(12).font('Helvetica-Bold').text(`Consorcio ${datos.consorcio.nombre}`);
  doc.fontSize(9).font('Helvetica');
  doc.text(
    [datos.consorcio.direccion, datos.consorcio.ciudad, datos.consorcio.provincia]
      .filter(Boolean)
      .join(', ')
  );
  doc.text(`Administración: ${datos.administrador.nombre}`);
  doc.text(`CUIT: ${datos.administrador.cuit}`);
  doc.font('Helvetica-Bold').text(`Matrícula RPA: ${datos.matriculaRPA}`);
  doc.font('Helvetica');
  doc.text(`Período: ${periodoLegible(datos.periodo)} (${datos.periodo})`);
  doc.text(`Fecha de emisión: ${fechaLarga(fecha)}`);

  // El QR va arriba a la derecha, fuera del flujo del texto.
  doc.image(qrBuffer, derecha - 132, doc.page.margins.top, { width: 132 });
  doc.moveDown(1);

  // ─── Unidad funcional ───
  titulo(doc, 'UNIDAD FUNCIONAL');
  doc.fontSize(9).font('Helvetica');
  doc.text(`Unidad: ${datos.unidad.numero} (${datos.unidad.tipo})`);
  doc.text(`Superficie: ${new Decimal(datos.unidad.m2).toFixed(2).replace('.', ',')} m²`);
  doc.text(`Coeficiente: ${porcentaje(datos.unidad.coeficiente)}`);
  doc.text(
    `Propietario/s: ${datos.propietarios.length > 0 ? datos.propietarios.join(' · ') : 'Sin titular registrado'}`
  );
  doc.moveDown(1);

  // ─── Separación ordinarias / extraordinarias (Ley 941 §3.2) ───
  seccion(doc, 'EXPENSAS ORDINARIAS', datos.ordinarias, datos.totalOrdinarias);
  seccion(doc, 'EXPENSAS EXTRAORDINARIAS', datos.extraordinarias, datos.totalExtraordinarias);

  // ─── Total a pagar ───
  doc.moveTo(izquierda, doc.y).lineTo(derecha, doc.y).stroke();
  doc.moveDown(0.4);
  const yTotal = doc.y;
  doc.fontSize(13).font('Helvetica-Bold');
  doc.text('TOTAL A PAGAR', izquierda, yTotal, { width: derecha - izquierda - 140 });
  doc.text(pesos(datos.totalGeneral), derecha - 140, yTotal, { width: 140, align: 'right' });
  doc.font('Helvetica').fontSize(8).text('', izquierda, doc.y).moveDown(1);
  doc.text(
    `Total del consorcio en el período: ordinarias ${pesos(datos.totalesConsorcio.ordinarias)} · ` +
      `extraordinarias ${pesos(datos.totalesConsorcio.extraordinarias)} · ` +
      `general ${pesos(datos.totalesConsorcio.general)}. ` +
      `El importe de esta UF surge de aplicar su coeficiente ${porcentaje(datos.unidad.coeficiente)} ` +
      `sobre los gastos que le corresponden.`
  );
  doc.moveDown(1.5);

  // ─── Pie legal (Ley 941 / Ley 5983) ───
  doc.fontSize(8).font('Helvetica');
  doc.text(
    'Recibo emitido según la Ley 941 de la Ciudad Autónoma de Buenos Aires (Registro Público de ' +
      'Administradores de Consorcios de Propiedad Horizontal). El código QR contiene los datos de esta ' +
      'liquidación y el enlace de verificación de los comprobantes del período (Ley 5983).'
    // Sin `align: 'justify'`: pdfkit justifica posicionando cada palabra por
    // separado y el texto deja de ser extraíble (copiar/pegar y lectores de
    // pantalla lo reciben pegado). En un documento legal eso importa más que
    // el margen derecho parejo.
  );
  doc.moveDown(0.4);
  doc.text(`Verificación: ${datos.verificacionUrl}`);

  doc.end();
  return { buffer: await listo, qrData };
}

export default { generarReciboPDF, armarQrData, pesos, porcentaje, fechaLarga, periodoLegible };
