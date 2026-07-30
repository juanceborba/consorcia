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
//
// 3. S3-19 — `cuotasTotal` es el ÚNICO campo del plan de cuotas que entra por la
//    API: el resto (los períodos y el monto de cada cuota) lo deriva el motor con
//    `planDeCuotas(monto, cuotasTotal, periodo)`, que es determinístico. Dejar
//    que el cliente mande los montos abriría la puerta a un plan que no suma el
//    total de la factura, que es justo la invariante que hay que defender.
//    `cuotasTotal: null` en una edición borra el plan (vuelve a imputación única).

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
  // Decisión 3: plan de cuotas. `periodo` es el de la primera cuota y las N-1
  // siguientes son los meses consecutivos. El tope de 120 son 10 años: más que
  // eso no es un plan de pago de una obra, es un error de tipeo.
  // S3-20: el esquema de reparto propio del gasto. NULL/ausente = el gasto adopta
  // lo que el edificio tenga configurado para su categoría/servicio/sector, y si
  // no hay nada, el coeficiente de siempre. Que el esquema sea de ESTE edificio
  // se valida en la ruta (depende de la DB).
  esquemaRepartoId: opcional(z.string().uuid('esquemaRepartoId: UUID requerido')),
  cuotasTotal: opcional(
    z.coerce
      .number({ invalid_type_error: 'cuotasTotal: número entero' })
      .int('cuotasTotal: número entero')
      .min(2, 'cuotasTotal: mínimo 2 cuotas (sin plan, el gasto se imputa entero en su período)')
      .max(120, 'cuotasTotal: máximo 120 cuotas')
  ),
};

// Coherencia del plan de cuotas con el tipo de gasto (S3-19). El alcance de la
// tarea es la brecha 1 del research: una OBRA que se cobra en N meses. Una
// ordinaria es, por definición, el gasto corriente del mes (CCyC arts. 2046 inc.
// c y 2048) y prorratearla escondería el gasto real de cada período.
export function incoherenciaCuotas({ cuotasTotal, esOrdinario }) {
  if (cuotasTotal && esOrdinario) {
    return 'cuotasTotal: solo un gasto extraordinario se imputa en cuotas (una ordinaria es el gasto corriente del período)';
  }
  return null;
}

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

// Los filtros que el dashboard (§3.4) comparte con la lista (§2). Se declaran
// una vez porque S3-16 los lee de la MISMA URL para las dos vistas: si el
// dashboard aceptara un subconjunto, filtrar por rubro movería la lista y dejaría
// los KPIs quietos.
const filtrosComunes = {
  periodo: periodoSchema.optional(),
  categoria: z.enum(['A', 'B', 'C']).optional(),
  proveedorId: z.string().uuid('proveedorId inválido').optional(),
  rubroId: z.string().uuid('rubroId inválido').optional(),
  createdBy: z.string().uuid('createdBy inválido').optional(),
  desde: z.coerce.date({ invalid_type_error: 'desde: fecha inválida' }).optional(),
  hasta: z.coerce.date({ invalid_type_error: 'hasta: fecha inválida' }).optional(),
  q: z.string().trim().min(1).max(100).optional(),
};

const rangoCoherente = (f) => !(f.desde && f.hasta) || f.desde <= f.hasta;

export const listarGastosSchema = z
  .object({
    ...filtrosComunes,
    esOrdinario: booleanoDeQuery.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .refine(rangoCoherente, {
    path: ['desde'],
    message: 'desde: no puede ser posterior a hasta',
  });

// Query del dashboard (§3.4): `?periodo=` | `?desde=&hasta=` | `?todo=1`, más los
// filtros comunes con la lista.
//
// DECISIONES:
//
// 1. Los tres modos son EXCLUYENTES y se rechaza la combinación con 422 en vez de
//    elegir uno por precedencia. `?periodo=2026-07&todo=1` no tiene una lectura
//    obvia, y un dashboard que devuelve un total distinto al que el usuario cree
//    haber pedido es peor que un error.
// 2. Sin ningún modo, el default es `todo`: es lo que hace la lista sin filtros y
//    lo que hace que un `GET` pelado del endpoint sea útil en vez de un 422. La
//    pantalla arranca en "últimos 12 meses" (§3.2), pero eso lo manda la UI.
// 3. `esOrdinario` NO es filtro del dashboard: el KPI ordinarias/extraordinarias
//    (§3.1) es justamente el corte por ese eje, y filtrarlo dejaría el otro
//    subtotal en cero mostrando un desglose que no desglosa nada.
export const dashboardGastosSchema = z
  .object({
    ...filtrosComunes,
    todo: booleanoDeQuery.optional(),
  })
  .refine(rangoCoherente, {
    path: ['desde'],
    message: 'desde: no puede ser posterior a hasta',
  })
  .refine(
    (f) => [f.periodo !== undefined, f.desde !== undefined || f.hasta !== undefined, f.todo === true]
      .filter(Boolean).length <= 1,
    {
      path: ['periodo'],
      message: 'elegir UN modo de período: periodo, desde/hasta o todo=1',
    }
  );
