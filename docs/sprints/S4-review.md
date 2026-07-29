# S4 — Review de código (usuarios e identidad)

> **Fecha:** 2026-07-29 · **Scope:** `git diff origin/main...main` (22 commits, 65 archivos, +7535/−185)
> **Specs contrastadas:** `AGENTS.md`, `docs/sprints/S4-usuarios-identidad.md`, `../vault/04_Módulos Core/PRD-04-11 Gestión de Usuarios e Identidad.md`
> **Método:** dos pasadas (corrección estructural + edge cases adversariales) + verificación ejecutable contra el stack corriendo.

---

## Veredicto general

**No apto para ship tal como está: 1 hallazgo blocking.**

El slice está bien construido. La migración a identidad global es sólida y no destructiva, el aislamiento por
`organizacion_id` se respeta en todas las queries nuevas (con la excepción documentada de `Usuario`), el contrato
de errores `{ error: { code, message } }` es consistente en los 3 routers nuevos, Cerbos sigue fail-closed y las
policies nuevas no tienen reglas ALLOW de más. Los comentarios explican las decisiones, no el código. Las 10
tareas del backlog mapean al diff sin scope-drift relevante.

Lo que bloquea es una sola cosa, pero es grave: **aceptar una invitación dirigida a un email que ya tiene cuenta
emite una sesión completa de esa persona sin ninguna prueba de identidad**, y el link se le entrega al admin que
invita. Un org_admin puede así tomar la cuenta de un org_admin de otra administración. Está reproducido abajo.

---

## Hallazgos

### 🔴 Blocking

#### B1 — Aceptar una invitación toma la cuenta de un usuario ya registrado (escalación cross-tenant)

**Dónde:** `backend/src/routes/invitaciones.routes.js:172-272` (en particular `:179-197` y `:271`)
· entrega del link: `backend/src/routes/staff.routes.js:308,331`, `backend/src/routes/residentes.routes.js:250,270`,
`frontend/src/components/invitaciones/InvitacionLinkDialog.jsx`

`POST /api/invitaciones/:token/aceptar` es público y su única credencial es el token. Cuando el email invitado ya
corresponde a un `Usuario` **con password**, el handler correctamente **no** sobrescribe el hash
(`invitaciones.routes.js:185`) — pero igual sigue de largo, consume el token y en la línea 271 hace
`emitirSesion(usuario)`, devolviendo un par access/refresh **de la víctima**. Los claims se derivan de la
membresía activa del usuario, no de la organización que invitó, así que la sesión alcanza *todas* sus
organizaciones vía `POST /api/auth/cambiar-organizacion`.

Quien tiene el link es, por diseño del MVP, el admin que invitó: `invitacionUrl` se devuelve en la respuesta del
alta y la UI lo muestra en un diálogo para copiar. No hay envío de email, así que no existe la prueba de posesión
del buzón que el comentario de cabecera (`:7-11`) asume.

**Escenario de falla (reproducido en el stack local, 2026-07-29):**

```
admin@demo.com (org_admin de Org A) invita a admin.sur@demo.com (org_admin de Org B)
como residente de Torre Palermo 1B  →  201 { invitacionUrl }

POST /api/invitaciones/<token>/aceptar {"password":"atacante1234"}
→ 200 SESION PARA: admin.sur@demo.com | roles: ['org_admin']
       orgs: ['Administración Sur S.R.L.']

GET /api/edificios con ese accessToken
→ [{"nombre":"Edificio Lomas", ...}]      ← datos de Org B

POST /api/auth/login {"email":"admin.sur@demo.com","password":"demo1234"}
→ 200                                     ← la password de la víctima sigue viva
```

La víctima no se entera: su password no cambia y la invitación aceptada solo le agrega un vínculo. El mismo
camino existe en el Workflow A (`POST /api/organizaciones/me/usuarios` con un email ya registrado), que además
permite elegir a cualquier persona del sistema como destino.

Viola el aislamiento de tenants que el sprint declara como no negociable (`AGENTS.md` §Modelo de dominio) y el
propio PRD-04-11 §7 ("el token prueba posesión del buzón").

**Sugerencia de fix (no aplicada):** en `aceptar`, si `existente?.passwordHash != null`, no emitir sesión — aplicar
los vínculos, consumir el token y responder 200 con `{ requiereLogin: true }`; que el frontend mande a `/login`.
Los tests `invitaciones.test.js` y el smoke §3.6/§3.7 usan cuentas sin activar, así que el cambio no los toca; hay
que ajustar `InvitacionPage.jsx` (ver S2) y agregar el caso "email ya activado → no se emite sesión".

---

### 🟠 Should-fix

#### S1 — `ULTIMO_ORG_ADMIN` cuenta admins que todavía no pueden loguear → organización sin administrador

**Dónde:** `backend/src/routes/staff.routes.js:388-398`

El guard cuenta membresías `rol: 'ORG_ADMIN', activo: true` sin mirar si esas personas tienen `passwordHash`. Como
el alta deja la membresía activa de entrada (`:266-275`), invitar a un segundo org_admin ya "habilita" degradar o
desactivar al primero. Si el admin cerró el diálogo sin copiar el `invitacionUrl` — y en el MVP no hay envío de
email — la organización queda sin nadie que pueda entrar a administrarla.

**Escenario de falla (reproducido):**

```
admin@demo.com invita a fantasma@test.dev como ORG_ADMIN
→ 201 cuentaActivada: False | membresia activa: True   ← cuenta el guard

PATCH /api/organizaciones/me/usuarios/<id-de-admin@demo.com> {"activo": false}
→ 200 (esperable: 422 ULTIMO_ORG_ADMIN)

GET /api/edificios con el token de admin@demo.com → 403
POST /api/auth/login admin@demo.com → org: None, roles: [], orgs: []
```

Org A quedó sin ningún org_admin capaz de iniciar sesión. Recuperable solo con el link descartado o tocando la DB.

**Sugerencia:** el `count` de `:389-396` debería filtrar `usuario: { passwordHash: { not: null }, activo: true }`.

#### S2 — La pantalla de invitación promete definir una contraseña que el backend puede ignorar

**Dónde:** `frontend/src/pages/InvitacionPage.jsx:143-146,187-190` vs `backend/src/routes/invitaciones.routes.js:185`

El form dice *"Definí tu contraseña para entrar con j\*\*\*@demo.com"* y el botón *"Activar cuenta y entrar"*. Si la
persona ya tenía password, el backend descarta la que acaba de tipear (correcto) pero la UI no lo dice y muestra
`toast.success('Cuenta activada')`. La persona sale del flujo creyendo que su credencial es la nueva y, en el
próximo login, no entra. Es la cara visible de B1 y conviene arreglarlos juntos.

#### S3 — Reinvitar a un residente rota el token y mata el link ya entregado, sin aviso

**Dónde:** `backend/src/routes/residentes.routes.js:210-235` + `backend/src/services/invitaciones.service.js:52-68`

Solo puede haber una invitación RESIDENTE pendiente por `(email, organizacionId)` (índice parcial). Vincular a la
misma persona a una segunda UF reusa esa fila regenerando `token`, `expiraAt` y `payload`. El comentario
(`:210-214`) lo justifica bien —los vínculos ya están creados, la invitación solo define la password—, pero la
consecuencia no está cubierta: **el link que el admin ya le pasó al residente por WhatsApp deja de funcionar** y
responde 410 sin explicar por qué. Con el caso 6 del seed (propietario multi-UF) es un flujo esperable, no un
borde raro. La respuesta trae `invitacion.reenviada: true` pero ni `ResidentesDrawer` ni el diálogo lo muestran.

#### S4 — `tenant` revalida la membresía pero no el estado de la cuenta

**Dónde:** `backend/src/middleware/tenant.middleware.js:23-56`

El middleware hace bien lo difícil: revalida la membresía contra la DB en cada request para que desactivar a
alguien corte el acceso antes de que expire el access token de 15 min. Pero no revalida `usuario.activo` ni
`usuario.deletedAt`, que sí revalidan `login` (`auth.routes.js:143-145`), `renovarTokens`
(`auth.service.js:178-181`) y `cambiar-organizacion` (`auth.routes.js:236-238`). Hoy no hay endpoint que
desactive un `Usuario`, así que no es explotable — pero la asimetría es una trampa para el sprint que agregue la
baja de personas, justo en el middleware que todo el mundo asume que es el que corta.

#### S5 — `reemplazarEdificiosDelGestor` borra asignaciones que la validación no deja volver a crear

**Dónde:** `backend/src/routes/staff.routes.js:100-114` vs `:81-88`

`edificiosDeLaOrg` solo acepta edificios con `activo: true`, pero `reemplazarEdificiosDelGestor` borra **todas**
las filas de `gestor_edificios` de la organización, incluidas las de edificios dados de baja. Un gestor asignado a
un edificio inactivo pierde esa asignación en el primer PATCH que toque sus edificios, y no hay forma de
devolvérsela por API (el id sería rechazado con 422 `EDIFICIO_INVALIDO`). Si el edificio se reactiva, el gestor ya
no lo tiene y nadie se enteró.

---

### 🔵 Nits

- **N1 — `PATCH /:id` ignora `edificioIds` en silencio al promover a ORG_ADMIN.**
  `staff.routes.js:402-403`: `rolFinal === 'ORG_ADMIN' ? [] : edificioIds ?? null`. Mandar
  `{rol:'ORG_ADMIN', edificioIds:[...]}` responde 200 con `edificios: []` como si se hubiera aplicado. El POST sí
  rechaza esa combinación con un `.refine` (`:53-56`); el PATCH debería hacer lo mismo o documentar el descarte.

- **N2 — El stub de notificaciones loguea el email del invitado en claro.**
  `notificaciones.service.js:19-22`. El comentario de arriba cuida de no loguear la URL con el token (bien), pero
  el email sí va a stdout en cada alta. Es el mismo dato personal que el código enmascara dos archivos más allá
  citando Ley 25.326 (`invitaciones.routes.js:77-84`). Coherencia: enmascararlo también acá.

- **N3 — `borrarUsuariosHuerfanos` puede reventar el seed con P2003.**
  `seed.js:124-134` borra el `Usuario`, pero `invitaciones.invitado_por_id` es `ON DELETE RESTRICT`
  (`20260729024000_s4_invitaciones/migration.sql:50`). Si un usuario huérfano de Org A fue autor de una invitación
  que todavía vive en Org B, el `delete` falla y aborta el reseed — el bucle limpia A antes que B
  (`seed.js:204`). Hoy no pasa (el seed solo crea una invitación, en Org A, de un autor de Org A), pero es una
  bomba de tiempo barata de desarmar: borrar también `invitacion.deleteMany({ where: { invitadoPorId } })`.

- **N4 — La limpieza de residuo del seed es por prefijo de email.**
  `seed.js:53,163-181`. Solo `e2e-staff-*` / `e2e-residente-*`. Cualquier persona creada a mano contra el stack
  (debug, smoke manual, curl de review) sobrevive al reseed con sus vínculos, y en organizaciones ajenas al seed
  ni siquiera se le desactivan las membresías. Vale documentarlo en el bloque de cabecera junto a "re-ejecutable",
  que hoy se lee como una garantía más fuerte de la que da.

- **N5 — La migración de identidad aborta sin decir cómo seguir.**
  `20260729020000_s4_identidad_global/migration.sql:15-24`. El `RAISE EXCEPTION` con la lista de emails duplicados
  es la decisión correcta (no elegir por el operador), pero el mensaje no dice qué hacer después. Una línea
  ("resolvé los duplicados a mano y volvé a correr") ahorra media hora en producción.

---

## Verificación puntual de lo que el review tenía que mirar

| Foco | Resultado |
|---|---|
| **Migración de identidad: ¿camino que deje usuarios sin membresía?** | **No.** `migration.sql:37-60` inserta la membresía desde `usuarios.organizacion_id` con `ON CONFLICT DO NOTHING`, alinea `activo`, y verifica con un `RAISE EXCEPTION` si quedó algún huérfano — antes de dropear las columnas. La transacción implícita de Prisma hace que un fallo deje el schema viejo intacto. |
| **Migración: ¿emails no-lowercase?** | **No.** `UPDATE ... lower(email)` (`:11`) corre antes del unique global, y el chequeo de duplicados (`:15-24`) aborta si el lowercase colisiona. En runtime, `normalizarEmail` (`auth.service.js:24`) se aplica en register, login, alta de staff, alta de residentes y aceptación de invitación — los 5 puntos de entrada. |
| **Invitaciones: ¿un solo uso?** | **Sí.** Doble candado: `usadaAt` verificado en lectura (`invitaciones.routes.js:99`) y consumido con `updateMany({ where: { usadaAt: null } })` dentro de la transacción (`:260-266`), que cierra la carrera de dos aceptaciones simultáneas. Índice único parcial `WHERE usada_at IS NULL` en DB. Smoke lo cubre ("segundo uso → 410"). |
| **Invitaciones: ¿sobrescribe passwords?** | **No** (`:185`). Pero ver **B1**: el problema no es el hash, es la sesión que se emite igual. |
| **Guards de rol UI vs backend** | **Consistentes.** `/configuracion/usuarios` va detrás de `RequireRole ['org_admin','superadmin']` (`main.jsx:50-61`), el módulo del sidebar se filtra por rol (`AppLayout.jsx:27-38,63-67`) y el backend lo decide con Cerbos (`staff.yaml`: gestor sin ninguna acción, ni `read`). El drawer de residentes no lleva guard de UI y es correcto: `residente.yaml` sí le da CRUD al gestor en sus edificios asignados, y `validarUnidad` (`unidad.middleware.js:38-42`) verifica la asignación en el backend. Ninguna policy nueva tiene ALLOW sin condición de `organizacion_id` fuera de `superadmin`. |
| **Seed: idempotencia** | **Sí,** verificado: `node prisma/seed.js` dos veces seguidas + `smoke.sh` dos veces seguidas sin reseed → 86/86 en ambas. El `upsert` por email (`seed.js:~330`) es lo que lo hace posible con identidad global. Ver N3/N4 para los bordes. |
| **Seed: datos raros** | Coeficientes de `UNIDADES_LOMAS` validados por `resolverCoeficientes` (suma = 1.000000, aborta si no). Residentes sin membresía de organización, como manda el modelo. Token fijo `seed-invitacion-pendiente` documentado. `encargado@demo.com` sin vínculos → Cerbos le niega todo, coherente con fail-closed. |
| **Scope-drift** | **Sin drift funcional.** Las 10 tareas mapean al diff. Fuera del backlog literal: `know-how/solutions/*.md` (5 archivos de documentación del sprint) y `frontend/src/components/ui/drawer.jsx` (primitiva shadcn que S4-08 necesita). Los cambios en `tests/edificios.test.js`, `tests/unidades.test.js` y `tests/helpers.js` son la adaptación al breaking change que S4-01 declara explícitamente. |
| **Contrato de errores** | Consistente. Todos los códigos nuevos (`INVITACION_INVALIDA`, `INVITACION_PENDIENTE`, `INVITACION_INCONSISTENTE`, `VINCULO_DUPLICADO`, `ULTIMO_ORG_ADMIN`, `SIN_MEMBRESIA`, `SIN_ORGANIZACION_ACTIVA`, `EDIFICIO_INVALIDO`, `EMAIL_YA_REGISTRADO`) usan `{ error: { code, message } }` con mensajes en español. Los 410/403 no distinguen causas, como corresponde. |

---

## Verificación ejecutable

| Gate | Esperado | Resultado |
|---|---|---|
| `docker exec consorcIA-backend npm test` | 75/75 | ✅ **75 pass · 0 fail** (8 suites, 4.9s) |
| `make smoke` | 86/86 | ✅ **SMOKE OK: 86 pasos en verde** (exit 0) |

Ambos re-corridos después de las pruebas manuales de B1 y S1, con `docker exec consorcIA-backend node prisma/seed.js`
en el medio. La DB quedó en el estado del seed; no se dejó residuo. No se modificó código fuente ni el árbol de git.

> Nota de método: las reproducciones de B1 y S1 mutaron la DB (un vínculo de residente y una membresía staff).
> Ambas se revirtieron con reseed y se re-verificaron los dos gates en verde. Ningún hallazgo de este reporte
> depende de esas mutaciones para ser cierto: los dos son deducibles del código y quedaron confirmados en runtime.

---

## Los 3 más críticos

1. **B1 — Toma de cuenta cross-tenant vía aceptación de invitación** (`invitaciones.routes.js:271`). Único
   blocking. Rompe el aislamiento entre administraciones, que es la promesa central del producto, y es
   silencioso para la víctima.
2. **S1 — La organización puede quedarse sin ningún org_admin capaz de loguear** (`staff.routes.js:388-398`). El
   guard existe y está bien pensado; le falta una condición. Sin envío de email, la recuperación depende de que
   alguien haya guardado un link.
3. **S2/S3 — El flujo de invitación miente sobre lo que hizo** (`InvitacionPage.jsx:143`, `residentes.routes.js:210`).
   Dos casos donde el backend hace lo correcto y la UI afirma otra cosa: la password que no se aplicó y el link
   que quedó muerto. No corrompen datos, pero generan tickets de soporte que nadie va a saber diagnosticar.

---

## Lo que está bien y conviene no tocar

- La migración `20260729020000_s4_identidad_global`: normaliza, verifica, migra datos, **vuelve a verificar** y
  recién ahí dropea. Es el estándar que deberían seguir las migraciones de S3 en adelante.
- `tenant.middleware.js`: revalidar la membresía contra la DB en cada request en vez de confiar en el claim es
  exactamente lo que hace que desactivar a alguien signifique algo con tokens de 15 min.
- `lockOrganizacion` (`staff.routes.js:121-123`) reusando el patrón de `lockEdificio` de S2 para cerrar el TOCTOU
  del guard de último admin — el mismo aprendizaje aplicado a un problema nuevo.
- La decisión de membresía activa por orden alfabético estable (`auth.service.js:~85`) documentada con su *por
  qué* (los timestamps del `createMany` del seed son iguales). Ese comentario evita un bug futuro.
- `residente.yaml` como recurso propio en vez de reusar `unidad.yaml`, con la justificación de por qué van a
  divergir en S5.
