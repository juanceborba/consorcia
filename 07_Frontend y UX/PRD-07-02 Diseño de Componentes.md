---
title: "PRD-07-02: Diseño de Componentes"
description: "Sistema de diseño, biblioteca de componentes reutilizables, tokens de diseño, patrones de UI/UX y guías de implementación para ConsorcIA."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [frontend, componentes, design-system, ui, ux, shadcn, react, consorcIA, mvp]
outcomes:
  - "Establecer un sistema de diseño coherente y escalable"
  - "Documentar todos los componentes reutilizables con props y variantes"
  - "Definir tokens de diseño (colores, tipografía, espaciado, sombras)"
  - "Especificar patrones de interacción y accesibilidad (WCAG 2.1 AA)"
  - "Garantizar consistencia visual entre módulos admin y portal residente"
---

# PRD-07-02: Diseño de Componentes

> **"La consistencia visual es confianza. Un sistema de diseño bien hecho reduce el tiempo de desarrollo en un 40%."**
> ConsorcIA utiliza shadcn/ui como base semántica, extendido con componentes propios para el dominio de consorcios.

---

## 1. Stack de Diseño

### 1.1 Tecnologías base

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| **Framework UI** | React | 19 | Componentes declarativos |
| **Estilos** | Tailwind CSS | 4 | Utility-first CSS |
| **Base semántica** | shadcn/ui | latest | Componentes accesibles, sin lock-in |
| **Animaciones** | Framer Motion | 11 | Transiciones y micro-interacciones |
| **Iconos** | Lucide React | latest | Iconografía consistente |
| **Gráficos** | Recharts | 2 | Visualizaciones de datos |
| **Tablas** | TanStack Table | 8 | Tablas avanzadas con sort/filter |
| **Formularios** | React Hook Form + Zod | 7 + 3 | Validación type-safe |
| **Fechas** | date-fns | 3 | Manipulación de fechas |
| **Moneda** | Intl.NumberFormat | nativo | Formato ARS/USD |

### 1.2 Filosofía de diseño

```
┌─────────────────────────────────────────────────────────────┐
│  PRINCIPIOS DE DISEÑO CONSORCIA                             │
│                                                              │
│  1. CLARIDAD SOBRE ESTÉTICA                                  │
│     El usuario administra plata. La información financiera   │
│     debe ser legible al primer vistazo.                      │
│                                                              │
│  2. ACCIÓN SOBRE CONTEMPLACIÓN                               │
│     Cada pantalla tiene una acción principal (CTA) clara.    │
│     No hay dead-ends.                                        │
│                                                              │
│  3. CONFIANZA SOBRE SORPRESA                                 │
│     Las operaciones destructivas requieren confirmación.     │
│     Los estados de éxito/error son explícitos.               │
│                                                              │
│  4. MOBILE-FIRST, DESKTOP-OPTIMIZED                          │
│     El portal residente se usa principalmente en móvil.      │
│     El dashboard admin se usa principalmente en desktop.     │
│                                                              │
│  5. ACCESIBILIDAD NO NEGOCIABLE                              │
│     WCAG 2.1 AA como mínimo.                                 │
│     Contraste 4.5:1 para texto, 3:1 para UI components.      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Tokens de Diseño

### 2.1 Paleta de colores

```css
/* === CORE === */
--color-primary:        #0F172A;    /* Slate 900 - headers, texto principal */
--color-primary-hover:  #1E293B;    /* Slate 800 */
--color-secondary:      #3B82F6;    /* Blue 500 - CTAs, links, estados activos */
--color-secondary-hover:#2563EB;    /* Blue 600 */
--color-accent:         #10B981;    /* Emerald 500 - éxito, pagado, aprobado */
--color-accent-hover:   #059669;    /* Emerald 600 */
--color-warning:        #F59E0B;    /* Amber 500 - advertencias, pendiente */
--color-warning-hover:  #D97706;    /* Amber 600 */
--color-danger:         #EF4444;    /* Red 500 - errores, rechazado, moroso */
--color-danger-hover:   #DC2626;    /* Red 600 */
--color-info:           #6366F1;    /* Indigo 500 - información, borrador */
--color-info-hover:     #4F46E5;    /* Indigo 600 */

/* === NEUTRALES === */
--color-background:     #F8FAFC;    /* Slate 50 - fondo general */
--color-surface:        #FFFFFF;    /* Blanco - cards, modales */
--color-surface-elevated: #FFFFFF;  /* Con sombra */
--color-border:         #E2E8F0;    /* Slate 200 - bordes, divisores */
--color-border-strong:  #CBD5E1;    /* Slate 300 - bordes focus */
--color-text-primary:   #0F172A;    /* Slate 900 */
--color-text-secondary: #64748B;    /* Slate 500 - labels, hints */
--color-text-tertiary:  #94A3B8;    /* Slate 400 - placeholders, disabled */
--color-text-inverse:   #FFFFFF;    /* Texto sobre fondos oscuros */

/* === CATEGORÍAS ESPECÍFICAS === */
--color-cat-a:          #3B82F6;    /* Categoría A - gastos generales */
--color-cat-b:          #8B5CF6;    /* Categoría B - servicios específicos */
--color-cat-c:          #F97316;    /* Categoría C - sectores específicos */
--color-ordinario:      #10B981;    /* Gasto ordinario */
--color-extraordinario: #F59E0B;    /* Gasto extraordinario */
```

> **Implementado (S2-05):** los estados y categorías viven como tokens de Tailwind 4 en `frontend/src/index.css` (bloque `@theme`): `--color-success` (= accent #10B981), `--color-warning`, `--color-danger`, `--color-info` (con sus `-hover`) y `--color-cat-a/b/c`. El resto de la paleta sigue siendo el tema shadcn base-nova (`:root` oklch) pendiente de migración completa.

### 2.2 Tipografía

```css
/* === FAMILIA === */
/* Implementado: Geist Variable (@fontsource-variable/geist, via shadcn init) */
--font-sans: 'Geist Variable', 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* === ESCALA === */
--text-xs:   0.75rem;   /* 12px - badges, tags */
--text-sm:   0.875rem;  /* 14px - labels, hints, tabla compacta */
--text-base: 1rem;      /* 16px - body, inputs */
--text-lg:   1.125rem;  /* 18px - subtítulos */
--text-xl:   1.25rem;   /* 20px - títulos de card */
--text-2xl:  1.5rem;    /* 24px - títulos de sección */
--text-3xl:  1.875rem;  /* 30px - títulos de página */
--text-4xl:  2.25rem;   /* 36px - hero, dashboard KPI */

/* === PESO === */
--font-normal:   400;
--font-medium:   500;   /* Labels, botones */
--font-semibold: 600;   /* Títulos, datos destacados */
--font-bold:     700;   /* KPIs, headers */

/* === ALTURA DE LÍNEA === */
--leading-tight:  1.25;  /* Headings */
--leading-normal: 1.5;   /* Body */
--leading-relaxed: 1.625;/* Descripciones largas */
```

### 2.3 Espaciado

```css
/* === ESCALA 4px BASE === */
--space-0:  0px;
--space-1:  4px;    /* gap ícono-texto */
--space-2:  8px;    /* padding interno compacto */
--space-3:  12px;   /* padding botón small */
--space-4:  16px;   /* padding estándar */
--space-5:  20px;   /* gap entre grupos */
--space-6:  24px;   /* padding card */
--space-8:  32px;   /* gap entre secciones */
--space-10: 40px;   /* padding página */
--space-12: 48px;   /* separación de bloques */

/* === BORDER RADIUS === */
--radius-sm:  4px;   /* badges, tags */
--radius-md:  6px;   /* inputs, botones */
--radius-lg:  8px;   /* cards, modales */
--radius-xl:  12px;  /* cards destacadas */
--radius-2xl: 16px;  /* modales grandes */
--radius-full: 9999px; /* avatares, pills */
```

### 2.4 Sombras

```css
--shadow-sm:   0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md:   0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg:   0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl:   0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
--shadow-inner: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);
```

---

## 3. Componentes Base (shadcn/ui extendidos)

### 3.1 Botón `<Button />`

```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
  size: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}
```

| Variante | Uso | Ejemplo |
|----------|-----|---------|
| `primary` | Acción principal de la pantalla | "Guardar edificio", "Generar liquidación" |
| `secondary` | Acción secundaria | "Cancelar", "Volver" |
| `outline` | Acción terciaria, grupo de botones | "Filtrar", "Exportar" |
| `ghost` | Acción dentro de tabla/card | "Editar", "Ver detalle" |
| `destructive` | Acciones destructivas | "Eliminar", "Anular liquidación" |
| `link` | Navegación dentro de texto | "Ver más", "Términos y condiciones" |

```
┌─────────────────────────────────────────────────────────────┐
│  VARIANTES DE BOTÓN                                         │
│                                                             │
│  [Guardar cambios]        ← primary, md                     │
│  [Cancelar]               ← secondary, md                   │
│  [Filtrar]                ← outline, sm                     │
│  [✏️ Editar]              ← ghost, sm                       │
│  [🗑️ Eliminar]            ← destructive, sm                 │
│  Ver detalle →            ← link                            │
│                                                             │
│  Estados:                                                   │
│  [Guardando...]           ← primary + loading               │
│  [Guardar cambios]        ← primary + disabled (opacity 50) │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Input `<Input />`

```typescript
interface InputProps {
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  type?: 'text' | 'number' | 'email' | 'password' | 'tel' | 'date' | 'month';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  required?: boolean;
  prefix?: string;      // "$", "m²"
  suffix?: string;      // "ARS", "%"
  icon?: LucideIcon;    // Icono izquierdo
  rightElement?: React.ReactNode; // Botón, icono derecho
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  Nombre del edificio *                                      │
│  [Av. Libertador 1234                                ]      │
│                                                             │
│  Monto *                                                    │
│  [$│450.000      │] [ARS ▼]                                │
│                                                             │
│  Coeficiente *                                              │
│  [0.027742                                         ]        │
│  ⚠️ La suma de coeficientes debe ser exactamente 1.000000   │
│                                                             │
│  Período *                                                  │
│  [2026-07       ]                                           │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Select `<Select />`

```typescript
interface SelectProps<T> {
  label?: string;
  placeholder?: string;
  options: { value: T; label: string; disabled?: boolean }[];
  value?: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  error?: string;
  searchable?: boolean;     // Búsqueda dentro del select
  clearable?: boolean;
  multiple?: boolean;       // Para categorías B (array)
}
```

### 3.4 Card `<Card />`

```typescript
interface CardProps {
  variant?: 'default' | 'outlined' | 'elevated' | 'interactive';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  header?: {
    title: string;
    subtitle?: string;
    action?: React.ReactNode; // Botón en header
    icon?: LucideIcon;
  };
  footer?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;      // Solo variant='interactive'
  href?: string;             // Navegación
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  🏢 Av. Libertador 1234                          [Ver] [⚙️] │
│  CABA | 36 unidades | Desde: Ene 2024                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ 36         │  │ 24         │  │ 10         │            │
│  │ Unidades   │  │ Deptos     │  │ Cocheras   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 Tabla `<DataTable />`

```typescript
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  sorting?: boolean;
  filtering?: boolean;
  selection?: 'single' | 'multiple';
  expandable?: boolean;     // Filas expandibles para detalle
  emptyState?: {
    icon: LucideIcon;
    title: string;
    description: string;
    action?: React.ReactNode;
  };
  loading?: boolean;
  onRowClick?: (row: T) => void;
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  Unidades (36)                                    [+ Agregar]│
├─────────────────────────────────────────────────────────────┤
│  Número ▼│ Tipo ▼     │ m² ▼  │ Coeficiente ▼│ Cat. A │ ...│
│  ────────┼────────────┼───────┼──────────────┼────────┼────│
│  1A      │ Departamento│ 85   │ 0.027742     │ ✓      │ ...│
│  1B      │ Departamento│ 85   │ 0.027742     │ ✓      │ ...│
│  ...     │ ...        │ ...   │ ...          │ ...    │ ...│
│  ────────┼────────────┼───────┼──────────────┼────────┼────│
│  TOTAL   │            │ 3064  │ 1.000000     │        │    │
├─────────────────────────────────────────────────────────────┤
│  [Anterior] Página 1 de 3 [Siguiente]                       │
└─────────────────────────────────────────────────────────────┘
```

> **Nota de implementación (S2-08, tabla de unidades):** el tab pide `GET /api/edificios/:id/unidades?limit=100` (el máximo del contrato) en una sola página y ordena client-side con TanStack Table — no implementa controles de paginación. Si un edificio supera las 100 unidades, el pie aclara que el Σm² es parcial. El coeficiente se muestra siempre con 6 decimales (`0.027742`), no como porcentaje.
>
> **Nota de implementación (#57, invariante informativa):** el Σcoeficiente de la fila TOTAL y su veredicto **los calcula el backend** (`coeficientes: { suma, delta, cuadra }` de la respuesta, decimal.js sobre todas las unidades del edificio) — el cliente no los recalcula. La fila TOTAL va `text-success` si cuadra y `text-warning` si no (**nunca danger**: descuadrar no es un error), y cuando `cuadra === false` se muestra un `<Alert variant="warning">` arriba de la tabla: *"Faltan 0.120000. Revisá los coeficientes de tus unidades y/o verificá si te falta cargar alguna unidad al sistema. La sumatoria total debe ser 1."* (variante *"Sobran X…"* si `delta` es negativo).
>
> **Nota de implementación (S2-09 + #57):** el botón `[+ Agregar]` del header (slot `CardAction`) abre el modal de alta de unidades (§3.6): modo individual (número, tipo, m², coeficiente, categorías A/B/C) y modo bulk "carga rápida" (grilla de N filas editables). Ambos envían array al endpoint bulk. Al cargar los m² de una UF se **autocompleta el coeficiente sugerido** (`m² / totalM2` del edificio, 6 decimales, editable; cada cambio de m² vuelve a sugerir, así una edición manual se respeta hasta que se toquen los m² de esa fila). El feedback inline muestra la suma resultante del edificio ("Suma actual: X — falta/sobra Y") en los dos modos, en `text-warning` cuando no cierra, y **Guardar nunca se deshabilita por la suma** — solo por la validación de campos o el submit en vuelo.

### 3.5.1 Alert `<Alert />`

```typescript
interface AlertProps {
  variant: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: React.ReactNode;   // Detalle del aviso
}
```

Banda de aviso **inline** (dentro del contenido, no toast) para condiciones persistentes que el usuario resuelve cuando puede — a diferencia del toast, que es efímero, y del ConfirmDialog (§4.8), que es bloqueante. `role="alert"`, ícono por variante (`Info` / `CheckCircle2` / `AlertTriangle` / `XCircle` de lucide) y los tokens de estado de §2.

> **Implementación:** `frontend/src/components/ui/alert.jsx`. Primer uso (#57): la suma de coeficientes de un edificio que no cierra en 1.000000, arriba de la DataTable de unidades.

### 3.6 Modal `<Modal />`

```typescript
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;  // Botones de acción
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  preventClose?: boolean;    // Para operaciones críticas
}
```

> **Nota de implementación (S2-09):** el Modal se implementó como `<Dialog />`
> en `frontend/src/components/ui/dialog.jsx` sobre el Dialog de Base UI
> (`Root/Portal/Backdrop/Popup/Title/Description/Close`, mismo estilo que el
> ConfirmDialog de §4.8). Contenido scrolleable (`max-h` con `overflow-y`)
> para formularios largos; cierra con Escape y con la X — el cierre con
> cambios sin guardar lo confirma el formulario consumidor (§6.1.8), no el
> componente. Primer uso: alta de unidades del tab Unidades — desde el
> refinamiento post-#57 son **dos dialogs separados** con botón propio en el
> listado: `UnidadAltaDialog` (alta individual, tabs "Datos de la unidad" /
> "Categorías de gastos" sobre el mismo form) y `UnidadBulkDialog` (carga
> rápida, grilla de N filas). Ambos con feedback de la invariante de
> coeficientes calculado con decimal.js en cliente.

### 3.7 Badge `<Badge />`

```typescript
interface BadgeProps {
  variant: 'default' | 'success' | 'warning' | 'danger' | 'info'
         | 'categoriaA' | 'categoriaB' | 'categoriaC'
         | 'outline'
         | 'secondary' | 'destructive' | 'ghost' | 'link';  // base shadcn base-nova
  size?: 'sm' | 'md';
  dot?: boolean;            // Punto de color antes del texto
  pulse?: boolean;          // Animación de pulso (alertas)
  children: React.ReactNode;
}
```

| Variante | Uso |
|----------|-----|
| `default` | Estado neutral |
| `success` | Pagado, Aprobado, Resuelto, Cerrado |
| `warning` | Pendiente, Parcial, Borrador |
| `danger` | Moroso, Rechazado, Vencido, Crítico |
| `info` | En progreso, Enviado, Nuevo |
| `outline` | Estados secundarios |
| `categoriaA` | Unidad en categoría A (gastos generales) — token `cat-a` |
| `categoriaB` | Unidad en categoría B (servicios específicos) — token `cat-b` |
| `categoriaC` | Unidad en categoría C (sectores específicos) — token `cat-c` |

```
Estados de cobro:
[● Pagado]  [● Pendiente]  [● Parcial]  [● Moroso]
   verde        azul          ambar        rojo

Estados de liquidación:
[BORRADOR]  [PENDIENTE]  [APROBADA]  [ENVIADA]  [COBRADA]
   gris        ambar        verde       azul       verde osc
```

### 3.8 Toast `<Toast />`

```typescript
interface ToastProps {
  id: string;
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;        // ms, default 5000
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss: (id: string) => void;
}
```

---

## 4. Componentes de Dominio (propios de ConsorcIA)

### 4.1 `<KpiCard />` — Tarjeta de métrica

```typescript
interface KpiCardProps {
  title: string;
  value: string | number;
  format?: 'currency' | 'percentage' | 'number' | 'decimal';
  currency?: 'ARS' | 'USD';
  variation?: {
    value: number;        // Porcentaje
    type: 'increase' | 'decrease' | 'neutral';
    label: string;        // "vs mes anterior"
  };
  icon: LucideIcon;
  color: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
  onClick?: () => void;
  href?: string;
}
```

```
┌─────────────────────────────────────────┐
│  💰 Gasto Total                         │
│                                         │
│  $2.450.000                             │
│  ▲ 12% vs junio                         │
└─────────────────────────────────────────┘
```

### 4.2 `<EstadoCobro />` — Indicador de estado de cobro

```typescript
interface EstadoCobroProps {
  estado: 'PENDIENTE' | 'PAGADO' | 'PARCIAL' | 'MOROSO' | 'PERDONADO';
  montoTotal: number;
  montoPagado?: number;
  montoPendiente?: number;
  size?: 'sm' | 'md' | 'lg';
  showProgress?: boolean;   // Barra de progreso para PARCIAL
}
```

### 4.3 `<ReciboPreview />` — Preview de recibo

```typescript
interface ReciboPreviewProps {
  liquidacion: Liquidacion;
  unidad: Unidad;
  edificio: Edificio;
  modo: 'preview' | 'final';  // Preview: sin QR final
  onAprobar?: () => void;
  onRechazar?: () => void;
  onDescargar?: () => void;
}
```

### 4.4 `<DistribucionChart />` — Gráfico de distribución A/B/C

```typescript
interface DistribucionChartProps {
  data: {
    categoria: 'A' | 'B' | 'C';
    monto: number;
    porcentaje: number;
    unidadesAfectadas: number;
  }[];
  type?: 'pie' | 'donut' | 'bar';
  showLegend?: boolean;
  interactive?: boolean;
}
```

### 4.5 `<FormularioGasto />` — Formulario inteligente de gasto

```typescript
interface FormularioGastoProps {
  edificioId: string;
  initialData?: Partial<Gasto>;
  onSubmit: (gasto: Gasto) => void;
  onCancel: () => void;
  modo: 'crear' | 'editar';
  // Integración con Agente Contable
  sugerenciaIA?: {
    categoria: 'A' | 'B' | 'C';
    esOrdinario: boolean;
    confianza: number;
  };
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  Nuevo Gasto                                                │
├─────────────────────────────────────────────────────────────┤
│  Concepto *                                                 │
│  [Sueldo encargado                                    ]     │
│                                                             │
│  💡 Sugerencia IA (94% confianza):                        │
│     "Este gasto parece ser ordinario de categoría A."      │
│     [✅ Usar sugerencia]  [✏️ Editar manualmente]          │
│                                                             │
│  Categoría *      [A - General ▼]                          │
│  Tipo             [Ordinario ●] [Extraordinario ○]         │
│                                                             │
│                    [Cancelar]  [Guardar Gasto]              │
└─────────────────────────────────────────────────────────────┘
```

### 4.6 `<TicketKanban />` — Tarjeta de ticket para Kanban

```typescript
interface TicketKanbanProps {
  ticket: Ticket;
  onClick?: () => void;
  onDragStart?: () => void;
  compact?: boolean;        // Vista mini para dashboard
  showSla?: boolean;        // Mostrar indicador de SLA
}
```

```
┌─────────────────────────────────────────┐
│  TK-0234  🔴 Crítica                    │
│  Canilla rota en baño 3B                │
│                                         │
│  🏷️ plomería  │  ⏰ Vence en 2h          │
│  Asignado: Plomero García               │
└─────────────────────────────────────────┘
```

### 4.7 `<FileUploader />` — Carga de archivos con preview

```typescript
interface FileUploaderProps {
  accept?: string[];        // ['.pdf', '.jpg']
  maxSize?: number;         // MB
  maxFiles?: number;
  onUpload: (files: File[]) => void;
  onRemove?: (file: File) => void;
  preview?: boolean;        // Mostrar preview de imagen/PDF
  dragDrop?: boolean;
  uploading?: boolean;
  progress?: number;
}
```

### 4.8 `<ConfirmDialog />` — Diálogo de confirmación

```typescript
interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  requireText?: string;     // Texto que debe escribir para confirmar
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Anular liquidación                                      │
├─────────────────────────────────────────────────────────────┤
│  ¿Estás seguro de que querés anular la liquidación de       │
│  Julio 2026? Esta acción no se puede deshacer.              │
│                                                             │
│  Escribí "ANULAR" para confirmar:                          │
│  [ANULAR                                          ]         │
│                                                             │
│                    [Cancelar]  [Anular liquidación]          │
└─────────────────────────────────────────────────────────────┘
```

> **Implementado (S2-10):** `frontend/src/components/ui/confirm-dialog.jsx`, sobre `AlertDialog` de Base UI (modal: no cierra por click fuera). Además de las props de la interfaz, expone `loading?: boolean` — cubre el paso "Procesando..." del flujo destructivo §6.3 con spinner en el botón de confirmar y deshabilita cancelar/teclear mientras tanto. La comparación de `requireText` es exacta (case-sensitive) y el texto tipeado se limpia al cerrar.

---

## 5. Layouts y Templates

### 5.1 Layout Administrador

```
┌─────────────────────────────────────────────────────────────────┐
│  🏠 ConsorcIA                    [🔔] [⚙️] [👤 María G.]       │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│  🏢 Mis  │  [Contenido principal]                               │
│  Edificios│                                                      │
│          │                                                      │
│  💰 Gastos│                                                      │
│          │                                                      │
│  📊 Liq.  │                                                      │
│  Expensas │                                                      │
│          │                                                      │
│  💳 Cobros│                                                      │
│          │                                                      │
│  📋 Kanban│                                                      │
│          │                                                      │
│  📈 Dash  │                                                      │
│          │                                                      │
│  ⚙️ Config│                                                      │
│          │                                                      │
├──────────┴──────────────────────────────────────────────────────┤
│  © 2026 ConsorcIA — v1.0.0                                      │
└─────────────────────────────────────────────────────────────────┘
```

**Especificaciones:**
- Sidebar: 240px fijo en desktop, drawer en mobile
- Header: 64px fijo
- Content: padding 24px, max-width 1440px centrado
- Footer: 40px, solo versión y copyright
- Sidebar colapsable a 64px (solo iconos)

### 5.2 Layout Portal Residente

```
┌─────────────────────────────────────────────────────────────┐
│  🏠 ConsorcIA — Portal del Residente              [☰] [👤] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Contenido mobile-first]                                   │
│                                                             │
│  Bottom Navigation (mobile):                                │
│  [🏠] [💰] [📄] [💬] [👤]                                  │
│  Inicio Expensas Docs Chat Perfil                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Especificaciones:**
- Mobile-first: 100% width, padding 16px
- Bottom nav en mobile (5 tabs)
- Top bar con menú hamburguesa y avatar
- Desktop: layout similar a admin pero simplificado

### 5.3 Layout Auth (login/registro)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    ┌─────────────────────────┐               │
│                    │      🏠 ConsorcIA       │               │
│                    │                         │               │
│                    │  Iniciar sesión         │               │
│                    │                         │               │
│                    │  Email *                │               │
│                    │  [                    ] │               │
│                    │                         │               │
│                    │  Contraseña *           │               │
│                    │  [                    ] │               │
│                    │                         │               │
│                    │  [Iniciar sesión]       │               │
│                    │                         │               │
│                    │  ¿No tenés cuenta?      │               │
│                    │  Registrate             │               │
│                    └─────────────────────────┘               │
│                                                             │
│              © 2026 ConsorcIA. Todos los derechos reservados│
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Patrones de Interacción

### 6.1 Formularios

```
REGLAS DE FORMULARIOS:
─────────────────────────────────────────────────────────────
1. Validación en tiempo real (onBlur para campos individuales)
2. Validación de submit para el formulario completo
3. Errores inline debajo del campo, color danger
4. Campos obligatorios marcados con *
5. Botón submit deshabilitado hasta que el formulario sea válido
6. Estado de loading en el botón durante submit
7. Toast de éxito al completar, toast de error si falla
8. Confirmación antes de salir con cambios sin guardar
```

### 6.2 Listados y tablas

```
REGLAS DE LISTADOS:
─────────────────────────────────────────────────────────────
1. Empty state siempre definido (nunca tabla vacía sin mensaje)
2. Skeleton loaders durante carga inicial
3. Pagination server-side para >50 items
4. Sorting por columnas relevantes
5. Filtering por campos clave
6. Acciones en hover (desktop) o swipe (mobile)
7. Selección múltiple para acciones batch (si aplica)
```

### 6.3 Operaciones destructivas

```
FLUJO DE OPERACIÓN DESTRUCTIVA:
─────────────────────────────────────────────────────────────
1. Usuario hace click en "Eliminar"
2. Botón cambia a estado loading
3. Modal de confirmación con descripción del impacto
4. Si es muy destructivo: requiere escribir texto de confirmación
5. Al confirmar: API call con toast de "Procesando..."
6. Éxito: toast verde + redirección o actualización de lista
7. Error: toast rojo con mensaje específico
```

### 6.4 Estados de carga

```
ESTADOS DE CARGA:
─────────────────────────────────────────────────────────────
| Estado        | Visual                        | Duración   |
|---------------|-------------------------------|------------|
| Inicial       | Skeleton screens              | < 1s       |
| Cargando      | Spinner centrado              | 1-3s       |
| Cargando largo| Spinner + texto explicativo   | > 3s       |
| Vacío         | Empty state ilustrado         | —          |
| Error         | Error state con retry         | —          |
```

### 6.5 Ayuda contextual (FAQ embebido)

Patrón para explicar conceptos de dominio en el momento en que el usuario los
necesita (implementado en el refinamiento post-#57 del alta de unidades; es el
patrón de referencia para todos los módulos).

**Piezas:**

| Pieza | Ubicación | Rol |
|-------|-----------|-----|
| Registro de topics | `frontend/src/lib/ayuda.js` | Mapa `AYUDA_TOPICS` con el contenido, keyed por ID de topic (path con slash, estable: es el contrato). Cada topic: `ruta` (breadcrumb), `titulo`, `secciones: [{ titulo, cuerpo, items? }]`. |
| Store global | `frontend/src/stores/ayuda.store.js` | Zustand efímero: `{ topic, abrirAyuda, cerrarAyuda }`. |
| `<AyudaDrawer />` | `frontend/src/components/ayuda/` | Única instancia montada en `AppLayout` (Drawer §-lateral sobre Base UI). Resuelve el topic del store, muestra breadcrumb con › + secciones; topic inexistente → fallback, nunca rompe. Se apila sobre modales sin conflicto (portal propio). |
| `<AyudaLink />` | `frontend/src/components/ayuda/` | Trigger: `<AyudaLink topic="modulo/pantalla/tema" />` (botón link con ícono, `type="button"` para vivir dentro de forms). |

**Reglas de uso:**

1. El concepto se explica **inline primero** (texto corto junto al control);
   el drawer es la profundización ("Más información"), no el único lugar.
2. El ID del topic es un path estable (`edificios/unidades/categorias-gastos`)
   → una vez publicado no se renombra.
3. Agregar ayuda a un módulo = una entrada en el registro + un `AyudaLink`.
   Nada más.
4. El contenido vive estático en el frontend (copy es-AR, sin i18n ni CMS).

**Camino de evolución a FAQ completo** (aditivo, sin refactor de consumidores):
hub `/ayuda` navegable, búsqueda cliente, deep links por topic y contenido en
Markdown + frontmatter (`import.meta.glob`). Como los consumidores dependen del
ID de topic y del registro (no del almacenamiento), migrar cambia solo los
internals de `ayuda.js`.

---

## 7. Accesibilidad (WCAG 2.1 AA)

### 7.1 Requisitos obligatorios

| Criterio | Implementación | Ejemplo |
|----------|---------------|---------|
| **Contraste** | 4.5:1 texto, 3:1 UI | Texto Slate 900 sobre Slate 50 = 12:1 ✅ |
| **Navegación teclado** | Tab order lógico | Todos los elementos interactivos focuseables |
| **Screen readers** | aria-labels, roles | `<button aria-label="Cerrar modal">` |
| **Focus visible** | Outline 2px solid secondary | `:focus-visible { ring-2 ring-blue-500 }` |
| **Texto escalable** | rem units | Usuario puede hacer zoom al 200% |
| **Error identification** | aria-describedby | Input vinculado a mensaje de error |
| **Form labels** | label for="id" o aria-label | Todos los inputs tienen label visible |
| **Color no único** | Iconos + texto | Estado "moroso" = rojo + icono + texto |

### 7.2 Componentes accesibles

```typescript
// Ejemplo: Botón con todos los atributos ARIA
<Button
  aria-label="Generar liquidación de julio 2026"
  aria-describedby="liquidacion-ayuda"
  aria-busy={loading}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => e.key === 'Enter' && onClick()}
>
  Generar liquidación
</Button>
<span id="liquidacion-ayuda" className="sr-only">
  Al hacer click se calculará la liquidación del período seleccionado
</span>
```

---

## 8. Responsive Breakpoints

```css
/* === BREAKPOINTS === */
--breakpoint-sm:  640px;   /* Mobile landscape */
--breakpoint-md:  768px;   /* Tablet */
--breakpoint-lg:  1024px;  /* Desktop */
--breakpoint-xl:  1280px;  /* Desktop grande */
--breakpoint-2xl: 1536px;  /* Monitor ancho */
```

| Breakpoint | Sidebar | Layout | Tablas |
|------------|---------|--------|--------|
| < 640px (mobile) | Drawer | Single column | Cards |
| 640-768px | Drawer | Single column | Cards |
| 768-1024px | Collapsed (iconos) | 2 columns | Tabla compacta |
| 1024-1280px | Expanded (240px) | 2-3 columns | Tabla completa |
| > 1280px | Expanded | 3-4 columns | Tabla completa + sidebar info |

---

## 9. Dark Mode (Fase 2)

```css
/* === DARK MODE TOKENS === */
[data-theme="dark"] {
  --color-background:     #0F172A;    /* Slate 900 */
  --color-surface:        #1E293B;    /* Slate 800 */
  --color-surface-elevated: #334155;  /* Slate 700 */
  --color-border:         #334155;    /* Slate 700 */
  --color-text-primary:   #F1F5F9;    /* Slate 100 */
  --color-text-secondary: #94A3B8;    /* Slate 400 */
  --color-text-tertiary:  #64748B;    /* Slate 500 */
}
```

> **Nota:** Dark mode se implementa en Fase 2. El MVP usa solo light mode.

---

## 10. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **shadcn/ui como base** | Componentes accesibles | Sin vendor lock-in, código propio, extensible. Implementado con style `base-nova` (Base UI en vez de Radix): algunas APIs difieren (`render=` en vez de `asChild`, `onClick` en vez de `onSelect`). |
| **Tailwind CSS v4** | Estilos | Utility-first, tree-shaking, bundle pequeño |
| **Lucide icons** | Iconografía | Consistente, tree-shakeable, 1000+ iconos |
| **Framer Motion** | Animaciones | Declarativo, performante, buen DX |
| **Recharts** | Gráficos | Nativo React, suficiente para MVP |
| **TanStack Table** | Tablas | Sort, filter, pagination, virtualización |
| **React Hook Form** | Formularios | Performance, re-renders controlados |
| **Zod** | Validación | Type-safe, mensajes de error personalizables |
| **Geist font** | Tipografía | Instalada con el init de shadcn (`@fontsource-variable/geist`). Excelente rendering en números, métrica consistente. (Se evaluó Inter; Geist cumple el mismo rol sin migración.) |
| **Slate palette** | Colores base | Neutral, profesional, buen contraste |
| **Mobile-first portal** | UX residente | 70% de usuarios acceden desde móvil |
| **Desktop-first admin** | UX admin | Admin trabaja desde escritorio |

---

*Documento relacionado:* [[PRD-07-01 Stack Frontend]]  
*Documento relacionado:* [[PRD-07-03 Rutas y Navegación]]  
*Documento relacionado:* [[PRD-07-04 Estado Global]]  
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]