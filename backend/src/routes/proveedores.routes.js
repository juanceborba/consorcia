// src/routes/proveedores.routes.js — Directorio híbrido de proveedores (S3-12)
// Spec: PRD-04-02 §1.3. Contrato:
//   GET    /api/proveedores      → globales + propios de la org (?q=&page=&limit=)
//   POST   /api/proveedores      → alta de un proveedor PROPIO de la org
//   GET    /api/proveedores/:id  → detalle
//   PUT    /api/proveedores/:id  → edita propios
//   DELETE /api/proveedores/:id  → soft delete si tiene gastos, físico si no
//
// El directorio es HÍBRIDO: `organizacionId = null` es un proveedor global de
// plataforma (lo ven todas las organizaciones) y `organizacionId = org` es
// propio. La API solo crea propios: el catálogo global lo administra la
// plataforma (promoción propio → global: fuera de scope, §1.3).
//
// DECISIONES de S3-12 (divergen o precisan lo que dice el PRD):
//
// 1. Los globales no se editan ni se borran por esta API. El PRD dice "los
//    globales solo los edita SUPERADMIN" y la policy ya lo expresa (solo
//    `superadmin` matchea `'*'`), pero la denegación de Cerbos es un
//    `403 ACCESO_DENEGADO` genérico que en la UI se lee como "te faltan
//    permisos" cuando en realidad el recurso es de otro dueño. El guard
//    `rechazarEscrituraDeGlobal` corre ANTES de Cerbos y responde
//    `403 PROVEEDOR_GLOBAL_NO_EDITABLE`. Va antes a propósito: nadie que no sea
//    superadmin edita un global —sea org_admin o gestor—, así que el código
//    específico siempre es la razón real y no filtra nada (el proveedor global
//    es legible por todo el staff). Cerbos sigue siendo la segunda línea: si el
//    guard desaparece, la policy igual deniega.
//
// 2. Paginación: SÍ, con `page`/`limit` (default 50, tope 100) y envelope
//    `{ data, pagination }`. El PRD §1.3 no la menciona, pero el volumen no lo
//    acota la organización: al directorio propio se le suma el catálogo global
//    de plataforma, que crece con el producto y es igual para todos. Sin tope,
//    el selector de proveedor del form de gasto (S3-14) traería el catálogo
//    completo en cada apertura. Mismo envelope que la lista de gastos
//    (PRD-04-02 §2), así el frontend reusa el paginador de S2.
//
// 3. Dedup de CUIT: se rechaza el CUIT que ya exista en el directorio VISIBLE
//    para la organización — propios *y* globales — con `409 CUIT_DUPLICADO`. El
//    PRD dice que los globales "quedan fuera del dedup por org", que es cierto
//    a nivel DB (son dos índices parciales distintos), pero a nivel producto la
//    org elige sobre el árbol mergeado: dejar entrar un propio con el CUIT de un
//    global le pone dos filas indistinguibles en el mismo selector. El índice
//    único parcial de la DB queda como backstop de la carrera entre dos POST
//    simultáneos (P2002 → mismo 409).

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import {
  crearProveedorSchema,
  editarProveedorSchema,
  listarProveedoresSchema,
} from '../schemas/proveedor.schema.js';
import { rubroUsable } from '../services/rubros.js';

const router = Router();

// ---------------------------------------------------------------------------
// Recursos Cerbos (contrato de attrs documentado en cerbos/policies/proveedor.yaml)
// ---------------------------------------------------------------------------

// Colección (listar / crear): el recurso es la organización activa, y lo que se
// lista/crea son sus propios → `es_global: false`.
const recursoColeccion = (req) => ({
  id: req.organizacionId,
  attr: { organizacion_id: req.organizacionId, es_global: false },
});

// Proveedor concreto. `organizacion_id` NUNCA se omite: string vacío si es
// global (un attr ausente hace fallar la condición y Cerbos deniega con un 403
// que no explica nada).
const recursoProveedor = (req) => ({
  id: req.proveedor.id,
  attr: {
    organizacion_id: req.proveedor.organizacionId ?? '',
    es_global: req.proveedor.organizacionId === null,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPOS = {
  id: true,
  organizacionId: true,
  razonSocial: true,
  cuit: true,
  email: true,
  telefono: true,
  direccion: true,
  rubroHabitualId: true,
  notas: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
};

// `esGlobal` explícito: la UI lo necesita para el badge Global/Propio y para
// deshabilitar las acciones de edición (decisión 1).
const serializar = (p) => ({ ...p, esGlobal: p.organizacionId === null });

const noEncontrado = () => ({
  error: { code: 'PROVEEDOR_NO_ENCONTRADO', message: 'El proveedor no existe' },
});

const cuitDuplicado = (cuit) => ({
  error: {
    code: 'CUIT_DUPLICADO',
    message: `Ya existe un proveedor con el CUIT ${cuit} en tu directorio`,
  },
});

// Resuelve `:id` dentro del directorio visible para la organización: propios de
// la org o globales. Un proveedor propio de OTRA organización responde 404, no
// 403: el 403 confirmaría que ese id existe.
async function validarProveedor(req, res, next) {
  try {
    const proveedor = await prisma.proveedor.findUnique({
      where: { id: req.params.id },
      select: CAMPOS,
    });
    if (!proveedor) return res.status(404).json(noEncontrado());

    const visible =
      proveedor.organizacionId === null || proveedor.organizacionId === req.organizacionId;
    if (!visible) return res.status(404).json(noEncontrado());

    req.proveedor = proveedor;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Decisión 1: los globales son de la plataforma. Corre antes de Cerbos.
function rechazarEscrituraDeGlobal(req, res, next) {
  if (req.proveedor.organizacionId === null && !req.user.roles.includes('superadmin')) {
    return res.status(403).json({
      error: {
        code: 'PROVEEDOR_GLOBAL_NO_EDITABLE',
        message:
          'Es un proveedor del catálogo global de la plataforma: no se edita ni se borra desde tu organización',
      },
    });
  }
  return next();
}

// Decisión 3: el CUIT no se repite en el directorio visible (propios + globales).
async function cuitYaEnDirectorio(organizacionId, cuit, excluirId) {
  if (!cuit) return false;
  const existente = await prisma.proveedor.findFirst({
    where: {
      cuit,
      OR: [{ organizacionId }, { organizacionId: null }],
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true },
  });
  return existente !== null;
}

// El rubro habitual es solo una sugerencia al cargar gastos, pero tiene que ser
// un rubro que la organización realmente vea: el merge del árbol (maestro +
// overrides de visibilidad + propios activos) lo resuelve services/rubros.js
// (S3-13). No se exige que sea hoja — eso lo exige el gasto (S3-02), no la
// sugerencia del proveedor.
async function rubroHabitualInvalido(organizacionId, rubroHabitualId) {
  if (!rubroHabitualId) return false;
  return !(await rubroUsable(organizacionId, rubroHabitualId));
}

const rubroInvalido = () => ({
  error: {
    code: 'RUBRO_INVALIDO',
    message: 'El rubro habitual no existe, está inactivo o no es visible para tu organización',
  },
});

// ---------------------------------------------------------------------------
// GET / — directorio de la organización (globales + propios)
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  tenant,
  autorizar('proveedor', 'read', recursoColeccion),
  validarQuery(listarProveedoresSchema),
  async (req, res, next) => {
    try {
      const { q, page, limit, incluirInactivos } = req.filtros;

      const where = {
        OR: [{ organizacionId: req.organizacionId }, { organizacionId: null }],
        ...(incluirInactivos ? {} : { activo: true }),
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { razonSocial: { contains: q, mode: 'insensitive' } },
                    { cuit: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      };

      const [total, proveedores] = await Promise.all([
        prisma.proveedor.count({ where }),
        prisma.proveedor.findMany({
          where,
          select: CAMPOS,
          orderBy: [{ razonSocial: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return res.json({
        data: proveedores.map(serializar),
        pagination: { page, limit, total },
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST / — alta de un proveedor propio de la organización
// ---------------------------------------------------------------------------

router.post(
  '/',
  requireAuth,
  tenant,
  autorizar('proveedor', 'create', recursoColeccion),
  validarBody(crearProveedorSchema),
  async (req, res, next) => {
    try {
      const { cuit, rubroHabitualId } = req.body;

      if (await rubroHabitualInvalido(req.organizacionId, rubroHabitualId)) {
        return res.status(422).json(rubroInvalido());
      }
      if (await cuitYaEnDirectorio(req.organizacionId, cuit)) {
        return res.status(409).json(cuitDuplicado(cuit));
      }

      const proveedor = await prisma.proveedor.create({
        data: {
          ...req.body,
          organizacionId: req.organizacionId,
          createdBy: req.user.id,
        },
        select: CAMPOS,
      });
      return res.status(201).json(serializar(proveedor));
    } catch (err) {
      // Carrera entre dos altas con el mismo CUIT: lo cierra el índice único
      // parcial `proveedores_cuit_org_unique` de la migración S3-01.
      if (err.code === 'P2002') {
        return res.status(409).json(cuitDuplicado(req.body.cuit));
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:id — detalle (staff: org_admin y gestor)
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  requireAuth,
  tenant,
  validarProveedor,
  autorizar('proveedor', 'read', recursoProveedor),
  (req, res) => res.json(serializar(req.proveedor))
);

// ---------------------------------------------------------------------------
// PUT /:id — edición de un proveedor propio
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  requireAuth,
  tenant,
  validarProveedor,
  rechazarEscrituraDeGlobal,
  autorizar('proveedor', 'update', recursoProveedor),
  validarBody(editarProveedorSchema),
  async (req, res, next) => {
    try {
      const { cuit, rubroHabitualId } = req.body;

      if (rubroHabitualId !== undefined && (await rubroHabitualInvalido(req.organizacionId, rubroHabitualId))) {
        return res.status(422).json(rubroInvalido());
      }
      if (
        cuit !== undefined &&
        cuit !== req.proveedor.cuit &&
        (await cuitYaEnDirectorio(req.organizacionId, cuit, req.proveedor.id))
      ) {
        return res.status(409).json(cuitDuplicado(cuit));
      }

      const proveedor = await prisma.proveedor.update({
        where: { id: req.proveedor.id },
        data: req.body,
        select: CAMPOS,
      });
      return res.json(serializar(proveedor));
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json(cuitDuplicado(req.body.cuit));
      }
      // Un DELETE concurrente lo borró entre validarProveedor y el update.
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /:id — baja del proveedor propio
// ---------------------------------------------------------------------------
//
// Con gastos asociados NO se borra: el gasto es histórico contable (Ley 941) y
// la FK es RESTRICT. Se desactiva (`activo = false`), que lo saca del selector
// de altas pero deja legibles los gastos que lo referencian. Sin gastos, borrado
// físico: un proveedor cargado por error no tiene por qué ensuciar el directorio.

router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarProveedor,
  rechazarEscrituraDeGlobal,
  autorizar('proveedor', 'delete', recursoProveedor),
  async (req, res, next) => {
    try {
      const gastos = await prisma.gasto.count({ where: { proveedorId: req.proveedor.id } });

      if (gastos > 0) {
        const proveedor = await prisma.proveedor.update({
          where: { id: req.proveedor.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({
          eliminado: false,
          desactivado: true,
          gastosAsociados: gastos,
          proveedor: serializar(proveedor),
        });
      }

      await prisma.proveedor.delete({ where: { id: req.proveedor.id } });
      return res.json({ eliminado: true, desactivado: false, gastosAsociados: 0 });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      // Un gasto creado entre el count y el delete (o cualquier futura FK
      // RESTRICT hacia proveedores) → se degrada a baja lógica.
      if (err.code === 'P2003' || err.code === 'P2014') {
        const proveedor = await prisma.proveedor.update({
          where: { id: req.proveedor.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({
          eliminado: false,
          desactivado: true,
          proveedor: serializar(proveedor),
        });
      }
      return next(err);
    }
  }
);

export default router;
