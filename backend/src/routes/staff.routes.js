// src/routes/staff.routes.js — Staff de la organización (S4-03, Workflow A)
// Spec: PRD-04-11 §4 (Workflow A), §6 (endpoints), §9 (casos borde).
// Montado en `/api/organizaciones/me/usuarios` (organizaciones.routes.js):
//   GET   /                → lista del staff de la org (rol, edificios, estado)
//   POST  /                → invita staff → 201 { ..., invitacionUrl }
//   PATCH /:id             → rol, edificios del gestor, activar/desactivar
//
// `:id` es el **usuarioId** (identidad global), no el id de la membresía: es lo
// que la UI tiene a mano y lo que identifica a la persona. La membresía se
// resuelve por (organizacionId del JWT, usuarioId), así que un usuarioId de
// otra organización responde 404 — nunca filtra que exista.
//
// La organización sale SIEMPRE del JWT (`/me`): no hay forma de operar el staff
// de otra org. El permiso lo decide Cerbos (`staff`: solo org_admin).

import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { normalizarEmail } from '../services/auth.service.js';
import {
  buscarPendiente,
  construirInvitacionUrl,
  crearOReenviarInvitacion,
  errorInvitacionPendiente,
} from '../services/invitaciones.service.js';
import { notificarInvitacion } from '../services/notificaciones.service.js';

const router = Router();

const ROLES_STAFF = ['ORG_ADMIN', 'GESTOR'];

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const invitarStaffSchema = z
  .object({
    email: z.string().email('email inválido'),
    nombre: z.string().trim().min(1, 'nombre requerido'),
    apellido: z.string().trim().default(''),
    rol: z.enum(ROLES_STAFF),
    // Un gestor sin edificios es válido (PRD-04-11 §9): ve la org en solo
    // lectura y la UI sugiere asignarle edificios.
    edificioIds: z.array(z.string().uuid('edificioId inválido')).default([]),
    // Reenvío explícito: sin esto, un email con invitación pendiente responde
    // 409 en vez de sobrescribirle silenciosamente rol/edificios.
    reenviar: z.boolean().default(false),
  })
  .refine((d) => d.rol === 'GESTOR' || d.edificioIds.length === 0, {
    path: ['edificioIds'],
    message: 'solo un GESTOR tiene edificios asignados',
  });

const editarStaffSchema = z
  .object({
    rol: z.enum(ROLES_STAFF).optional(),
    edificioIds: z.array(z.string().uuid('edificioId inválido')).optional(),
    activo: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Enviar al menos un campo a modificar (rol, edificioIds, activo)',
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Recurso Cerbos: el staff se administra a nivel organización, así que el
// recurso es la propia org del principal (mismo patrón que organizacion.yaml).
const recursoStaff = (req) => ({
  id: req.organizacionId,
  attr: { id: req.organizacionId, organizacion_id: req.organizacionId },
});

// Edificios de la organización dentro de `ids`. Devuelve solo los válidos: el
// handler compara la cantidad para rechazar ids de otra org o inexistentes.
async function edificiosDeLaOrg(client, organizacionId, ids) {
  if (ids.length === 0) return [];
  const edificios = await client.edificio.findMany({
    where: { id: { in: ids }, organizacionId, activo: true },
    select: { id: true },
  });
  return edificios.map((e) => e.id);
}

const errorEdificioInvalido = (ids) => ({
  error: {
    code: 'EDIFICIO_INVALIDO',
    message: `Estos edificios no existen o no son de tu organización: ${ids.join(', ')}`,
  },
});

// Reemplaza las asignaciones del gestor SOLO dentro de esta organización: si la
// persona también gestiona edificios de otra org (identidad global), esos
// vínculos no se tocan.
async function reemplazarEdificiosDelGestor(tx, { organizacionId, usuarioId, edificioIds }) {
  const deLaOrg = await tx.edificio.findMany({
    where: { organizacionId },
    select: { id: true },
  });
  await tx.gestorEdificio.deleteMany({
    where: { usuarioId, edificioId: { in: deLaOrg.map((e) => e.id) } },
  });
  if (edificioIds.length > 0) {
    await tx.gestorEdificio.createMany({
      data: edificioIds.map((edificioId) => ({ usuarioId, edificioId })),
      skipDuplicates: true,
    });
  }
}

// Lock de la fila de la organización dentro de una transacción interactiva.
// Serializa los PATCH concurrentes sobre su staff y cierra la carrera TOCTOU
// del guard de "último org_admin" (dos requests degradando a los dos últimos
// admins a la vez dejarían la org sin ninguno). Mismo patrón que lockEdificio
// en unidades.routes.js.
function lockOrganizacion(tx, organizacionId) {
  return tx.$queryRaw`SELECT id FROM organizaciones WHERE id = ${organizacionId} FOR UPDATE`;
}

// Shape de una fila de la lista de staff.
function serializarMiembro(membresia, edificiosPorUsuario) {
  const { usuario } = membresia;
  return {
    id: usuario.id,
    membresiaId: membresia.id,
    email: usuario.email,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    telefono: usuario.telefono,
    rol: membresia.rol,
    activo: membresia.activo,
    // Distingue "invitado, todavía no entró" de "cuenta operativa": sin
    // password no hay login posible (S4-02).
    cuentaActivada: usuario.passwordHash !== null,
    usuarioActivo: usuario.activo,
    edificios: membresia.rol === 'GESTOR' ? (edificiosPorUsuario.get(usuario.id) ?? []) : [],
    createdAt: membresia.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET / — staff de la organización
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  tenant,
  autorizar('staff', 'read', recursoStaff),
  async (req, res, next) => {
    try {
      // Incluye las membresías desactivadas: la pantalla de staff muestra el
      // estado y permite reactivar (baja lógica, nunca borrado).
      const membresias = await prisma.organizacionUsuario.findMany({
        where: { organizacionId: req.organizacionId },
        include: {
          usuario: {
            select: {
              id: true,
              email: true,
              nombre: true,
              apellido: true,
              telefono: true,
              activo: true,
              passwordHash: true,
            },
          },
        },
        orderBy: [{ usuario: { apellido: 'asc' } }, { usuario: { email: 'asc' } }],
      });

      // Edificios asignados, scopeados a los de ESTA organización (la persona
      // puede gestionar edificios de otra org con el mismo Usuario global).
      const asignaciones = await prisma.gestorEdificio.findMany({
        where: {
          usuarioId: { in: membresias.map((m) => m.usuarioId) },
          edificio: { organizacionId: req.organizacionId },
        },
        select: { usuarioId: true, edificio: { select: { id: true, nombre: true } } },
      });
      const edificiosPorUsuario = new Map();
      for (const a of asignaciones) {
        if (!edificiosPorUsuario.has(a.usuarioId)) edificiosPorUsuario.set(a.usuarioId, []);
        edificiosPorUsuario.get(a.usuarioId).push(a.edificio);
      }

      return res.json(membresias.map((m) => serializarMiembro(m, edificiosPorUsuario)));
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST / — invita staff (Workflow A)
// ---------------------------------------------------------------------------
//
// Email nuevo    → Usuario SIN password + membresía + GestorEdificio + Invitacion
// Email existente→ solo membresía + GestorEdificio + Invitacion ("sumaste una
//                  organización"): mismo login, la password no se toca nunca.
//
// La membresía queda activa desde el alta (PRD-04-11 §4.3): quien ya tenía
// cuenta entra sin esperar la invitación; para el recién creado el link es lo
// que le da password. Aceptar la invitación es idempotente sobre estos vínculos.

router.post(
  '/',
  requireAuth,
  tenant,
  autorizar('staff', 'create', recursoStaff),
  validarBody(invitarStaffSchema),
  async (req, res, next) => {
    try {
      const { nombre, apellido, rol, edificioIds, reenviar } = req.body;
      const email = normalizarEmail(req.body.email);

      const validos = await edificiosDeLaOrg(prisma, req.organizacionId, edificioIds);
      if (validos.length !== edificioIds.length) {
        const invalidos = edificioIds.filter((id) => !validos.includes(id));
        return res.status(422).json(errorEdificioInvalido(invalidos));
      }

      const resultado = await prisma.$transaction(async (tx) => {
        await lockOrganizacion(tx, req.organizacionId);

        const existente = await tx.usuario.findUnique({ where: { email } });

        // Orden de los conflictos (PRD-04-11 §9: "409 INVITACION_PENDIENTE o,
        // SI YA ES MIEMBRO ACTIVO, 409 VINCULO_DUPLICADO"): la invitación
        // pendiente manda. Como el alta deja la membresía activa de entrada,
        // chequear el vínculo primero volvería INVITACION_PENDIENTE inalcanzable
        // y el admin no tendría forma de reenviarle el link a quien todavía no
        // entró — que es justo el caso frecuente.
        const pendiente = await buscarPendiente(tx, {
          email,
          organizacionId: req.organizacionId,
          tipo: 'STAFF',
        });
        if (pendiente && !reenviar) return { pendiente: true };

        // Sin invitación pendiente y ya miembro activo: la persona está
        // onboardeada, no hay nada que invitar. Cambiarle rol o edificios es el
        // PATCH.
        if (!pendiente && existente) {
          const membresia = await tx.organizacionUsuario.findUnique({
            where: {
              organizacionId_usuarioId: {
                organizacionId: req.organizacionId,
                usuarioId: existente.id,
              },
            },
          });
          if (membresia?.activo) return { duplicado: true };
        }

        // El Usuario nuevo nace sin password: la define al aceptar (S4-02).
        const persona =
          existente ??
          (await tx.usuario.create({ data: { email, nombre, apellido, passwordHash: null } }));

        const membresia = await tx.organizacionUsuario.upsert({
          where: {
            organizacionId_usuarioId: {
              organizacionId: req.organizacionId,
              usuarioId: persona.id,
            },
          },
          create: { organizacionId: req.organizacionId, usuarioId: persona.id, rol },
          update: { rol, activo: true },
        });

        await reemplazarEdificiosDelGestor(tx, {
          organizacionId: req.organizacionId,
          usuarioId: persona.id,
          edificioIds: rol === 'GESTOR' ? validos : [],
        });

        const invitacion = await crearOReenviarInvitacion(tx, {
          email,
          organizacionId: req.organizacionId,
          tipo: 'STAFF',
          payload: { rol, nombre, apellido, edificioIds: rol === 'GESTOR' ? validos : [] },
          invitadoPorId: req.user.id,
          // S4-11 (SEC-02): solo la invitación que creó la identidad puede
          // definir su password. `existente` se leyó antes del create.
          creaUsuario: !existente,
          pendiente,
        });

        return { persona, membresia, invitacion, reenviada: Boolean(pendiente) };
      });

      if (resultado.duplicado) {
        return res.status(409).json({
          error: {
            code: 'VINCULO_DUPLICADO',
            message: 'Esa persona ya es miembro activo de tu organización',
          },
        });
      }
      if (resultado.pendiente) {
        return res.status(409).json(errorInvitacionPendiente());
      }

      const { persona, membresia, invitacion, reenviada } = resultado;
      const invitacionUrl = construirInvitacionUrl(invitacion.token);

      // Fuera de la transacción y sin await bloqueante del resultado: el alta
      // ya está committeada, la notificación es best-effort (stub en el MVP).
      const notificacion = await notificarInvitacion({
        email,
        tipo: 'STAFF',
        invitacionUrl,
        organizacion: { id: req.organizacionId },
      });

      // 201 en alta, 200 en reenvío: no se creó un recurso nuevo.
      return res.status(reenviada ? 200 : 201).json({
        usuario: {
          id: persona.id,
          email: persona.email,
          nombre: persona.nombre,
          apellido: persona.apellido,
          cuentaActivada: persona.passwordHash !== null,
        },
        membresia: { id: membresia.id, rol: membresia.rol, activo: membresia.activo },
        edificios: membresia.rol === 'GESTOR' ? validos : [],
        invitacion: { id: invitacion.id, expiraAt: invitacion.expiraAt, reenviada },
        invitacionUrl,
        emailEnviado: notificacion.enviado,
      });
    } catch (err) {
      // Carrera contra otro POST con el mismo email (unique global de Usuario o
      // índice parcial de invitación pendiente).
      if (err.code === 'P2002') {
        return res.status(409).json(errorInvitacionPendiente());
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /:id — rol, edificios del gestor, activar/desactivar
// ---------------------------------------------------------------------------

router.patch(
  '/:id',
  requireAuth,
  tenant,
  autorizar('staff', 'update', recursoStaff),
  validarBody(editarStaffSchema),
  async (req, res, next) => {
    try {
      const usuarioId = req.params.id;
      const { rol, edificioIds, activo } = req.body;

      if (edificioIds !== undefined) {
        const validos = await edificiosDeLaOrg(prisma, req.organizacionId, edificioIds);
        if (validos.length !== edificioIds.length) {
          const invalidos = edificioIds.filter((id) => !validos.includes(id));
          return res.status(422).json(errorEdificioInvalido(invalidos));
        }
      }

      const resultado = await prisma.$transaction(async (tx) => {
        await lockOrganizacion(tx, req.organizacionId);

        const membresia = await tx.organizacionUsuario.findUnique({
          where: {
            organizacionId_usuarioId: { organizacionId: req.organizacionId, usuarioId },
          },
        });
        if (!membresia) return { noExiste: true };

        const rolFinal = rol ?? membresia.rol;
        const activoFinal = activo ?? membresia.activo;

        // Un ORG_ADMIN deja de serlo si lo degradan o lo desactivan. Si es el
        // último activo, la organización se quedaría sin nadie que administre
        // usuarios (§9) → 422.
        const pierdeAdmin =
          membresia.rol === 'ORG_ADMIN' &&
          membresia.activo &&
          (rolFinal !== 'ORG_ADMIN' || !activoFinal);
        if (pierdeAdmin) {
          // S4-11 (review S1): solo cuentan los org_admin OPERABLES. Una
          // membresía activa de alguien que todavía no activó su cuenta
          // (`passwordHash NULL`) o que está dado de baja no puede loguear, así
          // que dejarla "cubrir" el guard deja la organización sin nadie que la
          // administre — y sin envío de email la recuperación depende de que
          // alguien haya guardado el link de la invitación.
          const otros = await tx.organizacionUsuario.count({
            where: {
              organizacionId: req.organizacionId,
              rol: 'ORG_ADMIN',
              activo: true,
              usuarioId: { not: usuarioId },
              usuario: { passwordHash: { not: null }, activo: true, deletedAt: null },
            },
          });
          if (otros === 0) return { ultimoAdmin: true };
        }

        // Un ORG_ADMIN administra toda la org: sus asignaciones por edificio no
        // significan nada, así que al promoverlo se limpian.
        const nuevosEdificios =
          rolFinal === 'ORG_ADMIN' ? [] : edificioIds ?? null;
        if (nuevosEdificios !== null) {
          await reemplazarEdificiosDelGestor(tx, {
            organizacionId: req.organizacionId,
            usuarioId,
            edificioIds: nuevosEdificios,
          });
        }

        const actualizada = await tx.organizacionUsuario.update({
          where: { id: membresia.id },
          data: { rol: rolFinal, activo: activoFinal },
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                nombre: true,
                apellido: true,
                telefono: true,
                activo: true,
                passwordHash: true,
              },
            },
          },
        });

        const asignaciones = await tx.gestorEdificio.findMany({
          where: { usuarioId, edificio: { organizacionId: req.organizacionId } },
          select: { edificio: { select: { id: true, nombre: true } } },
        });

        return { membresia: actualizada, edificios: asignaciones.map((a) => a.edificio) };
      });

      if (resultado.noExiste) {
        return res.status(404).json({
          error: {
            code: 'USUARIO_NO_ENCONTRADO',
            message: 'Esa persona no es miembro de tu organización',
          },
        });
      }
      if (resultado.ultimoAdmin) {
        return res.status(422).json({
          error: {
            code: 'ULTIMO_ORG_ADMIN',
            message:
              'La organización debe conservar al menos un org_admin activo: asigná otro antes de este cambio',
          },
        });
      }

      const edificiosPorUsuario = new Map([
        [resultado.membresia.usuarioId, resultado.edificios],
      ]);
      return res.json(serializarMiembro(resultado.membresia, edificiosPorUsuario));
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
