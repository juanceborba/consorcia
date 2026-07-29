// frontend/src/lib/acceso.js — ConsorcIA
// Nivel de acceso de la sesión (S4-12, #58). PRD-04-11 §3 y §5.5.
//
// El backoffice es de staff (membresía `OrganizacionUsuario`); el residente
// accede por sus vínculos `UnidadUsuario` y por diseño NO tiene organización
// activa — su JWT viaja con `org_id: null`. De ahí las tres situaciones:
//
//   staff           → tiene organización activa: ve el backoffice como siempre
//   residente puro  → sin organización activa pero con roles de vínculo:
//                     solo lectura de sus UFs (/mis-unidades)
//   sin acceso      → ni organización ni roles: pantalla permanente (QA-03)
//
// Un staff que ADEMÁS es propietario/inquilino no es "residente puro": tiene
// organización activa, así que sigue viendo el backoffice (los roles de la
// sesión son la unión, S4-11).

import { SIN_ROLES } from '@/stores/auth.store';

export function esStaff(user) {
  return Boolean(user?.organizacionId);
}

export function esResidentePuro(user) {
  if (!user || esStaff(user)) return false;
  return (user.roles ?? SIN_ROLES).length > 0;
}

export function sinAcceso(user) {
  if (!user) return false;
  return (
    !esStaff(user) &&
    (user.organizaciones?.length ?? 0) === 0 &&
    (user.roles ?? SIN_ROLES).length === 0
  );
}

// Texto del vínculo para la UI: "Inquilino", "Propietario" o ambos.
export function etiquetaVinculo({ esPropietario, esInquilino }) {
  return [esPropietario && 'Propietario', esInquilino && 'Inquilino']
    .filter(Boolean)
    .join(' y ');
}
