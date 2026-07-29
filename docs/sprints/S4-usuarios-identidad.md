# S4 — Usuarios e identidad (backlog)

> **Objetivo:** alta de staff por backoffice y de residentes por invitación, con identidad global por email (una persona = un login = N unidades en N consorcios).
> **Spec canónica:** `PRD-04-11 Gestión de Usuarios e Identidad` (vault). También toca `PRD-02-04` (schema), `PRD-07-03` (rutas) y `PRD-04-05` (portal, solo sync de la suposición de org activa).
> **Por qué antes del portal:** el portal residente (S5) necesita residentes reales logueados; este slice los crea.
> **Modelo:** identidad global (Usuario con email único, sin `organizacionId` ni `rol`); permisos como vínculos (`OrganizacionUsuario` staff, `GestorEdificio`, `UnidadUsuario` residente). Cerbos sigue fail-closed.

## Backend

- [x] **S4-01 Migración a identidad global.** Schema: `Usuario.email` `@unique` global (lowercase), eliminar `Usuario.organizacionId` y `Usuario.rol` (migrar datos a `OrganizacionUsuario`), agregar `OrganizacionUsuario.activo`. Adaptar `register` (email global único → 422 `EMAIL_YA_REGISTRADO`), `login` (por email global), `tenant.middleware` (org activa desde membresía, no del Usuario) y emisión de JWT (claims iguales: `sub, email, org_id, roles, edificios_asignados` derivados de la membresía activa). Actualizar `PRD-02-04` en la misma tarea.
  - _Depende de: nada (S3 no toca auth). **Ojo:** es breaking para tests S1/S2 — ajustarlos._
- [x] **S4-02 Modelo Invitación + endpoints.** Modelo `Invitacion` (PRD-04-11 §2.3) + migración. `GET /api/invitaciones/:token` (público, email enmascarado) y `POST /api/invitaciones/:token/aceptar` (define password, activa, loguea). 410 `INVITACION_INVALIDA`, un solo uso, expira 7 días.
  - _Depende de: S4-01._
- [x] **S4-03 Endpoints staff (Workflow A).** `GET/POST /api/organizaciones/me/usuarios`, `PATCH /api/organizaciones/me/usuarios/:id` (rol, edificios de gestor, activar/desactivar). Alta por email: usuario nuevo → crea Usuario + membresía + invitación; existente → solo membresía + invitación. Respuesta incluye `invitacionUrl` (MVP sin envío de email — link para copiar; el envío queda encapsulado para AgentMail post-beta). Guard: no desactivar al último org_admin (422 `ULTIMO_ORG_ADMIN`).
  - _Depende de: S4-02._
- [x] **S4-04 Endpoints residentes (Workflow B).** `GET/POST /api/unidades/:id/residentes`, `DELETE /api/unidades/:id/residentes/:vinculoId` (fechaFin, no borrado físico). Mismo patrón email-nuevo/existente; 409 `VINCULO_DUPLICADO`. Cerbos: org_admin y gestor asignado.
  - _Depende de: S4-02._
- [x] **S4-05 Cambio de organización activa.** `POST /api/auth/cambiar-organizacion` — valida membresía activa (403 `SIN_MEMBRESIA`) y re-emite JWT + refresh con la org elegida.
  - _Depende de: S4-01._
- [x] **S4-06 Tests de API del slice.** Register con email existente → 422; invitar staff nuevo y existente; aceptar invitación (feliz, token inválido, segundo uso → 410); residente multi-org (mismo email en 2 orgs, un solo Usuario en DB); switch de org; gestor invita en edificio no asignado → 403; org B no lista staff de org A. Limpiar datos creados.
  - _Depende de: S4-03, S4-04, S4-05._

## Frontend

- [ ] **S4-07 Backoffice de staff.** Ruta `/configuracion/usuarios` (07-03): tabla de staff (nombre, email, rol, edificios, estado), form de invitación (RHF + Zod, multi-select de edificios si rol=gestor), modal con `invitacionUrl` para copiar tras el alta. Edición de edificios del gestor y activar/desactivar con ConfirmDialog. Guards: solo org_admin (RequireRole, patrón de S2).
  - _Depende de: S4-03._
- [ ] **S4-08 Residentes + activación + register.** (a) Drawer "Residentes" desde la fila de la DataTable de unidades: lista vínculos, form "Vincular persona", desvincular con ConfirmDialog. (b) Pantalla pública `/invitacion/:token`: muestra a qué te invitaron y form de password (confirmación + validación de fuerza mínima). (c) `RegisterPage` en `/register` (pendiente de S1: endpoint ya existe) — alta de organización + org_admin.
  - _Depende de: S4-02, S4-04._
- [ ] **S4-09 Selector de organización en header.** Si el usuario staff tiene N membresías activas, dropdown en el header → `cambiar-organizacion` → `queryClient.clear()` + redirect al dashboard. Con 1 sola membresía no se muestra.
  - _Depende de: S4-05, S4-07._

## Cierre

- [ ] **S4-10 Seed multi-caso + smoke + docs.** Seed con los 7 casos de PRD-04-11 §10 (2 gestores, Org B con edificio+UFs, residente multi-consorcio, inquilino simple, propietario multi-UF, invitación pendiente) — credenciales documentadas en AGENTS.md. Extender `scripts/smoke.sh` (invitar staff + aceptar invitación + switch org). Actualizar AGENTS.md (identidad global como excepción al "todo cuelga de la organización"), PRD-07-03 (rutas nuevas) y checkboxes. `npm test` en verde (S1–S4).
  - _Depende de: S4-06, S4-08, S4-09._

## Dependencias entre tareas

```
S4-01 ──► S4-02 ──► S4-03 ──┬─► S4-06 ─────────────┐
       │           └─► S4-07 │                     │
       ├──► S4-04 ───────────┤                     │
       ├──► S4-05 ──► S4-09 ─┴─────────────────────► S4-10
       └────────────────────► S4-08 ───────────────┘
```

**Lotes paralelos sugeridos:** Lote A (S4-01→02), Lote B (S4-03/04/05), Lote C (S4-06), Lote D (S4-07/08/09), Lote E (S4-10).

## Definition of done del sprint

- Admin invita a un gestor (form backoffice) → acepta invitación → login → solo ve sus edificios asignados.
- Gestor vincula un propietario a una UF → el propietario activa por `/invitacion/:token` → login → portal muestra su UF.
- La misma persona (un email) es propietaria en Org A y Org B → **un solo Usuario** en la DB y un solo login que ve ambas UFs.
- Staff con 2 membresías → selector de organización en el header cambia el contexto sin re-login.
- Tests de aislamiento cross-org en verde; seed con los 7 casos documentado en AGENTS.md.
