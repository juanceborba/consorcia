// src/services/recibos.js — Emisión de los recibos de una liquidación (S3-05)
// Spec: PRD-02-05 §4 · PRD-06-01 §3 · PRD-04-03 §1 (APROBADA → ENVIADA)
//
// Orquesta lo que el generador (función pura) y el almacenamiento (bytes) no
// hacen: leer los datos de la liquidación, armar un recibo por UF, validar los
// requisitos de la Ley 941, escribir los PDFs y persistir los registros.
//
// DECISIONES:
//
// 1. **Una `fechaEmision` para toda la tanda.** Todos los recibos de una
//    liquidación se emiten en el mismo acto administrativo; que dos UF muestren
//    horas distintas porque el bucle tardó no tiene sentido legal y además
//    rompería el determinismo del PDF por UF.
//
// 2. **Numeración correlativa por liquidación**: `{periodo}-{NNNN}` sobre las
//    UF ordenadas por número (`2026-07-0001`). Ley 941 §3.1 pide recibo
//    numerado; el correlativo global por organización necesitaría una secuencia
//    en la DB y no aporta nada al MVP — el par (liquidación, número) ya es único
//    e irrepetible por índice.
//
// 3. **Los detalles con monto 0 no se imprimen.** El motor emite una fila por
//    UF y gasto incluso cuando la UF no participa (una cochera en el gasto de
//    ascensor); listar "$ 0,00" en un recibo legal es ruido, no información.
//    El total de la UF no cambia.
//
// 4. **Los propietarios se leen de los vínculos VIGENTES** (`fechaFin` null o
//    futura). Si la UF no tiene titular cargado el recibo se emite igual con
//    "Sin titular registrado": bloquear la liquidación entera del edificio por
//    un padrón incompleto sería peor (el consorcio tiene que poder emitir).

import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import { generarReciboPDF } from '../core/recibos.generator.js';
import { validarRecibo } from '../core/validators/recibo.validator.js';
import { guardar, segmentoSeguro } from './almacenamiento.js';

export class ReciboError extends Error {
  constructor(codigo, message, metadata = {}) {
    super(message);
    this.name = 'ReciboError';
    this.codigo = codigo;
    this.metadata = metadata;
  }
}

const baseApp = () => process.env.APP_BASE_URL ?? 'http://localhost:5173';

// URL de verificación que viaja en el QR (PRD-06-01 §3.3, ver decisión 2 del
// generador): resuelve a los comprobantes del período cuando exista S3-10.
export const urlVerificacion = (reciboId) => `${baseApp()}/r/${reciboId}`;

const correlativo = (periodo, indice) => `${periodo}-${String(indice + 1).padStart(4, '0')}`;

const nombreArchivo = (numero, unidadNumero) =>
  `${segmentoSeguro(numero)}-uf-${segmentoSeguro(unidadNumero)}.pdf`;

// Key de storage: scope org → edificio → período → liquidación. Todos los
// segmentos pasan por `segmentoSeguro` (los ids son uuid, el número de UF no).
const storageKey = (liquidacion, numero, unidadNumero) =>
  [
    'recibos',
    segmentoSeguro(liquidacion.organizacionId),
    segmentoSeguro(liquidacion.edificioId),
    segmentoSeguro(liquidacion.periodo),
    segmentoSeguro(liquidacion.id),
    nombreArchivo(numero, unidadNumero),
  ].join('/');

/**
 * Genera y persiste un recibo por cada UF de la liquidación.
 * Asume que la liquidación ya está en ENVIADA (la transición es el candado que
 * evita la doble emisión) y que el llamador revierte el estado si esto falla.
 *
 * @returns {Promise<object[]>} los recibos creados, ordenados por número
 */
export async function emitirRecibos(liquidacion, { fechaEmision = new Date() } = {}) {
  const organizacionId = liquidacion.organizacionId;

  const [edificio, organizacion, detalles] = await Promise.all([
    prisma.edificio.findUnique({
      where: { id: liquidacion.edificioId },
      select: { nombre: true, direccion: true, ciudad: true, provincia: true },
    }),
    prisma.organizacion.findUnique({
      where: { id: organizacionId },
      select: { nombre: true, cuit: true },
    }),
    prisma.liquidacionDetalle.findMany({
      where: { organizacionId, liquidacionId: liquidacion.id },
      select: {
        unidadId: true,
        montoAsignado: true,
        // S3-19: el rótulo "cuota k/N" del ítem sale del snapshot del detalle
        // (PRD-06-01 §3.2 lo dibuja: "Pintura fachada (cuota 3/6)").
        cuotaNumero: true,
        cuotasTotal: true,
        unidad: { select: { id: true, numero: true, tipo: true, m2: true, coeficiente: true } },
        gasto: { select: { id: true, concepto: true, esOrdinario: true, fechaGasto: true } },
      },
      // Orden estable: el detalle impreso de un mismo período no puede cambiar
      // de orden entre dos emisiones (determinismo del PDF).
      orderBy: [{ gasto: { fechaGasto: 'asc' } }, { gastoId: 'asc' }],
    }),
  ]);

  if (detalles.length === 0) {
    throw new ReciboError(
      'LIQUIDACION_SIN_DETALLE',
      'La liquidación no tiene detalle por unidad: no hay nada que emitir'
    );
  }

  // Titulares vigentes de las UF de esta liquidación (decisión 4).
  const unidadIds = [...new Set(detalles.map((d) => d.unidadId))];
  const ahora = fechaEmision;
  const vinculos = await prisma.unidadUsuario.findMany({
    where: {
      organizacionId,
      unidadId: { in: unidadIds },
      esPropietario: true,
      OR: [{ fechaFin: null }, { fechaFin: { gt: ahora } }],
    },
    select: {
      unidadId: true,
      usuario: { select: { apellido: true, nombre: true } },
    },
    orderBy: [{ unidadId: 'asc' }, { createdAt: 'asc' }],
  });

  const propietariosPorUnidad = new Map();
  for (const v of vinculos) {
    const lista = propietariosPorUnidad.get(v.unidadId) ?? [];
    lista.push(`${v.usuario.apellido}, ${v.usuario.nombre}`);
    propietariosPorUnidad.set(v.unidadId, lista);
  }

  // Agregación por UF: ítems por gasto + totales (decimal.js puro).
  const porUnidad = new Map();
  for (const d of detalles) {
    if (!porUnidad.has(d.unidadId)) {
      porUnidad.set(d.unidadId, {
        unidad: d.unidad,
        ordinarias: [],
        extraordinarias: [],
        totalOrdinarias: new Decimal(0),
        totalExtraordinarias: new Decimal(0),
      });
    }
    const fila = porUnidad.get(d.unidadId);
    const monto = new Decimal(d.montoAsignado);
    // S3-19: el ítem de una cuota se rotula "Concepto (cuota k/N)". Va en el
    // concepto impreso y no en un campo aparte porque el Modelo Único de la Ley
    // 941 tiene una columna de concepto y una de importe, no una de cuota.
    const item = {
      concepto: d.cuotasTotal
        ? `${d.gasto.concepto} (cuota ${d.cuotaNumero}/${d.cuotasTotal})`
        : d.gasto.concepto,
      monto: monto.toFixed(2),
    };

    if (d.gasto.esOrdinario) {
      fila.totalOrdinarias = fila.totalOrdinarias.plus(monto);
      if (!monto.isZero()) fila.ordinarias.push(item); // decisión 3
    } else {
      fila.totalExtraordinarias = fila.totalExtraordinarias.plus(monto);
      if (!monto.isZero()) fila.extraordinarias.push(item);
    }
  }

  const filas = [...porUnidad.values()].sort((a, b) =>
    a.unidad.numero.localeCompare(b.unidad.numero, 'es')
  );

  const totalesConsorcio = {
    ordinarias: new Decimal(liquidacion.totalOrdinarias).toFixed(2),
    extraordinarias: new Decimal(liquidacion.totalExtraordinarias).toFixed(2),
    general: new Decimal(liquidacion.totalGeneral).toFixed(2),
  };

  const emitidos = [];

  for (const [indice, fila] of filas.entries()) {
    const numero = correlativo(liquidacion.periodo, indice);
    const key = storageKey(liquidacion, numero, fila.unidad.numero);

    // El id del recibo se genera acá porque la URL de verificación del QR lo
    // referencia: el QR se dibuja antes de que exista la fila en la DB.
    const id = randomUUID();

    const datos = {
      numero,
      periodo: liquidacion.periodo,
      fechaEmision,
      matriculaRPA: liquidacion.matriculaRPA,
      administrador: { nombre: organizacion.nombre, cuit: organizacion.cuit },
      consorcio: edificio,
      unidad: fila.unidad,
      propietarios: propietariosPorUnidad.get(fila.unidad.id) ?? [],
      ordinarias: fila.ordinarias,
      extraordinarias: fila.extraordinarias,
      totalOrdinarias: fila.totalOrdinarias.toFixed(2),
      totalExtraordinarias: fila.totalExtraordinarias.toFixed(2),
      totalGeneral: fila.totalOrdinarias.plus(fila.totalExtraordinarias).toFixed(2),
      totalesConsorcio,
      verificacionUrl: urlVerificacion(id),
    };

    const { buffer, qrData } = await generarReciboPDF(datos);

    // Gate Ley 941 (PRD-02-05 §5.2): se valida el recibo YA armado, con el QR
    // que quedó embebido en el PDF.
    const veredicto = validarRecibo({
      matriculaRPA: datos.matriculaRPA,
      qrData,
      periodo: datos.periodo,
      fechaEmision: datos.fechaEmision,
      consorcio: edificio?.nombre,
      direccion: edificio?.direccion,
      unidad: fila.unidad.numero,
      totalOrdinarias: datos.totalOrdinarias,
      totalExtraordinarias: datos.totalExtraordinarias,
      totalGeneral: datos.totalGeneral,
    });
    if (!veredicto.valido) {
      throw new ReciboError(
        'RECIBO_INCOMPLETO',
        `El recibo de la UF ${fila.unidad.numero} no cumple la Ley 941`,
        { errores: veredicto.errores }
      );
    }

    const archivo = await guardar(key, buffer);

    emitidos.push({
      id,
      organizacionId,
      liquidacionId: liquidacion.id,
      unidadId: fila.unidad.id,
      numero,
      periodo: liquidacion.periodo,
      matriculaRPA: liquidacion.matriculaRPA,
      totalOrdinarias: datos.totalOrdinarias,
      totalExtraordinarias: datos.totalExtraordinarias,
      totalGeneral: datos.totalGeneral,
      qrData,
      fechaEmision,
      ...archivo,
    });
  }

  await prisma.recibo.createMany({ data: emitidos });

  // `Liquidacion.qrData` ya existía en el schema para esto: el payload a nivel
  // período (el de cada recibo es por UF y vive en `Recibo.qrData`). Deja el
  // acto de emisión auditable sin recorrer los recibos.
  await prisma.liquidacion.update({
    where: { id: liquidacion.id },
    data: {
      qrData: JSON.stringify({
        consorcio: edificio.nombre,
        matriculaRPA: liquidacion.matriculaRPA,
        periodo: liquidacion.periodo,
        totalOrdinarias: totalesConsorcio.ordinarias,
        totalExtraordinarias: totalesConsorcio.extraordinarias,
        totalGeneral: totalesConsorcio.general,
        fechaEmision: new Date(fechaEmision).toISOString(),
        recibos: emitidos.length,
      }),
    },
  });

  // Se releen desde la DB para que la respuesta del envío sea exactamente la
  // misma que la de `GET /api/liquidaciones/:id/recibos` (con la UF incluida).
  return prisma.recibo.findMany({
    where: { organizacionId, liquidacionId: liquidacion.id },
    include: { unidad: { select: { id: true, numero: true, tipo: true } } },
    orderBy: { numero: 'asc' },
  });
}

// Serialización del recibo para la API. Los montos salen como STRING por el
// mismo motivo que en liquidaciones (decisión 7 de la ruta) y el PDF nunca se
// expone como URL de storage: la descarga es siempre `descargaUrl`.
export const serializarRecibo = (r) => ({
  id: r.id,
  liquidacionId: r.liquidacionId,
  unidadId: r.unidadId,
  numero: r.numero,
  periodo: r.periodo,
  matriculaRPA: r.matriculaRPA,
  totalOrdinarias: new Decimal(r.totalOrdinarias).toFixed(2),
  totalExtraordinarias: new Decimal(r.totalExtraordinarias).toFixed(2),
  totalGeneral: new Decimal(r.totalGeneral).toFixed(2),
  fechaEmision: r.fechaEmision,
  bytes: r.bytes,
  sha256: r.sha256,
  storageDriver: r.storageDriver,
  descargaUrl: `/api/recibos/${r.id}/descargar`,
  ...(r.unidad ? { unidad: { id: r.unidad.id, numero: r.unidad.numero, tipo: r.unidad.tipo } } : {}),
});

export default { emitirRecibos, serializarRecibo, urlVerificacion };
