// src/routes/auth.routes.js — Autenticación (S1-04)
// Spec: PRD-08-05 Seguridad §1. Contrato de API del sprint S1:
//   POST /api/auth/register  → 201 { accessToken, refreshToken, user }
//   POST /api/auth/login     → 200 { accessToken, refreshToken, user }
//   POST /api/auth/refresh   → 200 { accessToken, refreshToken } (rota el refresh)
//   POST /api/auth/logout    → 204

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { validarBody } from '../middleware/validation.middleware.js';
import {
  emitirSesion,
  normalizarEmail,
  renovarTokens,
  revocarRefreshToken,
} from '../services/auth.service.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email('email inválido'),
  password: z.string().min(8, 'la password debe tener al menos 8 caracteres'),
  nombre: z.string().min(1, 'nombre requerido'),
  apellido: z.string().default(''),
  organizacion: z.object({
    nombre: z.string().min(1, 'nombre de organización requerido'),
    cuit: z
      .string()
      .regex(/^\d{2}-\d{8}-\d$/, 'CUIT con formato 30-12345678-9'),
    matriculaRPA: z.string().min(1, 'matrícula RPA requerida (Ley 941 CABA)'),
  }),
});

const loginSchema = z.object({
  email: z.string().email('email inválido'),
  password: z.string().min(1, 'password requerida'),
});

const refreshSchema = z.object({
  refreshToken: z.string().uuid('refreshToken inválido'),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken requerido'),
});

// ---------------------------------------------------------------------------
// POST /register — crea organización (tenant) + su org_admin y loguea
// ---------------------------------------------------------------------------

router.post('/register', validarBody(registerSchema), async (req, res, next) => {
  try {
    const { password, nombre, apellido, organizacion } = req.body;
    const email = normalizarEmail(req.body.email);

    // Identidad global (S4-01): el email identifica a la persona en todo el
    // sistema. Si ya existe, no se crea una segunda cuenta — se sugiere login
    // (para sumar una organización, el alta es por invitación staff, S4-03).
    const emailEnUso = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emailEnUso) {
      return res.status(422).json({
        error: {
          code: 'EMAIL_YA_REGISTRADO',
          message: 'Ese email ya tiene una cuenta; iniciá sesión con tu password',
        },
      });
    }

    const cuitEnUso = await prisma.organizacion.findUnique({
      where: { cuit: organizacion.cuit },
      select: { id: true },
    });
    if (cuitEnUso) {
      return res.status(422).json({
        error: { code: 'CUIT_YA_REGISTRADO', message: 'Ya existe una organización con ese CUIT' },
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Org + usuario + membresía en una transacción: nunca queda una org sin
    // su org_admin ni un usuario sin membresía (de la que derivan sus claims).
    const usuario = await prisma.$transaction(async (tx) => {
      const org = await tx.organizacion.create({ data: organizacion });
      const creado = await tx.usuario.create({
        data: { email, passwordHash, nombre, apellido },
      });
      await tx.organizacionUsuario.create({
        data: { organizacionId: org.id, usuarioId: creado.id, rol: 'ORG_ADMIN' },
      });
      return creado;
    });

    const sesion = await emitirSesion(usuario);
    return res.status(201).json(sesion);
  } catch (err) {
    // Carrera contra otro register con el mismo email (unique global)
    if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
      return res.status(422).json({
        error: {
          code: 'EMAIL_YA_REGISTRADO',
          message: 'Ese email ya tiene una cuenta; iniciá sesión con tu password',
        },
      });
    }
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

router.post('/login', validarBody(loginSchema), async (req, res, next) => {
  try {
    const { password } = req.body;
    const email = normalizarEmail(req.body.email);

    // Identidad global (S4-01): el email resuelve a un único Usuario. La
    // organización activa se deriva de su membresía activa (auth.service).
    const usuario = await prisma.usuario.findFirst({
      where: { email, activo: true, deletedAt: null },
    });

    // Mismo 401 para usuario inexistente y password incorrecta (no oráculo)
    const passwordOk = usuario && (await bcrypt.compare(password, usuario.passwordHash));
    if (!passwordOk) {
      return res.status(401).json({
        error: { code: 'CREDENCIALES_INVALIDAS', message: 'Email o password incorrectos' },
      });
    }

    const sesion = await emitirSesion(usuario);
    return res.status(200).json(sesion);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /refresh — rota el refresh token (el anterior queda invalidado)
// ---------------------------------------------------------------------------

router.post('/refresh', validarBody(refreshSchema), async (req, res, next) => {
  try {
    const renovada = await renovarTokens(req.body.refreshToken);
    if (!renovada) {
      return res.status(401).json({
        error: { code: 'REFRESH_INVALIDO', message: 'Refresh token inválido o expirado' },
      });
    }
    return res.status(200).json({
      accessToken: renovada.accessToken,
      refreshToken: renovada.refreshToken,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /logout — revoca el refresh token (idempotente)
// ---------------------------------------------------------------------------

router.post('/logout', validarBody(logoutSchema), async (req, res, next) => {
  try {
    await revocarRefreshToken(req.body.refreshToken);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;
