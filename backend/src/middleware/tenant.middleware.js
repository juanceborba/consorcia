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

// Resuelve la organización activa del request → req.organizacionId.
//
// S4-01 (identidad global): la org sale del claim `org_id` (nunca del cliente),
// pero se REVALIDA contra la membresía en DB en cada request. El access token
// vive 15 min: sin esta verificación, desactivar una membresía no cortaría el
// acceso hasta que expire. Fail-closed:
//   403 SIN_ORGANIZACION_ACTIVA si el token no trae org (residente puro)
//   403 SIN_MEMBRESIA si la membresía ya no existe o fue desactivada
export async function tenant(req, res, next) {
  const organizacionId = req.user.organizacionId;
  if (!organizacionId) {
    return res.status(403).json({
      error: {
        code: 'SIN_ORGANIZACION_ACTIVA',
        message: 'La sesión no tiene una organización activa',
      },
    });
  }

  try {
    const membresia = await prisma.organizacionUsuario.findUnique({
      where: { organizacionId_usuarioId: { organizacionId, usuarioId: req.user.id } },
      select: { activo: true },
    });

    if (!membresia || membresia.activo === false) {
      return res.status(403).json({
        error: {
          code: 'SIN_MEMBRESIA',
          message: 'No tenés una membresía activa en esa organización',
        },
      });
    }

    req.organizacionId = organizacionId;
    return next();
  } catch (err) {
    return next(err);
  }
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
