// src/routes/edificios.routes.js — Edificios de la organización (S1-08, S2-01, S2-02)
// Spec: PRD-04-01 Gestión de Edificios §3. Contrato de API:
//   GET    /api/edificios             → [ { id, nombre, direccion, ciudad, _count: { unidades } } ] (activos)
//   GET    /api/edificios/:id         → edificio completo + unidades
//   POST   /api/edificios             → crea edificio (org_admin) — S2-01
//   PATCH  /api/edificios/:id         → actualiza datos (org_admin / gestor asignado) — S2-01
//   DELETE /api/edificios/:id         → soft delete (activo=false, org_admin) — S2-01
//   GET    /api/edificios/:id/unidades → unidades paginadas (?page=&limit=) + estado de coeficientes — S2-02
//   POST   /api/edificios/:id/unidades → alta bulk (la invariante es informativa, #57) — S2-02
//
// Aislamiento (PRD-02-01 §6.2): TODAS las queries scopean por
// `organizacionId` (del JWT) + `edificioId`. El gestor además queda
// restringido a sus edificios asignados, tanto en el filtro de la query como
// en tenant.validarEdificio y en la decisión de Cerbos.

import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { bulkUnidadesSchema } from '../schemas/unidad.schema.js';
import { sumarCoeficientes, estadoCoeficientes } from '../services/coeficientes.js';
import { gastosDeEdificioRouter } from './gastos.routes.js';
import { liquidacionesDeEdificioRouter } from './liquidaciones.routes.js';
import {
  esquemasDeEdificioRouter,
  configuracionLiquidacionRouter,
} from './esquemas-reparto.routes.js';

const router = Router();

// Gastos del edificio (S3-02). Va antes de las rutas `/:id` para que el prefijo
// más específico gane; el router hereda `:id` con `mergeParams`.
router.use('/:id/gastos', gastosDeEdificioRouter);

// Liquidaciones del edificio (S3-04): calcular el período y listarlas. Las
// operaciones sobre una liquidación ya identificada viven en /api/liquidaciones.
router.use('/:id/liquidaciones', liquidacionesDeEdificioRouter);

// Esquemas de reparto y setup de liquidación del edificio (S3-20). Van acá y no
// bajo /api/esquemas-reparto porque el reparto es del EDIFICIO: su fuente de
// autoridad es el reglamento de copropiedad de ese consorcio.
router.use('/:id/esquemas-reparto', esquemasDeEdificioRouter);
router.use('/:id/configuracion-liquidacion', configuracionLiquidacionRouter);

// Estado informativo de la suma de coeficientes del edificio (#57): siempre
// sobre el set COMPLETO de unidades, nunca sobre la página pedida — la UI usa
// este dato para la fila TOTAL y la alerta "faltan/sobran X".
async function estadoCoeficientesEdificio(client, organizacionId, edificioId) {
  const unidades = await client.unidad.findMany({
    where: { organizacionId, edificioId },
    select: { coeficiente: true },
  });
  return estadoCoeficientes(sumarCoeficientes(unidades.map((u) => u.coeficiente)));
}

// ─── Schemas Zod (S2-01, PRD-04-01 §2) ───────────────────────────────────
// codigoPostal acepta CP numérico ("1425") o CPA argentino ("C1425BGW"):
// el seed y los datos reales usan CPA, el PRD pedía solo 4 dígitos.
export const TIPOS_EDIFICIO = ['ph', 'barrio_privado', 'centro_comercial', 'otro'];

const crearEdificioSchema = z.object({
  nombre: z.string().trim().min(3).max(100),
  direccion: z.string().trim().min(5).max(200),
  ciudad: z.string().trim().min(2).max(100).default('CABA'),
  provincia: z.string().trim().min(2).max(100).default('Buenos Aires'),
  codigoPostal: z.string().trim().regex(/^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/, 'CP inválido (4 dígitos o CPA, ej. C1425BGW)'),
  tipo: z.enum(TIPOS_EDIFICIO).default('ph'),
  totalM2: z.number().positive(),
  fechaInicioAdmin: z.coerce.date().optional(),
  antiguedad: z.number().int().min(0).optional(),
  amenities: z.array(z.string()).default([]),
  reglamentoPH: z.string().url().optional(),
});

const editarEdificioSchema = crearEdificioSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Enviar al menos un campo a modificar' });

// GET / — lista de la org (solo activos); el gestor solo ve sus edificios
// asignados. Roles de edificio (propietario, inquilino, etc.) no tienen vista
// de staff: su acceso es por el portal del residente (PRD-04-05).
router.get('/', requireAuth, tenant, async (req, res, next) => {
  try {
    const esGestor = req.user.roles.includes('gestor');
    const esStaff = req.user.roles.some((r) => ['org_admin', 'superadmin'].includes(r));
    if (!esStaff && !esGestor) return res.json([]);

    const edificios = await prisma.edificio.findMany({
      where: {
        organizacionId: req.organizacionId,
        activo: true,
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

// POST / — alta de edificio (S2-01). Solo org_admin (Cerbos 'create'); el
// recurso aún no existe, así que el check se hace contra la organización.
router.post(
  '/',
  requireAuth,
  tenant,
  autorizar('edificio', 'create', (req) => ({
    id: 'nuevo',
    attr: { id: 'nuevo', organizacion_id: req.organizacionId },
  })),
  validarBody(crearEdificioSchema),
  async (req, res, next) => {
    try {
      const edificio = await prisma.edificio.create({
        data: { ...req.body, organizacionId: req.organizacionId },
      });
      return res.status(201).json(edificio);
    } catch (err) {
      return next(err);
    }
  }
);

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
      const coeficientes = estadoCoeficientes(
        sumarCoeficientes(unidades.map((u) => u.coeficiente))
      );
      return res.json({ ...req.edificio, unidades, coeficientes });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /:id/unidades — unidades del edificio con paginación (S2-02).
// ?page= (default 1) y ?limit= (default 50, máx 100).
router.get(
  '/:id/unidades',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('unidad', 'read', (req) => ({
    id: req.edificio.id,
    attr: {
      id: req.edificio.id,
      organizacion_id: req.edificio.organizacionId,
      edificio_id: req.edificio.id,
    },
  })),
  async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const where = { organizacionId: req.organizacionId, edificioId: req.edificio.id };

      const [total, data, coeficientes] = await Promise.all([
        prisma.unidad.count({ where }),
        prisma.unidad.findMany({
          where,
          orderBy: { numero: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        estadoCoeficientesEdificio(prisma, req.organizacionId, req.edificio.id),
      ]);

      return res.json({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        coeficientes,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /:id/unidades — alta bulk de unidades (S2-02). Body: array de UFs.
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: el lote
// se guarda aunque la suma resultante del edificio no cierre en 1.000000, así
// la carga puede ser incremental (la primera UF nunca podría cerrar en 1). La
// respuesta informa el estado de la suma; el gate duro es la liquidación (S3).
// Respuesta 201: `{ unidades: [...], coeficientes: { suma, delta, cuadra } }`.
router.post(
  '/:id/unidades',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('unidad', 'create', (req) => ({
    id: 'nueva',
    attr: {
      id: 'nueva',
      organizacion_id: req.edificio.organizacionId,
      edificio_id: req.edificio.id,
    },
  })),
  validarBody(bulkUnidadesSchema),
  async (req, res, next) => {
    try {
      // Duplicados dentro del lote (el unique de DB es org+edificio+numero)
      const numeros = req.body.map((u) => u.numero);
      if (new Set(numeros).size !== numeros.length) {
        return res.status(422).json({
          error: { code: 'VALIDACION_FALLIDA', message: 'El lote tiene números de unidad repetidos' },
        });
      }

      // Escritura en transacción: el lote entra completo o no entra (atomicidad
      // del alta bulk). Ya NO se toma el `SELECT ... FOR UPDATE` del edificio:
      // su única razón era serializar la validación de la invariante (review S2
      // #2 / SEC-01) que desde #57 no rechaza nada. La unicidad del número de
      // UF bajo concurrencia la sigue garantizando el índice único
      // (organizacion_id, edificio_id, numero) → P2002 → 409.
      const creadas = await prisma.$transaction(async (tx) =>
        Promise.all(
          req.body.map((u) =>
            tx.unidad.create({
              data: { ...u, organizacionId: req.organizacionId, edificioId: req.edificio.id },
            })
          )
        )
      );

      // Estado de la suma leído después del commit: informativo para la UI.
      const coeficientes = await estadoCoeficientesEdificio(
        prisma,
        req.organizacionId,
        req.edificio.id
      );
      return res.status(201).json({ unidades: creadas, coeficientes });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: { code: 'UNIDAD_DUPLICADA', message: 'Ya existe una unidad con ese número en el edificio' },
        });
      }
      return next(err);
    }
  }
);

// PATCH /:id — edición de datos del edificio (S2-01). org_admin en toda la
// org; gestor solo en edificios asignados (validarEdificio + Cerbos 'update').
router.patch(
  '/:id',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('edificio', 'update', (req) => ({
    id: req.edificio.id,
    attr: { id: req.edificio.id, organizacion_id: req.edificio.organizacionId },
  })),
  validarBody(editarEdificioSchema),
  async (req, res, next) => {
    try {
      const edificio = await prisma.edificio.update({
        where: { id: req.edificio.id },
        data: req.body,
      });
      return res.json(edificio);
    } catch (err) {
      return next(err);
    }
  }
);

// DELETE /:id — soft delete (S2-01): activo=false. No se borra nada (Ley 941
// exige conservación); el edificio deja de listarse y validarEdificio lo
// trata como inexistente. Solo org_admin (Cerbos 'delete').
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('edificio', 'delete', (req) => ({
    id: req.edificio.id,
    attr: { id: req.edificio.id, organizacion_id: req.edificio.organizacionId },
  })),
  async (req, res, next) => {
    try {
      await prisma.edificio.update({
        where: { id: req.edificio.id },
        data: { activo: false },
      });
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
