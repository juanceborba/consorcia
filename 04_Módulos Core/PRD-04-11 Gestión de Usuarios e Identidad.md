---
title: "PRD-04-11: Gestión de Usuarios e Identidad"
description: "Identidad global por email, workflows de alta de staff (backoffice) y residentes (invitación), multi-pertenencia a organizaciones y unidades, roles y accesos MVP."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, usuarios, identidad, invitaciones, rbac, onboarding, mvp]
outcomes:
  - "Una persona = un solo Usuario global identificado por email, con N membresías (staff) y N vínculos a unidades (residente), incluso entre distintas organizaciones"
  - "Alta de staff administrativo desde el backoffice (form), con permisos por edificio"
  - "Alta de residentes (propietario/inquilino) por invitación con link de activación"
  - "Modelo de datos, endpoints, UX y seed definidos para el slice S4"
---

# PRD-04-11: Gestión de Usuarios e Identidad

> **"Una persona, un login, todos sus consorcios."**
> Este PRD define cómo se dan de alta y cómo acceden los dos universos de usuarios del SaaS: el **staff** de las administraciones (operan el backoffice) y los **residentes** (propietarios/inquilinos, usan el portal). Es prerequisito del portal del residente ([[PRD-04-05 Portal del Residente]]): sin alta de residentes no hay quién se loguee.

---

## 1. Problema

Hasta S2 el sistema solo tiene dos caminos para crear usuarios: `POST /api/auth/register` (crea organización + su org_admin) y el seed. No existe forma de:

- Agregar personal administrativo a una organización (gestores, administrativos con acceso limitado).
- Dar de alta propietarios/inquilinos y vincularlos a sus unidades.
- Representar que **una misma persona** es propietaria de unidades en varios consorcios, incluso administrados por **distintas organizaciones** (hoy `Usuario` tiene `organizacion_id` y `@@unique([organizacionId, email])`: la misma persona sería N filas-usuario con N passwords).

Además el schema actual tiene dos limitaciones estructurales:

- `Usuario.rol` es un único rol por fila → incompatible con "gestor en la org A y propietario en la org B".
- `OrganizacionUsuario.rol` ya existe como membresía: el rol de `Usuario` es redundante y se elimina.

---

## 2. Modelo de identidad (MVP)

### 2.1 Principio

**La identidad es global; los permisos son vínculos.** Un `Usuario` existe una sola vez en el sistema y se identifica unívocamente por su **email** (ver §7 para la decisión). Todo acceso se deriva de vínculos:

```
Usuario (global, email único)
  ├── OrganizacionUsuario (staff) ──────► Organización      rol: ORG_ADMIN | GESTOR
  │        └── GestorEdificio ──────────► Edificio          (solo si GESTOR: edificios permitidos)
  └── UnidadUsuario (residente) ────────► Unidad ─► Edificio ─► Organización
                                            esPropietario / esInquilino, fechaInicio/Fin
```

- **Staff** (pertenece a la organización): `org_admin` (administra todo, incluido el alta de usuarios) y `gestor` (personal operativo/administrativo limitado a los edificios asignados vía `GestorEdificio`).
- **Residentes** (pertenecen al edificio/UF): `propietario` e `inquilino`, modelados como flags de `UnidadUsuario` (una UF puede tener ambos; una persona puede tener N UFs en N edificios de N organizaciones).
- `superadmin` (ConsorcIA, cross-org) y los roles `consejo`, `encargado`, `proveedor`: **fuera del MVP de este slice** — el modelo los admite pero no hay workflows de alta todavía.

### 2.2 Cambios de schema (migración)

| Modelo | Cambio |
|--------|--------|
| `Usuario` | Quitar `organizacion_id` y `rol`. `email` pasa a `@unique` global (normalizado a lowercase). Quedan: `passwordHash`, `nombre`, `apellido`, `telefono?`, `activo` |
| `OrganizacionUsuario` | Sin cambios de estructura (ya es la membresía staff con `rol`). Agregar `activo` para baja lógica |
| `GestorEdificio` | Sin cambios (permisos por edificio del gestor) |
| `UnidadUsuario` | Sin cambios de estructura. `organizacion_id` se mantiene desnormalizado (scope de queries/Cerbos), consistente con `unidad.edificio.organizacionId` |
| `Invitacion` (nuevo) | Ver §2.3 |

> La migración mueve el `rol`/`organizacionId` de cada `Usuario` existente a su `OrganizacionUsuario` (ya reflejado en el seed de S1) y elimina la columna. `PRD-02-04 Base de Datos` se actualiza en la misma tarea (regla de sincronización).

### 2.3 Invitacion (nuevo modelo)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | |
| `email` | String | Normalizado lowercase |
| `organizacionId` | UUID | Quien invita (scope tenant) |
| `tipo` | Enum | `STAFF` \| `RESIDENTE` |
| `payload` | Json | STAFF: `{ rol, nombre, apellido, edificioIds[] }` · RESIDENTE: `{ nombre, apellido, unidadId, esPropietario, esInquilino, fechaInicio }` |
| `token` | UUID | En el link `/invitacion/:token` |
| `expiraAt` | DateTime | 7 días |
| `usadaAt` | DateTime? | Un solo uso |
| `invitadoPorId` | UUID | FK → Usuario (auditoría) |

Restricción: una sola invitación **pendiente** por `(email, organizacionId, tipo)`. Reenviar = regenerar token/expiración.

---

## 3. Roles y accesos (MVP)

| Rol | Nivel | Alta | Acceso |
|-----|-------|------|--------|
| `org_admin` | Organización | `register` (el primero) o invitación staff | Todo en su org: edificios, unidades, gastos, **usuarios**, config |
| `gestor` | Organización | Invitación staff (backoffice) | Lectura de su org; operación solo en `GestorEdificio` asignados (unidades, gastos del edificio). No crea edificios ni usuarios |
| `propietario` | Edificio/UF | Invitación residente | Portal: sus UFs (de todos sus consorcios), expensas, recibos, pagos |
| `inquilino` | Edificio/UF | Invitación residente | Igual que propietario (MVP; diferenciación de permisos queda para el portal) |

La autorización sigue siendo Cerbos fail-closed ([[PRD-05-04 Cerbos RBAC]]); el fast-path de vínculo usuario↔unidad del portal se mantiene (ver §8, sync con PRD-04-05).

---

## 4. Workflow A — Alta de staff (backoffice)

**Quién:** `org_admin`. **Dónde:** sección "Usuarios" en la configuración de la organización.

1. Org_admin abre **Configuración → Usuarios → "Invitar staff"**.
2. Form (RHF + Zod): `email`, `nombre`, `apellido`, `rol` (org_admin | gestor), y si es gestor, multi-select de **edificios asignados**.
3. Submit → `POST /api/organizaciones/me/usuarios`:
   - Si el email **no existe**: crea `Usuario` (sin password) + `OrganizacionUsuario` (+ `GestorEdificio` si gestor) + `Invitacion` tipo STAFF.
   - Si el email **ya existe** (persona de otra org o residente): solo agrega la membresía/vínculos + invitación de "sumaste una organización" — **mismo login**, sin password nuevo.
4. MVP: la UI muestra el **link de invitación para copiar** (AgentMail llega post-beta, ver [[PRD-05-01 AgentMail]] — el endpoint ya deja el envío encapsulado).
5. El invitado abre `/invitacion/:token` → define su password → cuenta activa → login.
6. Si el staff tiene membresías en N organizaciones, tras el login ve un **selector de organización** en el header; `POST /api/auth/cambiar-organizacion` re-emite el JWT con el `org_id` activo (mismos claims de siempre: `sub, email, org_id, roles, edificios_asignados`).

Gestión posterior (misma pantalla): listar staff, cambiar rol, editar edificios del gestor, desactivar (baja lógica de la membresía, no del Usuario global).

---

## 5. Workflow B — Alta de residente (invitación)

**Quién:** `org_admin` o `gestor` asignado. **Dónde:** desde la unidad (tab unidades del edificio → fila → "Residentes").

1. En el detalle de la UF, botón **"Vincular persona"**.
2. Form: `email`, `nombre`, `apellido`, tipo (`propietario` y/o `inquilino`), `fechaInicio` (default hoy).
3. Submit → `POST /api/unidades/:id/residentes`:
   - Email nuevo → crea `Usuario` + `UnidadUsuario` + `Invitacion` tipo RESIDENTE.
   - Email existente → solo crea `UnidadUsuario` + invitación. **Acá se materializa la multi-pertenencia**: la misma persona acumula UFs de distintos consorcios/organizaciones bajo un solo login.
4. Link de invitación para copiar (MVP; email post-beta). Al aceptar: define password y entra al portal.
5. El residente **no tiene contexto de organización**: su JWT no lleva `org_id` de staff; el portal agrega todas sus UFs (`UnidadUsuario` por `usuarioId`), agrupadas por consorcio/edificio.
6. Desvincular = `fechaFin` (baja temporal, preserva historial de expensas/pagos), nunca borrado físico del vínculo con actividad.

**Sin auto-registro de residentes en el MVP**: un residente solo entra invitado por su administración (la administración es quien conoce la titularidad de cada UF — Ley 25.326: minimización de datos, ver [[PRD-06-03 Ley 25.326 Datos Personales]]).

---

## 6. Endpoints MVP

| Endpoint | Rol | Descripción |
|----------|-----|-------------|
| `POST /api/auth/register` | público | (Existente) Alta de organización + org_admin. Adaptar: email global único → 422 `EMAIL_YA_REGISTRADO` sugiriendo login |
| `POST /api/auth/cambiar-organizacion` | staff | Re-emite JWT con otra org activa (body: `organizacionId`, valida membresía) |
| `GET /api/organizaciones/me/usuarios` | org_admin | Lista staff de la org (con edificios asignados) |
| `POST /api/organizaciones/me/usuarios` | org_admin | Invita staff (Workflow A) → 201 + `invitacionUrl` |
| `PATCH /api/organizaciones/me/usuarios/:id` | org_admin | Cambiar rol / edificios de gestor / activar-desactivar membresía |
| `GET /api/unidades/:id/residentes` | org_admin, gestor asignado | Vínculos activos e históricos de la UF |
| `POST /api/unidades/:id/residentes` | org_admin, gestor asignado | Vincula/invita residente (Workflow B) → 201 + `invitacionUrl` |
| `DELETE /api/unidades/:id/residentes/:vinculoId` | org_admin, gestor asignado | Desvincula (`fechaFin = hoy`) |
| `GET /api/invitaciones/:token` | público | Datos de la invitación (email enmascarado, org, tipo) para la pantalla de aceptación |
| `POST /api/invitaciones/:token/aceptar` | público | Define password, activa cuenta, loguea → 200 { accessToken, refreshToken, user } |

Errores del contrato `{ error: { code, message } }`. Códigos nuevos: `EMAIL_YA_REGISTRADO` (422), `INVITACION_INVALIDA` (410, expirada/usada/inexistente), `INVITACION_PENDIENTE` (409, ya hay una pendiente — sugiere reenviar), `VINCULO_DUPLICADO` (409, esa persona ya está en esa UF), `SIN_MEMBRESIA` (403, cambiar-organizacion a org ajena).

---

## 7. Decisión: identificación unívoca por email

- **Email = identificador de login e identidad global.** Único, verificable (el link de invitación prueba posesión del buzón), y es el canal natural de comunicaciones (AgentMail).
- Se normaliza a lowercase y se valida formato en Zod.
- **DNI/CUIT se descartan como identificador de login** en el MVP: no todos los residentes lo tienen a mano, no es verificable sin integración con Renaper/AFIP, y la Ley 25.326 aconseja no recolectar datos sensibles sin necesidad. Queda como campo opcional futuro (útil para matching al importar padrón de propietarios, ver [[PRD-04-07 Importación Inteligente]]).
- Riesgo conocido y aceptado: una persona con dos emails = dos cuentas. Mitigación futura: flujo de "unificar cuentas" por verificación de email.

---

## 8. Impacto en documentos existentes (sync obligatorio)

- **[[PRD-02-04 Base de Datos]]**: reflejar §2.2 (Usuario global, Invitacion).
- **[[PRD-04-05 Portal del Residente]]**: sus queries scopean `UnidadUsuario` por `organizacionId` del contexto — con identidad global el residente **no tiene org activa** y el portal agrega por `usuarioId` (todas sus orgs). Actualizar §middleware/endpoints cuando se implemente el portal.
- **[[PRD-03-02 Agente Onboarding]]**: su `crearOrganizacion` convive con `register` (el agente usa los mismos endpoints; no crea un camino paralelo).
- **[[PRD-07-03 Rutas y Navegación]]**: rutas nuevas `/invitacion/:token` (pública), `/configuracion/usuarios` (staff), selector de organización en header, y la `RegisterPage` pendiente.
- **AGENTS.md (app)**: el modelo "todo cuelga de la organización" se mantiene para datos de negocio; la **identidad** es la excepción documentada (Usuario global, vínculos scopeados).

---

## 9. Casos borde

| Escenario | Comportamiento |
|-----------|----------------|
| Invitar email que ya es staff de la org | 409 `INVITACION_PENDIENTE` o, si ya es miembro activo, 409 `VINCULO_DUPLICADO` |
| Invitación expirada | 410 `INVITACION_INVALIDA`; el admin reenvía (nuevo token) |
| Residente que también es gestor (de otra org) | Válido: mismo Usuario, membresía staff en org A + UnidadUsuario en org B. Al loguear, si tiene membresías staff ve selector; el portal siempre disponible |
| Desvincular residente con expensas impagas | Permitido (fechaFin); la deuda queda asociada a la UF, visible en historial |
| Org_admin se desactiva a sí mismo | Prohibido (debe quedar al menos un org_admin activo por org) → 422 `ULTIMO_ORG_ADMIN` |
| Gestor sin edificios asignados | Permitido (ve la org en solo lectura); la UI sugiere asignarle edificios |

---

## 10. Seed de demostración

Casos que el seed debe cubrir (credenciales documentadas en AGENTS.md del app):

1. **Org A (demo)** — admin + gestor limitado a Torre Palermo (existentes).
2. **Staff adicional**: segundo gestor de Org A con ambos edificios asignados.
3. **Org B** (segunda administración) con 1 edificio y sus UFs.
4. **Residente multi-consorcio**: misma persona (un email) propietaria de una UF en Org A y otra en Org B.
5. **Inquilino simple** en una UF de Org A.
6. **Propietario con N UFs** en el mismo edificio (2+ unidades).
7. **Invitación pendiente** (sin aceptar) para probar el flujo de activación.

---

## 11. Métricas de éxito

| Métrica | Meta |
|---------|------|
| Alta de staff + primer login | < 3 min |
| Alta de residente + activación | < 3 min |
| Una persona multi-consorcio con un solo login | 100% de los casos del seed |
| Tests de aislamiento (staff/residente de org B no toca org A) | En verde |

---

*Documento relacionado:* [[PRD-04-05 Portal del Residente]]
*Documento relacionado:* [[PRD-02-04 Base de Datos]]
*Documento relacionado:* [[PRD-05-04 Cerbos RBAC]]
*Documento relacionado:* [[PRD-03-02 Agente Onboarding]]
