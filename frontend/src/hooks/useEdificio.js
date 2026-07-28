// frontend/src/hooks/useEdificio.js — ConsorcIA
// Detalle de un edificio con sus unidades (GET /api/edificios/:id).
// Lo usa el layout del detalle (EdificioDetallePage, S2-07); los tabs
// reciben el dato por Outlet context para no duplicar la query.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useEdificio(id) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.edificios.detail(id),
    queryFn: () => api.get(`/api/edificios/${id}`),
  });

  return { edificio: data ?? null, cargando: isLoading, error: error ?? null };
}
