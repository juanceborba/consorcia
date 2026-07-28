// src/routes/edificios.routes.js — Edificios de la organización (S1-08)
// Spec: PRD-04-01 Gestión de Edificios §3. Contrato de API del sprint S1:
//   GET /api/edificios     → [ { id, nombre, direccion, ciudad, _count: { unidades } } ]
//   GET /api/edificios/:id → edificio completo + unidades
//
// Aislamiento (PRD-02-01 §6.2): TODAS las queries scopean por
// `organizacionId` (del JWT) + `edificioId`. El gestor además queda
// restringido a sus edificios asignados, tanto en el filtro de la query como
// en tenant.validarEdificio y en la decisión de Cerbos.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';

const router = Router();

// GET / — lista de la org; el gestor solo ve sus edificios asignados.
// Roles de edificio (propietario, inquilino, etc.) no tienen vista de staff:
// su acceso es por el portal del residente (PRD-04-05, fases posteriores).
router.get('/', requireAuth, tenant, async (req, res, next) => {
  try {
    const esGestor = req.user.roles.includes('gestor');
    const esStaff = req.user.roles.some((r) => ['org_admin', 'superadmin'].includes(r));
    if (!esStaff && !esGestor) return res.json([]);

    const edificios = await prisma.edificio.findMany({
      where: {
        organizacionId: req.organizacionId,
        ...(esGestor ? { id: { in: req.user.edificiosAsignados } } : {}),
      },
      select: {
        id: true,
        nombre: true,
        direccion: true,
        ciudad: true,
        _count: { select: { unidades: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    return res.json(edificios);
  } catch (err) {
    return next(err);
  }
});

// GET /:id — detalle con unidades. validarEdificio responde 404/403 según
// corresponda y deja el edificio en req.edificio; Cerbos decide el 'read'.
router.get(
  '/:id',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('edificio', 'read', (req) => ({
    id: req.edificio.id,
    attr: { id: req.edificio.id, organizacion_id: req.edificio.organizacionId },
  })),
  async (req, res, next) => {
    try {
      const unidades = await prisma.unidad.findMany({
        where: { organizacionId: req.organizacionId, edificioId: req.edificio.id },
        select: {
          id: true,
          numero: true,
          tipo: true,
          m2: true,
          coeficiente: true,
          categoriaA: true,
          categoriaB: true,
          categoriaC: true,
        },
        orderBy: { numero: 'asc' },
      });
      return res.json({ ...req.edificio, unidades });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
