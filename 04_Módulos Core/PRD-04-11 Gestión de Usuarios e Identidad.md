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

Errores del contrato `{ error: { code, message } }`. Códigos nuevos: `EMAIL_YA_REGISTRADO` (422), `INVITACION_INVALIDA` (410, expirada/usada/inexistente), `INVITACION_PENDIENTE` (409, ya hay una pendiente — sugiere reenviar), `VINCULO_DUPLICADO` (409, esa persona ya está en esa UF), `SIN_MEMBRESIA` (403, cambiar-organizacion a org ajena o membresía desactivada), `SIN_ORGANIZACION_ACTIVA` (403, sesión sin org activa — residente puro contra el backoffice), `INVITACION_INCONSISTENTE` (422, el payload de la invitación no valida o su unidad ya no existe: hay que reenviarla), `EDIFICIO_INVALIDO` (422, alguno de los `edificioIds` no existe, está dado de baja o es de otra organización), `ULTIMO_ORG_ADMIN` (422, ver §9), `USUARIO_NO_ENCONTRADO` (404, el `:id` del PATCH no es miembro de la organización del JWT).

**Implementado en S4-02** (`src/routes/invitaciones.routes.js`):

- Los dos endpoints públicos responden **410 `INVITACION_INVALIDA` sin distinguir** entre inexistente, usada y vencida: distinguir filtraría si un email/organización existe.
- `GET` devuelve `{ email (enmascarado, "j***@demo.com"), tipo, organizacion: {id, nombre}, nombre, apellido, expiraAt }`. El email nunca viaja completo (Ley 25.326, minimización: el link puede terminar en manos de un tercero).
- `aceptar` corre en **una sola transacción**: crea o reactiva el `Usuario`, materializa los vínculos del payload (STAFF → `OrganizacionUsuario` upsert + `GestorEdificio` de los edificios de la org que invita · RESIDENTE → `UnidadUsuario` upsert) y consume el token con `usadaAt` bajo condición `usadaAt IS NULL` (dos aceptaciones simultáneas no duplican vínculos). Si algo falla, la invitación **no** queda consumida.
- **La password solo se define si el Usuario no tenía**: a una persona ya activada la invitación le suma vínculos sin resetear sus credenciales (§4.3 "mismo login, sin password nuevo"). Quien tenga el link de una persona ya registrada no puede tomarle la cuenta.
- Un residente puro sale de `aceptar` con `org_id: null` y roles derivados de sus `UnidadUsuario` vigentes (§5.5); el backoffice le responde 403 `SIN_ORGANIZACION_ACTIVA`.
- `usuarios.password_hash` pasa a nullable para admitir cuentas creadas por backoffice sin activar; el login las rechaza con el mismo 401 `CREDENCIALES_INVALIDAS` (sin oráculo).

**Implementado en S4-03** (`src/routes/staff.routes.js`, montado en `/api/organizaciones/me/usuarios`):

- El `:id` del PATCH es el **`usuarioId`** (identidad global), no el id de la membresía: es lo que la UI tiene a mano y lo que identifica a la persona. La membresía se resuelve por `(organizacionId del JWT, usuarioId)`, así que un usuario de otra organización responde 404 `USUARIO_NO_ENCONTRADO` sin filtrar que exista.
- El alta deja la **membresía activa de entrada** (§4.3): quien ya tenía cuenta entra sin esperar el link; para el Usuario recién creado (sin password) la invitación es lo que le da acceso. Aceptar la invitación es idempotente sobre esos vínculos.
- **Orden de los conflictos:** la invitación pendiente manda sobre el vínculo. Un segundo POST al mismo email responde 409 `INVITACION_PENDIENTE`, y **`{ reenviar: true }` regenera token + expiración + payload de la misma fila** y devuelve **200** (no 201: no se creó un recurso). 409 `VINCULO_DUPLICADO` queda para el caso "ya es miembro activo y no hay invitación pendiente", o sea alguien ya onboardeado. Chequear el vínculo primero volvería `INVITACION_PENDIENTE` inalcanzable (la membresía nace activa) y dejaría al admin sin forma de reenviar el link a quien no entró todavía — que es el caso frecuente.
- `edificioIds` solo aplica a `GESTOR` (un `ORG_ADMIN` con edificios → 422 `VALIDACION_FALLIDA`); un gestor **sin** edificios es válido (§9). El PATCH **reemplaza** el set (no acumula) y solo toca las asignaciones de edificios de esta organización: si la persona gestiona edificios de otra org con el mismo Usuario global, esos vínculos no se tocan. Promover a `ORG_ADMIN` limpia sus asignaciones por edificio (administra toda la org, no significan nada).
- El guard `ULTIMO_ORG_ADMIN` cubre **desactivar y degradar**, y corre bajo `SELECT ... FOR UPDATE` de la fila de la organización: dos PATCH concurrentes degradando a los dos últimos admins no pueden dejar la org sin ninguno.
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

**Implementado (S4-10, `backend/prisma/seed.js`).** Decisiones que tomó la implementación:

- **Org B** = "Administración Sur S.R.L." (CUIT `30-71234569-4`) con el "Edificio Lomas" (5 UFs) y su propio org_admin `admin.sur@demo.com`.
- **Los residentes no llevan membresía de organización**: solo `UnidadUsuario`. Una membresía con rol PROPIETARIO/INQUILINO los metería en la nómina de staff de `GET /api/organizaciones/me/usuarios` (efecto colateral de la migración S4-01, corregido acá).
- **La invitación pendiente usa un token FIJO** (`seed-invitacion-pendiente`, la columna es String) para poder abrir `/invitacion/seed-invitacion-pendiente` sin consultar la DB. Su invitado (`invitado@demo.com`) existe sin password, igual que lo deja el alta por backoffice.
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
