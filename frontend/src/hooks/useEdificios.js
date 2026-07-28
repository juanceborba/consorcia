// frontend/src/hooks/useEdificios.js — ConsorcIA
// Hook compartido: edificios visibles para el usuario (GET /api/edificios).
// Lo usan el selector del header (AppLayout) y el listado (EdificiosPage).
// S2-04: migrado a TanStack Query (cache compartido entre consumidores).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useEdificios() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.edificios.lists(),
    queryFn: () => api.get('/api/edificios'),
  });

  return { edificios: data ?? [], cargando: isLoading, error: error ?? null };
}
