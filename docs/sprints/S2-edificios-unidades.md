# S2 — Edificios y unidades (backlog)

> **Objetivo:** alta completa de un edificio con sus unidades y coeficientes A/B/C, validando que la suma de coeficientes sea exactamente 1.
> **Specs:** `PRD-04-01 Gestión de Edificios` (entidades, endpoints), `PRD-07-02 Diseño de Componentes` (patrones de formularios, DataTable, ConfirmDialog), `PRD-07-03 Rutas y Navegación` (rutas, tabs anidados, breadcrumbs), `PRD-07-04 Estado Global` (TanStack Query, queryKeys), `PRD-02-04 Base de Datos` (schema ya migrado en S1).
> **Modelo:** la organización es el tenant; todo endpoint scopea `{ organizacionId, edificioId }`. org_admin: CRUD completo; gestor: solo edificios asignados (lectura + unidades).

## Backend

- [x] **S2-01 CRUD edificios.** `POST /api/edificios` (org_admin), `PATCH /api/edificios/:id`, `DELETE /api/edificios/:id` (soft delete, `activo=false`). Validación Zod del schema de PRD-04-01 §2 (nombre, direccion, ciudad, provincia, tipo, fechaInicioAdmin). Autorización vía Cerbos (`rbac.middleware`). Errores del contrato `{ error: { code, message } }`.
  - _Depende de: nada (S1 cerrado)._
- [x] **S2-02 CRUD unidades + invariante de coeficientes.** `POST /api/edificios/:id/unidades` (bulk: array de unidades), `PATCH /api/unidades/:id`, `DELETE /api/unidades/:id`. Invariante con **decimal.js**: la suma de `coeficiente` por edificio debe ser 1.000000 — validar en cada operación (rechazar con 422 `COEFICIENTES_NO_CUADRAN` informando suma actual y delta). `GET /api/edificios/:id/unidades` con paginación (`?page=&limit=`).
  - _Depende de: S2-01._
- [x] **S2-03 Tests de API del slice.** Bulk create feliz + rechazo por coeficientes ≠ 1; PATCH que descuadra coeficientes → 422; gestor crea unidad en edificio no asignado → 403; org B no toca edificio de org A. Limpiar datos creados.
  - _Depende de: S2-02._

## Frontend — fundación

- [x] **S2-04 Adoptar TanStack Query.** Instalar `@tanstack/react-query` (+ devtools en dev). Config según PRD-07-04 §2.1 (staleTime 5min, retry 3). `src/lib/query-keys.js` según §2.2 (edificios, gastos placeholder). Refactor: `useEdificios` y `organizaciones/me` a `useQuery`; `auth.store` limpia el cache en logout (`queryClient.clear()`).
  - _Depende de: nada._
- [x] **S2-05 Tokens de dominio.** Agregar a `src/index.css` las variables de PRD-07-02 §2.1 para categorías A/B/C y estados (success/warning/danger/info) y mapearlas a las variantes de `Badge`. Sin migración completa del tema.
  - _Depende de: nada._

## Frontend — features

- [ ] **S2-06 Formulario nuevo edificio.** Ruta `/edificios/nuevo` (07-03). RHF + Zod con patrones 07-02 §6.1: validación onBlur por campo, submit deshabilitado hasta válido, loading en botón, toast de éxito/error, confirmación al salir con cambios sin guardar. Redirige al detalle del edificio creado.
  - _Depende de: S2-01, S2-04._
- [ ] **S2-07 Detalle con tabs anidados.** `/edificios/:id` → tabs `overview` (datos + stats), `unidades` (tabla, default), `configuracion` (S2-10). Nested routes según 07-03 §2. El selector del header sigue navegando a `/edificios/:id/unidades`.
  - _Depende de: S2-04._
- [ ] **S2-08 DataTable de unidades.** TanStack Table (instalar `@tanstack/react-table`) siguiendo 07-02 §3.5: sort por número/tipo/m²/coeficiente, fila TOTAL (Σm² y Σcoeficiente con formato 6 decimales, en verde si = 1, danger si no), badges de categorías A/B/C (tokens S2-05), empty state (07-02 §6.2), skeleton de carga.
  - _Depende de: S2-05, S2-07._
- [ ] **S2-09 Alta de unidades (form + bulk).** Form de unidad individual (número, tipo, m², coeficiente, categorías A/B/C con checkboxes) + modo bulk "carga rápida" (N filas editables). Feedback inline de la invariante: "Suma actual: 0.973000 — falta 0.027000" actualizado al editar (decimal.js en cliente). Botón guardar deshabilitado si no cuadra.
  - _Depende de: S2-02, S2-08._
- [x] **S2-10 Editar/eliminar edificio.** Tab `configuracion`: form de edición (PATCH) + zona de peligro con eliminar usando `ConfirmDialog` con `requireText` (07-02 §4.8, flujo destructivo §6.3). Optimistic update con rollback (07-04 §2.5).
  - _Depende de: S2-01, S2-07._

## Cierre

- [ ] **S2-11 Breadcrumbs.** Componente en AppLayout según 07-03 §5: config estática para las rutas actuales + resolución dinámica del nombre del edificio (desde el store de edificio activo, sin fetch extra).
  - _Depende de: S2-07._
- [ ] **S2-12 Tests E2E + smoke + docs.** Extender `scripts/smoke.sh` (crear edificio + bulk unidades + invariante 422). Playwright: spec "crear edificio y agregar unidades". README y checkboxes. `npm test` backend en verde (S1 + S2).
  - _Depende de: S2-03, S2-09, S2-10._

## Dependencias entre tareas

```
S2-01 ──► S2-02 ──► S2-03 ────────────────┐
S2-04 ──┬─► S2-06                          │
        ├─► S2-07 ──► S2-08 ──► S2-09 ──► S2-12
S2-05 ──┘      └────► S2-10                │
              └────► S2-11 ────────────────┘
```

**Lotes paralelos sugeridos:** Lote A (S2-01→03), Lote B (S2-04+05), Lote C (S2-06/07), Lote D (S2-08/09/10), Lote E (S2-11/12).

## Definition of done del sprint

- Login admin → "Nuevo edificio" → alta con 5 unidades bulk → tabla con Σcoeficiente = 1.000000 en verde.
- Intento de guardar unidades que suman 0.9 → 422 con mensaje de delta (API) y botón deshabilitado (UI).
- Gestor no puede crear edificio ni tocar un edificio no asignado (test automático).
- Breadcrumbs muestran Inicio / Edificios / {nombre} / Unidades.
