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

// Suma actual de coeficientes del edificio (Decimales de Prisma). Recibe el
// cliente a usar: dentro de una transacción interactiva debe ser `tx`.
async function sumaActualEdificio(client, organizacionId, edificioId) {
  const unidades = await client.unidad.findMany({
    where: { organizacionId, edificioId },
    select: { coeficiente: true },
  });
  return sumarCoeficientes(unidades.map((u) => u.coeficiente));
}

// Lock de la fila del edificio dentro de una transacción interactiva:
// serializa bulk create / PATCH / DELETE concurrentes sobre las unidades del
// mismo edificio y cierra la carrera TOCTOU de la invariante (review S2 #2 /
// SEC-01). La validación de la suma y la escritura van siempre después.
function lockEdificio(tx, edificioId) {
  return tx.$queryRaw`SELECT id FROM edificios WHERE id = ${edificioId} FOR UPDATE`;
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
      const resultado = await prisma.$transaction(async (tx) => {
        await lockEdificio(tx, req.unidad.edificioId);

        if (req.body.coeficiente !== undefined) {
          // Se re-lee la UF dentro del lock: pudo cambiar entre validarUnidad
          // y la adquisición del lock por una operación concurrente.
          const actual = await tx.unidad.findUnique({
            where: { id: req.unidad.id },
            select: { coeficiente: true },
          });
          // Un DELETE concurrente pudo ganar el lock y borrarla.
          if (!actual) {
            return { noExiste: true };
          }
          const sumaActual = await sumaActualEdificio(tx, req.organizacionId, req.unidad.edificioId);
          const resultante = sumaActual.minus(actual.coeficiente).plus(req.body.coeficiente);
          if (!cuadra(resultante)) {
            return { suma: resultante };
          }
        }

        const unidad = await tx.unidad.update({
          where: { id: req.unidad.id },
          data: req.body,
        });
        return { unidad };
      });

      if (resultado.noExiste) {
        return res.status(404).json({
          error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
        });
      }
      if (!('unidad' in resultado)) {
        return res.status(422).json(errorCoeficientes(resultado.suma));
      }
      return res.json(resultado.unidad);
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
      const resultado = await prisma.$transaction(async (tx) => {
        await lockEdificio(tx, req.unidad.edificioId);

        const actual = await tx.unidad.findUnique({
          where: { id: req.unidad.id },
          select: { coeficiente: true },
        });
        // Un DELETE concurrente pudo ganar el lock y borrarla.
        if (!actual) {
          return { noExiste: true };
        }
        const sumaActual = await sumaActualEdificio(tx, req.organizacionId, req.unidad.edificioId);
        const resultante = sumaActual.minus(actual.coeficiente);
        if (!cuadra(resultante)) {
          return { suma: resultante };
        }

        await tx.unidad.delete({ where: { id: req.unidad.id } });
        return { eliminada: true };
      });

      if (resultado.noExiste) {
        return res.status(404).json({
          error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
        });
      }
      if (!('eliminada' in resultado)) {
        return res.status(422).json(errorCoeficientes(resultado.suma));
      }
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
