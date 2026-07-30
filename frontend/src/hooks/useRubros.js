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

/**
 * Nombre legible de un rubro del árbol, sea raíz o subrubro. Los chips de filtro
 * de S3-16 solo tienen el id (es lo que viaja en la URL) y mostrar un UUID no es
 * mostrar nada; el subrubro se nombra con su raíz adelante ("Mantenimiento ›
 * Plomería") porque un "Insumos" suelto no dice de qué.
 */
export function nombreDeRubro(arbol, rubroId) {
  if (!rubroId) return null;
  for (const raiz of arbol) {
    if (raiz.id === rubroId) return raiz.nombre;
    const hijo = (raiz.subrubros ?? []).find((h) => h.id === rubroId);
    if (hijo) return `${raiz.nombre} › ${hijo.nombre}`;
  }
  return null;
}

/**
 * El nombre del rubro filtrado, para el chip. La query solo se dispara cuando hay
 * un rubro en el filtro: el árbol es un request que la pantalla de gastos no
 * necesita hasta que alguien clickea una barra del chart.
 */
export function useNombreDeRubro(rubroId) {
  const { arbol } = useRubros({ enabled: Boolean(rubroId) });
  return nombreDeRubro(arbol, rubroId);
}
