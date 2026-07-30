// src/schemas/esquema-reparto.schema.js — Validación de esquemas de reparto (S3-20)
// Spec: PRD-02-05 Motor Contable · CCyC art. 2049, último párrafo
// Diseño: docs/investigacion/esquemas-de-reparto.md
//
// Lo que Zod puede validar acá es la FORMA (enums cerrados, coherencia entre
// alcance y alcanceValor, pesos numéricos no negativos). Lo que depende de la DB
// —que las UF sean del edificio, que el nombre no esté repetido— se valida en la
// ruta, como en `gasto.schema.js`.

import { z } from 'zod';
import Decimal from 'decimal.js';
import { BASES_VALIDAS, ALCANCES_VALIDOS } from '../core/liquidacion.engine.js';

// Decimal(12,6) en la DB. El techo real no es una regla del dominio: un peso es
// un factor o un coeficiente propio, así que cualquier cosa por encima de 4
// dígitos enteros es un error de tipeo, no un reparto.
export const PESO_MAX = new Decimal('9999.999999');

const opcional = (schema) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    schema.nullable().optional()
  );

// El peso viaja como string a la DB: cero floats en el borde de entrada, igual
// que el monto del gasto.
const pesoSchema = z
  .union([z.number(), z.string().trim().min(1)], {
    errorMap: () => ({ message: 'peso: debe ser un número o un string numérico' }),
  })
  .transform((valor, ctx) => {
    let peso;
    try {
      peso = new Decimal(valor);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'peso inválido' });
      return z.NEVER;
    }
    if (!peso.isFinite()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'peso inválido' });
      return z.NEVER;
    }
    // 0 es válido y significativo: es la exención total de esa UF.
    if (peso.lt(0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'peso: no puede ser negativo (un peso negativo le devolvería plata a una UF)',
      });
      return z.NEVER;
    }
    if (peso.decimalPlaces() > 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'peso: máximo 6 decimales' });
      return z.NEVER;
    }
    if (peso.gt(PESO_MAX)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `peso: máximo ${PESO_MAX.toString()}`,
      });
      return z.NEVER;
    }
    return peso.toFixed(6);
  });

// La tabla de pesos. Solo las UF que se apartan del default de la base: un
// esquema "todas por coeficiente menos PB al 50%" es UNA fila.
const pesosSchema = z
  .array(
    z
      .object({
        unidadId: z.string().uuid('unidadId: UUID requerido'),
        peso: pesoSchema,
      })
      .strict()
  )
  .max(1000, 'pesos: máximo 1000 unidades por esquema')
  .refine((filas) => new Set(filas.map((f) => f.unidadId)).size === filas.length, {
    message: 'pesos: hay una unidad repetida',
  });

const camposEsquema = {
  nombre: z.string().trim().min(3, 'nombre: mínimo 3 caracteres').max(100),
  base: z.enum(BASES_VALIDAS, {
    errorMap: () => ({ message: `base: ${BASES_VALIDAS.join(', ')}` }),
  }),
  alcance: z.enum(ALCANCES_VALIDOS, {
    errorMap: () => ({ message: `alcance: ${ALCANCES_VALIDOS.join(', ')}` }),
  }),
  alcanceValor: opcional(z.string().trim().max(100)),
  // La cláusula del reglamento que habilita este reparto (CCyC art. 2049): es
  // opcional porque un esquema puede estar en preparación, pero es el dato que
  // se pide cuando un propietario impugna.
  clausulaReglamento: opcional(z.string().trim().max(200)),
  documentoUrl: opcional(z.string().trim().url('documentoUrl: URL inválida').max(500)),
  activo: z.boolean().default(true),
  pesos: pesosSchema.default([]),
};

/**
 * El alcance por servicio o por sector necesita contra qué matchear; los otros
 * dos no admiten valor. Mismo criterio (y mismo CHECK) que en la migración: un
 * TODAS con `alcanceValor` seteado sería un filtro que el motor ignora en
 * silencio.
 */
export function incoherenciaAlcance({ alcance, alcanceValor }) {
  const necesitaValor = alcance === 'SERVICIO' || alcance === 'SECTOR';
  if (necesitaValor && !alcanceValor) {
    return alcance === 'SERVICIO'
      ? 'alcanceValor: obligatorio con alcance SERVICIO (el servicio que se reparte, ej. "ascensor")'
      : 'alcanceValor: obligatorio con alcance SECTOR (el sector que se reparte, ej. "torre_a")';
  }
  if (!necesitaValor && alcanceValor) {
    return `alcanceValor: el alcance ${alcance} no lleva valor (alcanza a todas las UF o a las de la tabla de pesos)`;
  }
  return null;
}

/**
 * Dos combinaciones dependen de la tabla de pesos para existir: sin filas, el
 * reparto sería 0 para todas las UF y la liquidación entera fallaría con
 * DESBALANCE_LIQUIDACION. Se rechaza acá, donde el mensaje puede explicar qué
 * falta, y no en el motor.
 */
export function incoherenciaPesos({ base, alcance, pesos }) {
  const conPeso = (pesos ?? []).filter((p) => new Decimal(p.peso).gt(0));

  if (alcance === 'SELECCION' && conPeso.length === 0) {
    return 'pesos: el alcance SELECCION reparte solo entre las UF de la tabla, así que necesita al menos una con peso mayor a 0';
  }
  if (base === 'PESOS_PROPIOS' && conPeso.length === 0) {
    return 'pesos: la base PESOS_PROPIOS toma el peso de la tabla (una UF sin fila no participa), así que necesita al menos una con peso mayor a 0';
  }
  return null;
}

export const crearEsquemaSchema = z.object(camposEsquema).strict();

export const editarEsquemaSchema = z
  .object(camposEsquema)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Enviar al menos un campo a modificar',
  });

// El setup del edificio. `esquemaGeneralId: null` lo desconfigura y devuelve el
// default (coeficiente sobre todas las UF). S3-21 agrega acá el fondo de reserva.
export const configuracionLiquidacionSchema = z
  .object({
    esquemaGeneralId: opcional(z.string().uuid('esquemaGeneralId: UUID requerido')),
  })
  .strict();
