// frontend/src/hooks/useGastosDashboard.js — ConsorcIA
// Agregados del dashboard de gastos (S3-16 sobre el endpoint de S3-15):
//   GET /api/edificios/:id/gastos/dashboard          → un edificio
//   GET /api/organizaciones/me/gastos/dashboard      → consolidado (Business+)
//
// Contrato en PRD-04-02 §3.4: una sola respuesta con `filtro`, `kpis`,
// `topProveedores`, `porRubro` (rollup a rubro raíz con sus subrubros adentro),
// `porCategoria` y `evolucionMensual`. Los montos vienen SIEMPRE como string
// (cero floats en el borde) y el cliente no suma nada: los cinco cortes salen de
// un mismo recorrido del backend y reconcilian por construcción.
//
// DECISIONES:
//
// 1. UN SOLO HOOK PARA LOS DOS ALCANCES. Lo único que cambia es la URL: la forma
//    de la respuesta es idéntica (fue una decisión del endpoint de S3-15), así
//    que los componentes del dashboard son los mismos para el tab del edificio y
//    para el reporte consolidado. Dos hooks obligarían a mantener dos veces la
//    traducción de filtros a query string.
//
// 2. EL ALIAS `me` PARA LA ORGANIZACIÓN, no el id. El endpoint acepta el id de
//    la organización activa o `me`, y cualquier otro responde `403
//    FUERA_DE_ORGANIZACION` (precisión 10 de §3.4): el tenant sale del JWT. `me`
//    es la forma que ya usa el resto del frontend y evita que el cliente tenga
//    que conocer un id para pedir lo suyo.
//
// 3. SIN `retry` Y CON EL `code` A LA VISTA. Los errores esperables de este
//    endpoint son de autorización, no de red: `PLAN_INSUFICIENTE` (plan <
//    business) y `ACCESO_DENEGADO` (un gestor pidiendo el consolidado).
//    Reintentarlos tres veces retrasa una pantalla que ya sabe qué mostrar, así
//    que el hook devuelve el `ApiError` entero y la pantalla decide el copy.
//
// 4. `placeholderData` MANTIENE LOS NÚMEROS ANTERIORES mientras carga el filtro
//    nuevo, igual que el listado: sin eso, cada cambio de filtro vacía los KPIs
//    y los charts se desmontan y remontan con su animación de entrada, que en
//    una pantalla con cinco componentes se lee como un parpadeo general.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Los vacíos no viajan (el contrato valida cada param presente). `todo` va como
// '1', el valor que `booleanoDeQuery` del backend acepta.
function armarQuery({ periodo, desde, hasta, todo, categoria, proveedorId, rubroId, createdBy, q }) {
  const params = new URLSearchParams();
  if (periodo) params.set('periodo', periodo);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (todo) params.set('todo', '1');
  if (categoria) params.set('categoria', categoria);
  if (proveedorId) params.set('proveedorId', proveedorId);
  if (rubroId) params.set('rubroId', rubroId);
  if (createdBy) params.set('createdBy', createdBy);
  if (q) params.set('q', q);
  return params.toString();
}

/**
 * @param {object} alcance  `{ edificioId }` o `{ organizacion: true }` (decisión 1)
 * @param {object} filtros  `filtrosDashboard` de `useFiltrosGastos`
 */
export function useGastosDashboard(alcance, filtros, { enabled = true } = {}) {
  const { edificioId, organizacion } = alcance;
  const path = organizacion
    ? // Decisión 2.
      '/api/organizaciones/me/gastos/dashboard'
    : `/api/edificios/${edificioId}/gastos/dashboard`;
  const clave = organizacion ? 'organizacion' : `edificio:${edificioId}`;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.gastos.dashboard(clave, filtros),
    queryFn: () => api.get(`${path}?${armarQuery(filtros)}`),
    enabled: enabled && Boolean(organizacion || edificioId),
    // Decisión 3.
    retry: false,
    // Decisión 4.
    placeholderData: keepPreviousData,
  });

  return {
    dashboard: data ?? null,
    cargando: isLoading,
    refrescando: isFetching && !isLoading,
    error: error ?? null,
  };
}
