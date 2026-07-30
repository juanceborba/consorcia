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
| `creaUsuario` | Boolean | **S4-11.** `true` si el alta que generó esta invitación fue la que **creó la identidad global**. Es lo único que habilita a la invitación a definir la password de una cuenta sin activar (§6.3). En el reenvío se conserva con un OR: la persona ya existe porque la creó la invitación anterior de esa misma organización, así que recalcularlo dejaría el link nuevo sin poder activar la cuenta que su propio origen aprovisionó |

Restricción: una sola invitación **pendiente** por `(email, organizacionId, tipo)`. Reenviar = regenerar token/expiración.

---

## 3. Roles y accesos (MVP)

| Rol | Nivel | Alta | Acceso |
|-----|-------|------|--------|
| `org_admin` | Organización | `register` (el primero) o invitación staff | Todo en su org: edificios, unidades, gastos, **usuarios**, config |
| `gestor` | Organización | Invitación staff (backoffice) | Lectura de su org; operación solo en `GestorEdificio` asignados (unidades, gastos del edificio). No crea edificios ni usuarios |
| `propietario` | Edificio/UF | Invitación residente | Portal: sus UFs (de todos sus consorcios), expensas, recibos, pagos. **Hoy (S4-12): lectura de su edificio/unidad vía `GET /api/me/unidades`, §5.7** |
| `inquilino` | Edificio/UF | Invitación residente | Igual que propietario (MVP; diferenciación de permisos queda para el portal) |

La autorización sigue siendo Cerbos fail-closed ([[PRD-05-04 Cerbos RBAC]]); el fast-path de vínculo usuario↔unidad del portal se mantiene (ver §8, sync con PRD-04-05).

**Los roles de la sesión son la UNIÓN de la membresía y de los vínculos de unidad vigentes (S4-11).** Antes eran excluyentes —si había membresía staff, los roles de `UnidadUsuario` no se derivaban—, así que a un propietario le alcanzaba con que **cualquier** organización lo invitara como staff (sin su consentimiento, §4.3) para perder `propietario` de su sesión y quedar sin acceso a su portal. La unión vale en los tres caminos que arman contexto: login, `cambiar-organizacion` y `refresh`. Los roles de residente no se scopean por organización (el portal agrega por `usuarioId`, §5.5); no amplían permisos en el backoffice porque las policies de `propietario`/`inquilino` exigen un `edificio_id` en el principal que solo el portal va a setear.

---

## 4. Workflow A — Alta de staff (backoffice)

**Quién:** `org_admin`. **Dónde:** sección "Usuarios" en la configuración de la organización.

1. Org_admin abre **Configuración → Usuarios → "Invitar staff"**.
2. Form (RHF + Zod): `email`, `nombre`, `apellido`, `rol` (org_admin | gestor), y si es gestor, multi-select de **edificios asignados**.
3. Submit → `POST /api/organizaciones/me/usuarios`:
   - Si el email **no existe**: crea `Usuario` (sin password) + `OrganizacionUsuario` (+ `GestorEdificio` si gestor) + `Invitacion` tipo STAFF.
   - Si el email **ya existe** (persona de otra org o residente): solo agrega la membresía/vínculos + invitación de "sumaste una organización" — **mismo login**, sin password nuevo.
4. MVP: la UI muestra el **link de invitación para copiar** (AgentMail llega post-beta, ver [[PRD-05-01 AgentMail]] — el endpoint ya deja el envío encapsulado).
5. El invitado abre `/invitacion/:token` → define su password → cuenta activa → login. **Solo si esta invitación creó la identidad** (§6.3): si el email ya tenía cuenta, el link no define password ni emite sesión — el vínculo ya quedó creado en el paso 3 y la persona entra con la credencial que ya tenía.
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

### 5.7 Acceso de lectura del residente (S4-12, issue #58)

Hasta S4-11 el residente activaba su cuenta y entraba a un backoffice que no le respondía nada: **todo** el backoffice pasa por el middleware `tenant`, que devuelve `403 SIN_ORGANIZACION_ACTIVA` cuando el JWT no trae `org_id` — y el residente puro no lo trae **por diseño** (§5.5). El síntoma era un dashboard vacío con el selector de edificios deshabilitado.

**Decisión: endpoint residente-scoped aparte, no ampliar `GET /api/edificios`.**

| Opción | Por qué no / sí |
|--------|-----------------|
| Que `GET /api/edificios` resuelva también por `UnidadUsuario` | ❌ Obliga a sacarlo de `tenant` y a que un endpoint de backoffice tenga dos modos de scope (organización activa vs. usuario). Rompe el aislamiento de PRD-02-01 §6.2, que es la invariante más cara de mantener del sistema |
| `GET /api/me/unidades` (elegida) | ✅ El scope es `req.user.id`: no necesita `tenant` ni Cerbos porque el recurso **es** el usuario del token. Refleja el modelo tal cual está escrito (§2.1: la identidad es global, los permisos son vínculos) y agrega naturalmente por `usuarioId` cruzando organizaciones, que es justo lo que pide §5.5 |

Contrato — devuelve los vínculos **vigentes** (`fechaFin: null`, la misma definición con la que `auth.service.js` deriva los roles del JWT, así el token y el listado nunca se contradicen), excluyendo los edificios dados de baja:

```json
[{ "id": "…", "esPropietario": false, "esInquilino": true, "fechaInicio": "…",
   "unidad": { "id": "…", "numero": "6", "tipo": "departamento" },
   "edificio": { "id": "…", "nombre": "Torre Palermo", "direccion": "…", "ciudad": "…" },
   "organizacion": { "id": "…", "nombre": "Administración Demo S.A." } }]
```

**Alcance MVP (solo lectura).** El atributo del vínculo (`esPropietario` / `esInquilino`) define hoy qué se le muestra, no qué puede hacer: no hay escritura para el residente. En el frontend el residente puro tiene su propio shell — sidebar con "Mis unidades", selector de edificio alimentado por sus vínculos, nombre de la administración tomado del vínculo (no de una organización activa que no existe) — y las rutas del backoffice lo redirigen a `/mis-unidades` en vez de dejarlo en una pantalla vacía. El portal completo (expensas, recibos, pagos) es [[PRD-04-05 Portal del Residente]], S5.

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
| `GET /api/me/unidades` | autenticado | Vínculos VIGENTES del propio usuario (unidad + edificio + organización), agregados por `usuarioId` y cruzando organizaciones. Único listado del residente puro: **no** pasa por `tenant` (S4-12, §5.7) |
| `GET /api/invitaciones/:token` | público | Datos de la invitación (email enmascarado, org, tipo) para la pantalla de aceptación |
| `POST /api/invitaciones/:token/aceptar` | público | Activa la cuenta **solo si esta invitación creó la identidad** → 200 { accessToken, refreshToken, user }. Si no, no emite sesión ni toca credenciales: ver §6.3 |

Errores del contrato `{ error: { code, message } }`. Códigos nuevos: `EMAIL_YA_REGISTRADO` (422), `INVITACION_INVALIDA` (410, expirada/usada/inexistente), `INVITACION_PENDIENTE` (409, ya hay una pendiente — sugiere reenviar), `VINCULO_DUPLICADO` (409, esa persona ya está en esa UF), `SIN_MEMBRESIA` (403, cambiar-organizacion a org ajena o membresía desactivada), `SIN_ORGANIZACION_ACTIVA` (403, sesión sin org activa — residente puro contra el backoffice), `INVITACION_INCONSISTENTE` (422, el payload de la invitación no valida o su unidad ya no existe: hay que reenviarla), `EDIFICIO_INVALIDO` (422, alguno de los `edificioIds` no existe, está dado de baja o es de otra organización), `ULTIMO_ORG_ADMIN` (422, ver §9), `USUARIO_NO_ENCONTRADO` (404, el `:id` del PATCH no es miembro de la organización del JWT), y los de §6.3: `ACTIVACION_NO_DISPONIBLE` (409), `MEMBRESIA_DESACTIVADA` (403), `CUENTA_DESACTIVADA` (403).

### 6.3 Semántica de la aceptación (S4-11)

**Por qué cambió.** El diseño original apoyaba la aceptación en que "el token prueba posesión del buzón" (§7). En el MVP eso **no es cierto**: no hay envío de email, el link se le devuelve al invitador (`invitacionUrl`) y la UI lo muestra para copiar. Sumado a la identidad global —el email es una credencial de aprovisionamiento y cualquier `org_admin` puede invitar a cualquier email, con `POST /auth/register` público— el token funcionaba como credencial de suplantación: aceptar una invitación dirigida a una cuenta ajena devolvía una **sesión completa de esa persona**, con todas sus organizaciones alcanzables vía `cambiar-organizacion`. Auditado en `docs/sprints/S4-security.md` (SEC-01 CRITICAL, SEC-02/03 HIGH) y reproducido de forma independiente en `S4-review.md` (B1) y `S4-qa.md` (QA-01).

**Regla de diseño resultante — no negociable mientras el link vuelva al invitador:**

> La aceptación de una invitación **nunca emite sesión ni fija password sobre un `Usuario` preexistente**. Solo la invitación que **creó** la identidad puede activarla.

`Invitacion.creaUsuario` (§2.3) es lo que materializa esa atribución: se setea en el alta según si el `Usuario` existía o no. Se eligió el flag en la invitación —y no un `creadoPorInvitacionId` en `Usuario`— porque es una columna booleana sin FK ni backfill, se resuelve en el mismo `findUnique` que el alta ya hacía, y sobrevive naturalmente al reenvío (que reusa la fila).

| Caso al aceptar | Respuesta | Efectos |
|---|---|---|
| El `Usuario` **no existe** | `200` sesión completa | Crea el `Usuario` con la password, aplica los vínculos del payload, consume el token |
| Existe **sin activar** y `creaUsuario = true` (esta invitación lo aprovisionó) | `200` sesión completa | Define la password, aplica los vínculos, consume el token |
| Existe y **ya está activado** (`passwordHash != null`) | `200 { yaActivada: true }` — **sin tokens ni DTO de usuario** | Consume el token y nada más: el vínculo ya se materializó en el alta (§4.3). La password tipeada se descarta y la UI lo dice explícitamente |
| Existe **sin activar** y `creaUsuario = false` (lo aprovisionó otra invitación) | `409 ACTIVACION_NO_DISPONIBLE` | Ninguno: **no** consume el token. La cuenta se activa con la invitación de origen; si se perdió, esa organización la reenvía |
| Su membresía en la organización que invita está **desactivada** | `403 MEMBRESIA_DESACTIVADA` | Ninguno. El accept no reactiva bajas lógicas: volver al staff es un `PATCH /me/usuarios/:id` de la organización |
| El `Usuario` está dado de **baja global** (`activo: false` / `deletedAt`) | `403 CUENTA_DESACTIVADA` | Ninguno. La reactivación es un acto administrativo explícito, no un efecto de un link que el propio atacante genera |

Notas:

- El vínculo de residente (`UnidadUsuario`) **sí** se reabre al aceptar (`fechaFin = null`), a diferencia de la membresía staff. Es intencional: la unicidad es `(org, unidad, usuario)` y re-vincular a un titular dado de baja reabre su fila por diseño (§5.6); además el vínculo ya lo creó el POST de alta, así que el accept no agrega poder.
- La pantalla `/invitacion/:token` distingue los tres desenlaces: sesión (entra), `yaActivada` ("tu cuenta ya estaba activa, la contraseña que escribiste no se guardó" + botón a `/login`) y los 409/403, que son condiciones **permanentes** del link y van a pantalla completa con su motivo, no a un toast de "reintentá".
- Queda pendiente el cierre de fondo del vector (que no depende de este endpoint): enviar el link al buzón en vez de devolvérselo al invitador, y no crear la membresía activa sin consentimiento de la persona. Ver SEC-04/05 en `S4-security.md`.

**Implementado en S4-02** (`src/routes/invitaciones.routes.js`):

- Los dos endpoints públicos responden **410 `INVITACION_INVALIDA` sin distinguir** entre inexistente, usada y vencida: distinguir filtraría si un email/organización existe.
- `GET` devuelve `{ email (enmascarado, "j***@demo.com"), tipo, organizacion: {id, nombre}, nombre, apellido, expiraAt }`. El email nunca viaja completo (Ley 25.326, minimización: el link puede terminar en manos de un tercero).
- `aceptar` corre en **una sola transacción**: crea el `Usuario` (o le define la password si esta invitación lo aprovisionó, §6.3 — **nunca** lo reactiva), materializa los vínculos del payload (STAFF → `OrganizacionUsuario` upsert + `GestorEdificio` de los edificios de la org que invita · RESIDENTE → `UnidadUsuario` upsert) y consume el token con `usadaAt` bajo condición `usadaAt IS NULL` (dos aceptaciones simultáneas no duplican vínculos). Si algo falla, la invitación **no** queda consumida.
- **La password solo se define si el Usuario no tenía** y además solo si esta invitación creó la identidad (**§6.3, S4-11**): a una persona ya activada la invitación no le toca las credenciales ni le emite sesión, y a una cuenta sin activar que aprovisionó otra organización no puede fijarle la password.
- Un residente puro sale de `aceptar` con `org_id: null` y roles derivados de sus `UnidadUsuario` vigentes (§5.5); el backoffice le responde 403 `SIN_ORGANIZACION_ACTIVA`.
- `usuarios.password_hash` pasa a nullable para admitir cuentas creadas por backoffice sin activar; el login las rechaza con el mismo 401 `CREDENCIALES_INVALIDAS` (sin oráculo).

**Implementado en S4-03** (`src/routes/staff.routes.js`, montado en `/api/organizaciones/me/usuarios`):

- El `:id` del PATCH es el **`usuarioId`** (identidad global), no el id de la membresía: es lo que la UI tiene a mano y lo que identifica a la persona. La membresía se resuelve por `(organizacionId del JWT, usuarioId)`, así que un usuario de otra organización responde 404 `USUARIO_NO_ENCONTRADO` sin filtrar que exista.
- El alta deja la **membresía activa de entrada** (§4.3): quien ya tenía cuenta entra sin esperar el link; para el Usuario recién creado (sin password) la invitación es lo que le da acceso. Aceptar la invitación es idempotente sobre esos vínculos.
- **Orden de los conflictos:** la invitación pendiente manda sobre el vínculo. Un segundo POST al mismo email responde 409 `INVITACION_PENDIENTE`, y **`{ reenviar: true }` regenera token + expiración + payload de la misma fila** y devuelve **200** (no 201: no se creó un recurso). 409 `VINCULO_DUPLICADO` queda para el caso "ya es miembro activo y no hay invitación pendiente", o sea alguien ya onboardeado. Chequear el vínculo primero volvería `INVITACION_PENDIENTE` inalcanzable (la membresía nace activa) y dejaría al admin sin forma de reenviar el link a quien no entró todavía — que es el caso frecuente.
- `edificioIds` solo aplica a `GESTOR` (un `ORG_ADMIN` con edificios → 422 `VALIDACION_FALLIDA`); un gestor **sin** edificios es válido (§9). El PATCH **reemplaza** el set (no acumula) y solo toca las asignaciones de edificios de esta organización: si la persona gestiona edificios de otra org con el mismo Usuario global, esos vínculos no se tocan. Promover a `ORG_ADMIN` limpia sus asignaciones por edificio (administra toda la org, no significan nada).
- El guard `ULTIMO_ORG_ADMIN` cubre **desactivar y degradar**, y corre bajo `SELECT ... FOR UPDATE` de la fila de la organización: dos PATCH concurrentes degradando a los dos últimos admins no pueden dejar la org sin ninguno. **S4-11:** cuenta solo org_admins **operables** —membresía activa **y** `usuario.passwordHash != null`, `activo`, sin `deletedAt`—. Antes, invitar a un segundo org_admin ya "habilitaba" degradarse a uno mismo aunque el invitado no pudiera loguear todavía; si el admin había cerrado el diálogo sin copiar el `invitacionUrl` (y no hay envío de email), la organización quedaba sin nadie capaz de administrarla.
- El envío está encapsulado en `src/services/notificaciones.service.js` (stub): la respuesta trae `invitacionUrl` + `emailEnviado: false` y sumar AgentMail no toca las rutas. La URL se arma con `APP_BASE_URL` (base pública de la SPA), nunca con la de la API.
- Cerbos: recurso **`staff`** (`cerbos/policies/staff.yaml`), el recurso es la organización misma. Solo `superadmin` y `org_admin` de su propia org; el gestor no tiene ni lectura de la nómina (§3: "no crea edificios ni usuarios").

**Implementado en S4-04** (`src/routes/residentes.routes.js`, montado en `/api/unidades/:id/residentes`):

- La UF se resuelve con `validarUnidad` (extraído a `middleware/unidad.middleware.js`, compartido con S2-02): 404 `UNIDAD_NO_ENCONTRADA` si no existe o su edificio está de baja, 403 `FUERA_DE_ORGANIZACION`, 403 `EDIFICIO_NO_ASIGNADO` para el gestor sin ese edificio.
- El vínculo nace **vigente** y `vigente` ⇔ `fechaFin === null` (misma definición que usa `auth.service.js` para derivar los roles del residente). `fechaInicio`/`fechaFin` se truncan a medianoche UTC: son fechas de calendario (titularidad), no instantes.
- La unicidad del vínculo es `(organizacionId, unidadId, usuarioId)`, así que **re-vincular a alguien dado de baja REABRE su fila** (`fechaFin = null` + `fechaInicio` nueva) en vez de duplicarla — el historial de esa titularidad es uno. 409 `VINCULO_DUPLICADO` solo si el vínculo ya está vigente.
- `DELETE` devuelve **200 con el vínculo actualizado** (no 204: la UI necesita la `fechaFin`) y es **idempotente** — si ya estaba dado de baja no reescribe la fecha original, que es dato histórico. 404 `VINCULO_NO_ENCONTRADO` si el `vinculoId` no es de esa UF.
- **Invitación pendiente:** a diferencia del staff, acá una pendiente en la misma organización **se reusa en silencio** (regenera token, expiración y payload) en vez de responder 409. El índice único es `(email, organizacionId, tipo)` y el propietario con N UFs (§10.6) es un caso central: bloquearlo impediría vincular a la misma persona a una segunda UF. No se pierde nada — los vínculos ya se crearon en el POST y la invitación solo sirve para definir la password; el token viejo se invalida y el backoffice muestra el nuevo link.
- Cerbos: recurso **`residente`** (`cerbos/policies/residente.yaml`), scope doble org + edificio idéntico a `unidad.yaml` (`org_admin` en su org, `gestor` en edificios asignados). Recurso propio y no reuso de `unidad`: administrar la titularidad no es editar los metros de la UF, y el portal (PRD-04-05) le dará al residente lectura de su vínculo sin darle nada sobre la unidad.

**Implementado en S4-05** (`POST /api/auth/cambiar-organizacion`, `src/routes/auth.routes.js` + `services/auth.service.js`):

- Body `{ organizacionId, refreshToken? }`. Requiere sesión pero **no** pasa por `tenant`: quien viene de una sesión sin org activa (residente puro al que recién le dieron una membresía, o token emitido antes del alta) tiene derecho a entrar a la organización que sí es suya. La membresía de destino se valida contra la DB en el handler.
- Un solo **403 `SIN_MEMBRESIA`** para "no sos miembro", "la organización no existe" y "tu membresía fue desactivada": no se filtra qué organizaciones existen. La cuenta se revalida (`activo`, `deletedAt`) porque el access token vive 15 min → 401 si ya no está disponible.
- El `refreshToken` de la sesión que se deja es **opcional**: si viene se revoca antes de emitir el par nuevo (mismo criterio de rotación que `POST /refresh`); si no, agota su TTL. Obligarlo rompería clientes que no lo tengan a mano.
- **El refresh token ahora guarda la organización activa** (`refresh:{uuid}` → `{ usuarioId, organizacionId }`, antes solo el `usuarioId`). Sin eso el primer `POST /refresh` después de un cambio devolvía al usuario a su organización por defecto (la primera alfabética) y el cambio de contexto no sobrevivía a los 15 min del access token. `renovarTokens` revalida esa membresía y, si fue desactivada, cae al contexto por defecto (el acceso lo corta `tenant.middleware`). El formato viejo se sigue leyendo, así que los refresh ya emitidos no se invalidan.
- **`edificios_asignados` pasa a estar scopeado a la organización activa.** Antes `obtenerEdificiosAsignados` devolvía los edificios del gestor en TODAS sus organizaciones; no era explotable (las queries y Cerbos filtran también por `organizacion_id`) pero con cambio de organización el claim tenía que describir un solo contexto.
- El DTO de usuario de **todas** las respuestas de auth (login, register, aceptar invitación, cambiar-organizacion) suma **`organizaciones: [{ id, nombre, rol }]`** con las membresías activas ordenadas por nombre: es lo que necesita el selector del header (S4-09) y evita un endpoint extra. El JWT no las lleva — los claims mantienen su forma (`sub, email, org_id, roles, edificios_asignados`).

---

## 7. Decisión: identificación unívoca por email

- **Email = identificador de login e identidad global.** Único y canal natural de comunicaciones (AgentMail). **Corrección S4-11:** mientras el MVP le devuelva el link al invitador en vez de enviarlo al buzón, el token **no** prueba posesión del email — por eso la aceptación no puede tener efectos sobre una identidad preexistente (§6.3). El email es, hoy, una credencial de **aprovisionamiento**, no de autenticación.
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
| Org_admin se desactiva a sí mismo | Prohibido (debe quedar al menos un org_admin **activo y operable** por org) → 422 `ULTIMO_ORG_ADMIN`. Un org_admin invitado que todavía no activó su cuenta **no cuenta** (S4-11) |
| Gestor sin edificios asignados | Permitido (ve la org en solo lectura); la UI sugiere asignarle edificios |
| Aceptar una invitación dirigida a una cuenta ya activada | `200 { yaActivada: true }` sin sesión: el vínculo ya está creado, se entra por login (§6.3) |
| Aceptar una invitación sobre una identidad sin activar que creó **otra** organización | 409 `ACTIVACION_NO_DISPONIBLE`: la activa su invitación de origen (§6.3) |
| Aceptar con la membresía staff dada de baja | 403 `MEMBRESIA_DESACTIVADA`: el link no revive bajas lógicas; reactivar es un PATCH de la organización (§6.3) |
| Persona con membresía staff **y** UFs a su nombre | La sesión trae la unión de roles (p. ej. `['gestor','propietario']`), no solo el de la membresía (§3) |
| Usuario autenticado sin membresía activa ni vínculos | Login 200 con `roles: []` y `organizacionId: null`; el frontend muestra una pantalla **permanente** ("tu cuenta no tiene acceso a ninguna organización, contactá a tu administración") con salida a logout, no un error de red transitorio |

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
8. **Staff multi-organización** (S4-11): un Usuario con membresía activa en Org A y en Org B. Es la precondición del selector de organización del header (§4.6) y sin él ese punto de la DoD había que probarlo fabricando la membresía a mano — que además el reseed desactivaba.

**Implementado (S4-10, `backend/prisma/seed.js`).** Decisiones que tomó la implementación:

- **Org B** = "Administración Sur S.R.L." (CUIT `30-71234569-4`) con el "Edificio Lomas" (5 UFs) y su propio org_admin `admin.sur@demo.com`.
- **Los residentes no llevan membresía de organización**: solo `UnidadUsuario`. Una membresía con rol PROPIETARIO/INQUILINO los metería en la nómina de staff de `GET /api/organizaciones/me/usuarios` (efecto colateral de la migración S4-01, corregido acá).
- **La invitación pendiente usa un token FIJO** (`seed-invitacion-pendiente`, la columna es String) para poder abrir `/invitacion/seed-invitacion-pendiente` sin consultar la DB. Su invitado (`invitado@demo.com`) existe sin password, igual que lo deja el alta por backoffice, y la invitación lleva `creaUsuario: true` porque es la que lo aprovisionó (sin eso el accept respondería 409, §6.3).
- **El caso 8 es `multiorg@demo.com`** (S4-11): GESTOR de Org A limitado a Torre Palermo y ORG_ADMIN de Org B. Su organización por defecto es Org A (primera alfabética) y el smoke verifica el cambio de contexto de punta a punta.
- **Idempotencia**: el seed borra las dos organizaciones demo por CUIT, hace `upsert` de los usuarios por email (con identidad global un Usuario puede sobrevivir a la org si tiene vínculos en otra), limpia el residuo de los specs E2E (`e2e-staff-*`, `e2e-residente-*`) y desactiva las membresías de los usuarios demo en organizaciones ajenas al seed. El `encargado@demo.com` queda como identidad **sin vínculos** (el rol ENCARGADO es de scope edificio y todavía no tiene modelo).

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
