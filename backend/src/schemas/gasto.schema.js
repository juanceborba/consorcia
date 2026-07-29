// src/schemas/gasto.schema.js — Validación de gastos (S3-02)
// Spec: PRD-04-02 §1.1 (entidad) y §2 (contrato de la API).
//
// Dos decisiones de validación que precisan el PRD:
//
// 1. `monto` entra como número O como string y se normaliza a un string decimal.
//    El PRD escribe `z.number().positive()`, pero un `number` de JSON ya pasó
//    por un float binario: 0.1 + 0.2 no es el problema acá, sí lo es que el
//    cliente pueda mandar 1234.565 y que la columna `Decimal(12,2)` lo redondee
//    en silencio (medio centavo por gasto, multiplicado por N UFs en la
//    liquidación). Se rechaza con 422 en vez de redondear, y lo que se persiste
//    y se serializa es un string: ningún float atraviesa el backend
//    (AGENTS.md — "montos SIEMPRE con decimal.js").
//
// 2. `fechaGasto` "no futura" se evalúa contra el FIN DEL DÍA UTC de hoy, no
//    contra el instante actual. Un cliente en Buenos Aires (UTC-3) que carga un
//    gasto de "hoy" manda `2026-07-29` o `2026-07-29T00:00-03:00`; con el corte
//    en el instante actual, cargar el gasto del día a la mañana funciona y a la
//    noche no (según cómo el navegador arme la fecha). El fin del día UTC acepta
//    hoy en cualquier huso de Argentina y sigue rechazando mañana.

import { z } from 'zod';
import Decimal from 'decimal.js';

// Tope de la columna `Decimal(12, 2)`: 10 enteros + 2 decimales.
export const MONTO_MAX = new Decimal('9999999999.99');

export const PERIODO_REGEX = /^\d{4}-\d{2}$/;

const opcional = (schema) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    schema.nullable().optional()
  );

// Decisión 1: número o string → string decimal con hasta 2 decimales.
const montoSchema = z
  .union([z.number(), z.string().trim().min(1)], {
    errorMap: () => ({ message: 'monto: debe ser un número o un string numérico' }),
  })
  .transform((valor, ctx) => {
    let monto;
    try {
      monto = new Decimal(valor);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'monto inválido' });
      return z.NEVER;
    }
    if (!monto.isFinite()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'monto inválido' });
      return z.NEVER;
    }
    if (monto.lte(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'monto: debe ser mayor a 0' });
      return z.NEVER;
    }
    if (monto.decimalPlaces() > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'monto: máximo 2 decimales (la moneda se guarda al centavo)',
      });
      return z.NEVER;
    }
    if (monto.gt(MONTO_MAX)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `monto: máximo ${MONTO_MAX.toFixed(2)}`,
      });
      return z.NEVER;
    }
    return monto.toFixed(2);
  });

// "YYYY-MM" con mes real: el regex del PRD acepta "2026-13".
const periodoSchema = z
  .string()
  .trim()
  .regex(PERIODO_REGEX, 'periodo: formato YYYY-MM')
  .refine((p) => {
    const mes = Number(p.slice(5, 7));
    return mes >= 1 && mes <= 12;
  }, 'periodo: el mes debe estar entre 01 y 12');

// Decisión 2: el corte es el fin del día UTC.
const finDeHoyUTC = () => {
  const ahora = new Date();
  return Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    23,
    59,
    59,
    999
  );
};

const fechaGastoSchema = z.coerce
  .date({ invalid_type_error: 'fechaGasto inválida' })
  .refine((f) => f.getTime() <= finDeHoyUTC(), 'fechaGasto: no puede ser futura');

const camposGasto = {
  proveedorId: z.string().uuid('proveedorId: UUID requerido'),
  rubroId: z.string().uuid('rubroId: UUID requerido'),
  concepto: z.string().trim().min(3, 'concepto: mínimo 3 caracteres').max(100),
  descripcion: opcional(z.string().trim().max(500)),
  monto: montoSchema,
  moneda: z.enum(['ARS', 'USD']).default('ARS'),
  categoria: z.enum(['A', 'B', 'C'], { errorMap: () => ({ message: 'categoria: A, B o C' }) }),
  servicioEspecifico: opcional(z.string().trim().max(100)),
  sectorEspecifico: opcional(z.string().trim().max(100)),
  esOrdinario: z.boolean().default(true),
  comprobanteUrl: opcional(z.string().trim().url('comprobanteUrl: URL inválida').max(500)),
  fechaGasto: fechaGastoSchema,
  periodo: periodoSchema,
};

// Coherencia categoría ↔ campo específico. Se aplica sobre el objeto YA
// resuelto (creación: valores del body; edición: merge con lo persistido), así
// que vive en una función reusable en vez de en un `.refine` del schema de alta.
export function incoherenciaCategoria({ categoria, servicioEspecifico, sectorEspecifico }) {
  if (categoria === 'B' && !servicioEspecifico) {
    return 'servicioEspecifico: obligatorio para la categoría B (el servicio que se reparte)';
  }
  if (categoria === 'C' && !sectorEspecifico) {
    return 'sectorEspecifico: obligatorio para la categoría C (el sector que se reparte)';
  }
  // Un gasto A con servicio/sector cargado es ruido que el motor ignora: se
  // rechaza para que el dato no contradiga a la distribución.
  if (categoria === 'A' && (servicioEspecifico || sectorEspecifico)) {
    return 'categoria A: no lleva servicioEspecifico ni sectorEspecifico (se reparte a todas las UF)';
  }
  if (categoria === 'B' && sectorEspecifico) {
    return 'categoria B: no lleva sectorEspecifico';
  }
  if (categoria === 'C' && servicioEspecifico) {
    return 'categoria C: no lleva servicioEspecifico';
  }
  return null;
}

export const crearGastoSchema = z.object(camposGasto).strict();

export const editarGastoSchema = z
  .object(camposGasto)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Enviar al menos un campo a modificar',
  });

const booleanoDeQuery = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return v;
}, z.boolean());

export const listarGastosSchema = z
  .object({
    periodo: periodoSchema.optional(),
    categoria: z.enum(['A', 'B', 'C']).optional(),
    esOrdinario: booleanoDeQuery.optional(),
    proveedorId: z.string().uuid('proveedorId inválido').optional(),
    rubroId: z.string().uuid('rubroId inválido').optional(),
    desde: z.coerce.date({ invalid_type_error: 'desde: fecha inválida' }).optional(),
    hasta: z.coerce.date({ invalid_type_error: 'hasta: fecha inválida' }).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .refine((f) => !(f.desde && f.hasta) || f.desde <= f.hasta, {
    path: ['desde'],
    message: 'desde: no puede ser posterior a hasta',
  });
