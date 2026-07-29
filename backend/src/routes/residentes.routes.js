// src/routes/residentes.routes.js — Residentes de una UF (S4-04, Workflow B)
// Spec: PRD-04-11 §5 (Workflow B), §6 (endpoints), §9 (casos borde).
// Montado en `/api/unidades/:id/residentes` (unidades.routes.js):
//   GET    /             → vínculos vigentes e históricos de la UF
//   POST   /             → vincula/invita residente → 201 { ..., invitacionUrl }
//   DELETE /:vinculoId   → baja temporal (`fechaFin = hoy`), nunca borrado físico
//
// `validarUnidad` (middleware compartido) resuelve la UF y aplica el
// aislamiento antes de todo: 404 si no existe, 403 si es de otra organización y
// 403 si el gestor no tiene ese edificio asignado. Cerbos decide sobre el
// recurso `residente` (org_admin de la org · gestor en edificios asignados).
//
// Acá se materializa la multi-pertenencia (§5.3): la misma persona acumula UFs
// de distintos consorcios y organizaciones bajo UN solo Usuario global.

import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { validarUnidad } from '../middleware/unidad.middleware.js';
import { normalizarEmail } from '../services/auth.service.js';
import {
  buscarPendiente,
  construirInvitacionUrl,
  crearOReenviarInvitacion,
} from '../services/invitaciones.service.js';
import { notificarInvitacion } from '../services/notificaciones.service.js';

// mergeParams: el `:id` de la UF lo aporta el router padre.
const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const vincularResidenteSchema = z
  .object({
    email: z.string().email('email inválido'),
    nombre: z.string().trim().min(1, 'nombre requerido'),
    apellido: z.string().trim().default(''),
    esPropietario: z.boolean().default(false),
    esInquilino: z.boolean().default(false),
    fechaInicio: z.coerce.date().optional(),
  })
  .refine((d) => d.esPropietario || d.esInquilino, {
    path: ['esPropietario'],
    message: 'el vínculo debe ser al menos propietario o inquilino',
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Recurso Cerbos: scope doble org + edificio, igual que unidad.yaml, más el
// unidad_id para que una policy futura pueda mirar la UF puntual.
const recursoResidente = (req) => ({
  id: req.unidad.id,
  attr: {
    id: req.unidad.id,
    organizacion_id: req.unidad.organizacionId,
    edificio_id: req.unidad.edificioId,
    unidad_id: req.unidad.id,
  },
});

// "Hoy" a medianoche UTC: fechaInicio/fechaFin son fechas de calendario
// (titularidad), no instantes. Sin truncar, dos altas del mismo día se
// ordenarían por hora y los tests dependerían del reloj.
function hoy() {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

// Vigente = sin fecha de fin. Misma definición que usa auth.service.js para
// derivar los roles del residente (`fechaFin: null`).
const esVigente = (vinculo) => vinculo.fechaFin === null;

const usuarioDelVinculo = {
  select: {
    id: true,
    email: true,
    nombre: true,
    apellido: true,
    telefono: true,
    activo: true,
    passwordHash: true,
  },
};

function serializarVinculo(vinculo) {
  const { usuario } = vinculo;
  return {
    id: vinculo.id,
    usuario: {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      telefono: usuario.telefono,
      // Sin password la persona fue dada de alta pero todavía no activó su
      // cuenta (S4-02): la UI ofrece reenviarle el link.
      cuentaActivada: usuario.passwordHash !== null,
    },
    esPropietario: vinculo.esPropietario,
    esInquilino: vinculo.esInquilino,
    fechaInicio: vinculo.fechaInicio,
    fechaFin: vinculo.fechaFin,
    vigente: esVigente(vinculo),
  };
}

// ---------------------------------------------------------------------------
// GET / — vínculos de la UF (vigentes e históricos)
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('residente', 'read', recursoResidente),
  async (req, res, next) => {
    try {
      const vinculos = await prisma.unidadUsuario.findMany({
        where: { organizacionId: req.organizacionId, unidadId: req.unidad.id },
        include: { usuario: usuarioDelVinculo },
        // Vigentes primero (fechaFin null), después el histórico más reciente.
        orderBy: [{ fechaFin: { sort: 'asc', nulls: 'first' } }, { fechaInicio: 'desc' }],
      });
      return res.json(vinculos.map(serializarVinculo));
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST / — vincula/invita residente (Workflow B)
// ---------------------------------------------------------------------------
//
// Email nuevo     → Usuario SIN password + UnidadUsuario + Invitacion RESIDENTE
// Email existente → solo UnidadUsuario + Invitacion (mismo login, la password
//                   no se toca nunca: la invitación suma vínculos)
//
// El vínculo se crea vigente de entrada: el residente figura en la UF desde el
// alta (las expensas ya lo alcanzan) y el link solo le da acceso al portal.

router.post(
  '/',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('residente', 'create', recursoResidente),
  validarBody(vincularResidenteSchema),
  async (req, res, next) => {
    try {
      const { nombre, apellido, esPropietario, esInquilino } = req.body;
      const email = normalizarEmail(req.body.email);
      const fechaInicio = req.body.fechaInicio ?? hoy();

      const resultado = await prisma.$transaction(async (tx) => {
        const existente = await tx.usuario.findUnique({ where: { email } });

        if (existente) {
          const vinculo = await tx.unidadUsuario.findUnique({
            where: {
              organizacionId_unidadId_usuarioId: {
                organizacionId: req.organizacionId,
                unidadId: req.unidad.id,
                usuarioId: existente.id,
              },
            },
          });
          // Ya vinculada y vigente con esta UF: nada que hacer (§9). Cambiar
          // los flags o la fecha es una edición futura; la baja es el DELETE.
          if (vinculo && esVigente(vinculo)) return { duplicado: true };
        }

        // El Usuario nuevo nace sin password: la define al aceptar (S4-02).
        const persona =
          existente ??
          (await tx.usuario.create({ data: { email, nombre, apellido, passwordHash: null } }));

        // Upsert y no create: la unicidad es (org, unidad, usuario), así que
        // re-vincular a alguien que había sido dado de baja REABRE su fila
        // (fechaFin null + fechaInicio nueva) en vez de duplicar el vínculo.
        const vinculo = await tx.unidadUsuario.upsert({
          where: {
            organizacionId_unidadId_usuarioId: {
              organizacionId: req.organizacionId,
              unidadId: req.unidad.id,
              usuarioId: persona.id,
            },
          },
          create: {
            organizacionId: req.organizacionId,
            unidadId: req.unidad.id,
            usuarioId: persona.id,
            esPropietario,
            esInquilino,
            fechaInicio,
          },
          update: { esPropietario, esInquilino, fechaInicio, fechaFin: null },
          include: { usuario: usuarioDelVinculo },
        });

        // Una sola invitación pendiente por (email, organización, tipo): si la
        // persona ya tenía una RESIDENTE pendiente en esta org (típico del
        // propietario con N UFs, §10.6), se REUSA regenerando token y payload
        // en vez de fallar. No se pierde nada: los vínculos ya quedaron
        // creados acá, la invitación solo sirve para definir la password.
        const pendiente = await buscarPendiente(tx, {
          email,
          organizacionId: req.organizacionId,
          tipo: 'RESIDENTE',
        });

        const invitacion = await crearOReenviarInvitacion(tx, {
          email,
          organizacionId: req.organizacionId,
          tipo: 'RESIDENTE',
          payload: {
            nombre,
            apellido,
            unidadId: req.unidad.id,
            esPropietario,
            esInquilino,
            fechaInicio,
          },
          invitadoPorId: req.user.id,
          // S4-11 (SEC-02): solo la invitación que creó la identidad puede
          // definir su password. `existente` se leyó antes del create.
          creaUsuario: !existente,
          pendiente,
        });

        return { persona, vinculo, invitacion, reenviada: Boolean(pendiente) };
      });

      if (resultado.duplicado) {
        return res.status(409).json({
          error: {
            code: 'VINCULO_DUPLICADO',
            message: 'Esa persona ya tiene un vínculo vigente con esta unidad',
          },
        });
      }

      const { persona, vinculo, invitacion, reenviada } = resultado;
      const invitacionUrl = construirInvitacionUrl(invitacion.token);

      // El alta ya está committeada: la notificación es best-effort (stub MVP).
      const notificacion = await notificarInvitacion({
        email,
        tipo: 'RESIDENTE',
        invitacionUrl,
        organizacion: { id: req.organizacionId },
      });

      return res.status(201).json({
        usuario: {
          id: persona.id,
          email: persona.email,
          nombre: persona.nombre,
          apellido: persona.apellido,
          cuentaActivada: persona.passwordHash !== null,
        },
        vinculo: serializarVinculo(vinculo),
        invitacion: { id: invitacion.id, expiraAt: invitacion.expiraAt, reenviada },
        invitacionUrl,
        emailEnviado: notificacion.enviado,
      });
    } catch (err) {
      // Carrera contra otro POST con el mismo email (unique global de Usuario,
      // unique del vínculo o índice parcial de invitación pendiente).
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'VINCULO_DUPLICADO',
            message: 'Esa persona ya tiene un vínculo vigente con esta unidad',
          },
        });
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /:vinculoId — baja temporal
// ---------------------------------------------------------------------------
//
// NUNCA borrado físico (§5.6): el vínculo conserva el historial de expensas y
// pagos de esa titularidad. Se permite incluso con deuda impaga (§9): la deuda
// queda asociada a la UF.

router.delete(
  '/:vinculoId',
  requireAuth,
  tenant,
  validarUnidad,
  autorizar('residente', 'delete', recursoResidente),
  async (req, res, next) => {
    try {
      // El vínculo tiene que ser de ESTA UF y de esta organización: un
      // vinculoId de otra UF responde 404 sin filtrar que exista.
      const vinculo = await prisma.unidadUsuario.findFirst({
        where: {
          id: req.params.vinculoId,
          organizacionId: req.organizacionId,
          unidadId: req.unidad.id,
        },
      });
      if (!vinculo) {
        return res.status(404).json({
          error: {
            code: 'VINCULO_NO_ENCONTRADO',
            message: 'Ese vínculo no existe en esta unidad',
          },
        });
      }

      // Idempotente: si ya estaba dado de baja se devuelve tal cual, sin
      // reescribir la fecha original (es dato histórico).
      const actualizado = esVigente(vinculo)
        ? await prisma.unidadUsuario.update({
            where: { id: vinculo.id },
            data: { fechaFin: hoy() },
            include: { usuario: usuarioDelVinculo },
          })
        : await prisma.unidadUsuario.findUnique({
            where: { id: vinculo.id },
            include: { usuario: usuarioDelVinculo },
          });

      return res.json(serializarVinculo(actualizado));
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
