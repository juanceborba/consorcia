# S4 — QA de cierre (usuarios e identidad)

**Fecha:** 2026-07-29 · **Rama:** `main` @ `3d34637` (sin mutaciones de git) · **Spec:** `PRD-04-11` §4/§5/§9/§10 + DoD de `docs/sprints/S4-usuarios-identidad.md`.

**Veredicto:** la Definition of Done del sprint **se cumple end-to-end**. Los 3 gates ejecutables pasan en verde. No encontré ningún fallo funcional del slice: los 4 rojos de mi primera pasada eran errores de mi propio arnés de prueba (envelope de respuesta, `:id` de la ruta de PATCH, nombres de tabla en snake_case) y quedaron todos en verde al corregirlos.

Sí hay **un bloqueante no funcional**: QA reprodujo de forma independiente la escalada cross-org de invitaciones que la fase de seguridad documentó como **SEC-01 / SEC-02** en `S4-security.md`. Rompe el aislamiento entre organizaciones, que es un punto explícito de la DoD, así que aparece acá como QA-01 con su repro.

---

## 1. Gates ejecutables

| Gate | Comando | Resultado |
|---|---|---|
| Tests de API | `docker exec consorcIA-backend npm test` | ✅ **75 pass / 0 fail** |
| Smoke E2E | `make smoke` | ✅ **86/86 pasos en verde** (`SMOKE OK: 86 pasos en verde`) |
| Playwright | `npx playwright test` (desde `frontend/`) | ✅ **7 passed** (8.9s) |

> **Nota de tooling:** el hook de `rtk` trunca la salida de estos comandos (`make smoke` se ve cortado en 43 de 86 pasos, y llega a alterar valores numéricos que se imprimen por `echo`). Para leer resultados reales hay que ir por `rtk proxy '<comando>'`. Los tres números de arriba son de corridas por `rtk proxy`.

Los 7 specs de Playwright: `edificio-unidades`, `residentes-invitacion` (vincular/activar/desvincular), `residentes-invitacion` (422 `EMAIL_YA_REGISTRADO` inline), `selector-organizacion` (2 membresías cambian de org), `selector-organizacion` (1 membresía → sin selector), `smoke` S1, `staff-usuarios` (invitar/reenviar/editar/desactivar).

## 2. Verificación manual de la DoD

79 aserciones propias sobre la API corrida (`/tmp/qa-s4/dod.sh` + `probe4.sh`), más recorrido visual del frontend. **79 pass / 0 fail.**

| # | Punto de la DoD | Resultado |
|---|---|---|
| 1 | Admin invita gestor → acepta → login → solo sus edificios | ✅ **PASS** |
| 2 | Gestor vincula propietario a UF → activa por `/invitacion/:token` → login | ✅ **PASS** |
| 3 | `multiconsorcio@demo.com`: un solo login, UFs de Org A y Org B | ✅ **PASS** |
| 4 | Staff con 2 membresías: selector cambia el contexto sin re-login | ✅ **PASS** (con reserva de seed → QA-02) |
| 5 | `/register`: alta nueva + 422 con email/CUIT duplicados | ✅ **PASS** |
| 6 | Invitación pendiente del seed: activa y el segundo uso da error claro | ✅ **PASS** |
| 7 | Aislamiento cross-org | ⚠️ **PASS por rol, roto por QA-01** |

### Área 1 — Alta de staff (Workflow A, PRD §4)
Ruta feliz completa por API y por UI. `admin@demo.com` ve los 2 edificios de Org A; el alta de un GESTOR con un edificio devuelve `invitacionUrl`; el `GET /api/invitaciones/:token` es público y enmascara el email (`e***@test.dev`); el invitado figura en la nómina con `cuentaActivada: false`; al aceptar se emite sesión; el login posterior trae `roles: ['gestor']` y **un solo edificio, justo el asignado**. El gestor recibe 403 en el backoffice de staff y 403 en el edificio no asignado.

Gestión posterior verificada: `PATCH` de edificios (1 → 2 → 1, y el gestor ve el cambio en su siguiente login sin intervención), desactivar/reactivar un gestor, `409 INVITACION_PENDIENTE` en la segunda invitación al mismo email, `409` al invitar a un miembro ya activo.

**UI** (`/configuracion/usuarios`, capturas 01–03): tabla con nombre/email/rol/edificios/estado, badge `Invitado` para el pendiente, `Todos` para el org_admin. El form valida inline con Zod (`Ingresá un email válido`) y mantiene el submit deshabilitado; muestra el aviso ámbar *"Sin edificios asignados, el gestor ve la organización en solo lectura"* (PRD §9). Tras el alta, el modal "Invitación creada" trae el link con botón Copiar, la fecha de vencimiento y la aclaración de un solo uso, más un toast; la fila aparece al instante como `Invitado`.

### Área 2 — Alta de residente (Workflow B, PRD §5)
`gestor@demo.com` lista las unidades de Torre Palermo, vincula un propietario en la UF 1A y recibe `invitacionUrl` de `tipo: RESIDENTE`. El propietario activa, loguea con `roles: ['propietario']` y **sin membresía staff** (0 organizaciones → no le corresponde selector, correcto según PRD §5.5). El vínculo aparece en la lista de la UF; el duplicado da `409 VINCULO_DUPLICADO`; el desvincular deja `fechaFin` seteada y el vínculo sigue existiendo (baja lógica, sin borrado físico). El gestor de Torre Palermo recibe **403** al intentar vincular en una UF del Edificio San Martín (no asignado).

**UI** (drawer Residentes, captura 04): se abre desde la fila de la DataTable, muestra `Vigentes (1)` con nombre, email, badge `Propietario`, `Desde 1/8/2024` y botón Desvincular, más el form "Vincular persona" con `fechaInicio` en hoy por defecto y checkboxes propietario/inquilino.

> `DELETE /api/unidades/:id/residentes/:vinculoId` devuelve **200 con el vínculo actualizado**, no 204 (yo esperaba 204). Es intencional y está comentado en el handler — el sprint no fija el status. **No es bug.**

### Área 3 — Identidad global multi-consorcio
`multiconsorcio@demo.com` loguea una sola vez. En la DB: **1 solo registro en `usuarios`** para ese email, con **2 `unidad_usuarios` vigentes que cuelgan de 2 organizaciones distintas** (Torre Palermo 2A en Org A + Lomas 1A en Org B). Su JWT trae `org_id: null` y 0 membresías staff. Además, **cero emails duplicados en toda la tabla `usuarios`** — la unicidad global se sostiene.

> El "portal muestra su UF" de la DoD no es verificable todavía: no existe endpoint de portal residente (es S5). Verifiqué el sustrato: identidad única + vínculos correctos + login. Lo dejo señalado, no como fallo de S4.

### Área 4 — Selector de organización
El cambio de contexto funciona completo: `POST /api/auth/cambiar-organizacion` re-emite access + refresh, el JWT nuevo apunta a Org B, con ese token se ve **solo Edificio Lomas**, y al volver a Org A reaparecen sus 2 edificios. Sin membresía → `403 SIN_MEMBRESIA`.

**UI** (capturas 05–07): con 1 membresía el nombre de la organización es texto plano; con 2 se convierte en un dropdown con encabezado "Organización activa" y check en la actual. Al elegir la otra, el header pasa a `Administración Sur S.R.L.` + `Edificio Lomas` y redirige al dashboard, **sin re-login**. `/configuracion/usuarios` en contexto Org B lista solo a sus 2 admins: **ningún staff de Org A**.

### Área 5 — RegisterPage
`POST /api/auth/register` con `{email, password, nombre, apellido, organizacion:{nombre, cuit, matriculaRPA}}` crea la administración y entra como `org_admin`, con 0 edificios. Email duplicado → **422 `EMAIL_YA_REGISTRADO`**; CUIT duplicado → **422 `CUIT_YA_REGISTRADO`** ("Ya existe una organización con ese CUIT"), y el intento fallido **no deja el usuario creado** (login posterior 401 → la transacción revierte bien). El spec de Playwright cubre el 422 inline en la UI.

### Área 6 — Invitación pendiente del seed
`/invitacion/seed-invitacion-pendiente`: `GET` 200 con `{email: 'i***@demo.com', tipo: STAFF, organizacion: Administración Demo S.A., expiraAt}`. Antes de activar, `invitado@demo.com` **no puede loguear (401)**. El primer uso activa y devuelve sesión con `roles: ['gestor']`; después loguea normal y ve **solo Edificio San Martín**. El segundo uso da **410 `INVITACION_INVALIDA`** con mensaje claro y accionable: *"La invitación no existe, ya fue usada o venció. Pedí una nueva a tu administración."* El `GET` del token consumido también da 410 (indistinguible de inexistente, bien). Un segundo intento con otra password **no altera** la password ya definida.

### Área 7 — Casos borde PRD §9
Todos en verde: `ULTIMO_ORG_ADMIN` al desactivar al único org_admin (y sigue operando después del intento); gestor sin edificios → 201 permitido; `ORG_ADMIN` con `edificioIds` → 422; sin token → 401; token basura → 401; token inexistente → 410; password corta al aceptar → 422; Org B no lista staff de Org A.

---

## 3. Hallazgos

### QA-01 · **BLOQUEANTE** · Escalada cross-org vía invitación a un email ya existente
*Es el mismo defecto que `S4-security.md` reporta como **SEC-01 (CRITICAL)** y **SEC-02 (HIGH)**. Lo incluyo porque rompe un punto explícito de la DoD del sprint (aislamiento cross-org) y porque lo reproduje de forma independiente end-to-end.*

`POST /api/invitaciones/:token/aceptar` emite **siempre** una sesión completa para la identidad del email invitado, incluso cuando esa cuenta ya estaba activada y la aceptación no aportó ninguna credencial. Como en el MVP el link **no se envía por email sino que se le devuelve al invitador** (`invitacionUrl`), quien invita siempre posee el token: el token deja de ser prueba de posesión del buzón y funciona como credencial de suplantación. La precondición es "ser org_admin de alguna organización", y eso es self-service por `/register`.

**Repro (verificado, `/tmp/qa-s4/sec3.sh`):**
1. Login como `admin.sur@demo.com` (org_admin de Org B, sin ninguna relación con Org A).
2. `POST /api/organizaciones/me/usuarios` con `{"email":"gestor2@demo.com","rol":"GESTOR"}` — `gestor2@demo.com` es staff **activo de Org A**. La respuesta trae `invitacionUrl`.
3. `POST /api/invitaciones/<token>/aceptar` con cualquier password, **sin autenticación**.
4. → `200` con `accessToken` + `refreshToken` **para la identidad `gestor2@demo.com`**, y la `organizacionId` activa de esa sesión ya es **Org A**.
5. `GET /api/edificios` con ese token → `200` con `['Edificio San Martín', 'Torre Palermo']` — **los edificios de Org A**.
6. `POST /auth/cambiar-organizacion` deja moverse libremente entre las organizaciones de la víctima.

**Atenuantes verificados:** la password original de la víctima **no** se sobrescribe (probado con `gestor@demo.com` y con `propietario1@demo.com`: la password vieja sigue funcionando y la que fija el atacante no). El daño es la sesión emitida, no el robo de la credencial. Para cuentas **no** activadas sí hay fijación de password (SEC-02).

**Ver remediación en `S4-security.md` (SEC-01/SEC-02).** La mínima: no emitir sesión en el accept cuando la invitación no aportó credenciales (si `passwordHash != null` → `200 { yaActivada: true }` y al login).

### QA-02 · Medio · El seed no cubre el caso "staff con 2 membresías", que es un punto de la DoD
Ningún usuario del seed tiene 2 membresías staff activas: `admin@demo.com` está solo en Org A, `admin.sur@demo.com` solo en Org B, y `multiconsorcio@demo.com` es residente (`unidad_usuarios`), no staff — el propio smoke lo verifica (`no tiene membresías para el selector (0)`). O sea, **el punto 4 de la DoD no se puede probar a mano con el seed tal como está documentado**: hay que fabricar la membresía. PRD-04-11 §10 lista 7 casos y ninguno es "staff multi-organización"; AGENTS.md tampoco lo advierte.

Lo verifiqué creando la membresía extra vía API (`admin.sur@demo.com` invita a `admin@demo.com` como `ORG_ADMIN` de Org B) y funcionó a la primera, tanto en API como en UI. **Sugerencia:** agregar un caso 8 al seed (un staff con membresía en las dos orgs, p.ej. `multistaff@demo.com`) o documentar el paso manual en AGENTS.md junto al selector. Ojo: el reseed **desactiva** las membresías de usuarios demo en orgs ajenas, así que la membresía fabricada se pierde en cada `make db-seed` — de ahí que convenga que sea parte del seed.

### QA-03 · Bajo · Un usuario sin membresía activa loguea y cae en un error genérico engañoso
`encargado@demo.com` (identidad del seed sin vínculos) y cualquier staff **desactivado** loguean con **200** y JWT válido, pero con `roles: []` y `organizacionId: null`; después toda llamada da `403 SIN_ORGANIZACION_ACTIVA`. En la UI (capturas 08 y 08b) eso se ve como el shell completo con `...` donde iría el nombre de la organización, `Sin edificios` en el selector y el mensaje rojo **"No se pudieron cargar los edificios. Intentá de nuevo más tarde."** — un mensaje de error transitorio con invitación a reintentar, para lo que en realidad es una condición **permanente de permisos**. 5 respuestas 403 en consola. No hay camino de salida más que desloguearse a mano.

Es coherente con lo que AGENTS.md documenta para `encargado@demo.com` ("loguea pero Cerbos le niega todo"), así que no lo cuento como fallo del slice, pero para un gestor al que le dieron de baja el mensaje es desorientador. **Sugerencia:** detectar `organizaciones: []` en el login y mostrar una pantalla explícita ("tu acceso a esta administración fue dado de baja, contactá a tu administrador"), o mapear `SIN_ORGANIZACION_ACTIVA` a un mensaje propio en vez del genérico de red.

### Observaciones sin acción (no son bugs)
- **`PATCH /api/organizaciones/me/usuarios/:id` espera el `usuarioId`**, pero la fila de la nómina expone también `membresiaId`; pasarlo devuelve `USUARIO_NO_ENCONTRADO` en vez de un 422 orientador. El frontend usa `miembro.id` correctamente y hay un comentario en `StaffEditarDialog.jsx:5` que lo aclara. Solo un filo para futuros consumidores de la API.
- **Un email ya existente queda con la membresía `Activo` de inmediato**, aunque su invitación siga pendiente (visible en la captura 07: `admin@demo.com` figura `Activo` en Org B sin haber aceptado). Es lo que pide PRD §4.3 ("solo agrega la membresía/vínculos") y es también parte del sustrato de QA-01.
- **El `DELETE` de residentes es idempotente** y no reescribe una `fechaFin` previa. Correcto.

---

## 4. Datos de prueba y limpieza

Todo lo que creé usa el prefijo `e2e-` acordado. Corrí `docker exec consorcIA-backend node prisma/seed.js` al terminar: el seed limpió los usuarios `e2e-staff-*` / `e2e-residente-*`, desactivó las membresías de usuarios demo en organizaciones ajenas (`admin@demo.com` → `E2E Administración B` quedó en `f`) y dejó la invitación `seed-invitacion-pendiente` otra vez pendiente. **Estado del seed: restaurado y consistente.**

Queda **residuo de organizaciones huérfanas** en la DB, que el seed no borra (solo borra las dos orgs demo por CUIT):

| Organización | CUIT | Origen |
|---|---|---|
| `e2e-QA Admin 1785295807` | `30-71995807-1` | mío (pruebas de `/register` de esta corrida) |
| `e2e-QA Admin 1785295933` | `30-71995933-1` | mío (idem) |
| `E2E Administración B` | `30-70000001-9` | preexistente (specs de Playwright) |
| `Org B Test 178529063223048` | `30-17852906-2` | preexistente (`npm test`) |
| `Org Test Aislamiento …` ×3 | `30-17852906-5` / `-17852907-8` / `-17852908-7` | preexistente (`npm test`) |

Las mías quedaron sin usuarios (el seed borró sus org_admin `e2e-staff-reg*@test.dev`), así que son cáscaras inertes. **No las borré** — eliminar organizaciones es destructivo y queda a criterio del equipo. Es un patrón que ya venía de las otras suites: si molesta, vale la pena que el seed limpie también por prefijo de nombre `e2e-`/`Org Test`, no solo por CUIT demo.

**Repo:** el único archivo que escribí es este reporte. Sin commits, sin push, sin resets de DB. `HEAD` sigue en `3d34637`. Las 11 capturas quedaron fuera del repo, en `/tmp/qa-s4/` (junto a los scripts `dod.sh`, `probe4.sh`, `sec*.sh` y los logs de los 3 gates).

## 5. Recomendación de cierre

El slice funciona: la DoD funcional está cumplida y los 3 gates están en verde. **QA-01 debería resolverse antes de exponer el sistema a más de una organización real** — no es un fallo de implementación de las tareas S4-01…S4-10 sino la consecuencia de la decisión de MVP de devolverle el link al invitador, y ya tiene remediación propuesta en `S4-security.md`. QA-02 es un hueco de cobertura del seed que conviene tapar en el mismo paso. QA-03 es pulido de UX y puede esperar a S5.
