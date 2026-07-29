// src/routes/invitaciones.routes.js — Activación por invitación (S4-02)
// Spec: PRD-04-11 Gestión de Usuarios e Identidad §2.3, §4, §5, §6.
//
//   GET  /api/invitaciones/:token          → 200 datos de la invitación (público)
//   POST /api/invitaciones/:token/aceptar  → 200 { accessToken, refreshToken, user }
//
// Ambos son PÚBLICOS: el invitado todavía no tiene sesión y el token del link
// es la única credencial. El token es de un solo uso y vence a los 7 días:
// expirada, usada o inexistente responden todas 410 `INVITACION_INVALIDA` (sin
// distinguir cuál, para no filtrar si un email/organización existe).
//
// S4-11 · REGLA DE DISEÑO (SEC-01/02/06, PRD-04-11 §6.3). En el MVP el link NO
// se envía por email: se le devuelve al invitador. El token, entonces, NO
// prueba posesión del buzón — lo posee quien invitó. De ahí la regla dura:
//
//   la aceptación NUNCA emite sesión ni fija password sobre un `Usuario`
//   preexistente; solo la invitación que CREÓ la identidad puede activarla.
//
// Casos y respuesta (tabla completa en PRD-04-11 §6.3):
//   identidad nueva / la creó esta invitación → 200 sesión (flujo feliz)
//   cuenta ya activada (passwordHash != null) → 200 { yaActivada: true }, sin tokens
//   sin activar y `creaUsuario = false`       → 409 ACTIVACION_NO_DISPONIBLE
//   membresía de esa org dada de baja         → 403 MEMBRESIA_DESACTIVADA
//   `Usuario` dado de baja global             → 403 CUENTA_DESACTIVADA
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

// La validez del link y el armado de la URL viven en el service compartido con
// los endpoints de alta (S4-03/04). Se re-exportan por compatibilidad con los
// importadores que ya apuntaban a esta ruta.
export {
  DIAS_VALIDEZ_INVITACION,
  calcularExpiracion,
} from '../services/invitaciones.service.js';

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
    const resultado = await prisma.$transaction(async (tx) => {
      // Consumo del token: `usadaAt` + condición `usadaAt: null` para que dos
      // aceptaciones simultáneas no apliquen los vínculos dos veces.
      const consumirToken = async () => {
        const consumida = await tx.invitacion.updateMany({
          where: { id: invitacion.id, usadaAt: null },
          data: { usadaAt: new Date() },
        });
        if (consumida.count === 0) {
          throw Object.assign(new Error('invitación ya consumida'), { esInvitacionUsada: true });
        }
      };

      const existente = await tx.usuario.findUnique({ where: { email } });

      // -----------------------------------------------------------------
      // Efectos sobre una identidad PREEXISTENTE: los tres cortes de S4-11.
      // -----------------------------------------------------------------
      if (existente) {
        // SEC-06: una baja lógica se revierte por acto administrativo, nunca
        // con una invitación que el propio atacante genera.
        if (!existente.activo || existente.deletedAt) {
          return { cuentaDesactivada: true };
        }

        // SEC-06: el accept tampoco reactiva una membresía dada de baja. Que
        // la persona vuelva al staff lo decide la organización (PATCH
        // /me/usuarios/:id con `activo: true`), no el link.
        if (invitacion.tipo === 'STAFF') {
          const membresia = await tx.organizacionUsuario.findUnique({
            where: {
              organizacionId_usuarioId: {
                organizacionId: invitacion.organizacionId,
                usuarioId: existente.id,
              },
            },
          });
          if (membresia && !membresia.activo) return { membresiaDesactivada: true };
        }

        // SEC-01: la cuenta ya está activada → la invitación no aporta
        // credenciales y NO puede emitir sesión (quien tiene el link es el
        // invitador). El vínculo ya se materializó en el alta, así que no se
        // pierde nada: se consume el token y la persona entra por /login.
        if (existente.passwordHash) {
          await consumirToken();
          return { yaActivada: true };
        }

        // SEC-02: cuenta sin activar que aprovisionó OTRA invitación. Fijarle
        // la password acá sería tomar una identidad de un tenant ajeno. No se
        // consume el token: la invitación de origen sigue siendo la válida.
        if (!invitacion.creaUsuario) return { noActivable: true };
      }

      // -----------------------------------------------------------------
      // Activación legítima: la identidad la creó esta invitación (o no
      // existía todavía). Acá sí se define la password y se emite sesión.
      // -----------------------------------------------------------------
      const persona = existente
        ? await tx.usuario.update({
            where: { id: existente.id },
            data: {
              passwordHash,
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
        // Membresía staff: si ya existía (la creó el alta), se le aplica el rol
        // invitado. Nunca se reactiva una desactivada: ese caso salió arriba.
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
          update: { rol: payload.rol },
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

      await consumirToken();
      return { persona };
    });

    if (resultado.cuentaDesactivada) {
      return res.status(403).json({
        error: {
          code: 'CUENTA_DESACTIVADA',
          message:
            'Esa cuenta está dada de baja. Reactivarla es un trámite con la administración: la invitación no la revive.',
        },
      });
    }
    if (resultado.membresiaDesactivada) {
      return res.status(403).json({
        error: {
          code: 'MEMBRESIA_DESACTIVADA',
          message:
            'Tu acceso a esta administración fue dado de baja. Pedile a la administración que lo reactive.',
        },
      });
    }
    if (resultado.noActivable) {
      return res.status(409).json({
        error: {
          code: 'ACTIVACION_NO_DISPONIBLE',
          message:
            'Tu cuenta ya existe y la creó otra administración: activala con el link que te mandaron ellos. Este link solo sumó tu vínculo con esta organización.',
        },
      });
    }
    // Cuenta ya activada: la invitación no aporta credenciales, así que no se
    // emite sesión (SEC-01). El vínculo ya está creado; se entra por /login.
    if (resultado.yaActivada) {
      return res.status(200).json({ yaActivada: true });
    }

    const sesion = await emitirSesion(resultado.persona);
    return res.status(200).json(sesion);
  } catch (err) {
    if (err.esInvitacionUsada) return invitacionInvalida(res);
    return next(err);
  }
});

export default router;
