// src/middleware/unidad.middleware.js — Resolución y aislamiento de una UF
// Spec: PRD-02-01 §6.2 (scope org + edificio), PRD-04-01 §2.
//
// Extraído de unidades.routes.js (S2-02) al agregar las rutas anidadas de
// residentes (S4-04): las dos las necesitan y así no se importan entre sí.

import prisma from '../db/prisma.js';

// Resuelve la UF de req.params.id y su edificio, validando el tenant:
//   404 si la UF no existe (o su edificio está dado de baja)
//   403 si pertenece a otra organización
//   403 si el usuario es gestor y el edificio no está asignado
// Deja req.unidad y req.edificio para el check de Cerbos y el handler.
export async function validarUnidad(req, res, next) {
  try {
    const unidad = await prisma.unidad.findUnique({ where: { id: req.params.id } });
    if (!unidad) {
      return res.status(404).json({
        error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
      });
    }

    if (unidad.organizacionId !== req.organizacionId) {
      return res.status(403).json({
        error: { code: 'FUERA_DE_ORGANIZACION', message: 'La unidad no pertenece a tu organización' },
      });
    }

    const edificio = await prisma.edificio.findUnique({ where: { id: unidad.edificioId } });
    if (!edificio || edificio.activo === false) {
      return res.status(404).json({
        error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
      });
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(edificio.id)) {
      return res.status(403).json({
        error: { code: 'EDIFICIO_NO_ASIGNADO', message: 'El edificio no está asignado a este gestor' },
      });
    }

    req.unidad = unidad;
    req.edificio = edificio;
    return next();
  } catch (err) {
    return next(err);
  }
}
