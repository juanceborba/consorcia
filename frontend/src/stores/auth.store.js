// frontend/src/stores/auth.store.js — ConsorcIA
// Store de autenticación (S1-11): usuario + tokens JWT, persistidos en localStorage.
// Usa fetch directo (no api.js) para no crear dependencia circular: api.js importa este store.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/lib/query-client';

const API_URL = import.meta.env.VITE_API_URL;

// Array vacío ESTABLE para selectores `s.user?.roles ?? SIN_ROLES`: sin él,
// cada snapshot devuelve un [] nuevo y useSyncExternalStore entra en loop
// infinito ("Maximum update depth exceeded") cuando user es null (p. ej.
// durante el logout, antes de que RequireAuth redirija a /login).
export const SIN_ROLES = [];

// Llama a un endpoint de /api/auth y devuelve el JSON, o lanza Error con el
// message del contrato de errores ({ error: { code, message } }).
async function authFetch(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? 'Error de autenticación');
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export const useAuthStore = create()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,

      // POST /api/auth/login → guarda usuario y tokens. Lanza Error si falla.
      async login(email, password) {
        const data = await authFetch('/api/auth/login', { email, password });
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
      },

      // POST /api/auth/logout (best effort), limpia la sesión local y el
      // cache de TanStack Query (S2-04: datos del tenant no sobreviven al logout).
      async logout() {
        const { refreshToken } = get();
        if (refreshToken) {
          try {
            await authFetch('/api/auth/logout', { refreshToken });
          } catch {
            // El logout remoto es best effort: la sesión local se limpia igual.
          }
        }
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },

      // POST /api/auth/refresh → renueva los tokens. Devuelve true si funcionó;
      // si falla, limpia la sesión (RequireAuth redirige a /login).
      async refresh() {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const data = await authFetch('/api/auth/refresh', { refreshToken });
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        } catch {
          set({ user: null, accessToken: null, refreshToken: null });
          return false;
        }
      },
    }),
    { name: 'consorcia-auth' },
  ),
);
