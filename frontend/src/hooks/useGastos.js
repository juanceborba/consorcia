// frontend/src/hooks/useGastos.js — ConsorcIA
// Lista paginada de gastos de un edificio (S3-07):
// GET /api/edificios/:id/gastos?periodo=&categoria=&esOrdinario=&page=&limit=
//
// La paginación y los totales son del BACKEND (decisión 5 de S3-02): la
// respuesta trae `pagination` y `totales: { cantidad, monto }` del filtro
// completo, no de la página. El cliente no suma nada.
//
// `placeholderData` mantiene la página anterior en pantalla mientras carga la
// siguiente: con paginación server-side, sin esto la tabla se vacía y salta en
// cada click de [Siguiente].
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Los filtros vacíos NO viajan: el contrato de `listarGastosSchema` valida cada
// param si está presente, así que un `categoria=` vacío sería un 422.
function armarQuery({ periodo, categoria, esOrdinario, page, limit }) {
  const params = new URLSearchParams();
  if (periodo) params.set('periodo', periodo);
  if (categoria) params.set('categoria', categoria);
  if (esOrdinario !== undefined) params.set('esOrdinario', String(esOrdinario));
  params.set('page', String(page));
  params.set('limit', String(limit));
  return params.toString();
}

export function useGastos(edificioId, filtros) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.gastos.porEdificio(edificioId, filtros),
    queryFn: () =>
      api.get(`/api/edificios/${edificioId}/gastos?${armarQuery(filtros)}`),
    placeholderData: keepPreviousData,
  });

  return {
    gastos: data?.data ?? [],
    pagination: data?.pagination ?? null,
    totales: data?.totales ?? null,
    cargando: isLoading,
    // `isFetching` con datos ya en pantalla = está trayendo otra página.
    refrescando: isFetching && !isLoading,
    error: error ?? null,
  };
}
