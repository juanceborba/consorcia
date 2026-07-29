// src/routes/rubros.routes.js — Árbol de rubros de la organización (S3-13)
// Spec: PRD-04-02 §1.4. Contrato:
//   GET    /api/rubros                 → árbol mergeado (maestro + propios)
//   POST   /api/rubros                 → alta de un ítem PROPIO
//   PUT    /api/rubros/:id             → edita un ítem propio
//   PUT    /api/rubros/:id/visibilidad → muestra u oculta un ítem del maestro
//   DELETE /api/rubros/:id             → baja de un ítem propio
//
// El merge (maestro + `RubroVisibilidad` + propios) vive en services/rubros.js
// porque S3-02 y S3-12 lo reusan para validar el rubro de un gasto y el rubro
// habitual de un proveedor.
//
// DECISIONES de S3-13:
//
// 1. El maestro no se edita, no se borra y no se le cuelgan hijos "en el
//    maestro" desde una organización: lo que la org puede hacer con un ítem
//    maestro es OCULTARLO (`PUT /:id/visibilidad`, que escribe en su propia
//    tabla `rubro_visibilidad`) o colgarle un subrubro PROPIO. Como en S3-12,
//    el guard corre antes de Cerbos para devolver un código que explique el
//    motivo (`403 RUBRO_MAESTRO_NO_EDITABLE`) en vez del `ACCESO_DENEGADO`
//    genérico de la policy, que sigue siendo la segunda línea.
//
// 2. `visibilidad` es solo para el maestro. Sobre un rubro propio responde
//    `422 RUBRO_PROPIO_SIN_VISIBILIDAD`: ocultar un propio es darlo de baja
//    (`PUT /:id` con `activo: false`), y tener dos mecanismos para el mismo
//    efecto sobre el mismo ítem deja estados contradictorios (activo pero
//    invisible).
//
// 3. Nombres duplicados: se rechaza el nombre que ya exista entre los hermanos
//    VISIBLES del árbol mergeado (maestro incluido), no solo entre los propios.
//    La org elige sobre el árbol mergeado; dos "Plomería" hermanas en el mismo
//    selector no se distinguen. Los índices únicos parciales de S3-01 quedan
//    como backstop de la carrera entre dos altas simultáneas.
//
// 4. Un rubro propio nivel 1 con subrubros no se borra (`409 RUBRO_CON_SUBRUBROS`):
//    la FK `rubros_parent_id_fkey` es ON DELETE SET NULL, así que borrarlo
//    ascendería a sus subrubros a nivel 1 en silencio, rompiendo la jerarquía
//    con la que se cargaron los gastos.
//
// 5. El árbol por defecto es el USABLE (maestro visible + propios activos).
//    `?incluirOcultos=1` agrega los ocultos/inactivos marcados, porque sin eso
//    la pantalla de administración no tendría forma de volver a mostrarlos.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import {
  crearRubroSchema,
  editarRubroSchema,
  listarRubrosSchema,
  visibilidadSchema,
} from '../schemas/rubro.schema.js';
import { arbolParaOrganizacion, indiceVisible } from '../services/rubros.js';

const router = Router();

// ---------------------------------------------------------------------------
// Recursos Cerbos (contrato de attrs en cerbos/policies/rubro.yaml)
// ---------------------------------------------------------------------------

// Colección (listar / crear propio): el recurso es la organización activa.
const recursoColeccion = (req) => ({
  id: req.organizacionId,
  attr: { organizacion_id: req.organizacionId, es_maestro: false },
});

// Ítem concreto. `organizacion_id` nunca se omite: string vacío si es del
// maestro (un attr ausente hace fallar la condición y Cerbos deniega con un 403
// que no explica nada).
const recursoRubro = (req) => ({
  id: req.rubro.id,
  attr: {
    organizacion_id: req.rubro.organizacionId ?? '',
    es_maestro: req.rubro.organizacionId === null,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPOS = {
  id: true,
  organizacionId: true,
  parentId: true,
  nombre: true,
  orden: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
};

const serializarItem = (r) => ({
  id: r.id,
  parentId: r.parentId,
  nombre: r.nombre,
  orden: r.orden,
  activo: r.activo,
  esMaestro: r.organizacionId === null,
});

const noEncontrado = () => ({
  error: { code: 'RUBRO_NO_ENCONTRADO', message: 'El rubro no existe' },
});

const duplicado = (nombre) => ({
  error: {
    code: 'RUBRO_DUPLICADO',
    message: `Ya existe un rubro "${nombre}" en ese nivel del árbol`,
  },
});

// Resuelve `:id` dentro del árbol de la organización: ítems del maestro o
// propios. Un ítem propio de OTRA organización responde 404, no 403 (el 403
// confirmaría que ese id existe).
async function validarRubro(req, res, next) {
  try {
    const rubro = await prisma.rubro.findUnique({
      where: { id: req.params.id },
      select: CAMPOS,
    });
    if (!rubro) return res.status(404).json(noEncontrado());

    const visible = rubro.organizacionId === null || rubro.organizacionId === req.organizacionId;
    if (!visible) return res.status(404).json(noEncontrado());

    req.rubro = rubro;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Decisión 1: el maestro es de la plataforma. Corre antes de Cerbos.
function rechazarEscrituraDelMaestro(req, res, next) {
  if (req.rubro.organizacionId === null && !req.user.roles.includes('superadmin')) {
    return res.status(403).json({
      error: {
        code: 'RUBRO_MAESTRO_NO_EDITABLE',
        message:
          'Es un rubro del maestro de la plataforma: podés ocultarlo para tu organización o colgarle un subrubro propio, pero no editarlo ni borrarlo',
      },
    });
  }
  return next();
}

// Decisión 3: nombre único entre hermanos visibles del árbol mergeado.
async function nombreOcupado(organizacionId, { nombre, parentId, excluirId }) {
  const indice = await indiceVisible(organizacionId);
  const comparable = nombre.trim().toLocaleLowerCase('es');
  for (const nodo of indice.values()) {
    if (nodo.id === excluirId) continue;
    if ((nodo.parentId ?? null) !== (parentId ?? null)) continue;
    if (nodo.nombre.trim().toLocaleLowerCase('es') === comparable) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET / — árbol mergeado para la organización
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  tenant,
  autorizar('rubro', 'read', recursoColeccion),
  validarQuery(listarRubrosSchema),
  async (req, res, next) => {
    try {
      const arbol = await arbolParaOrganizacion(req.organizacionId, {
        incluirOcultos: req.filtros.incluirOcultos,
      });
      return res.json({ data: arbol });
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST / — alta de un ítem propio (rubro nivel 1 o subrubro)
// ---------------------------------------------------------------------------

router.post(
  '/',
  requireAuth,
  tenant,
  autorizar('rubro', 'create', recursoColeccion),
  validarBody(crearRubroSchema),
  async (req, res, next) => {
    try {
      const { nombre, parentId = null, orden } = req.body;

      if (parentId) {
        // El padre tiene que ser un rubro NIVEL 1 visible para la org (maestro
        // visible o propio): el árbol es de dos niveles fijos, no hay nietos.
        const padre = (await indiceVisible(req.organizacionId)).get(parentId);
        if (!padre || padre.parentId !== null) {
          return res.status(422).json({
            error: {
              code: 'RUBRO_PADRE_INVALIDO',
              message:
                'El padre tiene que ser un rubro de nivel 1 visible para tu organización (el árbol tiene 2 niveles)',
            },
          });
        }
      }

      if (await nombreOcupado(req.organizacionId, { nombre, parentId })) {
        return res.status(409).json(duplicado(nombre));
      }

      const rubro = await prisma.rubro.create({
        data: { organizacionId: req.organizacionId, parentId, nombre, orden },
        select: CAMPOS,
      });
      return res.status(201).json(serializarItem(rubro));
    } catch (err) {
      // Carrera contra otra alta con el mismo nombre: la cierran los índices
      // únicos (parciales para el nivel 1) de la migración S3-01.
      if (err.code === 'P2002') return res.status(409).json(duplicado(req.body.nombre));
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /:id/visibilidad — muestra u oculta un ítem del MAESTRO para la org
// ---------------------------------------------------------------------------
//
// Va antes de `PUT /:id` para que el prefijo más específico gane. No toca el
// maestro: escribe el override en `rubro_visibilidad`, que es un dato de la
// organización (por eso la policy le habilita la acción `visibilidad` al
// org_admin aunque el recurso sea maestro).

router.put(
  '/:id/visibilidad',
  requireAuth,
  tenant,
  validarRubro,
  // Decisión 2: solo el maestro tiene override de visibilidad.
  (req, res, next) => {
    if (req.rubro.organizacionId !== null) {
      return res.status(422).json({
        error: {
          code: 'RUBRO_PROPIO_SIN_VISIBILIDAD',
          message:
            'La visibilidad es un override sobre el maestro: un rubro propio se oculta dándolo de baja (activo=false)',
        },
      });
    }
    return next();
  },
  autorizar('rubro', 'visibilidad', recursoRubro),
  validarBody(visibilidadSchema),
  async (req, res, next) => {
    try {
      const { visible } = req.body;
      await prisma.rubroVisibilidad.upsert({
        where: {
          organizacionId_rubroId: {
            organizacionId: req.organizacionId,
            rubroId: req.rubro.id,
          },
        },
        create: { organizacionId: req.organizacionId, rubroId: req.rubro.id, visible },
        update: { visible },
      });
      return res.json({ ...serializarItem(req.rubro), visible });
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /:id — edición de un ítem propio
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  requireAuth,
  tenant,
  validarRubro,
  rechazarEscrituraDelMaestro,
  autorizar('rubro', 'update', recursoRubro),
  validarBody(editarRubroSchema),
  async (req, res, next) => {
    try {
      const { nombre } = req.body;
      if (
        nombre !== undefined &&
        nombre !== req.rubro.nombre &&
        (await nombreOcupado(req.organizacionId, {
          nombre,
          parentId: req.rubro.parentId,
          excluirId: req.rubro.id,
        }))
      ) {
        return res.status(409).json(duplicado(nombre));
      }

      const rubro = await prisma.rubro.update({
        where: { id: req.rubro.id },
        data: req.body,
        select: CAMPOS,
      });
      return res.json(serializarItem(rubro));
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json(duplicado(req.body.nombre));
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /:id — baja de un ítem propio
// ---------------------------------------------------------------------------
//
// Con gastos asociados NO se borra (PRD-04-02 §1.4: "nunca se borra un ítem con
// gastos asociados → se desactiva"): el gasto es histórico contable y la FK es
// RESTRICT. Sin gastos y sin subrubros, borrado físico.

router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarRubro,
  rechazarEscrituraDelMaestro,
  autorizar('rubro', 'delete', recursoRubro),
  async (req, res, next) => {
    try {
      const [gastos, subrubros] = await Promise.all([
        prisma.gasto.count({ where: { rubroId: req.rubro.id } }),
        prisma.rubro.count({ where: { parentId: req.rubro.id } }),
      ]);

      if (gastos > 0) {
        const rubro = await prisma.rubro.update({
          where: { id: req.rubro.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({
          eliminado: false,
          desactivado: true,
          gastosAsociados: gastos,
          rubro: serializarItem(rubro),
        });
      }

      // Decisión 4: la FK de `parent_id` es SET NULL, borrar el padre ascendería
      // a los hijos a nivel 1 sin que nadie lo pida.
      if (subrubros > 0) {
        return res.status(409).json({
          error: {
            code: 'RUBRO_CON_SUBRUBROS',
            message: `El rubro tiene ${subrubros} subrubro(s): borralos o dalos de baja antes`,
          },
        });
      }

      await prisma.rubro.delete({ where: { id: req.rubro.id } });
      return res.json({ eliminado: true, desactivado: false, gastosAsociados: 0 });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      // Un gasto o un proveedor (rubro habitual) creado entre el count y el
      // delete → se degrada a baja lógica en vez de reventar con un 500.
      if (err.code === 'P2003' || err.code === 'P2014') {
        const rubro = await prisma.rubro.update({
          where: { id: req.rubro.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({ eliminado: false, desactivado: true, rubro: serializarItem(rubro) });
      }
      return next(err);
    }
  }
);

export default router;
