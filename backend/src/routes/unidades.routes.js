// src/routes/unidades.routes.js — Unidades individuales (S2-02, UX #57)
// Spec: PRD-04-01 §2. Contrato:
//   PATCH  /api/unidades/:id → actualiza campos de la UF (incl. coeficiente)
//   DELETE /api/unidades/:id → baja física de la UF
//
// Los residentes de la UF (`/:id/residentes`, S4-04) viven en
// residentes.routes.js; la resolución de la UF con su aislamiento
// (`validarUnidad`) es compartida y vive en middleware/unidad.middleware.js.
//
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: ambas
// operaciones guardan aunque la suma del edificio no cierre en 1.000000, y
// devuelven el estado de la suma resultante (`coeficientes: { suma, delta,
// cuadra }`) para que la UI muestre la alerta. El gate duro vive en la
// liquidación (S3, `validarParaLiquidacion` en services/coeficientes.js).
//
// Concurrencia: se eliminó el `SELECT ... FOR UPDATE` sobre el edificio. Su
// única razón era cerrar la carrera TOCTOU de la invariante (review S2 #2 /
// SEC-01), que ya no rechaza nada; la unicidad del número de UF sigue siendo
// segura porque la garantiza el índice único (organizacion_id, edificio_id,
// numero) de la DB, cuyo P2002 se traduce a 409 acá abajo. La suma que se
// devuelve se lee después de escribir: es informativa, no un invariante
// serializado, y puede quedar desactualizada si otra operación commitea justo
// después (la UI la refresca con el GET del listado).
//
// Aislamiento: la UF se resuelve a su edificio y se valida organización
// (del JWT) + asignación del gestor antes de cualquier escritura.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { validarUnidad } from '../middleware/unidad.middleware.js';
import { editarUnidadSchema } from '../schemas/unidad.schema.js';
import { sumarCoeficientes, estadoCoeficientes } from '../services/coeficientes.js';
import residentesRoutes from './residentes.routes.js';

const router = Router();

// Residentes de la UF (S4-04). Va antes de las rutas `/:id` para que el
// prefijo más específico gane.
router.use('/:id/residentes', residentesRoutes);

// Attrs del recurso para Cerbos (scope doble: org + edificio)
const recursoUnidad = (req) => ({
  id: req.unidad.id,
  attr: {
    id: req.unidad.id,
    organizacion_id: req.unidad.organizacionId,
    edificio_id: req.unidad.edificioId,
  },
});

// Estado informativo de la suma de coeficientes del edificio (se lee después
// de la escritura, así refleja lo que quedó persistido).
export async function estadoEdificio(organizacionId, edificioId) {
  const unidades = await prisma.unidad.findMany({
    where: { organizacionId, edificioId },
    select: { coeficiente: true },
  });
  return estadoCoeficientes(sumarCoeficientes(unidades.map((u) => u.coeficiente)));
}

// PATCH /:id — edición de la UF. Guarda siempre; informa la suma resultante.
router.patch(
  '/:id',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('unidad', 'update', recursoUnidad),
  validarBody(editarUnidadSchema),
  async (req, res, next) => {
    try {
      const unidad = await prisma.unidad.update({
        where: { id: req.unidad.id },
        data: req.body,
      });
      const coeficientes = await estadoEdificio(req.organizacionId, req.unidad.edificioId);
      return res.json({ ...unidad, coeficientes });
    } catch (err) {
      // Número de UF duplicado en el edificio (unique org+edificio+numero)
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: { code: 'UNIDAD_DUPLICADA', message: 'Ya existe una unidad con ese número en el edificio' },
        });
      }
      // Un DELETE concurrente pudo borrarla entre validarUnidad y el update.
      if (err.code === 'P2025') {
        return res.status(404).json({
          error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
        });
      }
      return next(err);
    }
  }
);

// DELETE /:id — baja física de la UF. Guarda siempre; informa la suma
// resultante (borrar una UF de un edificio cuadrado lo descuadra, y eso es
// esperado: la UI lo muestra como alerta, no como error).
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('unidad', 'delete', recursoUnidad),
  async (req, res, next) => {
    try {
      await prisma.unidad.delete({ where: { id: req.unidad.id } });
      const coeficientes = await estadoEdificio(req.organizacionId, req.unidad.edificioId);
      return res.json({ eliminada: true, coeficientes });
    } catch (err) {
      // Un DELETE concurrente ganó la carrera.
      if (err.code === 'P2025') {
        return res.status(404).json({
          error: { code: 'UNIDAD_NO_ENCONTRADA', message: 'La unidad no existe' },
        });
      }
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
