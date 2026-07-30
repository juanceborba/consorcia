// src/routes/organizaciones.routes.js — Organización propia del JWT (S1-07)
// Contrato de API del sprint S1:
//   GET   /api/organizaciones/me  → { id, nombre, cuit, plan, matriculaRPA }
//   PATCH /api/organizaciones/me  → actualiza nombre/matriculaRPA (solo org_admin)
//
// S3-15 suma el consolidado de gastos de toda la organización:
//   GET /api/organizaciones/:organizacionId/gastos/dashboard  (Business+)
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
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import { requierePlan } from '../middleware/plan.middleware.js';
import { dashboardGastosSchema } from '../schemas/gasto.schema.js';
import { dashboardDeGastos } from '../services/gastos-dashboard.js';
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

// ---------------------------------------------------------------------------
// GET /:organizacionId/gastos/dashboard — consolidado de gastos (S3-15)
// Spec: PRD-04-02 §3.2 ("Todos los edificios" es Business+) y §3.4.
// ---------------------------------------------------------------------------
//
// DECISIONES
//
// 1. `:organizacionId` acepta el id de la organización ACTIVA o el alias `me`,
//    y cualquier otro id responde 403 `FUERA_DE_ORGANIZACION`. El path con id lo
//    fija el PRD, pero el tenant sale del JWT y nunca del cliente
//    (tenant.middleware): el id de la URL es una aserción del cliente que se
//    verifica, no una fuente. El alias `me` es la forma que ya usa el resto de
//    este router y la que el frontend consume.
//
// 2. EL CONSOLIDADO ES DE org_admin, NO DE gestor. Se autoriza contra el recurso
//    `gasto` con `edificio_id: null`: la regla de org_admin de `gasto.yaml` solo
//    compara la organización y matchea; la de gestor exige
//    `edificio_id in edificios_asignados` y no matchea, así que un gestor cae en
//    el `403 ACCESO_DENEGADO` de Cerbos sin tocar la policy. Es el resultado
//    correcto y no un accidente: "todos los edificios de la organización" es
//    justamente la vista que un gestor con edificios asignados no debe ver
//    (PRD-04-08 la ubica en el dashboard del administrador).
//
// 3. EL GATE DE PLAN VA DESPUÉS DE Cerbos. A quien no tiene permiso no se le
//    informa qué plan le falta comprar (ver plan.middleware.js).
//
// 4. El alcance son los edificios ACTIVOS de la organización. Un edificio dado de
//    baja (soft delete de S2-01) se comporta como inexistente en toda la API, y
//    sus gastos históricos siguen en la DB por Ley 941: si entraran al
//    consolidado, el total del dashboard no coincidiría con la suma de los tabs
//    de los edificios visibles.

const recursoConsolidado = (req) => ({
  id: req.organizacionId,
  attr: {
    id: req.organizacionId,
    organizacion_id: req.organizacionId,
    // Decisión 2: sin edificio → la regla del gestor no matchea.
    edificio_id: null,
  },
});

function validarOrganizacionDelPath(req, res, next) {
  const { organizacionId } = req.params;
  if (organizacionId === 'me' || organizacionId === req.organizacionId) return next();
  return res.status(403).json({
    error: {
      code: 'FUERA_DE_ORGANIZACION',
      message: 'La organización de la URL no es la organización activa de la sesión',
    },
  });
}

router.get(
  '/:organizacionId/gastos/dashboard',
  requireAuth,
  tenant,
  validarOrganizacionDelPath,
  autorizar('gasto', 'read', recursoConsolidado),
  requierePlan('business'),
  validarQuery(dashboardGastosSchema),
  async (req, res, next) => {
    try {
      // Decisión 4: solo los edificios activos.
      const edificios = await prisma.edificio.findMany({
        where: { organizacionId: req.organizacionId, activo: true },
        select: { id: true },
      });

      const dashboard = await dashboardDeGastos(req.filtros, {
        organizacionId: req.organizacionId,
        edificioIds: edificios.map((e) => e.id),
      });
      return res.json(dashboard);
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
