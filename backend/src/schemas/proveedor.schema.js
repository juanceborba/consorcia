// src/schemas/proveedor.schema.js — Validación del directorio de proveedores
// Spec: PRD-04-02 §1.3 (S3-12).
//
// El CUIT es OPCIONAL (el plomero del barrio suele no tener uno a mano), pero
// si viene tiene que respetar el formato argentino `30-12345678-9`: sobre ese
// campo se apoya el dedup por organización (índice único parcial de la
// migración S3-01), y un CUIT con formato libre convierte el dedup en ruido
// ("30123456789" y "30-12345678-9" serían dos proveedores distintos).
//
// `activo` NO se acepta en el alta (todo proveedor nuevo nace activo) pero sí
// en la edición: es la baja/rehabilitación lógica del soft delete.

import { z } from 'zod';

export const CUIT_REGEX = /^\d{2}-\d{8}-\d$/;

// `''` → null: los forms mandan strings vacíos por los campos que el usuario no
// llenó, y guardarlos como '' rompería el dedup (dos '' no chocan, dos CUIT sí)
// y ensuciaría los contactos.
const opcional = (schema) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());

const camposProveedor = {
  razonSocial: z.string().trim().min(2, 'razón social: mínimo 2 caracteres').max(200),
  cuit: opcional(z.string().trim().regex(CUIT_REGEX, 'CUIT inválido: formato 30-12345678-9')),
  email: opcional(z.string().trim().email('email inválido').max(200)),
  telefono: opcional(z.string().trim().max(50)),
  direccion: opcional(z.string().trim().max(200)),
  rubroHabitualId: opcional(z.string().uuid('rubroHabitualId inválido')),
  notas: opcional(z.string().trim().max(500)),
};

export const crearProveedorSchema = z.object(camposProveedor).strict();

export const editarProveedorSchema = z
  .object({ ...camposProveedor, activo: z.boolean() })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Enviar al menos un campo a modificar',
  });

// Query de la lista. `page`/`limit` con tope: el directorio suma los globales de
// plataforma a los propios, así que la lista completa no está acotada por la
// organización (ver el comentario de paginación en proveedores.routes.js).
export const listarProveedoresSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  // Por defecto la lista es la usable para cargar gastos (solo activos). La
  // pantalla de administración pide los dados de baja para rehabilitarlos.
  incluirInactivos: z
    .preprocess((v) => v === true || v === '1' || v === 'true', z.boolean())
    .default(false),
});
