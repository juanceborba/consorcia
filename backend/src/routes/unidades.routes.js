// src/routes/unidades.routes.js — Unidades individuales (S2-02)
// Spec: PRD-04-01 §2. Contrato:
//   PATCH  /api/unidades/:id → actualiza campos de la UF (incl. coeficiente)
//   DELETE /api/unidades/:id → baja física de la UF
//
// Invariante (PRD-04-01 §1.3): ambas operaciones validan con decimal.js que
// la suma de coeficientes del edificio siga siendo 1.000000 tras el cambio;
// si descuadra → 422 COEFICIENTES_NO_CUADRAN (suma actual + delta).
// Consecuencia deliberada: en un edificio ya cuadrado no se puede cambiar un
// coeficiente ni eliminar una UF de a una — la redistribución atómica de
// coeficientes es una operación futura (consistente con la regla del PRD de
// no tocar unidades una vez cerrada la configuración).
//
// Aislamiento: la UF se resuelve a su edificio y se valida organización
// (del JWT) + asignación del gestor antes de cualquier escritura.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { editarUnidadSchema } from '../schemas/unidad.schema.js';
import { sumarCoeficientes, cuadra, errorCoeficientes } from '../services/coeficientes.js';

const router = Router();

// Resuelve la UF de req.params.id y su edificio, validando el tenant:
//   404 si la UF no existe (o su edificio está dado de baja)
//   403 si pertenece a otra organización
//   403 si el usuario es gestor y el edificio no está asignado
// Deja req.unidad y req.edificio para el check de Cerbos y el handler.
async function validarUnidad(req, res, next) {
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

// Attrs del recurso para Cerbos (scope doble: org + edificio)
const recursoUnidad = (req) => ({
  id: req.unidad.id,
  attr: {
    id: req.unidad.id,
    organizacion_id: req.unidad.organizacionId,
    edificio_id: req.unidad.edificioId,
  },
});

// Suma actual de coeficientes del edificio (Decimales de Prisma)
async function sumaActualEdificio(organizacionId, edificioId) {
  const unidades = await prisma.unidad.findMany({
    where: { organizacionId, edificioId },
    select: { coeficiente: true },
  });
  return sumarCoeficientes(unidades.map((u) => u.coeficiente));
}

// PATCH /:id — edición de la UF. Si cambia el coeficiente, la suma resultante
// del edificio debe seguir cerrando en 1.000000.
router.patch(
  '/:id',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('unidad', 'update', recursoUnidad),
  validarBody(editarUnidadSchema),
  async (req, res, next) => {
    try {
      if (req.body.coeficiente !== undefined) {
        const sumaActual = await sumaActualEdificio(req.organizacionId, req.unidad.edificioId);
        const resultante = sumaActual.minus(req.unidad.coeficiente).plus(req.body.coeficiente);
        if (!cuadra(resultante)) {
          return res.status(422).json(errorCoeficientes(resultante));
        }
      }

      const unidad = await prisma.unidad.update({
        where: { id: req.unidad.id },
        data: req.body,
      });
      return res.json(unidad);
    } catch (err) {
      // Número de UF duplicado en el edificio (unique org+edificio+numero)
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: { code: 'UNIDAD_DUPLICADA', message: 'Ya existe una unidad con ese número en el edificio' },
        });
      }
      return next(err);
    }
  }
);

// DELETE /:id — baja física de la UF. La suma resultante del edificio debe
// seguir cerrando en 1.000000 (en la práctica: solo es posible si el edificio
// aún no está cuadrado; si lo está, hay que redistribuir coeficientes antes).
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('unidad', 'delete', recursoUnidad),
  async (req, res, next) => {
    try {
      const sumaActual = await sumaActualEdificio(req.organizacionId, req.unidad.edificioId);
      const resultante = sumaActual.minus(req.unidad.coeficiente);
      if (!cuadra(resultante)) {
        return res.status(422).json(errorCoeficientes(resultante));
      }

      await prisma.unidad.delete({ where: { id: req.unidad.id } });
      return res.status(204).send();
    } catch (err) {
      // La UF tiene vínculos (UnidadUsuario, cobros, liquidaciones)
      if (err.code === 'P2003' || err.code === 'P2014') {
        return res.status(409).json({
          error: { code: 'UNIDAD_EN_USO', message: 'La unidad tiene vínculos activos y no se puede eliminar' },
        });
      }
      return next(err);
    }
  }
);

export default router;
