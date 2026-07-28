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
