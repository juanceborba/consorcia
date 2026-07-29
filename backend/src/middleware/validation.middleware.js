// src/middleware/validation.middleware.js — Validación de body con Zod
// Spec: PRD-02-02 Stack Tecnológico (validación con Zod), PRD-02-01 §6.1
// (capa 7: input validation). Devuelve 422 con el formato de error del
// contrato: { error: { code, message } }.

export function validarBody(schema) {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.body ?? {});
    if (!resultado.success) {
      const detalle = resultado.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      return res.status(422).json({
        error: { code: 'VALIDACION_FALLIDA', message: detalle },
      });
    }
    // Body sanitizado (sin claves extra) para los handlers
    req.body = resultado.data;
    return next();
  };
}

// Validación de query string (filtros y paginación de los listados, S3-12).
// El resultado va a `req.filtros`, no a `req.query`: en Express 5 `req.query`
// es un getter lazy sin setter y reasignarlo no persiste.
export function validarQuery(schema) {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.query ?? {});
    if (!resultado.success) {
      const detalle = resultado.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      return res.status(422).json({
        error: { code: 'VALIDACION_FALLIDA', message: detalle },
      });
    }
    req.filtros = resultado.data;
    return next();
  };
}
