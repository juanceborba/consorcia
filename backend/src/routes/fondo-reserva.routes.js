// backend/src/routes/fondo-reserva.routes.js — ConsorcIA
// Reglas del fondo de reserva de un edificio (S3-21):
//
//   GET    /api/edificios/:id/fondo-reserva        → reglas + la vigente hoy
//   POST   /api/edificios/:id/fondo-reserva        → alta de una regla (org_admin)
//   DELETE /api/fondo-reserva/:reglaId             → baja de una regla NO usada
//
// Diseño y alcance: `docs/investigacion/ledger-y-fondo-de-reserva.md` (capa A).
//
// DECISIONES:
//
// 1. LAS REGLAS NO SE EDITAN, SE SUCEDEN. No hay PUT: cambiar el porcentaje es
//    dar de alta una regla nueva con su `vigenciaDesde`. Editar la vigente
//    reescribiría el pasado —las liquidaciones anteriores se calcularon con
//    ella— y perdería el historial de qué votó cada asamblea, que es
//    exactamente lo que un propietario pide cuando discute el importe.
//
// 2. SÍ SE BORRA UNA REGLA QUE NO LIQUIDÓ NADA. El caso real es el error de
//    carga (5% donde iba 0,5%) descubierto antes de liquidar. La FK
//    `Liquidacion.reglaFondoReservaId` es `Restrict`, así que el intento de
//    borrar una regla ya usada muere en la DB; se traduce a un 409 explicando
//    que hay liquidaciones emitidas con ella. Un `deletedAt` acá sería peor: la
//    resolución por período tendría que filtrarlo y el historial ya lo garantiza
//    el snapshot que guarda cada liquidación.
//
// 3. MISMO RECURSO CERBOS QUE LOS ESQUEMAS (`esquema_reparto`). Las dos cosas
//    son "cómo se calcula lo que paga cada UF", las decide el org_admin y el
//    gestor solo las lee. Inventar un recurso nuevo sería una policy más para
//    mantener sincronizada con la misma respuesta.
//
// 4. EL ALTA ES IDEMPOTENTE POR PERÍODO: dos reglas desde el mismo mes serían
//    ambiguas (¿cuál gana?), así que el índice único responde 409 y la UI
//    propone reemplazar la existente.
import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { crearReglaFondoSchema } from '../schemas/fondo-reserva.schema.js';
import {
  SELECT_REGLA,
  explicarRegla,
  reglaVigente,
} from '../services/fondo-reserva.js';

const periodoActual = () => new Date().toISOString().slice(0, 7);

const serializar = (regla) => ({
  ...regla,
  porcentaje: regla.porcentaje === null ? null : String(regla.porcentaje),
  montoFijo: regla.montoFijo === null ? null : String(regla.montoFijo),
  descripcion: explicarRegla(regla),
});

const recursoDeEdificio = (req) => ({
  id: req.edificio.id,
  attr: {
    id: req.edificio.id,
    organizacion_id: req.edificio.organizacionId,
    edificio_id: req.edificio.id,
  },
});

// ---------------------------------------------------------------------------
// Router de edificio: /api/edificios/:id/fondo-reserva
// ---------------------------------------------------------------------------

export const fondoReservaDeEdificioRouter = Router({ mergeParams: true });

fondoReservaDeEdificioRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'read', recursoDeEdificio),
  async (req, res, next) => {
    try {
      const [reglas, vigente] = await Promise.all([
        prisma.reglaFondoReserva.findMany({
          where: { organizacionId: req.organizacionId, edificioId: req.edificio.id },
          select: SELECT_REGLA,
          // De la más nueva a la más vieja: la de arriba es la que va a regir.
          orderBy: { vigenciaDesde: 'desc' },
        }),
        reglaVigente(req.organizacionId, req.edificio.id, periodoActual()),
      ]);

      return res.json({
        data: reglas.map(serializar),
        // La que rige HOY puede no ser la primera de la lista: una regla con
        // vigencia futura encabeza el listado y todavía no se aplica.
        vigente: vigente ? serializar(vigente) : null,
        periodoActual: periodoActual(),
      });
    } catch (err) {
      return next(err);
    }
  }
);

fondoReservaDeEdificioRouter.post(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('esquema_reparto', 'create', recursoDeEdificio),
  validarBody(crearReglaFondoSchema),
  async (req, res, next) => {
    try {
      const { esquemaRepartoId } = req.body;

      // El esquema propio de la regla tiene que ser del MISMO edificio: un
      // esquema de otro consorcio repartiría el aporte entre UFs ajenas.
      if (esquemaRepartoId) {
        const esquema = await prisma.esquemaReparto.findFirst({
          where: {
            id: esquemaRepartoId,
            organizacionId: req.organizacionId,
            edificioId: req.edificio.id,
          },
          select: { id: true },
        });
        if (!esquema) {
          return res.status(422).json({
            error: {
              code: 'ESQUEMA_INVALIDO',
              message: 'El esquema de reparto no existe en este edificio',
            },
          });
        }
      }

      const regla = await prisma.reglaFondoReserva.create({
        data: {
          ...req.body,
          organizacionId: req.organizacionId,
          edificioId: req.edificio.id,
          createdBy: req.user.id,
        },
        select: SELECT_REGLA,
      });

      return res.status(201).json(serializar(regla));
    } catch (err) {
      // Decisión 4.
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'VIGENCIA_OCUPADA',
            message: `Ya hay una regla del fondo vigente desde ${req.body.vigenciaDesde}`,
          },
        });
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Router propio: /api/fondo-reserva/:reglaId
// ---------------------------------------------------------------------------

const router = Router();

router.delete(
  '/:reglaId',
  requireAuth,
  tenant,
  async (req, res, next) => {
    // El edificio sale de la regla y no de la URL: es lo que Cerbos necesita
    // para autorizar, y de paso valida la pertenencia al tenant.
    const regla = await prisma.reglaFondoReserva.findFirst({
      where: { id: req.params.reglaId, organizacionId: req.organizacionId },
      select: { id: true, edificioId: true, organizacionId: true, vigenciaDesde: true },
    });
    if (!regla) {
      return res.status(404).json({
        error: { code: 'REGLA_NO_ENCONTRADA', message: 'La regla no existe' },
      });
    }
    req.regla = regla;
    req.edificio = { id: regla.edificioId, organizacionId: regla.organizacionId };
    return next();
  },
  autorizar('esquema_reparto', 'delete', recursoDeEdificio),
  async (req, res, next) => {
    try {
      await prisma.reglaFondoReserva.delete({ where: { id: req.regla.id } });
      return res.status(204).send();
    } catch (err) {
      // Decisión 2: la FK Restrict es la que garantiza que el historial no se
      // pueda romper; acá solo se traduce.
      if (err.code === 'P2003' || err.code === 'P2014') {
        return res.status(409).json({
          error: {
            code: 'REGLA_EN_USO',
            message:
              'Hay liquidaciones emitidas con esta regla: para cambiarla, cargá una nueva con la vigencia que corresponda',
          },
        });
      }
      return next(err);
    }
  }
);

export default router;
