// src/middleware/error.middleware.js — Handler central de errores
// Formato de error del contrato de API: { error: { code, message } }.
// Express 5 propaga acá los errores lanzados en handlers async.

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error('Error no controlado:', err);
  res.status(500).json({
    error: { code: 'ERROR_INTERNO', message: 'Error interno del servidor' },
  });
}

// 404 para cualquier ruta /api/* no matcheada por los routers
export function rutaNoEncontrada(req, res) {
  res.status(404).json({
    error: { code: 'RUTA_NO_ENCONTRADA', message: 'La ruta solicitada no existe' },
  });
}
