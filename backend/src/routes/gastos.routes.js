// src/routes/gastos.routes.js — CRUD de gastos (S3-02)
// Spec: PRD-04-02 §1.1/§2 · policy cerbos/policies/gasto.yaml. Contrato:
//   POST   /api/edificios/:id/gastos → alta → 201
//   GET    /api/edificios/:id/gastos → lista paginada (fechaGasto desc) + totales
//   GET    /api/gastos/:id           → detalle con sus liquidaciones
//   PUT    /api/gastos/:id           → edición (409 si está liquidado)
//   DELETE /api/gastos/:id           → soft delete (`deletedAt`)
//
// Exporta DOS routers: `gastosDeEdificioRouter` (montado en edificios.routes.js
// bajo `/:id/gastos`, con `mergeParams` para heredar el edificio, igual que
// residentes bajo unidades) y el default sobre `/api/gastos`.
//
// DECISIONES de S3-02:
//
// 1. El gestor NO carga gastos. `gasto.yaml` (S3-01) le da solo `read` en sus
//    edificios asignados y el backlog de S3 lo dice explícito ("gestor: lectura
//    de gastos/liquidaciones de sus edificios"): cargar un gasto es mover la
//    caja del consorcio. Se respeta la policy tal cual — POST/PUT/DELETE de un
//    gestor caen en el `403 ACCESO_DENEGADO` de Cerbos, sin guard previo. A
//    diferencia de S3-12/S3-13 acá no hay código específico que agregar: el
//    motivo real *es* "te faltan permisos", no "el recurso es de otro dueño".
//
// 2. Congelado por liquidación (§6 "no modificar gastos liquidados"): el gasto
//    que participa de una liquidación en un estado NO reversible se rechaza con
//    `409 LIQUIDACION_APROBADA`. El conjunto congelado es
//    {APROBADA, ENVIADA, COBRADA} — el backlog nombra las dos primeras, y
//    COBRADA se suma porque es posterior a ENVIADA: si editar un gasto ya
//    enviado corrompe el recibo, editar uno ya cobrado corrompe además la
//    cuenta corriente. BORRADOR y ANULADA no congelan: el borrador se
//    recalcula y la anulada existe justamente para regenerar el período
//    (decisión de S3-01).
//
// 3. El DELETE aplica el MISMO candado que el PUT. El backlog solo lo pide para
//    el PUT, pero el soft delete es un cambio semántico igual de fuerte: un
//    gasto con `deletedAt` desaparece de la lista y de los próximos cálculos
//    mientras sigue referenciado por los `LiquidacionDetalle` ya emitidos, así
//    que la liquidación aprobada quedaría apuntando a un gasto que la UI no
//    muestra. Para "sacar" un gasto de una liquidación aprobada hay que anular
//    la liquidación (S3-04).
//
// 4. Validaciones cruzadas con códigos propios: `422 PROVEEDOR_INVALIDO` y
//    `422 RUBRO_INVALIDO`. Un proveedor o un rubro de OTRA organización no se
//    distingue de uno inexistente (mismo 422 con el mismo mensaje): el gasto no
//    es lugar para sondear el directorio ajeno. El rubro se valida con
//    `rubroUsable(..., { soloHojas: true })` porque §1.1 exige que el gasto
//    apunte a un subrubro o rubro hoja; el proveedor tiene que estar ACTIVO
//    (un proveedor dado de baja sigue legible en los gastos históricos, pero no
//    se le cargan nuevos).
//
// 5. La lista devuelve `totales: { cantidad, monto }` del filtro activo, además
//    de `pagination`. La fila TOTAL de la pantalla de gastos (PRD-04-02 §4.1,
//    S3-07) es del filtro completo, no de la página: sin esto el frontend
//    tendría que paginar todo el período para sumarlo, o inventar un segundo
//    endpoint. Es una suma, no analítica — el dashboard agregado es S3-15.
//
// 6. `monto` viaja como STRING en las respuestas (`"12345.67"`). Prisma
//    devuelve un `Decimal` que `JSON.stringify` serializaría como número,
//    reintroduciendo el float justo en el borde de salida.

import { Router } from 'express';
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import {
  crearGastoSchema,
  editarGastoSchema,
  listarGastosSchema,
  incoherenciaCategoria,
} from '../schemas/gasto.schema.js';
import { rubroUsable } from '../services/rubros.js';

// ---------------------------------------------------------------------------
// Constantes y helpers
// ---------------------------------------------------------------------------

// Decisión 2: estados de liquidación que congelan al gasto.
export const ESTADOS_CONGELANTES = ['APROBADA', 'ENVIADA', 'COBRADA'];

const CAMPOS = {
  id: true,
  organizacionId: true,
  edificioId: true,
  proveedorId: true,
  rubroId: true,
  concepto: true,
  descripcion: true,
  monto: true,
  moneda: true,
  categoria: true,
  servicioEspecifico: true,
  sectorEspecifico: true,
  esOrdinario: true,
  comprobanteUrl: true,
  fechaGasto: true,
  periodo: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  proveedor: { select: { id: true, razonSocial: true, activo: true } },
  rubro: { select: { id: true, nombre: true, parentId: true, activo: true } },
};

// Decisión 6: el monto sale como string, nunca como número.
const serializar = (g) => ({ ...g, monto: new Decimal(g.monto).toFixed(2) });

const noEncontrado = () => ({
  error: { code: 'GASTO_NO_ENCONTRADO', message: 'El gasto no existe' },
});

const validacionFallida = (message) => ({ error: { code: 'VALIDACION_FALLIDA', message } });

const proveedorInvalido = () => ({
  error: {
    code: 'PROVEEDOR_INVALIDO',
    message: 'El proveedor no existe, está inactivo o no es visible para tu organización',
  },
});

const rubroInvalido = () => ({
  error: {
    code: 'RUBRO_INVALIDO',
    message:
      'El rubro no existe, está inactivo, no es visible para tu organización o no es una hoja del árbol',
  },
});

// Carrera: el proveedor o el rubro se borraron entre la validación y el write.
// La FK que falló no dice cuál de los dos fue sin parsear el mensaje de Postgres.
const referenciaCaida = () =>
  validacionFallida(
    'El proveedor o el rubro referenciados dejaron de estar disponibles: volvé a elegirlos'
  );

const liquidacionAprobada = (liquidaciones) => ({
  error: {
    code: 'LIQUIDACION_APROBADA',
    message: `El gasto forma parte de una liquidación ${liquidaciones
      .map((l) => `${l.periodo} (${l.estado})`)
      .join(', ')}: para modificarlo hay que anular la liquidación`,
  },
});

// Decisión 4: proveedor visible para la org (propio o global) y activo.
async function proveedorUsable(organizacionId, proveedorId) {
  const proveedor = await prisma.proveedor.findFirst({
    where: {
      id: proveedorId,
      activo: true,
      OR: [{ organizacionId }, { organizacionId: null }],
    },
    select: { id: true },
  });
  return proveedor !== null;
}

// Corre las tres validaciones que no puede hacer Zod (dependen de la DB y de la
// organización). Devuelve la respuesta de error o null si todo cierra.
async function validacionesCruzadas(organizacionId, gasto) {
  const incoherencia = incoherenciaCategoria(gasto);
  if (incoherencia) return { status: 422, body: validacionFallida(incoherencia) };

  if (!(await proveedorUsable(organizacionId, gasto.proveedorId))) {
    return { status: 422, body: proveedorInvalido() };
  }
  if (!(await rubroUsable(organizacionId, gasto.rubroId, { soloHojas: true }))) {
    return { status: 422, body: rubroInvalido() };
  }
  return null;
}

// Liquidaciones del gasto en un estado congelante (decisión 2).
async function liquidacionesCongelantes(gastoId) {
  const detalles = await prisma.liquidacionDetalle.findMany({
    where: { gastoId, liquidacion: { estado: { in: ESTADOS_CONGELANTES } } },
    select: { liquidacion: { select: { id: true, periodo: true, estado: true } } },
  });
  // Un gasto tiene un detalle por UF dentro de la misma liquidación.
  const porId = new Map(detalles.map((d) => [d.liquidacion.id, d.liquidacion]));
  return [...porId.values()];
}

// Recurso Cerbos: scope doble org + edificio (contrato en cerbos/policies/gasto.yaml).
const recursoDeEdificio = (req) => ({
  id: req.edificio.id,
  attr: {
    id: req.edificio.id,
    organizacion_id: req.edificio.organizacionId,
    edificio_id: req.edificio.id,
  },
});

const recursoGasto = (req) => ({
  id: req.gasto.id,
  attr: {
    id: req.gasto.id,
    organizacion_id: req.gasto.organizacionId,
    edificio_id: req.gasto.edificioId,
  },
});

// ---------------------------------------------------------------------------
// Router de edificio: /api/edificios/:id/gastos
// ---------------------------------------------------------------------------
//
// `validarEdificio` resuelve el edificio y aplica el aislamiento antes de todo:
// 404 si no existe, 403 `FUERA_DE_ORGANIZACION` si es de otra org y 403
// `EDIFICIO_NO_ASIGNADO` si el gestor no lo tiene asignado.

export const gastosDeEdificioRouter = Router({ mergeParams: true });

// GET / — lista paginada del edificio, orden fechaGasto desc
gastosDeEdificioRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('gasto', 'read', recursoDeEdificio),
  validarQuery(listarGastosSchema),
  async (req, res, next) => {
    try {
      const { periodo, categoria, esOrdinario, proveedorId, rubroId, desde, hasta, q, page, limit } =
        req.filtros;

      const where = {
        organizacionId: req.organizacionId,
        edificioId: req.edificio.id,
        // Los soft-deleted no se listan nunca (siguen en la DB por Ley 941).
        deletedAt: null,
        ...(periodo ? { periodo } : {}),
        ...(categoria ? { categoria } : {}),
        ...(esOrdinario !== undefined ? { esOrdinario } : {}),
        ...(proveedorId ? { proveedorId } : {}),
        ...(rubroId ? { rubroId } : {}),
        ...(desde || hasta
          ? {
              fechaGasto: {
                ...(desde ? { gte: desde } : {}),
                ...(hasta ? { lte: hasta } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { concepto: { contains: q, mode: 'insensitive' } },
                { descripcion: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [agregado, gastos] = await Promise.all([
        // Decisión 5: los totales son del filtro completo, no de la página.
        prisma.gasto.aggregate({ where, _count: { _all: true }, _sum: { monto: true } }),
        prisma.gasto.findMany({
          where,
          select: CAMPOS,
          // `createdAt` desempata: dos gastos del mismo día tienen que salir
          // siempre en el mismo orden o la paginación repite/saltea filas.
          orderBy: [{ fechaGasto: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const total = agregado._count._all;
      return res.json({
        data: gastos.map(serializar),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        totales: {
          cantidad: total,
          monto: new Decimal(agregado._sum.monto ?? 0).toFixed(2),
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST / — alta del gasto (org_admin; el gestor cae en el 403 de Cerbos)
gastosDeEdificioRouter.post(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('gasto', 'create', recursoDeEdificio),
  validarBody(crearGastoSchema),
  async (req, res, next) => {
    try {
      const invalido = await validacionesCruzadas(req.organizacionId, req.body);
      if (invalido) return res.status(invalido.status).json(invalido.body);

      const gasto = await prisma.gasto.create({
        data: {
          ...req.body,
          organizacionId: req.organizacionId,
          edificioId: req.edificio.id,
          createdBy: req.user.id,
        },
        select: CAMPOS,
      });
      return res.status(201).json(serializar(gasto));
    } catch (err) {
      if (err.code === 'P2003') return res.status(422).json(referenciaCaida());
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Router de gasto: /api/gastos/:id
// ---------------------------------------------------------------------------

const router = Router();

// Resuelve `:id` con el aislamiento de la organización y del gestor. Un gasto de
// OTRA organización responde 404, no 403 (el 403 confirmaría que ese id existe);
// el edificio no asignado a un gestor SÍ responde 403 `EDIFICIO_NO_ASIGNADO`,
// que es el contrato ya establecido por `validarEdificio` para un edificio de la
// propia organización.
async function validarGasto(req, res, next) {
  try {
    // El soft-deleted es 404: para la API ya no existe (sigue en la DB por Ley 941).
    const gasto = await prisma.gasto.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: CAMPOS,
    });
    if (!gasto || gasto.organizacionId !== req.organizacionId) {
      return res.status(404).json(noEncontrado());
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(gasto.edificioId)) {
      return res.status(403).json({
        error: { code: 'EDIFICIO_NO_ASIGNADO', message: 'El edificio no está asignado a este gestor' },
      });
    }

    req.gasto = gasto;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Decisión 2 y 3: candado compartido por PUT y DELETE.
async function rechazarSiEstaLiquidado(req, res, next) {
  try {
    const liquidaciones = await liquidacionesCongelantes(req.gasto.id);
    if (liquidaciones.length > 0) {
      return res.status(409).json(liquidacionAprobada(liquidaciones));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /:id — detalle con las liquidaciones asociadas (PRD-04-02 §2)
router.get(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'read', recursoGasto),
  async (req, res, next) => {
    try {
      const detalles = await prisma.liquidacionDetalle.findMany({
        where: { gastoId: req.gasto.id },
        select: { liquidacion: { select: { id: true, periodo: true, estado: true } } },
      });
      const porId = new Map(detalles.map((d) => [d.liquidacion.id, d.liquidacion]));
      const liquidaciones = [...porId.values()];

      return res.json({
        ...serializar(req.gasto),
        liquidaciones,
        // La UI deshabilita editar/borrar con esto (DoD del sprint) en vez de
        // descubrirlo con un 409 después de abrir el formulario.
        editable: !liquidaciones.some((l) => ESTADOS_CONGELANTES.includes(l.estado)),
      });
    } catch (err) {
      return next(err);
    }
  }
);

// PUT /:id — edición parcial. 409 si el gasto ya está liquidado.
router.put(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'update', recursoGasto),
  // El candado va ANTES de validar el body: un gasto congelado se rechaza con
  // 409 sea lo que venga en el payload, sin que un 422 tape el motivo real.
  rechazarSiEstaLiquidado,
  validarBody(editarGastoSchema),
  async (req, res, next) => {
    try {
      // Las validaciones cruzadas corren sobre el gasto RESULTANTE: cambiar
      // solo `categoria` a B tiene que exigir el `servicioEspecifico` que ya
      // estaba (o el que venga en el mismo PUT).
      const resultante = { ...req.gasto, ...req.body };
      const invalido = await validacionesCruzadas(req.organizacionId, resultante);
      if (invalido) return res.status(invalido.status).json(invalido.body);

      const gasto = await prisma.gasto.update({
        where: { id: req.gasto.id },
        data: req.body,
        select: CAMPOS,
      });
      return res.json(serializar(gasto));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      if (err.code === 'P2003') return res.status(422).json(referenciaCaida());
      return next(err);
    }
  }
);

// DELETE /:id — soft delete (Ley 941: el registro se conserva). 409 si está liquidado.
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'delete', recursoGasto),
  rechazarSiEstaLiquidado,
  async (req, res, next) => {
    try {
      await prisma.gasto.update({
        where: { id: req.gasto.id },
        data: { deletedAt: new Date() },
      });
      return res.status(204).send();
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      return next(err);
    }
  }
);

export default router;
