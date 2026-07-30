// src/middleware/plan.middleware.js — Gate por plan de suscripción (S3-15)
// Spec: PRD-01-03 Modelo de Negocio · PRD-07-03 §(rutas con `planRequired`) ·
//       PRD-04-02 §3.2/§3.4 (el consolidado de gastos es Business+).
//
// Autorización ≠ plan. Cerbos responde "¿este rol puede hacer esto con este
// recurso?"; el plan responde "¿esta organización compró esta capacidad?". Son
// dos preguntas distintas con dos códigos distintos (`ACCESO_DENEGADO` vs
// `PLAN_INSUFICIENTE`) porque la acción del usuario también es distinta: pedirle
// el permiso a su org_admin, o contratar un plan superior.
//
// Este middleware va DESPUÉS de `autorizar(...)`: a quien no tiene permiso no se
// le cuenta qué le falta comprar.
//
// La jerarquía es la de PRD-07-03 (`planHierarchy`) y se lee de la DB, no del
// JWT: el plan cambia con una suscripción y el access token vive 15 minutos.

import prisma from '../db/prisma.js';

export const JERARQUIA_DE_PLANES = ['starter', 'pro', 'business', 'enterprise'];

const nivelDe = (plan) => JERARQUIA_DE_PLANES.indexOf(plan);

/**
 * Exige que la organización activa tenga `minimo` o superior.
 * 403 `PLAN_INSUFICIENTE` si no llega. Un plan desconocido en la columna cuenta
 * como el más bajo: fail-closed, igual que Cerbos.
 */
export function requierePlan(minimo) {
  const requerido = nivelDe(minimo);

  return async (req, res, next) => {
    try {
      const org = await prisma.organizacion.findUnique({
        where: { id: req.organizacionId },
        select: { plan: true },
      });

      if (org && nivelDe(org.plan) >= requerido) return next();

      return res.status(403).json({
        error: {
          code: 'PLAN_INSUFICIENTE',
          message: `Esta función requiere el plan ${minimo} o superior`,
          planActual: org?.plan ?? null,
          planRequerido: minimo,
        },
      });
    } catch (err) {
      return next(err);
    }
  };
}
