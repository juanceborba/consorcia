// frontend/src/lib/residente-schema.js — ConsorcIA
// Schema Zod del form "Vincular persona" (S4-08). Espejo de
// vincularResidenteSchema en backend/src/routes/residentes.routes.js
// (PRD-04-11 §5.2): al menos uno de propietario/inquilino, fechaInicio con
// default hoy.
import { z } from 'zod';

// "Hoy" en formato YYYY-MM-DD para el default del input type=date. Fecha de
// calendario (titularidad), no instante: el backend la trunca a medianoche UTC.
export function hoyISO() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export const vincularResidenteSchema = z
  .object({
    email: z.email('Ingresá un email válido'),
    nombre: z.string().trim().min(1, 'Ingresá el nombre'),
    apellido: z.string().trim().min(1, 'Ingresá el apellido'),
    esPropietario: z.boolean(),
    esInquilino: z.boolean(),
    fechaInicio: z.string().min(1, 'Ingresá la fecha de inicio'),
  })
  .refine((d) => d.esPropietario || d.esInquilino, {
    path: ['esPropietario'],
    message: 'Marcá al menos propietario o inquilino',
  });
