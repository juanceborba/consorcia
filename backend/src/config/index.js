// src/config/index.js — Configuración central del backend
// Spec: PRD-08-05 Seguridad §1 (JWT), PRD-02-03 Infraestructura Docker (envs)
// Lee una sola vez las variables de entorno y exporta constantes tipadas.

export const config = {
  port: process.env.PORT || 3000,

  jwt: {
    secret: process.env.JWT_SECRET,
    // Access token de corta vida (PRD-08-05 §1.1)
    accessTokenTtl: '15m',
    // Refresh token opaco en Redis, 7 días (en segundos para SETEX)
    refreshTokenTtlSeconds: 7 * 24 * 3600,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
  },

  cerbos: {
    // PDP Cerbos por HTTP (check resource)
    baseUrl: `http://${process.env.CERBOS_HOST || 'localhost'}:${process.env.CERBOS_PORT || 3592}`,
    // Timeout defensivo: si el PDP no responde, el middleware falla cerrado (403)
    timeoutMs: 3000,
  },
};
