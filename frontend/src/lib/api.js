// frontend/src/lib/api.js — ConsorcIA
// Wrapper de fetch para la API (S1-11): inyecta el Bearer y, ante un 401,
// intenta un único refresh de token y reintenta la request original.
import { useAuthStore } from '@/stores/auth.store';

const API_URL = import.meta.env.VITE_API_URL;

// Error de API con status HTTP y code/message del contrato { error: { code, message } }.
//
// S3-09: `detalle` conserva el objeto `error` COMPLETO. Varios errores del
// contrato viajan con campos extra que la UI necesita para ofrecer la salida
// (`PERIODO_YA_LIQUIDADO` trae el `liquidacionId` de la que ocupa el período,
// `COEFICIENTES_NO_CUADRAN` trae `sumaActual` y `delta`). Perderlos obligaba a
// parsear el `message`, que es copy y puede cambiar.
export class ApiError extends Error {
  constructor(status, code, message, detalle = null) {
    super(message ?? 'Error inesperado');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detalle = detalle;
  }
}

async function request(path, { method = 'GET', body, reintentado = false } = {}) {
  const { accessToken } = useAuthStore.getState();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token vencido: un solo intento de refresh y se reintenta la request original.
  if (res.status === 401 && !reintentado) {
    const renovado = await useAuthStore.getState().refresh();
    if (renovado) return request(path, { method, body, reintentado: true });
    // Si el refresh falló, el store ya quedó limpio y RequireAuth manda a /login.
    throw new ApiError(401, 'UNAUTHORIZED', 'Sesión expirada, volvé a ingresar');
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code,
      data?.error?.message,
      data?.error ?? null,
    );
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  // PUT (reemplazo) lo usan proveedores y rubros (S3-12/13): su edición manda el
  // set completo de campos, a diferencia del PATCH parcial de las membresías.
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};
