// frontend/src/hooks/useOrganizacion.js — ConsorcIA
// Organización del usuario logueado (GET /api/organizaciones/me), para el
// header de AppLayout. S2-04: TanStack Query; si falla, devuelve null.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useOrganizacion() {
  const { data } = useQuery({
    queryKey: queryKeys.organizaciones.me(),
    queryFn: () => api.get('/api/organizaciones/me'),
    // El header muestra '…' si no hay dato: un error no es bloqueante.
    retry: false,
  });

  return { organizacion: data ?? null };
}
