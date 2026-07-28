// frontend/src/lib/edificio-schema.js — ConsorcIA
// Schema Zod del formulario de edificio (alta S2-06 y edición S2-10).
// Espeja crearEdificioSchema de backend/src/routes/edificios.routes.js
// (misma regex de CP: numérico "1425" o CPA argentino "C1425BGW").
import { z } from 'zod';

export const edificioFormSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(3, 'Mínimo 3 caracteres')
    .max(100, 'Máximo 100 caracteres'),
  direccion: z
    .string()
    .trim()
    .min(5, 'Mínimo 5 caracteres')
    .max(200, 'Máximo 200 caracteres'),
  codigoPostal: z
    .string()
    .trim()
    .regex(/^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/, 'CP inválido (4 dígitos o CPA, ej. C1425BGW)'),
  ciudad: z.string().trim().min(2, 'Mínimo 2 caracteres').max(100),
  provincia: z.string().trim().min(2, 'Mínimo 2 caracteres').max(100),
  tipo: z.enum(['ph', 'barrio_privado', 'centro_comercial', 'otro']),
  totalM2: z.coerce.number().positive('Ingresá los m² totales (mayor a 0)'),
  fechaInicioAdmin: z.string().optional(),
});
