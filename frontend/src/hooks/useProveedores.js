// frontend/src/hooks/useProveedores.js — ConsorcIA
// Directorio de proveedores de la organización activa (S3-12: globales de
// plataforma + propios). Lo consumen la pantalla de administración (S3-14) y el
// selector de proveedor del form de gasto.
//
// `placeholderData: keepPreviousData`: el buscador dispara una query por término
// y sin esto la tabla se vacía en cada tecla (mismo patrón que el paginador de
// S2). El debounce del input vive en la pantalla, no acá.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useProveedores({
  q = '',
  page = 1,
  limit = 50,
  incluirInactivos = false,
  enabled = true,
} = {}) {
  const filtros = { q: q.trim(), page, limit, incluirInactivos };

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filtros.q) params.set('q', filtros.q);
  if (incluirInactivos) params.set('incluirInactivos', '1');

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.proveedores.lists(filtros),
    queryFn: () => api.get(`/api/proveedores?${params}`),
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    proveedores: data?.data ?? [],
    // El total es del filtro activo, no del directorio entero: es lo que
    // necesita el paginador.
    total: data?.pagination?.total ?? 0,
    cargando: isLoading,
    // `isFetching` distingue "primera carga" (skeleton) de "refetch por
    // búsqueda" (tabla anterior + indicador sutil).
    refrescando: isFetching && !isLoading,
    error: error ?? null,
  };
}
