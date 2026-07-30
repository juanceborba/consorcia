// frontend/src/lib/planes.js — ConsorcIA
// Jerarquía de planes de suscripción en el frontend (S3-16), espejo de
// `backend/src/middleware/plan.middleware.js` y de PRD-07-03 §2.
//
// EL GATE REAL ES DEL BACKEND. Esto NO autoriza nada: decide si una opción se
// ofrece habilitada o deshabilitada con el motivo. La diferencia importa —
// ocultar la vista consolidada dejaría a un plan starter sin saber que existe, y
// ofrecerla sin señal sería mandarlo a un `403 PLAN_INSUFICIENTE`. El plan se lee
// de `GET /api/organizaciones/me` (la DB) y no del JWT: una suscripción cambia y
// el access token vive 15 minutos (precisión 11 de PRD-04-02 §3.4).
const ORDEN = ['starter', 'pro', 'business', 'enterprise'];

/** `true` si `plan` alcanza o supera a `minimo`. Un plan desconocido no alcanza. */
export function planAlcanza(plan, minimo) {
  const actual = ORDEN.indexOf(plan);
  const requerido = ORDEN.indexOf(minimo);
  return actual >= 0 && requerido >= 0 && actual >= requerido;
}

/**
 * El consolidado de gastos de la organización es Business+ (PRD-04-02 §3.2) y es
 * de `org_admin`: a un gestor Cerbos le responde 403 sin mirar el plan
 * (precisión 9 de §3.4), así que la opción tampoco se le ofrece.
 */
export function permiteConsolidado({ plan, roles }) {
  return (
    planAlcanza(plan, 'business') &&
    (roles ?? []).some((rol) => ['org_admin', 'superadmin'].includes(rol))
  );
}

/** El `title` de la opción deshabilitada: por qué no está disponible. */
export function motivoConsolidado({ plan, roles }) {
  const esAdmin = (roles ?? []).some((rol) =>
    ['org_admin', 'superadmin'].includes(rol),
  );
  if (!esAdmin) {
    return 'La vista consolidada es de la administración de la organización';
  }
  if (!planAlcanza(plan, 'business')) {
    return `La vista consolidada de todos los edificios está disponible desde el plan Business (tu plan es ${plan ?? 'starter'})`;
  }
  return undefined;
}
