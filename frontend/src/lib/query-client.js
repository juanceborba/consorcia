// frontend/src/lib/query-client.js — ConsorcIA
// QueryClient global de TanStack Query (S2-04). Config según PRD-07-04 §2.1:
// staleTime 5 min, gcTime 30 min, retry 3 con backoff exponencial.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutos
      gcTime: 1000 * 60 * 30, // 30 minutos (antes cacheTime)
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: 'online',
    },
    mutations: {
      // Sin retry automático (default de TanStack): los POST/PATCH/DELETE no
      // son idempotentes y reintentarlos tras un error de red/5xx puede
      // duplicar escrituras (review S2 #3). El retry manual queda en manos
      // del usuario.
      retry: 0,
      networkMode: 'online',
    },
  },
});
