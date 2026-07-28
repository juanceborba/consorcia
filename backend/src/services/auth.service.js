// src/services/auth.service.js — Emisión y rotación de tokens
// Spec: PRD-08-05 Seguridad §1 (JWT + Refresh Tokens)
//
// - Access token: JWT de 15 min con claims { sub, email, org_id, roles,
//   edificios_asignados }. `org_id` es el tenant raíz (PRD-02-01 §6.2).
// - Refresh token: UUID opaco en Redis (`refresh:{uuid}` → userId) con TTL de
//   7 días. ROTA en cada uso: el anterior se invalida (PRD-08-05 §1.2).

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import prisma from '../db/prisma.js';
import redis from '../config/redis.js';
import { config } from '../config/index.js';

// Rol de Prisma (enum MAYÚSCULA) → rol canónico del dominio (minúscula),
// mismo nombre que usan las políticas Cerbos (PRD-05-04 §2.1).
export const rolCanonico = (rol) => rol.toLowerCase();

// Edificios asignados a un gestor (tabla gestor_edificios). Solo aplica al
// rol GESTOR; para el resto devuelve siempre [].
async function obtenerEdificiosAsignados(usuario) {
  if (usuario.rol !== 'GESTOR') return [];
  const asignaciones = await prisma.gestorEdificio.findMany({
    where: { usuarioId: usuario.id },
    select: { edificioId: true },
  });
  return asignaciones.map((a) => a.edificioId);
}

// Shape público del usuario para las respuestas de auth (contrato S1).
// `edificiosAsignados` solo se expone a gestores.
export function serializarUsuario(usuario, edificiosAsignados) {
  const dto = {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    roles: [rolCanonico(usuario.rol)],
    organizacionId: usuario.organizacionId,
  };
  if (usuario.rol === 'GESTOR') dto.edificiosAsignados = edificiosAsignados;
  return dto;
}

// Genera el par access/refresh y persiste el refresh en Redis.
export async function generarTokens(usuario, edificiosAsignados = []) {
  const accessToken = jwt.sign(
    {
      sub: usuario.id,
      email: usuario.email,
      org_id: usuario.organizacionId,
      roles: [rolCanonico(usuario.rol)],
      edificios_asignados: edificiosAsignados,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTokenTtl }
  );

  const refreshToken = randomUUID();
  await redis.setex(
    `refresh:${refreshToken}`,
    config.jwt.refreshTokenTtlSeconds,
    usuario.id
  );

  return { accessToken, refreshToken };
}

// Rota el refresh token: invalida el anterior y emite un par nuevo.
// Devuelve null si el refresh token no existe o ya fue rotado (→ 401).
export async function renovarTokens(refreshToken) {
  const clave = `refresh:${refreshToken}`;
  const usuarioId = await redis.getdel(clave);
  if (!usuarioId) return null;

  // Se recargan usuario y asignaciones desde DB para que el nuevo access
  // token refleje cambios de rol/edificios desde el último login.
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, activo: true, deletedAt: null },
  });
  if (!usuario) return null;

  const edificiosAsignados = await obtenerEdificiosAsignados(usuario);
  const tokens = await generarTokens(usuario, edificiosAsignados);
  return { ...tokens, usuario, edificiosAsignados };
}

// Revoca un refresh token (logout). Idempotente: no falla si ya no existe.
export async function revocarRefreshToken(refreshToken) {
  await redis.del(`refresh:${refreshToken}`);
}

// Helper de login: resuelve usuario + asignaciones y emite tokens.
export async function emitirSesion(usuario) {
  const edificiosAsignados = await obtenerEdificiosAsignados(usuario);
  const tokens = await generarTokens(usuario, edificiosAsignados);
  return {
    ...tokens,
    user: serializarUsuario(usuario, edificiosAsignados),
  };
}
