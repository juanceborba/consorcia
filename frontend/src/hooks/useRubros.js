// frontend/src/hooks/useRubros.js — ConsorcIA
// Árbol de rubros mergeado para la organización activa (S3-13: maestro de
// plataforma + overrides de visibilidad + propios).
//
// `incluirOcultos` cambia el conjunto, no solo el filtro visual, así que forma
// parte de la query key: la pantalla de administración necesita los ocultos para
// poder volver a mostrarlos, y el selector del form de gasto tiene que ver
// EXACTAMENTE lo usable (si mostrara un oculto, el POST del gasto lo rechazaría
// con 422 RUBRO_INVALIDO).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useRubros({ incluirOcultos = false, enabled = true } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.rubros.arbol(incluirOcultos),
    queryFn: () =>
      api.get(`/api/rubros${incluirOcultos ? '?incluirOcultos=1' : ''}`),
    enabled,
  });

  return { arbol: data?.data ?? [], cargando: isLoading, error: error ?? null };
}
