// src/middleware/auth.middleware.js — Validación de access token JWT
// Spec: PRD-08-05 Seguridad §1.2
// Valida el header `Authorization: Bearer <jwt>`, verifica firma y expiración
// y carga `req.user` con los claims normalizados (camelCase) que consumen
// tenant.middleware y rbac.middleware.

import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({
      error: { code: 'TOKEN_AUSENTE', message: 'Falta el header Authorization: Bearer <token>' },
    });
  }

  try {
    const claims = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: claims.sub,
      email: claims.email,
      organizacionId: claims.org_id,
      roles: claims.roles || [],
      edificiosAsignados: claims.edificios_asignados || [],
    };
    return next();
  } catch (err) {
    const expirado = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: {
        code: expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
        message: expirado
          ? 'El access token expiró; usar POST /api/auth/refresh'
          : 'Access token inválido',
      },
    });
  }
}
