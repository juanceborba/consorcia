// frontend/src/lib/staff-schema.js — ConsorcIA
// Schemas Zod del backoffice de staff (S4-07). Espejo de los schemas de
// backend/src/routes/staff.routes.js (PRD-04-11 §4): mismos roles, misma
// regla "solo un GESTOR tiene edificios asignados" y mismo email normalizado
// a lowercase (identidad global, §7).
import { z } from 'zod';

// Roles staff del contrato (enum en MAYÚSCULAS en la API; los roles del JWT
// van en minúscula — ver rolCanonico en el backend).
export const ROLES_STAFF = [
  { value: 'ORG_ADMIN', label: 'Administrador de la organización' },
  { value: 'GESTOR', label: 'Gestor' },
];

export const ROL_LABEL = {
  ORG_ADMIN: 'Administrador',
  GESTOR: 'Gestor',
};

const rolSchema = z.enum(ROLES_STAFF.map((r) => r.value));

// El multi-select de edificios solo aplica a GESTOR. Un gestor SIN edificios
// es válido (§9: ve la org en solo lectura), así que no se exige al menos uno
// — la tabla lo señala para que el admin le asigne.
const soloGestorTieneEdificios = [
  (d) => d.rol === 'GESTOR' || d.edificioIds.length === 0,
  { path: ['edificioIds'], message: 'Solo un gestor tiene edificios asignados' },
];

const permisosBase = {
  rol: rolSchema,
  edificioIds: z.array(z.string()),
};

// Alta (POST /api/organizaciones/me/usuarios).
export const invitarStaffSchema = z
  .object({
    email: z.email('Ingresá un email válido'),
    nombre: z.string().trim().min(1, 'Ingresá el nombre'),
    apellido: z.string().trim().min(1, 'Ingresá el apellido'),
    ...permisosBase,
  })
  .refine(...soloGestorTieneEdificios);

// Edición (PATCH /:usuarioId): rol + edificios del gestor. El PATCH REEMPLAZA
// el set de edificios (no acumula) y promover a ORG_ADMIN los limpia — el form
// refleja eso deshabilitando el multi-select.
export const editarStaffSchema = z
  .object(permisosBase)
  .refine(...soloGestorTieneEdificios);
