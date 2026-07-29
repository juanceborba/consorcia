// src/schemas/rubro.schema.js — Validación de rubros propios (S3-13)
// Spec: PRD-04-02 §1.4.
//
// El árbol tiene 2 niveles FIJOS: `parentId` null crea un rubro nivel 1 y
// `parentId` set crea un subrubro. Que el padre exista, sea visible para la
// organización y sea nivel 1 (nada de nietos) no se valida acá sino en la ruta,
// que es la que tiene la organización del JWT.

import { z } from 'zod';

export const crearRubroSchema = z
  .object({
    nombre: z.string().trim().min(2, 'nombre: mínimo 2 caracteres').max(100),
    // null explícito o ausente = rubro nivel 1.
    parentId: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().uuid('parentId inválido').nullable().optional()
    ),
    orden: z.number().int().min(0).max(9999).default(0),
  })
  .strict();

export const editarRubroSchema = z
  .object({
    nombre: z.string().trim().min(2, 'nombre: mínimo 2 caracteres').max(100),
    orden: z.number().int().min(0).max(9999),
    // Baja/rehabilitación lógica del rubro propio. Mover un rubro de padre NO
    // se expone: cambiaría la segmentación de los gastos ya cargados.
    activo: z.boolean(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Enviar al menos un campo a modificar (nombre, orden, activo)',
  });

export const visibilidadSchema = z.object({ visible: z.boolean() }).strict();

export const listarRubrosSchema = z.object({
  // Suma los ítems del maestro que la org ocultó (con `visible: false`) y los
  // propios dados de baja: es lo que necesita la pantalla de administración
  // para volver a mostrarlos. El árbol por defecto es el usable en un gasto.
  incluirOcultos: z
    .preprocess((v) => v === true || v === '1' || v === 'true', z.boolean())
    .default(false),
});
