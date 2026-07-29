// src/routes/organizaciones.routes.js — Organización propia del JWT (S1-07)
// Contrato de API del sprint S1:
//   GET   /api/organizaciones/me  → { id, nombre, cuit, plan, matriculaRPA }
//   PATCH /api/organizaciones/me  → actualiza nombre/matriculaRPA (solo org_admin)
//
// El staff de la organización (`/me/usuarios`, S4-03) vive en staff.routes.js.
//
// La organización se resuelve SIEMPRE desde el JWT (tenant.middleware); el
// permiso read/update lo decide Cerbos (PRD-05-04 §3.2: org_admin full,
// gestor solo lectura).

import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import staffRoutes from './staff.routes.js';

const router = Router();

// Staff de la organización (S4-03). Va antes de las rutas `/me` para que el
// prefijo más específico gane.
router.use('/me/usuarios', staffRoutes);

// Recurso Cerbos: la organización del propio usuario
const organizacionPropia = (req) => ({
  id: req.organizacionId,
  attr: { id: req.organizacionId, organizacion_id: req.organizacionId },
});

const camposPublicos = {
  id: true,
  nombre: true,
  cuit: true,
  plan: true,
  matriculaRPA: true,
};

const patchSchema = z
  .object({
    nombre: z.string().min(1, 'el nombre no puede ser vacío').optional(),
    matriculaRPA: z.string().min(1, 'la matrícula RPA no puede ser vacía').optional(),
  })
  .refine((data) => data.nombre !== undefined || data.matriculaRPA !== undefined, {
    message: 'indicar al menos un campo a actualizar (nombre, matriculaRPA)',
  });

router.get(
  '/me',
  requireAuth,
  tenant,
  autorizar('organizacion', 'read', organizacionPropia),
  async (req, res, next) => {
    try {
      const org = await prisma.organizacion.findUnique({
        where: { id: req.organizacionId },
        select: camposPublicos,
      });
      if (!org) {
        return res.status(404).json({
          error: { code: 'ORGANIZACION_NO_ENCONTRADA', message: 'La organización no existe' },
        });
      }
      return res.json(org);
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  '/me',
  requireAuth,
  tenant,
  autorizar('organizacion', 'update', organizacionPropia),
  validarBody(patchSchema),
  async (req, res, next) => {
    try {
      const org = await prisma.organizacion.update({
        where: { id: req.organizacionId },
        data: req.body,
        select: camposPublicos,
      });
      return res.json(org);
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
