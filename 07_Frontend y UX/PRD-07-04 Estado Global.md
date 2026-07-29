---
title: "PRD-07-04: Estado Global"
description: "Especificacion del sistema de gestion de estado global de ConsorcIA. Define la arquitectura de stores con Zustand, patrones para server state con TanStack Query, persistencia y sincronizacion entre pestanas."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [frontend, estado-global, zustand, tanstack-query, state-management, react, mvp]
outcomes:
  - "Definir arquitectura de stores separando UI state, server state y auth state"
  - "Especificar patrones de TanStack Query para cache, revalidacion y mutations"
  - "Documentar persistencia de estado y sincronizacion entre pestanas"
  - "Establecer convenciones para optimistic updates y rollback"
  - "Definir middleware de logging, devtools y hydration"
---

# PRD-07-04: Estado Global

> **"El estado bien organizado es la diferencia entre una app que funciona y una que escala."**  
> Separar UI state de server state no es una opcion: es un requisito para mantener la sanidad mental del equipo a medida que el producto crece.

---

## 1. Principios de Estado

> **Estado de adopción (2026-07-28):** S1 se implementó con hooks livianos de fetch (`useEdificios`) y Zustand sin `immer`. **TanStack Query adoptado en S2-04:** `QueryClient` según §2.1 en `frontend/src/lib/query-client.js`, provider + devtools (solo dev) en `src/main.jsx`, keys en `src/lib/query-keys.js` (S2 incluye `organizaciones`, `edificios` y placeholder de `gastos`; el resto de dominios se agrega con sus módulos). `useEdificios` y `organizaciones/me` migrados a `useQuery`; `auth.store` limpia el cache con `queryClient.clear()` en logout. Los stores simples no necesitan `immer` — se evalúa caso a caso, no es obligatorio.

### 1.1 Reglas de oro

```
┌─────────────────────────────────────────────────────────────┐
│  REGLAS DE ORO DEL ESTADO:                                  │
│                                                             │
│  1. Server state != Client state                            │
│     - Server state: datos del API (cacheado por TanStack)   │
│     - Client state: UI, formularios, preferencias (Zustand) │
│                                                             │
│  2. No dupliques server state en Zustand                    │
│     - Si esta en TanStack Query, NO va en Zustand         │
│     - Excepcion: datos que requieren transformacion compleja │
│                                                             │
│  3. Un store por dominio, no un store gigante               │
│     - auth.store.ts, ui.store.ts, edificio.store.ts         │
│     - Cada store < 200 lineas                               │
│                                                             │
│  4. Selectores explicitos, no acceso directo                │
│     - useAuthStore(s => s.user) en vez de useAuthStore()    │
│     - Previene re-renders innecesarios                      │
│                                                             │
│  5. Async solo en TanStack Query                            │
│     - Zustand NO hace fetch. Solo guarda resultado.       │
│     - TanStack Query maneja loading, error, retry, cache    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Taxonomia de estado

| Tipo | Ejemplos | Herramienta | Persistencia |
|------|----------|-------------|-------------|
| **Server State** | Edificios, gastos, liquidaciones, cobros | TanStack Query | Cache (TTL configurable) |
| **Auth State** | Usuario, token, roles, permisos | Zustand | localStorage (token) |
| **UI State** | Sidebar abierto, tema, filtros activos, toast queue | Zustand | localStorage (parcial) |
| **Form State** | Valores, errores, touched, submitting | react-hook-form | Ninguna (ephemeral) |
| **Route State** | Params, query strings, location | React Router | URL (browser history) |
| **Sync State** | Online/offline, WebSocket status | Zustand | Ninguna |

---

## 2. TanStack Query (Server State)

### 2.1 Configuracion global

```typescript
// lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutos
      gcTime: 1000 * 60 * 30,          // 30 minutos (antes cacheTime)
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

// Provider en main.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<QueryClientProvider client={queryClient}>
  <App />
  {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
</QueryClientProvider>
```

### 2.2 Keys estandarizadas

```typescript
// lib/query-keys.ts
// Convencion: [dominio, entidad, accion, params...]

export const queryKeys = {
  organizaciones: {
    all: ['organizaciones'] as const,
    me: () => [...queryKeys.organizaciones.all, 'me'] as const,
  },
  edificios: {
    all: ['edificios'] as const,
    lists: (filters?: Record<string, unknown>) => 
      [...queryKeys.edificios.all, 'list', filters] as const,
    detail: (id: string) => 
      [...queryKeys.edificios.all, 'detail', id] as const,
    unidades: (edificioId: string) => 
      [...queryKeys.edificios.all, 'unidades', edificioId] as const,
  },
  gastos: {
    all: ['gastos'] as const,
    lists: (filters?: { periodo?: string; categoria?: string }) => 
      [...queryKeys.gastos.all, 'list', filters] as const,
    detail: (id: string) => 
      [...queryKeys.gastos.all, 'detail', id] as const,
    porPeriodo: (periodo: string) => 
      [...queryKeys.gastos.all, 'periodo', periodo] as const,
  },
  liquidaciones: {
    all: ['liquidaciones'] as const,
    lists: () => [...queryKeys.liquidaciones.all, 'list'] as const,
    detail: (id: string) => 
      [...queryKeys.liquidaciones.all, 'detail', id] as const,
    preview: (edificioId: string, periodo: string) => 
      [...queryKeys.liquidaciones.all, 'preview', edificioId, periodo] as const,
  },
  cobros: {
    all: ['cobros'] as const,
    lists: (filters?: { estado?: string; periodo?: string }) => 
      [...queryKeys.cobros.all, 'list', filters] as const,
    detail: (id: string) => 
      [...queryKeys.cobros.all, 'detail', id] as const,
    morosidad: (edificioId: string) => 
      [...queryKeys.cobros.all, 'morosidad', edificioId] as const,
  },
  tickets: {
    all: ['tickets'] as const,
    lists: (filters?: { estado?: string; categoria?: string }) => 
      [...queryKeys.tickets.all, 'list', filters] as const,
    detail: (id: string) => 
      [...queryKeys.tickets.all, 'detail', id] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    kpis: (edificioId: string, periodo: string) => 
      [...queryKeys.dashboard.all, 'kpis', edificioId, periodo] as const,
    charts: (edificioId: string, periodo: string) => 
      [...queryKeys.dashboard.all, 'charts', edificioId, periodo] as const,
  },
  portal: {
    expensas: (unidadId: string) => ['portal', 'expensas', unidadId] as const,
    documentos: () => ['portal', 'documentos'] as const,
    consultas: (unidadId: string) => ['portal', 'consultas', unidadId] as const,
  },
} as const;
```

### 2.3 Hooks de queries (ejemplos)

```typescript
// hooks/queries/use-edificios.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { api } from '@/lib/api';

// Listar edificios
export function useEdificios(filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.edificios.lists(filters),
    queryFn: async () => {
      const { data } = await api.get('/edificios', { params: filters });
      return data;
    },
  });
}

// Obtener edificio por ID
export function useEdificio(id: string) {
  return useQuery({
    queryKey: queryKeys.edificios.detail(id),
    queryFn: async () => {
      const { data } = await api.get(`/edificios/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// Crear edificio
export function useCreateEdificio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edificio: CreateEdificioInput) => {
      const { data } = await api.post('/edificios', edificio);
      return data;
    },
    onSuccess: () => {
      // Invalidar lista de edificios
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.all });
      // Mostrar toast de exito
      toast.success('Edificio creado correctamente');
    },
    onError: (error) => {
      toast.error(error.message || 'Error al crear el edificio');
    },
  });
}

// Actualizar edificio
export function useUpdateEdificio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateEdificioInput }) => {
      const { data: response } = await api.put(`/edificios/${id}`, data);
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.all });
    },
  });
}

// Eliminar edificio (soft delete)
export function useDeleteEdificio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/edificios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.all });
    },
  });
}
```

### 2.4 Infinite queries (para listados grandes)

```typescript
// hooks/queries/use-gastos-infinite.ts
import { useInfiniteQuery } from '@tanstack/react-query';

export function useGastosInfinite(filters?: { periodo?: string; categoria?: string }) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.gastos.all, 'infinite', filters],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get('/gastos', {
        params: { ...filters, page: pageParam, limit: 50 },
      });
      return data;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.page >= lastPage.pagination.totalPages) {
        return undefined;
      }
      return lastPage.pagination.page + 1;
    },
    initialPageParam: 1,
  });
}
```

### 2.5 Optimistic updates

```typescript
// hooks/queries/use-aprobar-liquidacion.ts
export function useAprobarLiquidacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (liquidacionId: string) => {
      const { data } = await api.post(`/liquidaciones/${liquidacionId}/aprobar`);
      return data;
    },
    // Optimistic update
    onMutate: async (liquidacionId) => {
      // Cancelar queries en vuelo
      await queryClient.cancelQueries({ queryKey: queryKeys.liquidaciones.detail(liquidacionId) });

      // Snapshot del estado anterior
      const previousLiquidacion = queryClient.getQueryData(
        queryKeys.liquidaciones.detail(liquidacionId)
      );

      // Actualizar optimistamente
      queryClient.setQueryData(
        queryKeys.liquidaciones.detail(liquidacionId),
        (old: any) => ({ ...old, estado: 'APROBADA' })
      );

      return { previousLiquidacion };
    },
    onError: (err, liquidacionId, context) => {
      // Rollback en caso de error
      queryClient.setQueryData(
        queryKeys.liquidaciones.detail(liquidacionId),
        context?.previousLiquidacion
      );
      toast.error('Error al aprobar la liquidacion');
    },
    onSettled: (liquidacionId) => {
      // Revalidar despues de settle (exito o error)
      queryClient.invalidateQueries({ queryKey: queryKeys.liquidaciones.detail(liquidacionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.liquidaciones.all });
    },
  });
}
```

---

## 3. Zustand Stores (Client State)

### 3.1 Auth Store

```typescript
// stores/auth.store.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface User {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  // Roles canónicos (PRD-05-04 §2): nivel organización + nivel edificio
  roles: ('superadmin' | 'org_admin' | 'gestor' | 'consejo' |
          'propietario' | 'inquilino' | 'encargado' | 'proveedor')[];
  organizacionId: string;
  edificiosAsignados?: string[];  // solo gestores
  // El plan NO va en el usuario: es de la organización (se obtiene de
  // GET /api/organizaciones/me).
}

interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;    // JWT 15 min
  refreshToken: string | null;   // UUID opaco, 7 días
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (tokens: { accessToken: string; refreshToken: string }, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
  refresh: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  immer(
    persist(
      (set, get) => ({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: true,

        login: (token, user) => {
          set((state) => {
            state.token = token;
            state.user = user;
            state.isAuthenticated = true;
            state.isLoading = false;
          });
        },

        logout: () => {
          set((state) => {
            state.token = null;
            state.user = null;
            state.isAuthenticated = false;
            state.isLoading = false;
          });
          // Limpiar cache de TanStack Query
          queryClient.clear();
        },

        setUser: (user) => {
          set((state) => {
            state.user = user;
          });
        },

        setEdificioActivo: (edificioId) => {
          set((state) => {
            if (state.user) {
              state.user.edificioActivoId = edificioId;
            }
          });
        },

        refreshToken: async () => {
          try {
            const { data } = await api.post('/auth/refresh');
            set((state) => {
              state.token = data.token;
            });
          } catch {
            get().logout();
          }
        },
      }),
      {
        name: 'consorcia-auth',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ 
          token: state.token, 
          user: state.user 
        }),
      }
    )
  )
);
```

### 3.2 UI Store

```typescript
// stores/ui.store.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;

  // Tema
  theme: 'light' | 'dark' | 'system';

  // Toasts
  toasts: Toast[];

  // Modales globales
  activeModal: string | null;
  modalData: Record<string, unknown> | null;

  // Filtros globales (persistidos por sesion)
  globalFilters: {
    periodo?: string;
    edificioId?: string;
  };

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setGlobalFilter: (key: string, value: unknown) => void;
}

export const useUIStore = create<UIState>()(
  immer(
    persist(
      (set, get) => ({
        sidebarOpen: true,
        sidebarCollapsed: false,
        theme: 'system',
        toasts: [],
        activeModal: null,
        modalData: null,
        globalFilters: {},

        toggleSidebar: () => {
          set((state) => {
            state.sidebarOpen = !state.sidebarOpen;
          });
        },

        setSidebarCollapsed: (collapsed) => {
          set((state) => {
            state.sidebarCollapsed = collapsed;
          });
        },

        setTheme: (theme) => {
          set((state) => {
            state.theme = theme;
          });
        },

        addToast: (toast) => {
          const id = Math.random().toString(36).substring(2, 9);
          set((state) => {
            state.toasts.push({ ...toast, id });
          });

          // Auto-remove
          setTimeout(() => {
            get().removeToast(id);
          }, toast.duration || 5000);
        },

        removeToast: (id) => {
          set((state) => {
            state.toasts = state.toasts.filter((t) => t.id !== id);
          });
        },

        openModal: (modalId, data) => {
          set((state) => {
            state.activeModal = modalId;
            state.modalData = data || null;
          });
        },

        closeModal: () => {
          set((state) => {
            state.activeModal = null;
            state.modalData = null;
          });
        },

        setGlobalFilter: (key, value) => {
          set((state) => {
            state.globalFilters[key] = value;
          });
        },
      }),
      {
        name: 'consorcia-ui',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          theme: state.theme,
          globalFilters: state.globalFilters,
        }),
      }
    )
  )
);
```

### 3.3 Edificio Store (UI state del edificio activo)

> **Implementación S1 (vigente):** `src/stores/edificio.store.js` mínimo — `{ edificioId, setEdificioId }` persistido en localStorage (key `consorcia-edificio`). El edificio activo NO vive en el auth store (separación de concerns). La versión completa de abajo se adopta en S2 junto con los filtros de gastos.

```typescript
// stores/edificio.store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface EdificioUIState {
  // Estado de seleccion
  edificioSeleccionadoId: string | null;

  // Estado de formularios (no duplicar server state)
  formDrafts: Record<string, Record<string, unknown>>;

  // Estado de vistas
  vistaActiva: 'lista' | 'detalle' | 'configuracion';

  // Filtros locales
  filtrosGastos: {
    periodo?: string;
    categoria?: string;
    esOrdinario?: boolean;
  };

  // Actions
  setEdificioSeleccionado: (id: string | null) => void;
  setFormDraft: (formId: string, data: Record<string, unknown>) => void;
  clearFormDraft: (formId: string) => void;
  setVistaActiva: (vista: 'lista' | 'detalle' | 'configuracion') => void;
  setFiltroGasto: (key: string, value: unknown) => void;
  resetFiltrosGastos: () => void;
}

export const useEdificioStore = create<EdificioUIState>()(
  immer((set) => ({
    edificioSeleccionadoId: null,
    formDrafts: {},
    vistaActiva: 'lista',
    filtrosGastos: {},

    setEdificioSeleccionado: (id) => {
      set((state) => {
        state.edificioSeleccionadoId = id;
      });
    },

    setFormDraft: (formId, data) => {
      set((state) => {
        state.formDrafts[formId] = data;
      });
    },

    clearFormDraft: (formId) => {
      set((state) => {
        delete state.formDrafts[formId];
      });
    },

    setVistaActiva: (vista) => {
      set((state) => {
        state.vistaActiva = vista;
      });
    },

    setFiltroGasto: (key, value) => {
      set((state) => {
        state.filtrosGastos[key] = value;
      });
    },

    resetFiltrosGastos: () => {
      set((state) => {
        state.filtrosGastos = {};
      });
    },
  }))
);
```

### 3.4 Kanban Store (Fase 2)

```typescript
// stores/kanban.store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface KanbanState {
  // Drag & drop
  draggedTicketId: string | null;
  dragOverColumn: string | null;

  // Filtros del board
  filtros: {
    categoria?: string;
    prioridad?: string;
    asignadoA?: string;
    slaVencido?: boolean;
  };

  // Vista
  vista: 'kanban' | 'lista' | 'calendario';

  // Actions
  setDraggedTicket: (id: string | null) => void;
  setDragOverColumn: (column: string | null) => void;
  setFiltro: (key: string, value: unknown) => void;
  resetFiltros: () => void;
  setVista: (vista: 'kanban' | 'lista' | 'calendario') => void;
}

export const useKanbanStore = create<KanbanState>()(
  immer((set) => ({
    draggedTicketId: null,
    dragOverColumn: null,
    filtros: {},
    vista: 'kanban',

    setDraggedTicket: (id) => {
      set((state) => {
        state.draggedTicketId = id;
      });
    },

    setDragOverColumn: (column) => {
      set((state) => {
        state.dragOverColumn = column;
      });
    },

    setFiltro: (key, value) => {
      set((state) => {
        state.filtros[key] = value;
      });
    },

    resetFiltros: () => {
      set((state) => {
        state.filtros = {};
      });
    },

    setVista: (vista) => {
      set((state) => {
        state.vista = vista;
      });
    },
  }))
);
```

---

## 4. Sincronizacion entre Pestañas

### 4.1 BroadcastChannel para estado compartido

```typescript
// stores/sync.store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface SyncState {
  // Estado de conexion
  isOnline: boolean;
  lastSync: Date | null;
  pendingMutations: number;

  // Actions
  setOnline: (online: boolean) => void;
  setLastSync: (date: Date) => void;
  incrementPending: () => void;
  decrementPending: () => void;
}

export const useSyncStore = create<SyncState>()(
  immer((set) => ({
    isOnline: navigator.onLine,
    lastSync: null,
    pendingMutations: 0,

    setOnline: (online) => {
      set((state) => {
        state.isOnline = online;
      });
    },

    setLastSync: (date) => {
      set((state) => {
        state.lastSync = date;
      });
    },

    incrementPending: () => {
      set((state) => {
        state.pendingMutations += 1;
      });
    },

    decrementPending: () => {
      set((state) => {
        state.pendingMutations = Math.max(0, state.pendingMutations - 1);
      });
    },
  }))
);

// Hook para sincronizacion entre pestanas
export function useTabSync() {
  useEffect(() => {
    const channel = new BroadcastChannel('consorcia-sync');

    channel.onmessage = (event) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'AUTH_LOGOUT':
          // Cerrar sesion en todas las pestanas
          useAuthStore.getState().logout();
          break;
        case 'EDIFICIO_CHANGED':
          // Invalidar cache de edificio
          queryClient.invalidateQueries({ queryKey: queryKeys.edificios.all });
          break;
        case 'LIQUIDACION_APROBADA':
          // Invalidar liquidaciones
          queryClient.invalidateQueries({ queryKey: queryKeys.liquidaciones.all });
          break;
        case 'THEME_CHANGED':
          // Sincronizar tema
          useUIStore.getState().setTheme(payload.theme);
          break;
      }
    };

    return () => channel.close();
  }, []);
}
```

---

## 5. Middleware y Devtools

### 5.1 Logger middleware

```typescript
// stores/middleware/logger.ts
import { StateCreator, StoreApi } from 'zustand';

export const logger = <T>(
  config: StateCreator<T>
): StateCreator<T> => (set, get, api) => {
  return config(
    (args) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('  Zustand action:', args);
        console.log('  Previous state:', get());
      }
      set(args);
      if (process.env.NODE_ENV === 'development') {
        console.log('  Next state:', get());
      }
    },
    get,
    api
  );
};

// Uso:
// export const useAuthStore = create<AuthState>()(
//   logger(immer(persist(...)))
// );
```

### 5.2 Devtools integration

```typescript
// stores/devtools.ts
import { devtools } from 'zustand/middleware';

// En desarrollo, envolver stores con devtools
const isDev = process.env.NODE_ENV === 'development';

export const withDevtools = <T>(store: any, name: string) => {
  if (isDev) {
    return devtools(store, { name: `ConsorcIA-${name}` });
  }
  return store;
};
```

---

## 6. Patrones Avanzados

### 6.1 Composicion de stores

```typescript
// hooks/use-combined-store.ts
// Combinar multiples stores en un selector

export function useIsAdmin() {
  const user = useAuthStore((s) => s.user);
  return user?.roles.includes('ADMIN') ?? false;
}

export function useEdificioActivo() {
  const edificioId = useAuthStore((s) => s.user?.edificioActivoId);
  const { data: edificio } = useEdificio(edificioId || '');
  return edificio;
}

export function useTienePermiso(recurso: string, accion: string) {
  const user = useAuthStore((s) => s.user);
  // Delegar a Cerbos
  return useQuery({
    queryKey: ['permiso', user?.id, recurso, accion],
    queryFn: () => cerbosCheck({
      principal: { id: user!.id, roles: user!.roles },
      resource: { kind: recurso },
      action: accion,
    }),
    enabled: !!user,
  });
}
```

### 6.2 Estado derivado

```typescript
// hooks/use-derived-state.ts
import { useMemo } from 'react';

// Estado derivado de TanStack Query + Zustand
export function useDashboardData() {
  const edificioId = useAuthStore((s) => s.user?.edificioActivoId);
  const periodo = useUIStore((s) => s.globalFilters.periodo) || getCurrentPeriodo();

  const { data: kpis } = useDashboardKPIs(edificioId || '', periodo);
  const { data: gastos } = useGastos({ periodo });
  const { data: cobros } = useCobros({ periodo });

  // Calcular metricas derivadas
  const metricas = useMemo(() => {
    if (!kpis || !gastos || !cobros) return null;

    const totalGastos = gastos.data.reduce((sum, g) => sum + g.monto, 0);
    const totalCobrado = cobros.data
      .filter((c) => c.estado === 'PAGADO')
      .reduce((sum, c) => sum + c.montoPagado, 0);

    return {
      totalGastos,
      totalCobrado,
      porcentajeCobrado: totalGastos > 0 ? (totalCobrado / totalGastos) * 100 : 0,
      morosidad: kpis.morosidad,
    };
  }, [kpis, gastos, cobros]);

  return { kpis, gastos, cobros, metricas };
}
```

### 6.3 Estado de loading global

```typescript
// hooks/use-global-loading.ts
export function useGlobalLoading() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();

  return {
    isLoading: isFetching > 0 || isMutating > 0,
    isFetching: isFetching > 0,
    isMutating: isMutating > 0,
  };
}

// Componente GlobalLoadingIndicator
export function GlobalLoadingIndicator() {
  const { isLoading } = useGlobalLoading();

  if (!isLoading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <Progress value={undefined} className="h-1" />
    </div>
  );
}
```

---

## 7. Offline y Sincronizacion

### 7.1 Estrategia offline-first (MVP basico)

```typescript
// hooks/use-online-status.ts
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// Hook para mutations con retry offline
export function useOfflineMutation<TData, TError, TVariables>(
  options: UseMutationOptions<TData, TError, TVariables>
) {
  const isOnline = useOnlineStatus();

  return useMutation({
    ...options,
    retry: isOnline ? 3 : false,
    networkMode: isOnline ? 'online' : 'offline',
  });
}
```

### 7.2 Cola de mutaciones pendientes (Fase 2)

```typescript
// stores/offline.store.ts (Fase 2)
interface PendingMutation {
  id: string;
  timestamp: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload: unknown;
  queryKeysToInvalidate: string[][];
}

interface OfflineState {
  pendingMutations: PendingMutation[];
  isSyncing: boolean;

  addPendingMutation: (mutation: Omit<PendingMutation, 'id' | 'timestamp'>) => void;
  removePendingMutation: (id: string) => void;
  syncPendingMutations: () => Promise<void>;
}

// Implementacion con IndexedDB para persistencia offline
```

---

## 8. Decisiones de Diseno Clave

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **TanStack Query para server state** | Si | Cache, revalidacion, deduplication, retry, offline support. El estandar de la industria. |
| **Zustand para client state** | Si | Lightweight, TypeScript-first, middleware ecosystem (immer, persist, devtools). |
| **Immer para inmutabilidad** | Si | Sintaxis mutable con semantica inmutable. Reduce bugs de referencia. |
| **Persistencia selectiva** | localStorage | Solo auth token y preferencias UI. Datos de negocio en cache de TanStack (volatil). |
| **BroadcastChannel** | Si | Sincronizar logout y cambios criticos entre pestanas. No para todo el estado. |
| **No Redux** | Si | Overkill para este scope. Zustand + TanStack Query cubren todos los casos. |
| **No Context API para estado global** | Si | Re-renders innecesarios. Zustand usa selectors para granularidad fina. |
| **Query keys estandarizadas** | Array anidado | Invalidacion granular. Invalidar ['gastos'] invalida todas las queries de gastos. |
| **Optimistic updates** | Caso por caso | Solo para acciones de bajo riesgo (aprobar, cambiar estado). No para crear edificios. |
| **Offline-first basico en MVP** | Solo detection | Detectar online/offline, mostrar indicador. Cola de mutaciones en Fase 2. |

---

*Documento relacionado:* [[PRD-07-02 Diseno de Componentes]]
*Documento relacionado:* [[PRD-07-03 Rutas y Navegacion]]
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]
*Documento relacionado:* [[PRD-04-06 Kanban de Tareas]]
*Documento relacionado:* [[PRD-01-01 Vision del Producto]]
