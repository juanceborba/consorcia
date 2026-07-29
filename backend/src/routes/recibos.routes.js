// src/routes/recibos.routes.js — Descarga de recibos emitidos (S3-05)
// Spec: PRD-02-05 §4 · PRD-06-01 §3 · policy cerbos/policies/recibo.yaml
//
//   GET /api/recibos/:id/descargar → el PDF (stream, application/pdf)
//
// La lista de recibos de una liquidación vive en
// `GET /api/liquidaciones/:id/recibos` (liquidaciones.routes.js): la emisión y
// el listado son operaciones de la liquidación; acá cuelga lo que es del recibo
// individual.
//
// DECISIONES:
//
// 1. **Un recibo de otra organización responde 404**, no 403 (mismo criterio que
//    gastos y liquidaciones: un 403 confirmaría que ese id existe).
//
// 2. **El PDF se sirve por la API, nunca por una URL de storage.** La URL
//    firmada de MinIO saltearía Cerbos, y el recibo de una UF es un dato
//    personal del propietario. Consecuencia: cambiar de driver de storage no
//    cambia el contrato HTTP.
//
// 3. **Acceso del residente a SU recibo: no en este sprint.** Es el portal (S5,
//    PRD-04-05) y necesita el claim `unidades` en el JWT — un residente puro no
//    trae `org_id` y muere en el middleware `tenant` (AGENTS.md "Acceso del
//    residente"). El recurso Cerbos ya lleva `unidad_id` y la regla está escrita
//    y comentada en `cerbos/policies/recibo.yaml` para que S5 la active sin
//    rediseñar nada.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { abrirLectura } from '../services/almacenamiento.js';

const router = Router();

const noEncontrado = () => ({
  error: { code: 'RECIBO_NO_ENCONTRADO', message: 'El recibo no existe' },
});

const CAMPOS = {
  id: true,
  organizacionId: true,
  liquidacionId: true,
  unidadId: true,
  numero: true,
  periodo: true,
  storageDriver: true,
  storageKey: true,
  bytes: true,
  liquidacion: { select: { edificioId: true } },
};

// Resuelve `:id` con el aislamiento de organización y del gestor, igual que
// `validarLiquidacion` (S3-04).
async function validarRecibo(req, res, next) {
  try {
    const recibo = await prisma.recibo.findUnique({ where: { id: req.params.id }, select: CAMPOS });
    if (!recibo || recibo.organizacionId !== req.organizacionId) {
      return res.status(404).json(noEncontrado()); // decisión 1
    }

    const edificioId = recibo.liquidacion.edificioId;
    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(edificioId)) {
      return res.status(403).json({
        error: {
          code: 'EDIFICIO_NO_ASIGNADO',
          message: 'El edificio no está asignado a este gestor',
        },
      });
    }

    req.recibo = { ...recibo, edificioId };
    return next();
  } catch (err) {
    return next(err);
  }
}

// Recurso Cerbos `recibo`: scope org + edificio + la UF del comprobante.
const recursoRecibo = (req) => ({
  id: req.recibo.id,
  attr: {
    id: req.recibo.id,
    organizacion_id: req.recibo.organizacionId,
    edificio_id: req.recibo.edificioId,
    unidad_id: req.recibo.unidadId,
  },
});

// GET /:id/descargar — el PDF, en streaming
router.get(
  '/:id/descargar',
  requireAuth,
  tenant,
  validarRecibo,
  autorizar('recibo', 'read', recursoRecibo),
  async (req, res, next) => {
    try {
      const stream = await abrirLectura(req.recibo.storageKey);
      if (!stream) {
        // El registro existe pero el archivo no está (volumen recreado): 404
        // con un código propio, no un 500 — el estado del sistema es conocido.
        return res.status(404).json({
          error: {
            code: 'ARCHIVO_NO_DISPONIBLE',
            message: 'El PDF del recibo no está disponible en el almacenamiento',
          },
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', req.recibo.bytes);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="recibo-${req.recibo.numero}.pdf"`
      );

      stream.on('error', (err) => {
        if (!res.headersSent) return next(err);
        return res.destroy(err);
      });
      return stream.pipe(res);
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
