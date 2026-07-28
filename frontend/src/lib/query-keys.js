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
  },
  organizaciones: {
    all: ['organizaciones'],
    me: () => [...queryKeys.organizaciones.all, 'me'],
  },
};
