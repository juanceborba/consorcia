// src/schemas/liquidacion.schema.js — Validación de liquidaciones (S3-04)
// Spec: PRD-04-03 §1 (estados) y §3 (contrato de la API).
//
// El body del cálculo es mínimo por diseño: el período y nada más. Todo lo
// demás (edificio, organización, gastos, unidades, coeficientes, matrícula RPA)
// lo resuelve el backend — una liquidación es el acto oficial del administrador
// (Ley 941), no un documento que el cliente arma. El PRD la modela con
// `POST /api/liquidaciones/calcular { edificioId, periodo }`; acá el edificio
// viaja en la URL (`POST /api/edificios/:id/liquidaciones`) igual que los
// gastos de S3-02, para que `validarEdificio` aplique el aislamiento antes de
// que el handler exista.

import { z } from 'zod';
import { PERIODO_REGEX } from './gasto.schema.js';

// Mismo período que los gastos: "YYYY-MM" con mes real (el regex solo no
// alcanza — "2026-13" matchea).
const periodoSchema = z
  .string()
  .trim()
  .regex(PERIODO_REGEX, 'periodo: formato YYYY-MM')
  .refine((p) => {
    const mes = Number(p.slice(5, 7));
    return mes >= 1 && mes <= 12;
  }, 'periodo: el mes debe estar entre 01 y 12');

export const ESTADOS = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'ENVIADA',
  'COBRADA',
  'ANULADA',
];

export const calcularLiquidacionSchema = z.object({ periodo: periodoSchema }).strict();

export const listarLiquidacionesSchema = z.object({
  periodo: periodoSchema.optional(),
  estado: z.enum(ESTADOS).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
