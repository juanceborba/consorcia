// src/middleware/tenant.middleware.js — Aislamiento multi-tenant
// Spec: PRD-02-01 Arquitectura General §6.2
//
// La organización es el tenant raíz: se resuelve SIEMPRE desde el JWT
// (nunca del cliente) y se inyecta en `req.organizacionId`. Cuando el
// request referencia un edificio (`:id` en params o `edificioId` en
// body/query) se valida que pertenezca a esa organización y, si el usuario
// es gestor, que esté dentro de sus edificios asignados.
//
// Defensa en profundidad: este middleware NO reemplaza el scope
// `{ organizacionId, ... }` en las queries Prisma ni la decisión de Cerbos.

import prisma from '../db/prisma.js';

// Extrae org_id del JWT (ya validado por requireAuth) → req.organizacionId
export function tenant(req, res, next) {
  req.organizacionId = req.user.organizacionId;
  next();
}

// Valida el edificio referenciado por el request:
//   404 si el edificio no existe
//   403 si pertenece a otra organización
//   403 si el usuario es gestor y no lo tiene asignado
// Si no hay edificio referenciado, deja pasar (rutas de lista).
export async function validarEdificio(req, res, next) {
  const edificioId = req.params.id ?? req.body?.edificioId ?? req.query?.edificioId;
  if (!edificioId) return next();

  try {
    const edificio = await prisma.edificio.findUnique({ where: { id: edificioId } });
    if (!edificio) {
      return res.status(404).json({
        error: { code: 'EDIFICIO_NO_ENCONTRADO', message: 'El edificio no existe' },
      });
    }

    if (edificio.organizacionId !== req.organizacionId) {
      return res.status(403).json({
        error: { code: 'FUERA_DE_ORGANIZACION', message: 'El edificio no pertenece a tu organización' },
      });
    }

    // Soft delete (S2-01): un edificio dado de baja se comporta como inexistente
    if (edificio.activo === false) {
      return res.status(404).json({
        error: { code: 'EDIFICIO_NO_ENCONTRADO', message: 'El edificio no existe' },
      });
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(edificio.id)) {
      return res.status(403).json({
        error: { code: 'EDIFICIO_NO_ASIGNADO', message: 'El edificio no está asignado a este gestor' },
      });
    }

    // Disponible para rbac.middleware (attrs del recurso) y para el handler
    req.edificio = edificio;
    return next();
  } catch (err) {
    return next(err);
  }
}
