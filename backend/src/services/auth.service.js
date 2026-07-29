// src/services/auth.service.js — Emisión y rotación de tokens
// Spec: PRD-08-05 Seguridad §1 (JWT + Refresh Tokens), PRD-04-11 §2 (identidad global)
//
// - Access token: JWT de 15 min con claims { sub, email, org_id, roles,
//   edificios_asignados }. `org_id` es el tenant raíz (PRD-02-01 §6.2).
// - Refresh token: UUID opaco en Redis (`refresh:{uuid}` → userId) con TTL de
//   7 días. ROTA en cada uso: el anterior se invalida (PRD-08-05 §1.2).
//
// S4-01: el Usuario es global (sin `organizacionId` ni `rol`). La organización
// activa y los roles del token se DERIVAN de la membresía activa
// (`OrganizacionUsuario.activo`). La forma de los claims no cambió.

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import prisma from '../db/prisma.js';
import redis from '../config/redis.js';
import { config } from '../config/index.js';

// Rol de Prisma (enum MAYÚSCULA) → rol canónico del dominio (minúscula),
// mismo nombre que usan las políticas Cerbos (PRD-05-04 §2.1).
export const rolCanonico = (rol) => rol.toLowerCase();

// Email como identificador global: siempre lowercase (PRD-04-11 §7).
export const normalizarEmail = (email) => email.trim().toLowerCase();

// Edificios asignados a un gestor (tabla gestor_edificios) DENTRO de una
// organización. El scope importa: con identidad global la misma persona puede
// gestionar edificios en varias organizaciones, y el claim
// `edificios_asignados` describe solo la org activa de la sesión (S4-05).
// Solo aplica al rol GESTOR; para el resto devuelve siempre [].
async function obtenerEdificiosAsignados(usuarioId, organizacionId) {
  const asignaciones = await prisma.gestorEdificio.findMany({
    where: { usuarioId, edificio: { organizacionId } },
    select: { edificioId: true },
  });
  return asignaciones.map((a) => a.edificioId);
}

// Membresías activas del usuario, para el selector de organización del header
// (PRD-04-11 §4.6). Van en el DTO de usuario de todas las respuestas de auth
// así el front sabe si hay algo entre lo que elegir sin un endpoint extra.
export async function membresiasActivas(usuarioId) {
  const membresias = await prisma.organizacionUsuario.findMany({
    where: { usuarioId, activo: true },
    select: { rol: true, organizacion: { select: { id: true, nombre: true } } },
    orderBy: [{ organizacion: { nombre: 'asc' } }, { organizacionId: 'asc' }],
  });
  return membresias.map((m) => ({
    id: m.organizacion.id,
    nombre: m.organizacion.nombre,
    rol: rolCanonico(m.rol),
  }));
}

// Membresía activa del usuario = organización activa de la sesión.
//
// DECISIÓN (multi-membresía, S4-01): con N membresías activas se elige la de
// la organización PRIMERA ALFABÉTICAMENTE (desempate por `organizacionId`).
// Es determinística y estable —no depende de timestamps de creación, que el
// seed genera iguales con `createMany`— y predecible para el usuario, que ve
// las orgs ordenadas por nombre. Cambiar de contexto sin re-login es S4-05
// (`POST /api/auth/cambiar-organizacion`).
export function membresiaActiva(usuarioId) {
  return prisma.organizacionUsuario.findFirst({
    where: { usuarioId, activo: true },
    orderBy: [{ organizacion: { nombre: 'asc' } }, { organizacionId: 'asc' }],
  });
}

// Roles derivados de los vínculos a unidades VIGENTES (`fechaFin: null`).
// Sin scope de organización a propósito: con identidad global la misma persona
// es propietaria en varios consorcios y el portal del residente (S5) agrega por
// `usuarioId`, no por organización.
async function rolesDeResidente(usuarioId) {
  const vinculos = await prisma.unidadUsuario.findMany({
    where: { usuarioId, fechaFin: null },
    select: { esPropietario: true, esInquilino: true },
  });
  const roles = [];
  if (vinculos.some((v) => v.esPropietario)) roles.push('propietario');
  if (vinculos.some((v) => v.esInquilino)) roles.push('inquilino');
  return roles;
}

// Contexto de acceso derivado de los vínculos del usuario global:
//   { organizacionId, roles, edificiosAsignados }
//
// Staff (con membresía activa): org activa + su rol de organización.
// Residente puro (sin membresía): NO tiene organización activa (PRD-04-11 §5.5,
// el portal agrega por `usuarioId`). Sin vínculos ni membresía: roles [] →
// Cerbos fail-closed.
//
// S4-11 (SEC-03): los roles son la UNIÓN de la membresía y de los vínculos de
// unidad, no una alternativa excluyente. Antes, una membresía staff tapaba los
// roles de residente, así que a un propietario le alcanzaba con que CUALQUIER
// organización lo invitara como staff para que perdiera `propietario` de su
// sesión — sin consentimiento y sin enterarse.
export async function resolverContextoAcceso(usuario) {
  const membresia = await membresiaActiva(usuario.id);
  if (membresia) return contextoParaMembresia(usuario, membresia);

  return { organizacionId: null, roles: await rolesDeResidente(usuario.id), edificiosAsignados: [] };
}

// Contexto de acceso de UNA membresía concreta. Es lo que usa S4-05 para
// re-emitir la sesión en la organización elegida: los claims salen de esa
// membresía y no de la que el usuario tenía activa. Los roles de residente
// viajan también acá, así que el switch de organización y el refresh conservan
// la unión (SEC-03).
export async function contextoParaMembresia(usuario, membresia) {
  const esGestor = membresia.rol === 'GESTOR';
  return {
    organizacionId: membresia.organizacionId,
    roles: [rolCanonico(membresia.rol), ...(await rolesDeResidente(usuario.id))],
    edificiosAsignados: esGestor
      ? await obtenerEdificiosAsignados(usuario.id, membresia.organizacionId)
      : [],
  };
}

// Shape público del usuario para las respuestas de auth (contrato S1).
// `edificiosAsignados` solo se expone a gestores; `organizaciones` son las
// membresías activas entre las que puede cambiar (S4-05).
export function serializarUsuario(usuario, contexto) {
  const dto = {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    roles: contexto.roles,
    organizacionId: contexto.organizacionId,
  };
  if (contexto.roles.includes('gestor')) {
    dto.edificiosAsignados = contexto.edificiosAsignados;
  }
  if (contexto.organizaciones) {
    dto.organizaciones = contexto.organizaciones;
  }
  return dto;
}

// Genera el par access/refresh y persiste el refresh en Redis.
export async function generarTokens(usuario, contexto) {
  const accessToken = jwt.sign(
    {
      sub: usuario.id,
      email: usuario.email,
      org_id: contexto.organizacionId,
      roles: contexto.roles,
      edificios_asignados: contexto.edificiosAsignados,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTokenTtl }
  );

  // El refresh guarda la organización activa además del usuario: sin eso, el
  // primer `POST /refresh` después de un cambio de organización (S4-05)
  // devolvería al usuario a su org por defecto (la primera alfabética), y el
  // cambio de contexto no sobreviviría a los 15 min del access token.
  const refreshToken = randomUUID();
  await redis.setex(
    `refresh:${refreshToken}`,
    config.jwt.refreshTokenTtlSeconds,
    JSON.stringify({ usuarioId: usuario.id, organizacionId: contexto.organizacionId })
  );

  return { accessToken, refreshToken };
}

// Sesión guardada en Redis. Tolera el formato viejo (solo el userId como texto
// plano) para no invalidar los refresh emitidos antes de S4-05.
function parsearSesionGuardada(valor) {
  try {
    const datos = JSON.parse(valor);
    if (datos && typeof datos === 'object' && datos.usuarioId) return datos;
  } catch {
    // formato viejo
  }
  return { usuarioId: valor, organizacionId: null };
}

// Rota el refresh token: invalida el anterior y emite un par nuevo.
// Devuelve null si el refresh token no existe o ya fue rotado (→ 401).
export async function renovarTokens(refreshToken) {
  const clave = `refresh:${refreshToken}`;
  const guardado = await redis.getdel(clave);
  if (!guardado) return null;

  const { usuarioId, organizacionId } = parsearSesionGuardada(guardado);

  // Se recargan usuario y contexto desde DB para que el nuevo access token
  // refleje cambios de membresía/rol/edificios desde el último login.
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, activo: true, deletedAt: null },
  });
  if (!usuario) return null;

  // Se conserva la organización activa de la sesión, revalidando la membresía:
  // si fue desactivada o borrada, se cae al contexto por defecto (el resto del
  // acceso lo corta tenant.middleware con 403 SIN_MEMBRESIA).
  const membresia = organizacionId
    ? await prisma.organizacionUsuario.findUnique({
        where: { organizacionId_usuarioId: { organizacionId, usuarioId } },
      })
    : null;

  const contexto =
    membresia && membresia.activo
      ? await contextoParaMembresia(usuario, membresia)
      : await resolverContextoAcceso(usuario);

  const tokens = await generarTokens(usuario, contexto);
  return { ...tokens, usuario, contexto };
}

// Revoca un refresh token (logout). Idempotente: no falla si ya no existe.
export async function revocarRefreshToken(refreshToken) {
  await redis.del(`refresh:${refreshToken}`);
}

// Helper de login: resuelve el contexto de acceso y emite tokens.
export async function emitirSesion(usuario) {
  const contexto = await resolverContextoAcceso(usuario);
  return emitirSesionConContexto(usuario, contexto);
}

// Emite la sesión para un contexto ya resuelto (S4-05: la org elegida). Suma al
// DTO las membresías activas para el selector del header; el JWT no las lleva
// (los claims no cambian de forma: sub, email, org_id, roles, edificios_asignados).
export async function emitirSesionConContexto(usuario, contexto) {
  const tokens = await generarTokens(usuario, contexto);
  const organizaciones = await membresiasActivas(usuario.id);
  return {
    ...tokens,
    user: serializarUsuario(usuario, { ...contexto, organizaciones }),
  };
}
