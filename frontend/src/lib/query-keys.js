// frontend/src/lib/query-keys.js — ConsorcIA
// Keys estandarizadas de TanStack Query (S2-04), según PRD-07-04 §2.2.
// Convención: [dominio, entidad, acción, params...].
// S2 incluye edificios completo y placeholders de gastos y organización;
// el resto de dominios se agregan junto con sus módulos (S3+).

export const queryKeys = {
  edificios: {
    all: ['edificios'],
    lists: (filters) => [...queryKeys.edificios.all, 'list', filters],
    detail: (id) => [...queryKeys.edificios.all, 'detail', id],
    unidades: (edificioId) => [...queryKeys.edificios.all, 'unidades', edificioId],
  },
  gastos: {
    all: ['gastos'],
    lists: (filters) => [...queryKeys.gastos.all, 'list', filters],
    detail: (id) => [...queryKeys.gastos.all, 'detail', id],
    porPeriodo: (periodo) => [...queryKeys.gastos.all, 'periodo', periodo],
    // Lista del tab `gastos` de un edificio (S3-07). El edificio va antes que
    // los filtros para poder invalidar todas las páginas y combinaciones de
    // filtros de un edificio con un prefijo (`[...all, 'edificio', id]`).
    porEdificio: (edificioId, filtros) => [
      ...queryKeys.gastos.all,
      'edificio',
      edificioId,
      filtros,
    ],
  },
  // Directorio de proveedores de la organización activa (S3-12/14). No lleva el
  // id de la organización: el endpoint la saca del JWT y el cambio de
  // organización activa hace `queryClient.clear()` (S4-09).
  proveedores: {
    all: ['proveedores'],
    lists: (filtros) => [...queryKeys.proveedores.all, 'list', filtros],
    detail: (id) => [...queryKeys.proveedores.all, 'detail', id],
  },
  // Árbol de rubros mergeado para la organización activa (S3-13/14). `incluirOcultos`
  // es parte de la key: la pantalla de administración y el selector del form de
  // gasto piden árboles distintos y no pueden compartir cache.
  rubros: {
    all: ['rubros'],
    arbol: (incluirOcultos = false) => [
      ...queryKeys.rubros.all,
      'arbol',
      { incluirOcultos },
    ],
  },
  // Esquemas de reparto de un edificio (S3-20). Una sola key para la pantalla de
  // configuración y para el selector del gasto: el endpoint devuelve la lista y
  // la configuración juntas (decisión 2 de esquemas-reparto.routes.js) y las dos
  // pantallas necesitan la misma foto — cambiar el esquema general tiene que
  // reflejarse en el selector del gasto sin un refetch aparte.
  esquemasReparto: {
    all: ['esquemas-reparto'],
    porEdificio: (edificioId) => [
      ...queryKeys.esquemasReparto.all,
      'edificio',
      edificioId,
    ],
    detail: (id) => [...queryKeys.esquemasReparto.all, 'detail', id],
  },
  // Contexto propio del usuario logueado (S4-12): no lleva scope de
  // organización porque el endpoint agrega por `usuarioId` (PRD-04-11 §5.5).
  me: {
    all: ['me'],
    unidades: () => [...queryKeys.me.all, 'unidades'],
  },
  organizaciones: {
    all: ['organizaciones'],
    me: () => [...queryKeys.organizaciones.all, 'me'],
    // Nómina de staff de la organización activa (S4-07). No lleva el id de la
    // organización: el endpoint es `/me` (sale del JWT) y el cambio de
    // organización activa hace `queryClient.clear()` (S4-09).
    staff: () => [...queryKeys.organizaciones.all, 'staff'],
  },
  unidades: {
    all: ['unidades'],
    // Vínculos (propietarios/inquilinos) de una UF, vigentes e históricos (S4-08).
    residentes: (unidadId) => [...queryKeys.unidades.all, 'residentes', unidadId],
  },
  invitaciones: {
    all: ['invitaciones'],
    // Pantalla pública de activación: GET /api/invitaciones/:token (S4-08).
    porToken: (token) => [...queryKeys.invitaciones.all, 'token', token],
  },
};
