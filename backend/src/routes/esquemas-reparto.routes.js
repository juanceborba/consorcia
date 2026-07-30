// src/routes/esquemas-reparto.routes.js — Esquemas de reparto del edificio (S3-20)
// Spec: PRD-02-05 Motor Contable · PRD-04-01 §1.3 · CCyC art. 2049, último párrafo
// Diseño: docs/investigacion/esquemas-de-reparto.md
// Contrato:
//   GET    /api/edificios/:id/esquemas-reparto        → { data, configuracion }
//   POST   /api/edificios/:id/esquemas-reparto        → alta → 201
//   PUT    /api/edificios/:id/configuracion-liquidacion → setup del edificio (upsert)
//   GET    /api/esquemas-reparto/:id                  → detalle + enUso
//   PUT    /api/esquemas-reparto/:id                  → edición (reemplaza la tabla de pesos)
//   DELETE /api/esquemas-reparto/:id                  → borra si no se usó, si no desactiva
//
// Exporta DOS routers, igual que gastos: `esquemasDeEdificioRouter` (montado en
// edificios.routes.js con `mergeParams`) y el default sobre /api/esquemas-reparto.
//
// DECISIONES:
//
// 1. PERMISOS = los del gasto (`cerbos/policies/esquema_reparto.yaml`): org_admin
//    administra, gestor SOLO lee. Configurar el reparto es más fuerte que cargar
//    un gasto — cambia cuánto paga cada propietario en todas las liquidaciones
//    futuras — y su fuente de autoridad es el reglamento de copropiedad, no el
//    criterio de quien administra el día a día. Un gestor lo necesita para
//    entender un importe, no para cambiarlo.
//
// 2. EL GET DEL EDIFICIO DEVUELVE TAMBIÉN LA CONFIGURACIÓN. La pantalla muestra
//    las dos cosas juntas (la lista de esquemas y cuál es el general por
//    default) y una sin la otra no se puede interpretar: un esquema "Partes
//    iguales" no dice si está aplicándose a todo el edificio o a nada. Un
//    endpoint, una foto consistente.
//
// 3. LA TABLA DE PESOS SE REEMPLAZA COMPLETA en el PUT, no se mergea. Un PATCH
//    por fila obligaría a un endpoint por UF y dejaría estados intermedios donde
//    el reparto suma cualquier cosa. La UI edita la tabla entera y la manda
//    entera; el reemplazo va en una transacción con el update del esquema.
//    Corolario: `pesos` ausente en el PUT NO borra la tabla (es una edición
//    parcial de los otros campos); `pesos: []` sí la vacía, explícitamente.
//
// 4. EL DELETE ES SEMÁFORO DOBLE, igual que los rubros propios (S3-13): si el
//    esquema no se usó nunca se borra de verdad; si lo referencia un gasto, una
//    liquidación emitida o la configuración del edificio, se DESACTIVA
//    (`activo = false`) y la respuesta lo dice. La FK del snapshot es RESTRICT:
//    un recibo emitido no puede quedar apuntando a un esquema que no existe.
//
// 5. DESACTIVAR NO CAMBIA NINGÚN CÁLCULO EN CURSO. Un esquema inactivo deja de
//    matchear automáticamente y deja de ofrecerse en la UI, pero los gastos que
//    lo eligieron a mano lo siguen usando (ver la decisión b de
//    `services/esquemas-reparto.js`): cambiarles el reparto por debajo sería
//    mover plata sin que nadie lo pida.
//
// 6. LAS UF DE LA TABLA TIENEN QUE SER DEL EDIFICIO (422 `UNIDAD_INVALIDA`). Una
//    UF de otro edificio —o de otra organización— no se distingue de una
//    inexistente: el esquema no es lugar para sondear el padrón ajeno (mismo
//    criterio que `PROVEEDOR_INVALIDO` en gastos).

import { Router } from 'express';
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import {
  crearEsquemaSchema,
  editarEsquemaSchema,
  configuracionLiquidacionSchema,
  incoherenciaAlcance,
  incoherenciaPesos,
} from '../schemas/esquema-reparto.schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPOS = {
  id: true,
  organizacionId: true,
  edificioId: true,
  nombre: true,
  base: true,
  alcance: true,
  alcanceValor: true,
  clausulaReglamento: true,
  documentoUrl: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
  pesos: {
    select: { unidadId: true, peso: true, unidad: { select: { numero: true } } },
    orderBy: { unidad: { numero: 'asc' } },
  },
};

// El peso sale como STRING con 6 decimales: Prisma devuelve un Decimal que
// `JSON.stringify` serializaría como número, reintroduciendo el float justo en
// el borde de salida (mismo criterio que `monto` en gastos).
const serializar = (e) => ({
  ...e,
  pesos: (e.pesos ?? []).map((p) => ({
    unidadId: p.unidadId,
    numero: p.unidad?.numero ?? null,
    peso: new Decimal(p.peso).toFixed(6),
  })),
});

const noEncontrado = () => ({
  error: { code: 'ESQUEMA_NO_ENCONTRADO', message: 'El esquema de reparto no existe' },
});

const validacionFallida = (message) => ({ error: { code: 'VALIDACION_FALLIDA', message } });

const nombreRepetido = (nombre) => ({
  error: {
    code: 'ESQUEMA_DUPLICADO',
    message: `Ya hay un esquema llamado "${nombre}" en este edificio`,
  },
});

// Decisión: el matcheo automático tiene que ser único (índice parcial en la DB).
const alcanceOcupado = (alcance, valor) => ({
  error: {
    code: 'ALCANCE_OCUPADO',
    message: `Ya hay un esquema activo para el ${alcance === 'SERVICIO' ? 'servicio' : 'sector'} "${valor}": desactivalo o editalo en vez de crear otro (si hubiera dos, el reparto dejaría de ser determinístico)`,
  },
});

const unidadInvalida = () => ({
  error: {
    code: 'UNIDAD_INVALIDA',
    message: 'Alguna de las unidades de la tabla de pesos no existe o no es de este edificio',
  },
});

const esquemaInvalidoParaConfig = () => ({
  error: {
    code: 'ESQUEMA_INVALIDO',
    message: 'El esquema no existe, está inactivo o no es de este edificio',
  },
});

// Decisión 6: todas las UF de la tabla tienen que ser del edificio.
async function pesosInvalidos(organizacionId, edificioId, pesos) {
  if (!pesos || pesos.length === 0) return false;
  const ids = [...new Set(pesos.map((p) => p.unidadId))];
  const cuantas = await prisma.unidad.count({
    where: { id: { in: ids }, organizacionId, edificioId },
  });
  return cuantas !== ids.length;
}

// Las validaciones que Zod no puede hacer (dependen de la DB y del edificio).
async function validacionesCruzadas(organizacionId, edificioId, esquema) {
  const incoherencia = incoherenciaAlcance(esquema) ?? incoherenciaPesos(esquema);
  if (incoherencia) return { status: 422, body: validacionFallida(incoherencia) };

  if (await pesosInvalidos(organizacionId, edificioId, esquema.pesos)) {
    return { status: 422, body: unidadInvalida() };
  }
  return null;
}

const filasDePesos = (pesos, organizacionId) =>
  (pesos ?? []).map((p) => ({ organizacionId, unidadId: p.unidadId, peso: p.peso }));

// Quién referencia al esquema. Decide entre borrado real y baja lógica, y es lo
// que la UI muestra antes de que el administrador toque nada.
async function referenciasDe(esquemaId) {
  const [gastos, detalles, configuraciones] = await Promise.all([
    prisma.gasto.count({ where: { esquemaRepartoId: esquemaId, deletedAt: null } }),
    prisma.liquidacionDetalle.count({ where: { esquemaRepartoId: esquemaId } }),
    prisma.configuracionLiquidacion.count({ where: { esquemaGeneralId: esquemaId } }),
  ]);
  return { gastos, liquidaciones: detalles, esGeneral: configuraciones > 0 };
}

const enUso = (refs) => refs.gastos > 0 || refs.liquidaciones > 0 || refs.esGeneral;

// Recurso Cerbos: scope doble org + edificio (contrato en cerbos/policies/esquema_reparto.yaml).
const recursoDeEdificio = (req) => ({
  id: req.edificio.id,
  attr: {
    id: req.edificio.id,
    organizacion_id: req.edificio.organizacionId,
    edificio_id: req.edificio.id,
  },
});

const recursoEsquema = (req) => ({
  id: req.esquema.id,
  attr: {
    id: req.esquema.id,
    organizacion_id: req.esquema.organizacionId,
    edificio_id: req.esquema.edificioId,
  },
});

// La configuración del edificio, con el default explícito cuando no hay fila:
// un edificio sin configurar reparte por coeficiente, y la respuesta lo dice en
// vez de devolver un 404 que la UI tendría que interpretar.
async function configuracionDe(edificioId) {
  const config = await prisma.configuracionLiquidacion.findUnique({
    where: { edificioId },
    select: {
      esquemaGeneralId: true,
      updatedAt: true,
      esquemaGeneral: { select: { id: true, nombre: true, base: true, alcance: true, activo: true } },
    },
  });
  return {
    esquemaGeneralId: config?.esquemaGeneralId ?? null,
    esquemaGeneral: config?.esquemaGeneral ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Router de edificio: /api/edificios/:id/esquemas-reparto
// ---------------------------------------------------------------------------

export const esquemasDeEdificioRouter = Router({ mergeParams: true });

// GET / — los esquemas del edificio + el setup (decisión 2)
esquemasDeEdificioRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'read', recursoDeEdificio),
  async (req, res, next) => {
    try {
      const [esquemas, configuracion] = await Promise.all([
        prisma.esquemaReparto.findMany({
          where: { organizacionId: req.organizacionId, edificioId: req.edificio.id },
          select: CAMPOS,
          orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        }),
        configuracionDe(req.edificio.id),
      ]);

      return res.json({ data: esquemas.map(serializar), configuracion });
    } catch (err) {
      return next(err);
    }
  }
);

// POST / — alta (org_admin; el gestor cae en el 403 de Cerbos)
esquemasDeEdificioRouter.post(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'create', recursoDeEdificio),
  validarBody(crearEsquemaSchema),
  async (req, res, next) => {
    try {
      const invalido = await validacionesCruzadas(
        req.organizacionId,
        req.edificio.id,
        req.body
      );
      if (invalido) return res.status(invalido.status).json(invalido.body);

      const { pesos, ...campos } = req.body;
      const filas = filasDePesos(pesos, req.organizacionId);

      const esquema = await prisma.esquemaReparto.create({
        data: {
          ...campos,
          organizacionId: req.organizacionId,
          edificioId: req.edificio.id,
          ...(filas.length > 0 ? { pesos: { create: filas } } : {}),
        },
        select: CAMPOS,
      });
      return res.status(201).json(serializar(esquema));
    } catch (err) {
      if (err.code === 'P2002') {
        // Dos únicos posibles: el nombre, o el índice parcial del alcance activo.
        return err.meta?.target?.includes?.('nombre')
          ? res.status(409).json(nombreRepetido(req.body.nombre))
          : res.status(409).json(alcanceOcupado(req.body.alcance, req.body.alcanceValor));
      }
      if (err.code === 'P2003') return res.status(422).json(unidadInvalida());
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Configuración de liquidación del edificio (singleton)
// ---------------------------------------------------------------------------

export const configuracionLiquidacionRouter = Router({ mergeParams: true });

configuracionLiquidacionRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'read', recursoDeEdificio),
  async (req, res, next) => {
    try {
      return res.json(await configuracionDe(req.edificio.id));
    } catch (err) {
      return next(err);
    }
  }
);

// PUT / — upsert del setup. La fila se crea on-demand: un edificio que nunca
// configuró nada no tiene fila, y eso ya significa "reparto por coeficiente".
configuracionLiquidacionRouter.put(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'update', recursoDeEdificio),
  validarBody(configuracionLiquidacionSchema),
  async (req, res, next) => {
    try {
      const { esquemaGeneralId = null } = req.body;

      // El general tiene que ser un esquema ACTIVO de ESTE edificio: acá no vale
      // la excepción del override (decisión 5), porque elegir un default
      // desactivado es siempre un error de la UI, no una decisión.
      if (esquemaGeneralId) {
        const valido = await prisma.esquemaReparto.findFirst({
          where: {
            id: esquemaGeneralId,
            organizacionId: req.organizacionId,
            edificioId: req.edificio.id,
            activo: true,
          },
          select: { id: true },
        });
        if (!valido) return res.status(422).json(esquemaInvalidoParaConfig());
      }

      await prisma.configuracionLiquidacion.upsert({
        where: { edificioId: req.edificio.id },
        create: {
          organizacionId: req.organizacionId,
          edificioId: req.edificio.id,
          esquemaGeneralId,
        },
        update: { esquemaGeneralId },
      });

      return res.json(await configuracionDe(req.edificio.id));
    } catch (err) {
      if (err.code === 'P2003') return res.status(422).json(esquemaInvalidoParaConfig());
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Router de esquema: /api/esquemas-reparto/:id
// ---------------------------------------------------------------------------

const router = Router();

// Mismo aislamiento que `validarGasto`: un esquema de OTRA organización responde
// 404 (un 403 confirmaría que ese id existe); el edificio no asignado a un gestor
// responde 403 `EDIFICIO_NO_ASIGNADO`, el contrato ya establecido por
// `validarEdificio` para un edificio de la propia organización.
async function validarEsquema(req, res, next) {
  try {
    const esquema = await prisma.esquemaReparto.findFirst({
      where: { id: req.params.id },
      select: CAMPOS,
    });
    if (!esquema || esquema.organizacionId !== req.organizacionId) {
      return res.status(404).json(noEncontrado());
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(esquema.edificioId)) {
      return res.status(403).json({
        error: {
          code: 'EDIFICIO_NO_ASIGNADO',
          message: 'El edificio no está asignado a este gestor',
        },
      });
    }

    req.esquema = esquema;
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /:id — detalle + quién lo referencia (lo que la UI necesita para avisar
// que editarlo NO reescribe las liquidaciones ya emitidas)
router.get(
  '/:id',
  requireAuth,
  tenant,
  validarEsquema,
  autorizar('esquema_reparto', 'read', recursoEsquema),
  async (req, res, next) => {
    try {
      const referencias = await referenciasDe(req.esquema.id);
      return res.json({ ...serializar(req.esquema), referencias, enUso: enUso(referencias) });
    } catch (err) {
      return next(err);
    }
  }
);

// PUT /:id — edición parcial. La tabla de pesos se reemplaza completa (decisión 3).
//
// No hay candado por liquidación acá, y es deliberado: el reparto aplicado vive
// en el snapshot de `LiquidacionDetalle`, así que editar el esquema NO puede
// alterar un recibo emitido. Lo que cambia es lo que se va a liquidar de acá en
// adelante, que es exactamente para lo que existe la edición (un reglamento se
// reforma). La UI avisa con `enUso` del GET.
router.put(
  '/:id',
  requireAuth,
  tenant,
  validarEsquema,
  autorizar('esquema_reparto', 'update', recursoEsquema),
  validarBody(editarEsquemaSchema),
  async (req, res, next) => {
    try {
      // Las validaciones corren sobre el esquema RESULTANTE: cambiar solo
      // `alcance` a SERVICIO tiene que exigir el `alcanceValor` que ya estaba (o
      // el que venga en el mismo PUT), igual que la categoría del gasto.
      const resultante = {
        ...serializar(req.esquema),
        ...req.body,
      };
      const invalido = await validacionesCruzadas(
        req.organizacionId,
        req.esquema.edificioId,
        resultante
      );
      if (invalido) return res.status(invalido.status).json(invalido.body);

      const { pesos, ...campos } = req.body;
      // Decisión 3: `pesos` ausente no toca la tabla; `pesos: []` la vacía.
      const reemplazarPesos = 'pesos' in req.body;

      const esquema = await prisma.$transaction(async (tx) => {
        if (reemplazarPesos) {
          await tx.esquemaRepartoUnidad.deleteMany({ where: { esquemaId: req.esquema.id } });
        }
        const filas = reemplazarPesos ? filasDePesos(pesos, req.organizacionId) : [];
        return tx.esquemaReparto.update({
          where: { id: req.esquema.id },
          data: {
            ...campos,
            ...(filas.length > 0 ? { pesos: { create: filas } } : {}),
          },
          select: CAMPOS,
        });
      });
      return res.json(serializar(esquema));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      if (err.code === 'P2002') {
        return err.meta?.target?.includes?.('nombre')
          ? res.status(409).json(nombreRepetido(req.body.nombre ?? req.esquema.nombre))
          : res
              .status(409)
              .json(
                alcanceOcupado(
                  req.body.alcance ?? req.esquema.alcance,
                  req.body.alcanceValor ?? req.esquema.alcanceValor
                )
              );
      }
      if (err.code === 'P2003') return res.status(422).json(unidadInvalida());
      return next(err);
    }
  }
);

// DELETE /:id — borra si no se usó, si no desactiva (decisión 4)
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarEsquema,
  autorizar('esquema_reparto', 'delete', recursoEsquema),
  async (req, res, next) => {
    try {
      const referencias = await referenciasDe(req.esquema.id);

      if (enUso(referencias)) {
        const esquema = await prisma.esquemaReparto.update({
          where: { id: req.esquema.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({
          eliminado: false,
          desactivado: true,
          referencias,
          esquema: serializar(esquema),
        });
      }

      await prisma.esquemaReparto.delete({ where: { id: req.esquema.id } });
      return res.json({ eliminado: true, desactivado: false, referencias });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      // Un gasto que eligió el esquema entre el count y el delete → se degrada a
      // baja lógica en vez de reventar con un 500 (mismo criterio que rubros).
      if (err.code === 'P2003' || err.code === 'P2014') {
        const esquema = await prisma.esquemaReparto.update({
          where: { id: req.esquema.id },
          data: { activo: false },
          select: CAMPOS,
        });
        return res.json({
          eliminado: false,
          desactivado: true,
          referencias: await referenciasDe(req.esquema.id),
          esquema: serializar(esquema),
        });
      }
      return next(err);
    }
  }
);

export default router;
