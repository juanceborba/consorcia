// frontend/src/lib/unidad-schema.js — ConsorcIA
// Schemas Zod del alta de unidades (S2-09). Espejo de
// backend/src/schemas/unidad.schema.js (PRD-04-01 §1.2 y §2.2): mismo regex
// de coeficiente (6 decimales exactos, "1.000000" solo para edificio de una
// sola UF) y mismos tipos de unidad.
import { z } from 'zod';

export const TIPOS_UNIDAD = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'local', label: 'Local' },
  { value: 'cochera', label: 'Cochera' },
  { value: 'baulera', label: 'Baulera' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'subconsorcio', label: 'Subconsorcio' },
];

// Servicios frecuentes de categoría B (Ley 941, PRD-04-01 §1.4). El backend
// acepta strings libres; el form ofrece los canónicos (el seed usa estos
// mismos valores en minúscula).
export const SERVICIOS_B = [
  { value: 'ascensor', label: 'Ascensor' },
  { value: 'calefaccion', label: 'Calefacción' },
  { value: 'agua_caliente', label: 'Agua caliente' },
];

// Regex del contrato, exportada para el feedback inline de la invariante:
// solo los coeficientes que ya matchean entran en la suma del cliente.
export const COEFICIENTE_REGEX = /^(0\.\d{6}|1\.000000)$/;

const camposBase = {
  numero: z
    .string()
    .trim()
    .min(1, 'Ingresá el número de la unidad')
    .max(20, 'Máximo 20 caracteres'),
  tipo: z.enum(TIPOS_UNIDAD.map((t) => t.value)),
  m2: z.coerce.number().positive('Ingresá los m² (mayor a 0)'),
  coeficiente: z
    .string()
    .trim()
    .regex(COEFICIENTE_REGEX, 'Coeficiente con 6 decimales (ej. 0.027742)'),
};

// Modo individual: incluye las categorías A/B/C. categoriaC se tipea como
// string y se convierte a null al enviar si quedó vacía (default del schema
// del backend).
const unidadBaseSchema = z.object({
  ...camposBase,
  categoriaA: z.boolean(),
  categoriaB: z.array(z.string()),
  categoriaC: z.string().trim(),
});

// Fila del modo bulk: solo los campos esenciales; el backend aplica los
// defaults de categorías (categoriaA=true, categoriaB=[], categoriaC=null).
const filaBulkSchema = z.object(camposBase);

const numerosEnMinuscula = (numeros) =>
  new Set(numeros.map((n) => n.trim().toLowerCase()));

// Factories: además del shape validan que el número no esté repetido (contra
// las UFs existentes del edificio y dentro del lote). El backend respondería
// 409 UNIDAD_DUPLICADA / 422 VALIDACION_FALLIDA; esto lo adelanta inline.
export function crearUnidadFormSchema(numerosExistentes = []) {
  const existentes = numerosEnMinuscula(numerosExistentes);
  return unidadBaseSchema.superRefine((data, ctx) => {
    if (data.numero && existentes.has(data.numero.toLowerCase())) {
      ctx.addIssue({
        code: 'custom',
        message: 'Ya existe una unidad con ese número en el edificio',
        path: ['numero'],
      });
    }
  });
}

export function crearBulkFormSchema(numerosExistentes = []) {
  const existentes = numerosEnMinuscula(numerosExistentes);
  return z
    .object({
      unidades: z.array(filaBulkSchema).min(1, 'Cargá al menos una unidad'),
    })
    .superRefine((data, ctx) => {
      const vistos = new Set();
      data.unidades.forEach((unidad, index) => {
        const clave = unidad.numero.trim().toLowerCase();
        if (!clave) return;
        if (vistos.has(clave)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Número repetido en el lote',
            path: ['unidades', index, 'numero'],
          });
        }
        if (existentes.has(clave)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Ya existe en el edificio',
            path: ['unidades', index, 'numero'],
          });
        }
        vistos.add(clave);
      });
    });
}
