// src/middleware/rbac.middleware.js — Autorización vía Cerbos PDP (HTTP)
// Spec: PRD-05-04 Cerbos RBAC §4.1 / §3 (políticas), PRD-02-02 §10
//
// Consulta `POST {cerbos}/api/check/resources` (endpoint vigente en Cerbos
// 0.54; el singular `/api/check/resource` no existe en esta versión)
// construyendo:
//   - principal: desde req.user (JWT ya validado) con attrs
//     organizacion_id / edificios_asignados (mismos nombres que usan las
//     condiciones de las policies YAML).
//   - resource: kind fijo + attrs que resuelve cada ruta (p. ej. el edificio
//     que tenant.validarEdificio dejó en req.edificio).
//
// FAIL-CLOSED: cualquier error (PDP caído, timeout, respuesta ambigua o
// EFFECT_DENY) se traduce en 403.

import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

export function autorizar(kind, action, resolverRecurso) {
  return async (req, res, next) => {
    try {
      const recurso = resolverRecurso(req);

      const respuesta = await fetch(`${config.cerbos.baseUrl}/api/check/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.cerbos.timeoutMs),
        body: JSON.stringify({
          requestId: randomUUID(),
          principal: {
            id: req.user.id,
            roles: req.user.roles,
            attr: {
              organizacion_id: req.user.organizacionId,
              edificios_asignados: req.user.edificiosAsignados,
            },
          },
          resources: [
            {
              resource: { kind, id: recurso.id, attr: recurso.attr },
              actions: [action],
            },
          ],
        }),
      });

      const data = await respuesta.json().catch(() => null);
      const efecto = data?.results?.[0]?.actions?.[action];

      if (respuesta.ok && efecto === 'EFFECT_ALLOW') return next();

      // Denegado por política (o respuesta inesperada del PDP)
      if (respuesta.ok && efecto !== undefined) {
        return res.status(403).json({
          error: { code: 'ACCESO_DENEGADO', message: 'No tenés permiso para esta operación' },
        });
      }

      throw new Error(`Respuesta inválida de Cerbos (HTTP ${respuesta.status})`);
    } catch (err) {
      // PDP inalcanzable, timeout o payload inválido → denegar (fail-closed)
      console.error(`Cerbos no disponible para ${kind}:${action} —`, err.message);
      return res.status(403).json({
        error: { code: 'ACCESO_DENEGADO', message: 'No se pudo verificar la autorización' },
      });
    }
  };
}
