---
title: "PRD-07-03: Rutas y Navegacion"
description: "Especificacion del sistema de rutas, navegacion y estructura de URLs de ConsorcIA. Define el router, layouts anidados, proteccion de rutas por rol, breadcrumbs dinamicos y navegacion adaptativa por perfil de usuario."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [frontend, routing, react-router, navegacion, rutas, layouts, auth, mvp]
outcomes:
  - "Definir estructura completa de rutas para admin, portal y auth"
  - "Especificar proteccion de rutas por rol con Cerbos + React Router"
  - "Disenar navegacion adaptativa (sidebar, bottom nav, breadcrumbs)"
  - "Documentar lazy loading y code splitting por modulo"
  - "Establecer convenciones de URLs y parametros"
---

# PRD-07-03: Rutas y Navegacion

> **"La navegacion es el mapa mental del usuario. Si no sabe donde esta, no confia en el sistema."**  
> Una estructura de rutas clara y predecible reduce la curva de aprendizaje y minimiza errores de operacion.

---

## 1. Stack de Routing

| Tecnologia | Version | Propósito |
|------------|---------|-----------|
| **React Router** | v7 | Routing declarativo y data mode |
| **React Router DOM** | v7 | BrowserRouter, Routes, Route, Outlet |
| **Cerbos SDK** | latest | Verificacion de permisos en rutas |
| **Zustand** | latest | Estado de autenticacion y permisos |

> **Nota sobre React Router v7:** Combina React Router v6 + Remix. Soporta modo declarativo (SPA tradicional) y modo data (loaders/actions). **Implementado (S2-06):** ConsorcIA usa **data router** (`createBrowserRouter` + `RouterProvider` en `frontend/src/main.jsx`) porque la confirmación de salida con cambios sin guardar (PRD-07-02 §6.1) requiere `useBlocker`, que solo existe en data routers. No se usan loaders/actions: el data fetching sigue siendo TanStack Query (PRD-07-04). Ver documentacion oficial de React Router v7 para nested routes y data loaders.

---

## 2. Estructura de Rutas

### 2.1 Arbol de rutas completo

```
/
├── /login                    (AuthLayout)     → LoginPage
├── /register                 (AuthLayout)     → RegisterPage
├── /onboarding               (AuthLayout)     → OnboardingWizard
│   ├── /edificio             (AuthLayout)     → OnboardingEdificio
│   ├── /unidades             (AuthLayout)     → OnboardingUnidades
│   └── /confirmar            (AuthLayout)     → OnboardingConfirmar
│
├── /                         (AdminLayout)    → DashboardPage
│   ├── /dashboard            (AdminLayout)    → DashboardPage (index)
│   │
│   ├── /edificios            (AdminLayout)    → EdificiosListPage
│   │   ├── /nuevo            (AdminLayout)    → EdificioCreatePage
│   │   └── /:id              (AdminLayout)    → EdificioDetailPage
│   │       ├── /overview     (AdminLayout)    → EdificioOverviewTab
│   │       ├── /unidades     (AdminLayout)    → EdificioUnidadesTab
│   │       ├── /usuarios     (AdminLayout)    → EdificioUsuariosTab
│   │       └── /configuracion (AdminLayout)    → EdificioConfigTab
│   │
│   ├── /gastos               (AdminLayout)    → GastosListPage
│   │   ├── /nuevo            (AdminLayout)    → GastoCreatePage
│   │   └── /:id              (AdminLayout)    → GastoDetailPage
│   │       └── /editar       (AdminLayout)    → GastoEditPage
│   │
│   ├── /liquidaciones        (AdminLayout)    → LiquidacionesListPage
│   │   ├── /nuevo            (AdminLayout)    → LiquidacionCreatePage
│   │   └── /:id              (AdminLayout)    → LiquidacionDetailPage
│   │       ├── /             (AdminLayout)    → LiquidacionPreviewTab
│   │       ├── /detalle      (AdminLayout)    → LiquidacionDetalleTab
│   │       └── /recibos      (AdminLayout)    → LiquidacionRecibosTab
│   │
│   ├── /cobros               (AdminLayout)    → CobrosListPage
│   │   ├── /:id              (AdminLayout)    → CobroDetailPage
│   │   └── /morosidad        (AdminLayout)    → MorosidadReportPage
│   │
│   ├── /tickets              (AdminLayout)    → TicketsKanbanPage
│   │   ├── /nuevo            (AdminLayout)    → TicketCreatePage
│   │   └── /:id              (AdminLayout)    → TicketDetailPage
│   │
│   ├── /importar             (AdminLayout)    → ImportacionPage
│   │   └── /:importId        (AdminLayout)    → ImportacionPreviewPage
│   │
│   ├── /documentos           (AdminLayout)    → DocumentosListPage
│   │   └── /:id              (AdminLayout)    → DocumentoViewPage
│   │
│   ├── /reportes             (AdminLayout)    → ReportesPage
│   │   └── /:reportId        (AdminLayout)    → ReporteDetailPage
│   │
│   └── /configuracion        (AdminLayout)    → ConfiguracionPage
│       ├── /perfil           (AdminLayout)    → ConfigPerfilTab
│       ├── /edificio         (AdminLayout)    → ConfigEdificioTab
│       ├── /notificaciones   (AdminLayout)    → ConfigNotificacionesTab
│       └── /planes           (AdminLayout)    → ConfigPlanesTab
│
├── /portal                   (PortalLayout)   → PortalDashboardPage
│   ├── /                     (PortalLayout)   → PortalDashboardPage (index)
│   ├── /expensas             (PortalLayout)   → PortalExpensasPage
│   │   ├── /                 (PortalLayout)   → PortalExpensasListTab
│   │   └── /:cobroId         (PortalLayout)   → PortalExpensaDetailPage
│   │
│   ├── /pagos                (PortalLayout)   → PortalPagosPage
│   ├── /documentos           (PortalLayout)   → PortalDocumentosPage
│   ├── /consultas           (PortalLayout)   → PortalConsultasPage
│   │   └── /:ticketId        (PortalLayout)   → PortalConsultaDetailPage
│   ├── /cuenta              (PortalLayout)   → PortalCuentaPage
│   └── /configuracion        (PortalLayout)   → PortalConfigPage
│
├── /publico                  (PublicLayout)   → LandingPage
│   ├── /                     (PublicLayout)   → LandingPage
│   ├── /precios              (PublicLayout)   → PricingPage
│   ├── /contacto             (PublicLayout)   → ContactPage
│   └── /legal                (PublicLayout)   → LegalPage
│       ├── /terminos         (PublicLayout)   → TerminosPage
│       └── /privacidad       (PublicLayout)   → PrivacidadPage
│
└── *                         (RootLayout)     → NotFoundPage
```

### 2.2 Convenciones de URL

> **Implementado (S2-07):** el detalle de edificio usa tabs como rutas hijas (`/edificios/:id/overview|unidades|configuracion`); `/edificios/:id` a secas **redirige a `/unidades`** (tab default, ver backlog S2). El tab `usuarios` aún no existe (llega con gestión de usuarios del edificio). El formulario de alta (S2-06) vive en `/edificios/nuevo` y redirige al detalle del edificio creado.

> **Implementado (S4-07/08/09):** rutas del slice de usuarios e identidad ([[PRD-04-11 Gestión de Usuarios e Identidad]] §8).
>
> | Ruta | Guard | Página | Notas |
> |------|-------|--------|-------|
> | `/register` | pública | `pages/RegisterPage.jsx` | Pendiente desde S1, ahora implementada: alta de organización + su org_admin. Link desde el login. **Único auto-registro del MVP** — los residentes entran solo por invitación (PRD-04-11 §5) |
> | `/invitacion/:token` | **pública** | `pages/InvitacionPage.jsx` | Activación de cuenta: el token del link es la única credencial del invitado (§7), así que va FUERA de `RequireAuth`. 410 `INVITACION_INVALIDA` → pantalla "invitación inválida o vencida" sin distinguir el motivo |
> | `/configuracion/usuarios` | `RequireRole org_admin` | `pages/configuracion/ConfiguracionUsuariosPage.jsx` | Backoffice de staff. Cerbos (`staff`) no le da al gestor ni lectura de la nómina, así que el guard de ruta y la entrada del sidebar se restringen al mismo set |
>
> Divergencias con §2.1 de este documento:
>
> - El **selector de organización** vive en el header del `AppLayout` (`components/layout/OrganizacionSelector.jsx`), no en una ruta: cambia el contexto del tenant con `POST /api/auth/cambiar-organizacion` + `queryClient.clear()` + redirect a `/`. Solo se muestra con **más de una** membresía activa (`user.organizaciones`, que viene en el DTO de usuario de todas las respuestas de auth); un residente puro no lo ve nunca.
> - `/configuracion` **no tiene página propia todavía** (las tabs perfil/edificio/notificaciones/planes de §2.1 llegan más adelante): `usuarios` es su primera ruta hija y el breadcrumb del segmento intermedio va sin href.
> - "Usuarios" entra al sidebar como módulo de primer nivel (no anidado bajo Configuración) porque es la única entrada de configuración que existe; se reacomoda cuando lleguen las demás.
> - Las páginas de residentes de una UF **no son rutas**: el panel "Residentes" es un `Drawer` que se abre desde la fila de la DataTable de unidades (PRD-04-11 §5: "desde la unidad → fila → Residentes"), sin URL propia.

| Regla | Ejemplo | Descripcion |
|-------|---------|-------------|
| **Recursos en plural** | `/edificios`, `/gastos` | Colecciones |
| **ID de recurso con param** | `/edificios/:id` | Detalle de entidad |
| **Acciones con verbo** | `/edificios/nuevo`, `/gastos/:id/editar` | Crear/editar |
| **Tabs como rutas hijas** | `/edificios/:id/unidades` | Subvistas |
| **Parametros de query para filtros** | `/gastos?periodo=2026-07&categoria=A` | Estado de UI |
| **Sin hash routing** | `/login` (no `/#/login`) | SEO + compatibilidad |
| **Lowercase con guiones** | `/pendiente-aprobacion` | Legibilidad |

---

## 3. Configuracion del Router

### 3.1 Router principal (App.tsx)

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Suspense, lazy } from 'react';

// Layouts (eager loaded)
import RootLayout from './layouts/RootLayout';
import AdminLayout from './layouts/AdminLayout';
import PortalLayout from './layouts/PortalLayout';
import AuthLayout from './layouts/AuthLayout';
import PublicLayout from './layouts/PublicLayout';

// Pages (lazy loaded por modulo)
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const OnboardingPage = lazy(() => import('./pages/auth/OnboardingPage'));

const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const EdificiosListPage = lazy(() => import('./pages/admin/edificios/EdificiosListPage'));
const EdificioCreatePage = lazy(() => import('./pages/admin/edificios/EdificioCreatePage'));
const EdificioDetailPage = lazy(() => import('./pages/admin/edificios/EdificioDetailPage'));

const GastosListPage = lazy(() => import('./pages/admin/gastos/GastosListPage'));
const GastoCreatePage = lazy(() => import('./pages/admin/gastos/GastoCreatePage'));
const GastoDetailPage = lazy(() => import('./pages/admin/gastos/GastoDetailPage'));

const LiquidacionesListPage = lazy(() => import('./pages/admin/liquidaciones/LiquidacionesListPage'));
const LiquidacionCreatePage = lazy(() => import('./pages/admin/liquidaciones/LiquidacionCreatePage'));
const LiquidacionDetailPage = lazy(() => import('./pages/admin/liquidaciones/LiquidacionDetailPage'));

const CobrosListPage = lazy(() => import('./pages/admin/cobros/CobrosListPage'));
const CobroDetailPage = lazy(() => import('./pages/admin/cobros/CobroDetailPage'));
const MorosidadReportPage = lazy(() => import('./pages/admin/cobros/MorosidadReportPage'));

const TicketsKanbanPage = lazy(() => import('./pages/admin/tickets/TicketsKanbanPage'));
const TicketCreatePage = lazy(() => import('./pages/admin/tickets/TicketCreatePage'));
const TicketDetailPage = lazy(() => import('./pages/admin/tickets/TicketDetailPage'));

const ImportacionPage = lazy(() => import('./pages/admin/importar/ImportacionPage'));
const ImportacionPreviewPage = lazy(() => import('./pages/admin/importar/ImportacionPreviewPage'));

const DocumentosListPage = lazy(() => import('./pages/admin/documentos/DocumentosListPage'));
const ReportesPage = lazy(() => import('./pages/admin/reportes/ReportesPage'));
const ConfiguracionPage = lazy(() => import('./pages/admin/configuracion/ConfiguracionPage'));

const PortalDashboardPage = lazy(() => import('./pages/portal/PortalDashboardPage'));
const PortalExpensasPage = lazy(() => import('./pages/portal/PortalExpensasPage'));
const PortalExpensaDetailPage = lazy(() => import('./pages/portal/PortalExpensaDetailPage'));
const PortalPagosPage = lazy(() => import('./pages/portal/PortalPagosPage'));
const PortalDocumentosPage = lazy(() => import('./pages/portal/PortalDocumentosPage'));
const PortalConsultasPage = lazy(() => import('./pages/portal/PortalConsultasPage'));
const PortalCuentaPage = lazy(() => import('./pages/portal/PortalCuentaPage'));
const PortalConfigPage = lazy(() => import('./pages/portal/PortalConfigPage'));

const LandingPage = lazy(() => import('./pages/public/LandingPage'));
const PricingPage = lazy(() => import('./pages/public/PricingPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          {/* Rutas publicas */}
          <Route element={<PublicLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="precios" element={<PricingPage />} />
          </Route>

          {/* Rutas de autenticacion */}
          <Route element={<AuthLayout />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="onboarding/*" element={<OnboardingPage />} />
          </Route>

          {/* Rutas de administracion (staff de la organizacion) */}
          <Route element={<RequireAuth allowedRoles={['org_admin', 'gestor']} />}>
            <Route element={<AdminLayout />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="edificios" element={<EdificiosListPage />} />
              <Route path="edificios/nuevo" element={<EdificioCreatePage />} />
              <Route path="edificios/:id/*" element={<EdificioDetailPage />} />
              <Route path="gastos" element={<GastosListPage />} />
              <Route path="gastos/nuevo" element={<GastoCreatePage />} />
              <Route path="gastos/:id" element={<GastoDetailPage />} />
              <Route path="gastos/:id/editar" element={<GastoDetailPage mode="edit" />} />
              <Route path="liquidaciones" element={<LiquidacionesListPage />} />
              <Route path="liquidaciones/nuevo" element={<LiquidacionCreatePage />} />
              <Route path="liquidaciones/:id/*" element={<LiquidacionDetailPage />} />
              <Route path="cobros" element={<CobrosListPage />} />
              <Route path="cobros/:id" element={<CobroDetailPage />} />
              <Route path="cobros/morosidad" element={<MorosidadReportPage />} />
              <Route path="tickets" element={<TicketsKanbanPage />} />
              <Route path="tickets/nuevo" element={<TicketCreatePage />} />
              <Route path="tickets/:id" element={<TicketDetailPage />} />
              <Route path="importar" element={<ImportacionPage />} />
              <Route path="importar/:importId" element={<ImportacionPreviewPage />} />
              <Route path="documentos" element={<DocumentosListPage />} />
              <Route path="reportes" element={<ReportesPage />} />
              <Route path="configuracion/*" element={<ConfiguracionPage />} />
            </Route>
          </Route>

          {/* Rutas del portal del residente */}
          <Route element={<RequireAuth allowedRoles={['propietario', 'inquilino']} />}>
            <Route element={<PortalLayout />}>
              <Route path="portal" element={<PortalDashboardPage />} />
              <Route path="portal/expensas" element={<PortalExpensasPage />} />
              <Route path="portal/expensas/:cobroId" element={<PortalExpensaDetailPage />} />
              <Route path="portal/pagos" element={<PortalPagosPage />} />
              <Route path="portal/documentos" element={<PortalDocumentosPage />} />
              <Route path="portal/consultas" element={<PortalConsultasPage />} />
              <Route path="portal/consultas/:ticketId" element={<PortalConsultasPage />} />
              <Route path="portal/cuenta" element={<PortalCuentaPage />} />
              <Route path="portal/configuracion" element={<PortalConfigPage />} />
            </Route>
          </Route>

          {/* Redirects */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

### 3.2 Guard de autenticacion (RequireAuth)

```typescript
// components/auth/RequireAuth.tsx
import { Navigate, useLocation, Outlet } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';
import { useEffect, useState } from 'react';
import { cerbosCheck } from '@/lib/cerbos';

interface RequireAuthProps {
  allowedRoles: string[];
  children?: React.ReactNode;
}

export function RequireAuth({ allowedRoles, children }: RequireAuthProps) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setAuthorized(false);
      return;
    }

    // Verificar permisos con Cerbos
    async function checkPermissions() {
      const hasAccess = await cerbosCheck({
        principal: { id: user.id, roles: user.roles },
        resource: { kind: 'route', id: location.pathname },
        action: 'access',
      });
      setAuthorized(hasAccess);
    }

    checkPermissions();
  }, [isAuthenticated, user, location.pathname]);

  if (isLoading) return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (authorized === null) return <FullPageLoader />;
  if (!authorized) return <Navigate to="/unauthorized" replace />;

  return children ? <>{children}</> : <Outlet />;
}
```

---

## 4. Navegacion por Perfil

### 4.1 Sidebar de Administrador

```typescript
// config/navigation.admin.ts
export const adminNavigation: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    href: '/dashboard',
    exact: true,
  },
  {
    id: 'edificios',
    label: 'Edificios',
    icon: 'Building2',
    href: '/edificios',
    badge: { variant: 'default', count: 0 },
  },
  {
    id: 'gastos',
    label: 'Gastos',
    icon: 'Receipt',
    href: '/gastos',
  },
  {
    id: 'liquidaciones',
    label: 'Liquidaciones',
    icon: 'Calculator',
    href: '/liquidaciones',
  },
  {
    id: 'cobros',
    label: 'Cobros',
    icon: 'CreditCard',
    href: '/cobros',
    badge: { variant: 'danger', count: 0, condition: 'morosos' },
  },
  {
    id: 'tickets',
    label: 'Tickets',
    icon: 'Ticket',
    href: '/tickets',
    badge: { variant: 'warning', count: 0, condition: 'vencidos' },
  },
  {
    id: 'importar',
    label: 'Importar',
    icon: 'Upload',
    href: '/importar',
    featureFlag: 'importacion-inteligente',
  },
  {
    id: 'documentos',
    label: 'Documentos',
    icon: 'FileText',
    href: '/documentos',
  },
  {
    id: 'reportes',
    label: 'Reportes',
    icon: 'BarChart3',
    href: '/reportes',
    featureFlag: 'reportes-avanzados',
  },
  {
    id: 'configuracion',
    label: 'Configuracion',
    icon: 'Settings',
    href: '/configuracion',
    children: [
      { label: 'Perfil', href: '/configuracion/perfil' },
      { label: 'Edificio', href: '/configuracion/edificio' },
      { label: 'Notificaciones', href: '/configuracion/notificaciones' },
      { label: 'Plan', href: '/configuracion/planes' },
    ],
  },
];
```

**Visual:**
```
+------------------+
|  CONSORCIA       |
|                  |
|  [Dashboard]     |
|  [Edificios]     |
|  [Gastos]        |
|  [Liquidaciones] |
|  [Cobros]    [3] |
|  [Tickets]   [2] |
|  [Importar]      |
|  [Documentos]    |
|  [Reportes]      |
|  [Configuracion] |
|                  |
|  v1.0.0          |
+------------------+
```

### 4.2 Bottom Navigation (Portal Residente - Mobile)

```typescript
// config/navigation.portal.ts
export const portalNavigation: NavItem[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    icon: 'Home',
    href: '/portal',
    exact: true,
  },
  {
    id: 'expensas',
    label: 'Expensas',
    icon: 'Receipt',
    href: '/portal/expensas',
    badge: { variant: 'danger', condition: 'vencidas' },
  },
  {
    id: 'pagos',
    label: 'Pagos',
    icon: 'CreditCard',
    href: '/portal/pagos',
  },
  {
    id: 'consultas',
    label: 'Consultas',
    icon: 'MessageCircle',
    href: '/portal/consultas',
    badge: { variant: 'info', condition: 'nuevas' },
  },
  {
    id: 'mas',
    label: 'Mas',
    icon: 'Menu',
    href: '/portal/cuenta',
  },
];
```

**Visual (mobile):**
```
+----------------------------------+
|                                  |
|  [Contenido del portal]          |
|                                  |
+----+----+----+----+----+
|Home|Exp |Pay |Chat|Mas |
+----+----+----+----+----+
```

### 4.3 Navegacion contextual (Edificio seleccionado)

```typescript
// Cuando un edificio esta seleccionado, el sidebar muestra
// acciones rapidas del edificio activo

interface EdificioContextNav {
  edificioId: string;
  edificioNombre: string;
  quickActions: {
    label: string;
    href: string;
    icon: string;
  }[];
}

// Ejemplo:
// Edificio: Av. Libertador 1234
// [Liquidar] -> /liquidaciones/nuevo?edificio=xxx
// [Cargar gasto] -> /gastos/nuevo?edificio=xxx
// [Nuevo ticket] -> /tickets/nuevo?edificio=xxx
```

---

## 5. Breadcrumbs Dinamicos

> **Implementado (S2-11):** `frontend/src/components/layout/Breadcrumbs.jsx` (integrado en `AppLayout`, sobre el `<Outlet />`) usa una config estatica con patrones `matchPath` para las rutas actuales: `/` (Inicio), `/edificios`, `/edificios/nuevo` y `/edificios/:id/overview|unidades|configuracion`. Dos divergencias con el diseño original de esta seccion:
>
> - El segmento dinamico `:id` se resuelve al nombre del edificio **desde el cache de TanStack Query** (lista de `useEdificios` o detalle ya cargado en `EdificioDetallePage`), **sin fetch extra** — el hook de §5.2 (fetch por breadcrumb) no se implementó. Fallback: "Edificio" mientras el dato no esta disponible.
> - "Inicio" apunta a `/` (el dashboard); no existe ruta `/dashboard` en el router actual.
>
> El ultimo segmento no es link (`aria-current="page"`); los intermedios son `Link` de react-router. Separador: chevron de lucide, texto muted para intermedios.

### 5.1 Configuracion de breadcrumbs por ruta

```typescript
// config/breadcrumbs.ts
export const breadcrumbConfig: Record<string, BreadcrumbConfig> = {
  '/dashboard': {
    items: [{ label: 'Inicio', href: '/dashboard' }],
  },
  '/edificios': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Edificios' },
    ],
  },
  '/edificios/nuevo': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Edificios', href: '/edificios' },
      { label: 'Nuevo Edificio' },
    ],
  },
  '/edificios/:id': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':nombreEdificio', dynamic: true },
    ],
  },
  '/edificios/:id/unidades': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Edificios', href: '/edificios' },
      { label: ':nombreEdificio', href: '/edificios/:id', dynamic: true },
      { label: 'Unidades' },
    ],
  },
  '/gastos': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Gastos' },
    ],
  },
  '/gastos/nuevo': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Gastos', href: '/gastos' },
      { label: 'Nuevo Gasto' },
    ],
  },
  '/gastos/:id': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Gastos', href: '/gastos' },
      { label: ':conceptoGasto', dynamic: true },
    ],
  },
  '/liquidaciones': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Liquidaciones' },
    ],
  },
  '/liquidaciones/:id': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Liquidaciones', href: '/liquidaciones' },
      { label: ':periodoLiquidacion', dynamic: true },
    ],
  },
  '/cobros': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Cobros' },
    ],
  },
  '/cobros/morosidad': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Cobros', href: '/cobros' },
      { label: 'Reporte de Morosidad' },
    ],
  },
  '/tickets': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Tickets' },
    ],
  },
  '/tickets/:id': {
    items: [
      { label: 'Inicio', href: '/dashboard' },
      { label: 'Tickets', href: '/tickets' },
      { label: 'Ticket #:id', dynamic: true },
    ],
  },
};
```

### 5.2 Hook useBreadcrumbs

```typescript
// hooks/use-breadcrumbs.ts
import { useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

export function useBreadcrumbs() {
  const location = useLocation();
  const params = useParams();

  // Resolver breadcrumbs dinamicos
  const config = resolveBreadcrumbConfig(location.pathname);

  // Fetch datos dinamicos si es necesario
  const { data: dynamicData } = useQuery({
    queryKey: ['breadcrumb', location.pathname, params],
    queryFn: async () => {
      const dynamicItems = config.items.filter(i => i.dynamic);
      const resolved = await Promise.all(
        dynamicItems.map(async (item) => {
          // Ej: para /edificios/:id, fetchear nombre del edificio
          if (item.label === ':nombreEdificio' && params.id) {
            const res = await fetch(`/api/edificios/${params.id}`);
            const data = await res.json();
            return { ...item, label: data.nombre };
          }
          // Similar para otros placeholders
          return item;
        })
      );
      return resolved;
    },
    enabled: config.items.some(i => i.dynamic),
  });

  return {
    items: dynamicData || config.items,
    showBackButton: config.items.length > 1,
  };
}
```

---

## 6. Lazy Loading y Code Splitting

### 6.1 Estrategia de splitting

| Chunk | Rutas | Tamano estimado | Prioridad |
|-------|-------|----------------|-----------|
| `main` | Layouts, auth, utilidades | ~150KB | Eager |
| `admin-dashboard` | Dashboard + KPIs + charts | ~200KB | Lazy |
| `admin-edificios` | Edificios CRUD + unidades | ~180KB | Lazy |
| `admin-gastos` | Gastos CRUD | ~120KB | Lazy |
| `admin-liquidaciones` | Liquidacion + preview + recibos | ~250KB | Lazy |
| `admin-cobros` | Cobros + morosidad | ~150KB | Lazy |
| `admin-tickets` | Kanban + ticket detail | ~200KB | Lazy |
| `admin-importar` | OCR + preview + tabulacion | ~300KB | Lazy (Fase 2) |
| `portal` | Portal residente completo | ~400KB | Lazy |
| `public` | Landing + pricing | ~200KB | Lazy |

### 6.2 Prefetching inteligente

```typescript
// hooks/use-prefetch-routes.ts
import { useEffect } from 'react';
import { useLocation } from 'react-router';

// Prefetch rutas probables basado en la ruta actual
const prefetchMap: Record<string, string[]> = {
  '/dashboard': ['/edificios', '/gastos', '/liquidaciones'],
  '/edificios': ['/edificios/nuevo', '/gastos'],
  '/gastos': ['/gastos/nuevo', '/liquidaciones'],
  '/liquidaciones': ['/liquidaciones/nuevo', '/cobros'],
  '/cobros': ['/cobros/morosidad', '/tickets'],
};

export function usePrefetchRoutes() {
  const location = useLocation();

  useEffect(() => {
    const routesToPrefetch = prefetchMap[location.pathname] || [];

    routesToPrefetch.forEach((route) => {
      // Prefetch con baja prioridad
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = route;
      link.as = 'document';
      link.fetchPriority = 'low';
      document.head.appendChild(link);
    });

    return () => {
      // Cleanup
      document.querySelectorAll('link[rel="prefetch"]').forEach((el) => el.remove());
    };
  }, [location.pathname]);
}
```

---

## 7. Estados de Error en Rutas

### 7.1 ErrorBoundary para rutas

```typescript
// components/error/RouteErrorBoundary.tsx
import { useRouteError, isRouteErrorResponse } from 'react-router';

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return <NotFoundPage />;
    }
    if (error.status === 403) {
      return <UnauthorizedPage />;
    }
    return (
      <ErrorState
        title={`Error ${error.status}`}
        description={error.statusText || 'Ocurrio un error inesperado'}
        onBack={() => window.history.back()}
      />
    );
  }

  return (
    <ErrorState
      title="Algo salio mal"
      description="Ocurrio un error inesperado. Por favor, intenta de nuevo."
      error={error}
      onRetry={() => window.location.reload()}
    />
  );
}
```

### 7.2 Paginas de error

| Ruta | Componente | Uso |
|------|-----------|-----|
| `*` (catch-all) | `NotFoundPage` | Ruta no existe |
| `/unauthorized` | `UnauthorizedPage` | Sin permisos |
| `/error` | `GenericErrorPage` | Error 500 |
| `/offline` | `OfflinePage` | Sin conexion (PWA) |

---

## 8. Feature Flags en Rutas

### 8.1 Configuracion

```typescript
// config/features.ts
export const features = {
  'importacion-inteligente': {
    enabled: false,
    planRequired: 'business',
    phase: 'fase2',
  },
  'reportes-avanzados': {
    enabled: false,
    planRequired: 'pro',
    phase: 'fase2',
  },
  'kanban-tickets': {
    enabled: false,
    planRequired: 'pro',
    phase: 'fase2',
  },
  'benchmarking': {
    enabled: false,
    planRequired: 'business',
    phase: 'fase3',
  },
  'gestion-personal': {
    enabled: false,
    planRequired: 'premium',
    phase: 'fase3',
  },
} as const;

// Hook
export function useFeatureFlag(featureId: string): boolean {
  const { user } = useAuthStore();
  const feature = features[featureId as keyof typeof features];

  if (!feature) return false;
  if (!feature.enabled) return false;

  // Verificar plan
  const userPlan = user?.plan || 'starter';
  const planHierarchy = ['starter', 'pro', 'business', 'enterprise'];
  const userPlanIndex = planHierarchy.indexOf(userPlan);
  const requiredPlanIndex = planHierarchy.indexOf(feature.planRequired);

  return userPlanIndex >= requiredPlanIndex;
}
```

---

## 9. Decisiones de Diseno Clave

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **React Router v7 (data router)** | `createBrowserRouter` | Implementado en S2-06: `useBlocker` (confirmar salida con cambios sin guardar) solo funciona en data routers. El data fetching sigue con TanStack Query, no con loaders/actions. |
| **Roles canónicos en guards** | Set único de 8 roles | Nivel organización: `org_admin`, `gestor` (acceso al área admin). Nivel edificio: `propietario`, `inquilino`, `encargado`, `consejo`, `proveedor` (portal). `superadmin` es staff ConsorcIA. Ver [[PRD-05-04 Cerbos RBAC]] §2. |
| **Lazy loading por modulo** | Si | Reduce bundle inicial. Admin no carga portal y viceversa. |
| **Cerbos en frontend** | Solo verificacion UI | El backend SIEMPRE valida. Cerbos en frontend es UX, no seguridad. |
| **Breadcrumbs dinamicos** | Con datos de API | Nombres de edificios, conceptos de gastos, etc. se resuelven dinamicamente. |
| **Feature flags por plan** | Si | Permite desactivar rutas segun plan de pago sin deploy. |
| **Bottom nav en portal mobile** | Si | 70% de residentes usaran mobile. Bottom nav es patron nativo. |
| **Sidebar colapsable en admin** | Si | Admin usa desktop/tablet. Sidebar expande/colapsa segun viewport. |
| **Prefetching inteligente** | Si | Mejora perceived performance sin costo de carga inicial. |
| **URL state para filtros** | Query params | Permite compartir URLs con filtros aplicados. Bookmarkable. |
| **Nested routes para tabs** | Si | /edificios/:id/unidades es mas limpio que /edificios/:id?tab=unidades. |

---

*Documento relacionado:* [[PRD-07-02 Diseno de Componentes]]
*Documento relacionado:* [[PRD-07-04 Estado Global]]
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]
*Documento relacionado:* [[PRD-01-02 Estrategia de MVP y Fases]]
