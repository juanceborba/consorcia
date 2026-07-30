// frontend/src/lib/proveedor-schema.js — ConsorcIA
// Espejo del schema Zod del backend (`backend/src/schemas/proveedor.schema.js`,
// S3-12) para validar en el cliente antes de mandar. Las reglas tienen que
// coincidir: si divergen, el usuario ve un 422 genérico en un toast en vez del
// error inline en el campo que lo causó.
//
// Los campos opcionales se declaran como `''` → se limpian antes del submit
// (`limpiarOpcionales`): el backend convierte `''` a null, pero mandar `''` en
// `cuit` desactivaría el dedup y en `rubroHabitualId` fallaría el `uuid()`. RHF
// siempre entrega strings, nunca undefined, así que la limpieza es del cliente.

import { z } from 'zod';

// Mismo regex que el backend: el dedup por CUIT se apoya en el formato canónico
// (`30123456789` y `30-12345678-9` serían dos proveedores distintos).
export const CUIT_REGEX = /^\d{2}-\d{8}-\d$/;

// Opcional en el form = string vacío permitido; con contenido, valida.
const opcional = (schema) => z.union([z.literal(''), schema]);

export const proveedorSchema = z.object({
  razonSocial: z
    .string()
    .trim()
    .min(2, 'La razón social necesita al menos 2 caracteres')
    .max(200, 'Máximo 200 caracteres'),
  cuit: opcional(
    z.string().trim().regex(CUIT_REGEX, 'CUIT inválido: usá el formato 30-12345678-9'),
  ),
  email: opcional(z.email('Ingresá un email válido').max(200)),
  telefono: opcional(z.string().trim().max(50, 'Máximo 50 caracteres')),
  direccion: opcional(z.string().trim().max(200, 'Máximo 200 caracteres')),
  rubroHabitualId: z.string(),
  notas: opcional(z.string().trim().max(500, 'Máximo 500 caracteres')),
});

export const PROVEEDOR_VACIO = {
  razonSocial: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  rubroHabitualId: '',
  notas: '',
};

// Valores del form → body de la API: `''` se convierte en null (el backend lo
// acepta y lo guarda como ausencia de dato).
export function aPayload(valores) {
  const payload = {};
  for (const [campo, valor] of Object.entries(valores)) {
    payload[campo] = typeof valor === 'string' && valor.trim() === '' ? null : valor;
  }
  return payload;
}

// Proveedor de la API → valores del form (null → '' para inputs controlados).
export function aFormulario(proveedor) {
  const valores = { ...PROVEEDOR_VACIO };
  for (const campo of Object.keys(PROVEEDOR_VACIO)) {
    valores[campo] = proveedor[campo] ?? '';
  }
  return valores;
}
