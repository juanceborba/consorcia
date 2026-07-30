---
title: "PRD-07-01: Stack Frontend"
description: "Arquitectura del frontend de ConsorcIA: React 19, Vite 6, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Query y el ecosistema de herramientas modernas."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [frontend, ux, react, vite, tailwind, shadcn, zustand, tanstack, consorcIA]
outcomes:
  - "Justificar cada elección tecnológica del stack frontend"
  - "Configurar el entorno de desarrollo con Vite y TypeScript"
  - "Implementar el sistema de diseño con Tailwind y shadcn/ui"
  - "Establecer patrones de estado global y fetching de datos"
  - "Definir convenciones de código y estructura de carpetas"
---

# PRD-07-01: Stack Frontend

> **El frontend de ConsorcIA es una aplicación web moderna construida con React 19, Vite 6 y Tailwind CSS 4.** El objetivo es una UX rápida, accesible y sin vendor lock-in, que escale desde el portal del administrador hasta la app móvil (React Native) en Fase 2.

---

## 1. Stack Tecnológico

### 1.1 Core

| Componente | Versión | Rol |
|------------|---------|-----|
| **React** | 19 | Framework UI con Server Components y Actions |
| **TypeScript** | 5.7 | Tipado estático, shared types con backend |
| **Vite** | 6 | Build tool con HMR instantáneo |
| **Tailwind CSS** | 4 | Utility-first CSS framework |
| **shadcn/ui** | latest | Componentes accesibles, sin vendor lock-in |

### 1.2 Estado y Datos

| Componente | Versión | Rol |
|------------|---------|-----|
| **Zustand** | 5 | Estado global ligero y TypeScript-friendly |
| **TanStack Query** | 5 | Fetching, cache, sync, optimistic updates |
| **React Hook Form** | 7 | Formularios con validación declarativa |
| **Zod** | 3 | Validación de schemas (shared con backend) |

### 1.3 Routing y Navegación

| Componente | Versión | Rol |
|------------|---------|-----|
| **React Router** | 7 | SPA routing con layouts y guards |
| **TanStack Router** | 1 | Alternativa type-safe (evaluar) |

### 1.4 Visualización y UX

| Componente | Versión | Rol |
|------------|---------|-----|
| **Recharts** | 2 | Charts y gráficos (dashboard) |
| **@dnd-kit** | 6 | Drag and drop nativo (kanban) |
| **react-pdf** | 4 | Preview de recibos en browser |
| **Lucide React** | latest | Iconos consistentes |
| **Framer Motion** | 11 | Animaciones sutiles |

### 1.5 Testing

| Componente | Versión | Rol |
|------------|---------|-----|
| **Vitest** | 2 | Unit testing rápido |
| **React Testing Library** | 16 | Testing de componentes |
| **Playwright** | 1 | E2E testing |
| **MSW** | 2 | Mock Service Worker para tests |

---

## 2. React 19: Nuevas Capacidades

### 2.1 Server Components (RSC)

> **React 19 introduce Server Components estables.** Permiten renderizar componentes en el servidor, reduciendo el bundle de JavaScript enviado al cliente.

**Uso en ConsorcIA:**
```tsx
// Server Component: renderizado en servidor, 0 JS en cliente
async function LiquidacionList({ edificioId }: { edificioId: string }) {
  const liquidaciones = await api.liquidaciones.list(edificioId);

  return (
    <ul>
      {liquidaciones.map(l => (
        <LiquidacionCard key={l.id} liquidacion={l} />
      ))}
    </ul>
  );
}
```

**Limitaciones:**
- No pueden usar hooks de estado (`useState`, `useEffect`)
- No pueden usar eventos del browser
- Pueden hacer `await` directamente

### 2.2 React Actions

> **Actions permiten manejar formularios y mutaciones de datos de forma declarativa.**

```tsx
// Action: función asíncrona que maneja la mutación
async function crearGasto(formData: FormData) {
  'use server';
  const gasto = await api.gastos.create(formData);
  revalidatePath(`/edificios/${gasto.edificioId}/gastos`);
}

// Componente cliente que usa la action
function GastoForm() {
  return (
    <form action={crearGasto}>
      <input name="concepto" required />
      <input name="monto" type="number" required />
      <button type="submit">Crear gasto</button>
    </form>
  );
}
```

### 2.3 use() Hook

> **Nuevo hook para consumir promises y contextos de forma condicional.**

```tsx
function ExpensaDetail({ promise }: { promise: Promise<Expensa> }) {
  const expensa = use(promise); // Suspense automático
  return <div>{expensa.monto}</div>;
}
```

---

## 3. Vite 6: Configuración

### 3.1 vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@api': path.resolve(__dirname, './src/api'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          charts: ['recharts'],
        },
      },
    },
  },
});
```

### 3.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"],
      "@hooks/*": ["./src/hooks/*"],
      "@stores/*": ["./src/stores/*"],
      "@types/*": ["./src/types/*"],
      "@lib/*": ["./src/lib/*"],
      "@api/*": ["./src/api/*"]
    }
  },
  "include": ["src"]
}
```

---

## 4. Tailwind CSS 4 + shadcn/ui

### 4.1 Configuración de Tailwind

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  --color-primary: #0f172a;
  --color-primary-foreground: #f8fafc;
  --color-secondary: #1e293b;
  --color-accent: #3b82f6;
  --color-accent-foreground: #ffffff;
  --color-muted: #f1f5f9;
  --color-muted-foreground: #64748b;
  --color-destructive: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-border: #e2e8f0;
  --color-input: #e2e8f0;
  --color-ring: #3b82f6;

  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}
```

### 4.2 Tokens de diseño

| Token | Valor | Uso |
|-------|-------|-----|
| `--color-primary` | `#0f172a` | Headers, botones primarios |
| `--color-accent` | `#3b82f6` | Links, estados activos, énfasis |
| `--color-success` | `#22c55e` | Éxito, pagos confirmados |
| `--color-destructive` | `#ef4444` | Errores, eliminar, deuda |
| `--color-warning` | `#f59e0b` | Alertas, vencimientos próximos |
| `--font-sans` | Inter | Todo el texto UI |
| `--font-mono` | JetBrains Mono | Montos, códigos, tablas |

### 4.3 shadcn/ui: Componentes base

```bash
# Instalación de componentes shadcn/ui
npx shadcn add button
npx shadcn add card
npx shadcn add dialog
npx shadcn add dropdown-menu
npx shadcn add form
npx shadcn add input
npx shadcn add select
npx shadcn add table
npx shadcn add tabs
npx shadcn add toast
npx shadcn add tooltip
npx shadcn add badge
npx shadcn add avatar
npx shadcn add skeleton
npx shadcn add sheet
npx shadcn add calendar
n```

**Ventaja de shadcn/ui:**
- Código fuente en tu proyecto (no es una dependencia)
- Totalmente customizable
- Basado en Radix UI (accesibilidad ARIA)
- Sin vendor lock-in

---

## 5. Zustand: Estado Global

### 5.1 Stores principales

```typescript
// src/stores/auth.store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  token: string | null;
  edificioActivo: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  setEdificioActivo: (edificioId: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      edificioActivo: null,
      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null, edificioActivo: null }),
      setEdificioActivo: (edificioId) => set({ edificioActivo: edificioId }),
    }),
    { name: 'auth-storage' }
  )
);
```

```typescript
// src/stores/ui.store.ts
interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  toast: Toast | null;
  toggleSidebar: () => void;
  setTheme: (theme: UIState['theme']) => void;
  showToast: (toast: Toast) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: 'system',
  toast: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
  showToast: (toast) => set({ toast }),
}));
```

### 5.2 Por qué Zustand sobre Redux

| Aspecto | Zustand | Redux Toolkit |
|---------|---------|---------------|
| Tamaño | ~1KB | ~11KB |
| Boilerplate | Mínimo | Moderado |
| TypeScript | Nativo | Requiere configuración |
| Middleware | Persist, devtools | Thunk, saga |
| Curva de aprendizaje | Baja | Media |
| Performance | Excelente | Excelente |

---

## 6. TanStack Query: Fetching y Cache

### 6.1 Configuración del cliente

```typescript
// src/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutos
      gcTime: 10 * 60 * 1000,   // 10 minutos
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
```

### 6.2 Hooks de datos

```typescript
// src/hooks/use-liquidaciones.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useLiquidaciones(edificioId: string) {
  return useQuery({
    queryKey: ['liquidaciones', edificioId],
    queryFn: () => api.liquidaciones.list(edificioId),
    enabled: !!edificioId,
  });
}

export function useCrearGasto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.gastos.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ 
        queryKey: ['gastos', data.edificioId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['liquidaciones', data.edificioId] 
      });
    },
  });
}
```

### 6.3 Optimistic Updates

```typescript
export function useActualizarEstadoTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.tickets.updateStatus,
    onMutate: async (newTicket) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      const previous = queryClient.getQueryData(['tickets']);
      queryClient.setQueryData(['tickets'], (old) => 
        old?.map(t => t.id === newTicket.id ? { ...t, ...newTicket } : t)
      );
      return { previous };
    },
    onError: (err, newTicket, context) => {
      queryClient.setQueryData(['tickets'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
```

---

## 7. Estructura de Carpetas

```
src/
├── api/                    # Cliente HTTP y endpoints
│   ├── client.ts           # Axios/fetch configurado
│   ├── endpoints/
│   │   ├── auth.ts
│   │   ├── edificios.ts
│   │   ├── gastos.ts
│   │   ├── liquidaciones.ts
│   │   ├── cobranzas.ts
│   │   ├── tickets.ts
│   │   └── ...
│   └── types.ts            # Tipos de API (shared con backend)
│
├── components/             # Componentes React
│   ├── ui/                  # shadcn/ui base (Button, Card, etc)
│   ├── layout/              # Layouts (Sidebar, Header, etc)
│   ├── forms/               # Formularios reutilizables
│   ├── data-display/        # Tablas, cards, charts
│   ├── feedback/            # Toasts, modales, skeletons
│   └── kanban/              # Componentes específicos de kanban
│
├── hooks/                   # Custom hooks
│   ├── use-auth.ts
│   ├── use-liquidaciones.ts
│   ├── use-cobranzas.ts
│   ├── use-tickets.ts
│   └── use-media-query.ts
│
├── stores/                  # Zustand stores
│   ├── auth.store.ts
│   ├── ui.store.ts
│   └── edificio.store.ts
│
├── lib/                     # Utilidades
│   ├── utils.ts             # cn() helper, formatters
│   ├── query-client.ts      # TanStack Query client
│   ├── constants.ts         # Constantes de la app
│   └── validators.ts        # Zod schemas compartidos
│
├── types/                   # Tipos globales
│   ├── index.ts
│   ├── edificio.ts
│   ├── usuario.ts
│   └── expensa.ts
│
├── pages/                   # Páginas/rutas
│   ├── admin/               # Dashboard admin
│   ├── residente/           # Portal residente
│   ├── auth/                # Login, register
│   └── onboarding/          # Flujo de alta de edificio
│
├── styles/                  # Estilos globales
│   └── globals.css
│
├── App.tsx                  # Entry point
└── main.tsx                 # Bootstrap
```

---

## 8. Convenciones de Código

### 8.1 Nomenclatura

| Tipo | Convención | Ejemplo |
|------|------------|---------|
| Componentes | PascalCase | `LiquidacionCard` |
| Hooks | camelCase con prefix `use` | `useLiquidaciones` |
| Stores | camelCase con suffix `.store` | `auth.store.ts` |
| Tipos | PascalCase | `Liquidacion` |
| Interfaces | PascalCase con prefix `I` opcional | `ILiquidacion` |
| Enums | PascalCase | `EstadoTicket` |
| Constantes | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |

### 8.2 Orden de imports

```typescript
// 1. React/core
import { useState, useEffect } from 'react';

// 2. Librerías de terceros
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// 3. Componentes internos
import { Button } from '@components/ui/button';
import { LiquidacionCard } from '@components/data-display/liquidacion-card';

// 4. Hooks y stores
import { useAuth } from '@hooks/use-auth';
import { useLiquidaciones } from '@hooks/use-liquidaciones';

// 5. Utilidades y tipos
import { formatCurrency } from '@lib/utils';
import type { Liquidacion } from '@types';
```

---

## 9. Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **React 19** | Sobre React 18 | Server Components + Actions reducen bundle y simplifican mutaciones |
| **Vite** | Sobre Webpack | HMR más rápido, configuración más simple, tree-shaking superior |
| **Tailwind** | Sobre CSS Modules | Prototipado rápido, consistencia, sin conflictos de nombres |
| **shadcn/ui** | Sobre MUI/Chakra | Sin vendor lock-in, código propio, accesible por defecto |
| **Zustand** | Sobre Redux | Menos boilerplate, nativo TypeScript, tamaño mínimo |
| **TanStack Query** | Sobre SWR | Cache más robusto, devtools, mutations con optimistic updates |
| **Zod** | Sobre Yup/Joi | Shared con backend (NodeJS), type inference nativa |
| **No Next.js** | SPA con React Router | No necesitamos SSR para un ERP. Simplifica hosting. |

---

## 10. Performance Targets

| Métrica | Target | Cómo lograrlo |
|---------|--------|---------------|
| First Contentful Paint | < 1.5s | Code splitting, lazy loading |
| Time to Interactive | < 3s | Minimize JS bundle, RSC |
| Largest Contentful Paint | < 2.5s | Optimized images, font loading |
| Cumulative Layout Shift | < 0.1 | Skeleton loaders, fixed dimensions |
| Bundle size inicial | < 200KB | Code splitting, tree shaking |

---

*Documento relacionado:* [[PRD-07-02 Diseño de Componentes]]  
*Documento relacionado:* [[PRD-07-03 Rutas y Navegación]]  
*Documento relacionado:* [[PRD-07-04 Estado Global]]  
*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]
