# S1 — Fundación visible (backlog)

> GENERADO desde app/state/ — editar el estado con engine.py, no este archivo
> **Objetivo:** login real → el usuario ve su organización y sus edificios.
> **Specs:** `PRD-02-04 Base de Datos` (schema), `PRD-08-05 Seguridad` (JWT), `PRD-05-04 Cerbos RBAC` (roles/políticas), `PRD-02-02 Stack Tecnológico` §6-7 (estructura front/back), `PRD-04-01 Gestión de Edificios` (entidades).
> **Modelo:** Organización (tenant raíz) → Edificio → Unidad → Usuario. Roles: `superadmin`, `org_admin`, `gestor` (org) / `consejo`, `propietario`, `inquilino`, `encargado`, `proveedor` (edificio).

## Backend — datos

- [x] **S1-01 Schema Prisma completo.** Llevar el schema de PRD-02-04 a `backend/prisma/schema.prisma`: `Organizacion`, `OrganizacionUsuario`, `GestorEdificio`, `Usuario`, `Edificio`, `Unidad`, `UnidadUsuario`, `Gasto`, `Liquidacion`, `LiquidacionDetalle`, `Cobro`, `Ticket`, `TicketComentario`, `Comunicacion`, `Documento`, `AuditLog`, `OrganizacionConfig`. Enums con roles canónicos. Todo con `organizacion_id`.
  - _Spec: PRD-02-04 §2. Depende de: nada._
- [x] **S1-02 Migración inicial + flujo db-migrate.** `npx prisma migrate dev` dentro del contenedor, verificar tablas + extensión `vector`. Documentar en README (`make db-migrate`).
  - _Depende de: S1-01._
- [x] **S1-03 Seed data rico.** `prisma/seed.js`: 1 organización demo ("Administración Demo S.A.", CUIT, matrícula RPA), 2 edificios, ~20 unidades con coeficientes A/B/C, usuarios: 1 org_admin, 1 gestor (1 edificio asignado), 3 propietarios, 1 inquilino, 1 encargado. Passwords hasheadas (bcrypt).
  - _Depende de: S1-02._

## Backend — auth y autorización

- [x] **S1-04 Auth JWT.** Endpoints `POST /api/auth/register` (crea organización + org_admin), `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`. Access token 15 min con claims `{ sub, email, org_id, roles, edificios_asignados }`; refresh UUID en Redis (7 días). bcrypt para passwords.
  - _Spec: PRD-08-05 §1. Depende de: S1-02._
- [x] **S1-05 Middleware de organización.** `tenant.middleware.js`: extrae `org_id` del JWT, lo inyecta en `req`, y valida que el `edificio_id` del request (params/body) pertenezca a la organización. 403 si no.
  - _Spec: PRD-02-01 §6.2. Depende de: S1-04._
- [x] **S1-06 Políticas Cerbos base.** `cerbos/policies/organizacion.yaml` (org_admin full, gestor read) y `edificio.yaml` (scope por `organizacion_id` + `edificios_asignados` para gestores). `rbac.middleware.js` que consulta Cerbos PDP.
  - _Spec: PRD-05-04 §3. Depende de: S1-05._

## Backend — API mínima del slice

- [x] **S1-07 Endpoint organizaciones.** `GET /api/organizaciones/me` (org del JWT con sus edificios), `PATCH /api/organizaciones/me` (solo org_admin).
  - _Depende de: S1-05._
- [x] **S1-08 Endpoint edificios (read).** `GET /api/edificios` (de la org, filtrado por `edificios_asignados` si es gestor), `GET /api/edificios/:id` (con unidades). Scope doble `{ organizacionId, id }`.
  - _Spec: PRD-04-01 §3. Depende de: S1-06._
- [x] **S1-09 Tests de API del slice.** Tests de integración: login → me → edificios; aislamiento (usuario de org A no ve edificios de org B); gestor solo ve edificios asignados.
  - _Depende de: S1-07, S1-08._

## Frontend — shell

- [x] **S1-10 Setup Tailwind + shadcn/ui + router.** Tailwind 4, shadcn/ui base, React Router con rutas `/login`, `/` (dashboard placeholder), `/edificios`, `/edificios/:id`.
  - _Spec: PRD-02-02 §6. Depende de: nada._
- [x] **S1-11 Auth store + pantalla login.** Zustand store con tokens + `organizacionId`, login form (React Hook Form + Zod), guard de rutas privadas, refresh automático.
  - _Depende de: S1-10, S1-04._
- [x] **S1-12 Layout app.** Sidebar (Edificios, Gastos/Liquidaciones/Cobranzas deshabilitados con badge "S2+"), header con selector de edificio de trabajo y menú de usuario (logout).
  - _Depende de: S1-11._
- [x] **S1-13 Lista de edificios.** Página `/edificios` conectada a `GET /api/edificios`: cards con nombre, dirección, cantidad de unidades. Detalle `/edificios/:id` read-only con tabla de unidades.
  - _Spec: PRD-04-01 §4. Depende de: S1-12, S1-08._

## Cierre

- [x] **S1-14 Smoke E2E + docs.** Script de smoke (login → edificios → detalle) corriendo contra el stack dockerizado. README actualizado con el flujo de desarrollo (up, migrate, seed, login demo con credenciales del seed).
  - _Depende de: S1-09, S1-13._

## Dependencias entre tareas

```
S1-01 ──► S1-02
S1-02 ──► S1-03
S1-02 ──► S1-04
S1-04 ──► S1-05
S1-05 ──► S1-06
S1-05 ──► S1-07
S1-06 ──► S1-08
S1-07 ──► S1-09
S1-08 ──► S1-09
S1-10 ──► S1-11
S1-04 ──► S1-11
S1-11 ──► S1-12
S1-12 ──► S1-13
S1-08 ──► S1-13
S1-09 ──► S1-14
S1-13 ──► S1-14
```

**Lotes paralelos sugeridos:** Lote A (S1-01→03), Lote B (S1-04→06), Lote C (S1-10), Lote D (S1-07/08), Lote E (S1-11→13), Lote F (S1-09/14).

## Definition of done del sprint

- `make up` + `make db-migrate` + `make db-seed` → login con `admin@demo.com` → lista de 2 edificios → detalle con unidades.
- Usuario de otra organización no ve nada de la demo (test automático).
- `make health` en verde; políticas Cerbos cargadas sin errores en logs.
