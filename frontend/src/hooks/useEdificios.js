// frontend/src/hooks/useEdificios.js — ConsorcIA
// Hook compartido: edificios visibles para el usuario (GET /api/edificios).
// Lo usan el selector del header (AppLayout) y el listado (EdificiosPage).
// S2-04: migrado a TanStack Query (cache compartido entre consumidores).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// `enabled` en false para el residente puro: el endpoint pasa por `tenant` y
// le responde 403 SIN_ORGANIZACION_ACTIVA. Sus edificios salen de sus vínculos
// (useMisUnidades, #58).
export function useEdificios({ enabled = true } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.edificios.lists(),
    queryFn: () => api.get('/api/edificios'),
    enabled,
  });

  return { edificios: data ?? [], cargando: isLoading, error: error ?? null };
}
