// src/routes/invitaciones.routes.js — Activación por invitación (S4-02)
// Spec: PRD-04-11 Gestión de Usuarios e Identidad §2.3, §4, §5, §6.
//
//   GET  /api/invitaciones/:token          → 200 datos de la invitación (público)
//   POST /api/invitaciones/:token/aceptar  → 200 { accessToken, refreshToken, user }
//
// Ambos son PÚBLICOS: el invitado todavía no tiene sesión y el token del link
// es la única credencial (prueba de posesión del buzón, PRD-04-11 §7). El
// token es de un solo uso y vence a los 7 días: expirada, usada o inexistente
// responden todas 410 `INVITACION_INVALIDA` (sin distinguir cuál, para no
// filtrar si un email/organización existe).
//
// Los endpoints que CREAN invitaciones son de S4-03 (staff) y S4-04
// (residentes); acá solo se leen y se aceptan.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { validarBody } from '../middleware/validation.middleware.js';
import { emitirSesion, normalizarEmail } from '../services/auth.service.js';

const router = Router();

// Días de validez del link (PRD-04-11 §2.3). Exportado para que los endpoints
// de alta (S4-03/04) y los tests usen la misma fuente.
export const DIAS_VALIDEZ_INVITACION = 7;

export function calcularExpiracion(desde = new Date()) {
  return new Date(desde.getTime() + DIAS_VALIDEZ_INVITACION * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const aceptarSchema = z
  .object({
    password: z.string().min(8, 'la password debe tener al menos 8 caracteres'),
    confirmacion: z.string().optional(),
  })
  .refine((d) => d.confirmacion === undefined || d.confirmacion === d.password, {
    path: ['confirmacion'],
    message: 'la confirmación no coincide con la password',
  });

// Payloads que dejan S4-03 / S4-04. Se validan al aceptar (defensa en
// profundidad: el payload es Json libre en la DB).
const payloadStaffSchema = z.object({
  rol: z.enum(['ORG_ADMIN', 'GESTOR']),
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  edificioIds: z.array(z.string().uuid()).default([]),
});

const payloadResidenteSchema = z.object({
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  unidadId: z.string().uuid(),
  esPropietario: z.boolean().default(false),
  esInquilino: z.boolean().default(false),
  fechaInicio: z.coerce.date().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const invitacionInvalida = (res) =>
  res.status(410).json({
    error: {
      code: 'INVITACION_INVALIDA',
      message: 'La invitación no existe, ya fue usada o venció. Pedí una nueva a tu administración.',
    },
  });

// Enmascara el email para la pantalla pública: no se muestra completo porque
// el link puede terminar en manos de un tercero (Ley 25.326: minimización).
//   "juan.perez@demo.com" → "j***@demo.com"
export function enmascararEmail(email) {
  const [local, dominio] = email.split('@');
  if (!dominio) return '***';
  return `${local.slice(0, 1)}***@${dominio}`;
}

// Busca la invitación por token y valida que siga siendo usable.
// Devuelve null si no existe, ya fue usada o venció.
async function buscarInvitacionVigente(token) {
  // El token es un UUID: cualquier otra cosa no puede existir en la DB (y
  // Prisma no falla por formato porque la columna es texto).
  if (typeof token !== 'string' || token.length > 64) return null;

  const invitacion = await prisma.invitacion.findUnique({
    where: { token },
    include: { organizacion: { select: { id: true, nombre: true } } },
  });

  if (!invitacion) return null;
  if (invitacion.usadaAt) return null;
  if (invitacion.expiraAt.getTime() <= Date.now()) return null;
  return invitacion;
}

// ---------------------------------------------------------------------------
// GET /:token — datos de la invitación para la pantalla de aceptación
// ---------------------------------------------------------------------------

router.get('/:token', async (req, res, next) => {
  try {
    const invitacion = await buscarInvitacionVigente(req.params.token);
    if (!invitacion) return invitacionInvalida(res);

    const payload = invitacion.payload ?? {};
    return res.status(200).json({
      email: enmascararEmail(invitacion.email),
      tipo: invitacion.tipo,
      organizacion: invitacion.organizacion,
      nombre: payload.nombre ?? null,
      apellido: payload.apellido ?? null,
      expiraAt: invitacion.expiraAt,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:token/aceptar — define la password, materializa los vínculos y loguea
// ---------------------------------------------------------------------------

router.post('/:token/aceptar', validarBody(aceptarSchema), async (req, res, next) => {
  try {
    const invitacion = await buscarInvitacionVigente(req.params.token);
    if (!invitacion) return invitacionInvalida(res);

    const email = normalizarEmail(invitacion.email);
    const parseado =
      invitacion.tipo === 'STAFF'
        ? payloadStaffSchema.safeParse(invitacion.payload ?? {})
        : payloadResidenteSchema.safeParse(invitacion.payload ?? {});

    if (!parseado.success) {
      return res.status(422).json({
        error: {
          code: 'INVITACION_INCONSISTENTE',
          message: 'La invitación tiene datos incompletos; pedí una nueva a tu administración',
        },
      });
    }
    const payload = parseado.data;

    // RESIDENTE: la unidad tiene que seguir existiendo y ser de la
    // organización que invitó (la invitación pudo quedar vieja).
    if (invitacion.tipo === 'RESIDENTE') {
      const unidad = await prisma.unidad.findFirst({
        where: { id: payload.unidadId, organizacionId: invitacion.organizacionId },
        select: { id: true },
      });
      if (!unidad) {
        return res.status(422).json({
          error: {
            code: 'INVITACION_INCONSISTENTE',
            message: 'La unidad de la invitación ya no existe; pedí una nueva a tu administración',
          },
        });
      }
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);

    // Todo o nada: si algo falla, la invitación NO queda consumida.
    const usuario = await prisma.$transaction(async (tx) => {
      const existente = await tx.usuario.findUnique({ where: { email } });

      // Si la persona ya tenía cuenta con password, NO se sobrescribe: la
      // invitación suma vínculos, no resetea credenciales ajenas (PRD-04-11
      // §4.3 "mismo login, sin password nuevo"). Solo se define cuando el
      // Usuario todavía no fue activado.
      const persona = existente
        ? await tx.usuario.update({
            where: { id: existente.id },
            data: {
              activo: true,
              deletedAt: null,
              ...(existente.passwordHash ? {} : { passwordHash }),
              nombre: existente.nombre || payload.nombre || '',
              apellido: existente.apellido || payload.apellido || '',
            },
          })
        : await tx.usuario.create({
            data: {
              email,
              passwordHash,
              nombre: payload.nombre ?? '',
              apellido: payload.apellido ?? '',
            },
          });

      if (invitacion.tipo === 'STAFF') {
        // Membresía staff: si ya existía (invitación de "sumaste una
        // organización"), se reactiva y se aplica el rol invitado.
        await tx.organizacionUsuario.upsert({
          where: {
            organizacionId_usuarioId: {
              organizacionId: invitacion.organizacionId,
              usuarioId: persona.id,
            },
          },
          create: {
            organizacionId: invitacion.organizacionId,
            usuarioId: persona.id,
            rol: payload.rol,
          },
          update: { rol: payload.rol, activo: true },
        });

        // Edificios permitidos del gestor (los de otras orgs no se tocan)
        if (payload.rol === 'GESTOR' && payload.edificioIds.length > 0) {
          const edificios = await tx.edificio.findMany({
            where: {
              id: { in: payload.edificioIds },
              organizacionId: invitacion.organizacionId,
            },
            select: { id: true },
          });
          await tx.gestorEdificio.createMany({
            data: edificios.map((e) => ({ usuarioId: persona.id, edificioId: e.id })),
            skipDuplicates: true,
          });
        }
      } else {
        // Vínculo con la unidad. Idempotente: si ya existía (p. ej. lo creó
        // S4-04 al invitar), se actualizan los flags y se reabre el vínculo.
        await tx.unidadUsuario.upsert({
          where: {
            organizacionId_unidadId_usuarioId: {
              organizacionId: invitacion.organizacionId,
              unidadId: payload.unidadId,
              usuarioId: persona.id,
            },
          },
          create: {
            organizacionId: invitacion.organizacionId,
            unidadId: payload.unidadId,
            usuarioId: persona.id,
            esPropietario: payload.esPropietario,
            esInquilino: payload.esInquilino,
            fechaInicio: payload.fechaInicio ?? new Date(),
          },
          update: {
            esPropietario: payload.esPropietario,
            esInquilino: payload.esInquilino,
            fechaFin: null,
          },
        });
      }

      // Consumo del token: `usadaAt` + condición `usadaAt: null` para que dos
      // aceptaciones simultáneas no apliquen los vínculos dos veces.
      const consumida = await tx.invitacion.updateMany({
        where: { id: invitacion.id, usadaAt: null },
        data: { usadaAt: new Date() },
      });
      if (consumida.count === 0) {
        throw Object.assign(new Error('invitación ya consumida'), { esInvitacionUsada: true });
      }

      return persona;
    });

    const sesion = await emitirSesion(usuario);
    return res.status(200).json(sesion);
  } catch (err) {
    if (err.esInvitacionUsada) return invitacionInvalida(res);
    return next(err);
  }
});

export default router;
