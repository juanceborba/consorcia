// backend/src/schemas/fondo-reserva.schema.js — ConsorcIA
// Contrato del alta de una regla del fondo de reserva (S3-21).
//
// La validación que importa es la CRUZADA: el porcentaje y el monto fijo son
// excluyentes y cada uno es obligatorio en su base. Sin esto entra una regla
// `MONTO_FIJO` sin monto que liquida $ 0,00 sin decir por qué, o una
// `ORDINARIAS` con monto fijo que se ignora en silencio.
import { z } from 'zod';

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const crearReglaFondoSchema = z
  .object({
    vigenciaDesde: z
      .string()
      .regex(PERIODO_REGEX, 'vigenciaDesde: formato YYYY-MM'),
    base: z.enum(['ORDINARIAS', 'TOTAL', 'MONTO_FIJO']).default('ORDINARIAS'),
    // Hasta 100% con dos decimales. Un fondo del 0% es una regla válida:
    // suspenderlo un tiempo es una decisión de asamblea como cualquier otra.
    porcentaje: z
      .number()
      .min(0, 'porcentaje: no puede ser negativo')
      .max(100, 'porcentaje: no puede superar 100')
      .optional(),
    montoFijo: z
      .number()
      .min(0, 'montoFijo: no puede ser negativo')
      .optional(),
    esquemaRepartoId: z.string().uuid('esquemaRepartoId inválido').optional(),
    motivo: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((r) => (r.base === 'MONTO_FIJO' ? r.montoFijo !== undefined : true), {
    path: ['montoFijo'],
    message: 'montoFijo: obligatorio con base MONTO_FIJO',
  })
  .refine((r) => (r.base !== 'MONTO_FIJO' ? r.porcentaje !== undefined : true), {
    path: ['porcentaje'],
    message: 'porcentaje: obligatorio con base ORDINARIAS o TOTAL',
  })
  .refine((r) => !(r.porcentaje !== undefined && r.montoFijo !== undefined), {
    path: ['montoFijo'],
    message: 'porcentaje y montoFijo son excluyentes',
  });
