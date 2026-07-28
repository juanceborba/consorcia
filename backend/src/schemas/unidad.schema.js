// src/schemas/unidad.schema.js — Schemas Zod de unidades (S2-02)
// Spec: PRD-04-01 §2 (crearEdificioSchema.unidades) y §1.2 (tipos).
// El coeficiente es string con 6 decimales exactos ("0.027742"); se admite
// "1.000000" para el caso borde de edificio de una sola UF.

import { z } from 'zod';

export const TIPOS_UNIDAD = [
  'departamento',
  'local',
  'cochera',
  'baulera',
  'oficina',
  'subconsorcio',
];

export const unidadSchema = z.object({
  numero: z.string().trim().min(1).max(20),
  tipo: z.enum(TIPOS_UNIDAD),
  m2: z.number().positive(),
  coeficiente: z.string().regex(/^(0\.\d{6}|1\.000000)$/, 'Coeficiente con 6 decimales (ej. 0.027742)'),
  categoriaA: z.boolean().default(true),
  categoriaB: z.array(z.string()).default([]),
  categoriaC: z.string().nullable().default(null),
});

// PATCH: todos los campos opcionales, pero al menos uno.
export const editarUnidadSchema = unidadSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Enviar al menos un campo a modificar' });

// Bulk create: body = array de unidades (al menos una).
export const bulkUnidadesSchema = z.array(unidadSchema).min(1);
