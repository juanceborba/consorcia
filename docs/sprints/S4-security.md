# S4 — Auditoría de seguridad (usuarios e identidad)

**Fecha:** 2026-07-29 · **Modo:** `--standard` (OWASP A01–A10 + STRIDE + verificación activa con curl)
**Scope:** `git diff origin/main...main` (65 archivos, 22 commits), políticas `cerbos/policies/staff.yaml` y `residente.yaml`, middlewares `auth` / `tenant` / `unidad` / `rbac`, migraciones `20260729020000_s4_identidad_global` y `20260729024000_s4_invitaciones`, seed multi-caso y frontend del slice (`InvitacionPage`, `RegisterPage`, `OrganizacionSelector`, `auth.store`).

**Veredicto:** `CRITICAL (1) HIGH (2) MEDIUM (4) LOW (7) = 14 hallazgos. Score: D`
**NO apto para ship.** SEC-01 es una toma de cuentas completa, cross-tenant, verificada contra el stack local: cualquier `org_admin` (y el registro es público, así que cualquier persona con acceso a internet) obtiene una sesión válida de cualquier cuenta del sistema conociendo solo su email, sin conocer ni cambiar su password. SEC-02 y SEC-03 son variantes del mismo defecto de diseño y comparten remediación.

**Detectado:** Node 20 + Express 5 + Prisma 6 + Zod + Cerbos 0.54 (PDP HTTP) + Redis · React 19 + Vite + TanStack Query · Postgres 16 con RLS parcial.

---

## Resumen de los vectores priorizados

| Vector | Resultado |
|---|---|
| Invitaciones · fuerza bruta / enum de tokens | **Limpio.** Token UUIDv4 (122 bits) y 410 indistinguible entre inexistente / usada / vencida. El token fijo del seed sí es un riesgo, pero de entorno → SEC-08. |
| Invitaciones · toma de cuentas | **SEC-01 (CRITICAL) + SEC-02 (HIGH).** Hay dos caminos: sesión directa sobre cuenta activada, y fijación de password sobre cuenta no activada. |
| Invitaciones · email enmascarado | **Limpio.** `j***@dominio` (1 char + dominio), suficiente para que el invitado se reconozca sin identificar a un tercero. |
| Invitaciones · un solo uso bajo concurrencia | **Limpio y verificado.** 3 aceptaciones paralelas del mismo token → `1×200` + `2×410`. |
| Tenancy con identidad global · queries sin scope | **Limpio.** Todas las queries nuevas llevan `organizacionId` o navegan por relación scopeada; las de `usuario` por email son globales por diseño. |
| Tenancy · IDOR staff/residentes cross-org | **Limpio y verificado.** `PATCH` con `usuarioId` de otra org → `404 USUARIO_NO_ENCONTRADO`. |
| Switch de org · membresía desactivada | **Limpio y verificado.** `403 SIN_MEMBRESIA` en `cambiar-organizacion` y en `tenant` con access token todavía vivo. |
| Switch de org · scope del refresh | **Limpio y verificado.** El refresh conserva la org y, si la membresía se desactiva, degrada a `org_id: null / roles: []`. |
| Migración · RLS vieja y columna eliminada | **Limpio** (con la salvedad de SEC-12). Policy e índices viejos dropeados, sin referencias residuales a `usuarios.organizacion_id` ni `usuarios.rol`. |
| Cuentas sin activar (`password_hash NULL`) | **Limpio para login** (401 uniforme), **explotable vía invitación** → SEC-02. |
| Concesión de membresía sin consentimiento | **SEC-03 (HIGH).** No estaba en la lista de vectores y resultó el tercer hallazgo grave. |
| Auth · bcrypt / refresh rotation / localStorage | **SEC-09/10/11 (LOW).** Rotación correcta; cost 10 y localStorage ya documentados en S2. |

---

## Hallazgos

### SEC-01 · CRITICAL · Secuestro de sesión de cualquier cuenta activada vía invitación propia
**Archivo:** `backend/src/routes/invitaciones.routes.js:271` (con `backend/src/routes/staff.routes.js:308` y `:331`)

`POST /api/invitaciones/:token/aceptar` emite **siempre** una sesión completa para el `Usuario` resuelto por el email de la invitación (`emitirSesion(usuario)`), incluso cuando la cuenta ya estaba activada y la aceptación no agregó nada. El comentario del archivo (`:7-11`) apoya el diseño en que "el token es la única credencial (prueba de posesión del buzón)", pero en el MVP **el link no se envía por email: se devuelve al invitador** en el body (`invitacionUrl`, `staff.routes.js:331`, y `notificaciones.service.js` es un stub con `enviado: false`). El invitador siempre posee el token, así que la premisa de posesión del buzón no se cumple y el token funciona como una credencial de suplantación.

**Precondición:** ser `org_admin` de **cualquier** organización y conocer el email de la víctima. `POST /api/auth/register` es público (`auth.routes.js:70`, sin `requireAuth`) y crea organización + `ORG_ADMIN` con solo un CUIT con formato válido: la precondición es "tener acceso a internet".

**Evidencia (ejecutada contra el stack local).** Atacante = `admin.sur@demo.com` (org_admin de "Administración Sur"). Víctima = `admin@demo.com` (org_admin de "Administración Demo", cuenta activada):

```
POST /api/organizaciones/me/usuarios  (como admin.sur)
  {"email":"admin@demo.com","nombre":"x","rol":"GESTOR","reenviar":true}
→ 200 { usuario:{cuentaActivada:true}, invitacionUrl:".../invitacion/29c80673-…" }

POST /api/invitaciones/29c80673-…/aceptar   (sin autenticación)
  {"password":"cualquiera123"}
→ 200 {
    accessToken:"…", refreshToken:"…",
    user:{ email:"admin@demo.com", nombre:"María Fernanda",
           roles:["org_admin"],
           organizacionId:"9bd6de60-…"  ← la organización DE LA VÍCTIMA
           organizaciones:[ "Administración Demo S.A." (org_admin), "Administración Sur S.R.L." (gestor) ] }

GET /api/organizaciones/me       -H "Bearer <token robado>" → 200 {"nombre":"Administración Demo S.A.","cuit":"30-71234567-8",…}
GET /api/organizaciones/me/usuarios -H "Bearer <token robado>" → 200 [nómina completa del staff de la víctima]
```

La password de la víctima **no se toca** (`login demo1234 → 200`, `login cualquiera123 → 401`): el ataque es silencioso y no dispara ninguna señal para la víctima. El `refreshToken` robado dura 7 días y sobrevive a cualquier cambio de password. Con `POST /auth/cambiar-organizacion` el atacante entra además a **todas** las organizaciones de la víctima (vienen listadas en la respuesta).

**Impacto:** A01 Broken Access Control + A07 Identification and Authentication Failures. Compromiso total de cualquier tenant a partir del email de uno de sus org_admin. STRIDE: Spoofing + Elevation of Privilege.

**Remediación (mínima):** no emitir sesión en el accept cuando la invitación no aportó credenciales — si `existente.passwordHash != null`, responder `200 { yaActivada: true }` y mandar a login (el vínculo ya quedó creado en el alta, así que no se pierde nada). Complementario y recomendado: dejar de devolver `invitacionUrl` al invitador y enviar el link al buzón, o —si el MVP necesita el copiar-link— que ese link no habilite nunca la emisión de sesión, solo la definición de password de una cuenta virgen. Ver también SEC-02.

---

### SEC-02 · HIGH · Toma de cuentas no activadas: un tenant ajeno fija la password
**Archivo:** `backend/src/routes/invitaciones.routes.js:169` y `:185`

Cuando el `Usuario` existe pero tiene `passwordHash NULL` (dado de alta por backoffice y todavía sin activar, estado normal del Workflow A/B), el accept **sí** define la password (`...(existente.passwordHash ? {} : { passwordHash })`). Como el token lo posee el invitador (ver SEC-01) y el `Usuario` es global (S4-01), un `org_admin` de otra organización puede invitar ese email, quedarse con el link y fijar la credencial de una identidad que **otro tenant** aprovisionó.

**Evidencia (ejecutada).** Org A invita a `e2e-staff-secaudit@demo.com` como GESTOR (queda `cuentaActivada:false`). Org B invita el mismo email, se queda con su token y acepta con `AtacanteFijaEsto1`:

```
POST /api/invitaciones/eaf4ae3c-…/aceptar {"password":"AtacanteFijaEsto1"} → 200
POST /api/auth/login {"email":"e2e-staff-secaudit@demo.com","password":"AtacanteFijaEsto1"} → 200
  user.organizacionId = cea76943-…   ← la organización de la VÍCTIMA (Org A), rol gestor
  user.organizaciones = [Org A (gestor), Org B (org_admin)]
```

El atacante entra directamente en el tenant que había invitado a esa persona, y la persona real nunca puede activar su cuenta (su link sigue vivo pero la password ya es de otro). `cuentaActivada` en la respuesta del alta (SEC-04) es el oráculo perfecto para elegir víctimas.

**Remediación:** aceptar solo invitaciones que se puedan atribuir al buzón (envío real por email) o exigir que el aceptante demuestre posesión con un segundo factor fuera del canal del invitador. Como mitigación inmediata: no permitir que un `Usuario` preexistente —activado o no— sea alcanzado por una invitación creada por una organización distinta de las que ya lo tienen vinculado, y no fijar password sobre un `Usuario` que otra organización creó.

---

### SEC-03 · HIGH · Membresía sin consentimiento: secuestro de la organización por defecto y pérdida de los roles de residente
**Archivos:** `backend/src/routes/staff.routes.js:266-275` · `backend/src/services/auth.service.js:63-90`

El alta de staff crea la membresía **activa de entrada** (decisión explícita de PRD-04-11 §4.3) sin ninguna aceptación de la persona. Combinado con la identidad global y con `membresiaActiva()` —que elige la organización **primera alfabéticamente**— cualquier `org_admin` puede, con solo el email:

1. Meter a una persona ajena en su tenant y darle rol de staff sin que lo sepa.
2. Cambiarle la **organización por defecto** de su sesión, registrando una organización cuyo nombre gane el orden alfabético (`"AAA Administración"`).
3. **Borrarle los roles de residente**: `resolverContextoAcceso` (`auth.service.js:77-90`) devuelve el contexto de la membresía y solo cae a los roles derivados de `unidadUsuario` si **no** hay membresía. Un propietario/inquilino al que le inyectan una membresía staff pierde `propietario`/`inquilino` de su sesión.

**Evidencia (ejecutada).** `propietario1@demo.com` es residente de Org A (propietario de una UF). Desde Org B (organización ajena) se lo invita como GESTOR; después, su propio login:

```
POST /api/auth/login {"email":"propietario1@demo.com","password":"demo1234"}
→ user.roles          = ["gestor"]           ← ya no es propietario
  user.organizacionId = 563abe1d-…           ← "Administración Sur S.R.L." (el tenant ajeno)
  user.organizaciones = [ "Administración Sur S.R.L." (gestor) ]
```

**Impacto:** A01. Integridad (pertenencia falsa a un tenant, con implicancias legales bajo Ley 941/25.326) + denegación de servicio sobre el portal del residente (S5 va a leer esos roles) + vector de phishing: la víctima entra por defecto a la organización del atacante creyendo que es la suya.

**Remediación:** (a) que los roles del contexto sean la **unión** de membresías y vínculos de unidad, no una alternativa excluyente; (b) que la membresía nazca `activo: false` hasta que la persona acepte, o al menos que solo nazca activa si el `Usuario` no existía; (c) elegir la organización por defecto por criterio de la persona (última usada / marcada) y no por orden alfabético global.

---

### SEC-04 · MEDIUM · Divulgación de PII cross-tenant y oráculo de enumeración de usuarios
**Archivo:** `backend/src/routes/staff.routes.js:321-327`

La respuesta del alta devuelve `nombre`, `apellido` y `cuentaActivada` **del `Usuario` existente en la DB**, ignorando lo que mandó el invitador. Cualquier `org_admin` convierte así un email en el nombre real de la persona y en su estado de activación, sin que esa persona tenga relación alguna con su organización.

**Evidencia (ejecutada).** Desde Org B, con `nombre:"ZZZ", apellido:"ZZZ"`:

```
email=propietario1@demo.com          → {"nombre":"Roberto","apellido":"Álvarez","cuentaActivada":true}
email=e2e-staff-noexiste-zzz@demo.com→ {"nombre":"ZZZ","apellido":"ZZZ","cuentaActivada":false}
```

Además de la PII (Ley 25.326: minimización), `cuentaActivada` es el oráculo que selecciona víctimas para SEC-02 y distingue email existente de inexistente. Los códigos 409 `VINCULO_DUPLICADO` / `INVITACION_PENDIENTE` filtran lo mismo en menor grado.

**Remediación:** devolver en el alta solo lo que el invitador mandó (o solo el `id`), nunca los datos persistidos de una identidad que no le pertenece.

---

### SEC-05 · MEDIUM · Sin rate limiting ni lockout en ningún endpoint público
**Archivo:** `backend/src/app.js:51-56` (no hay middleware de rate limit; `express-rate-limit` no está en `package.json`)

`POST /auth/login`, `POST /auth/refresh`, `GET /invitaciones/:token`, `POST /invitaciones/:token/aceptar` y `POST /auth/register` no tienen límite de tasa ni bloqueo por intentos. No hace falta para adivinar tokens (UUIDv4), pero sí abarata el password spraying contra `login`, el registro masivo de organizaciones (que es la precondición de SEC-01/02/03) y la enumeración de SEC-04. Tampoco hay `helmet` ni cabeceras de seguridad en el backend.

**Remediación:** `express-rate-limit` con cubetas por IP y por email en `login` / `register` / `invitaciones/*`, más lockout progresivo. Sumar `helmet`.

---

### SEC-06 · MEDIUM · El accept revive cuentas dadas de baja lógica
**Archivo:** `backend/src/routes/invitaciones.routes.js:182-184`

El accept fuerza `activo: true, deletedAt: null` sobre el `Usuario` existente sin condición. Cualquier baja global (ban, borrado lógico por pedido del titular bajo Ley 25.326, cuenta comprometida) se revierte con una invitación que el propio atacante genera. Hoy no hay endpoint que ponga `usuario.activo = false` (solo `organizacionUsuario.activo`), así que el vector aplica a bajas manuales/operativas y queda armado para cuando el endpoint exista.

**Remediación:** no tocar `activo`/`deletedAt` del `Usuario` en el accept; si está dado de baja, responder 410 y que la reactivación sea un acto administrativo explícito.

---

### SEC-07 · MEDIUM · Un `GESTOR` con membresía en otra org conserva `edificios_asignados` y rol por 15 minutos
**Archivos:** `backend/src/middleware/tenant.middleware.js:35-47` · `backend/src/middleware/unidad.middleware.js:25-30` · `backend/src/middleware/rbac.middleware.js:33-36`

`tenant` revalida contra la DB la **existencia y actividad de la membresía**, pero el **rol** y los **edificios asignados** que consumen Cerbos, `validarEdificio` y `validarUnidad` salen de los claims del JWT. Quitarle un edificio a un gestor (`PATCH /me/usuarios/:id` con `edificioIds`) o degradarlo no surte efecto hasta que expire el access token: hasta 15 minutos de acceso a las UFs y residentes de un edificio del que ya fue desasignado. Con identidad global el problema se amplifica: la misma persona tiene rol distinto en cada organización y el claim describe solo una.

**Remediación:** revalidar rol y `edificiosAsignados` en `tenant` junto con la membresía (una query más, ya se está haciendo el roundtrip) y usar esos valores en `req.user` en vez de los claims.

---

### SEC-08 · MEDIUM · Seed sin guard de entorno, con token de invitación predecible y passwords conocidas
**Archivo:** `backend/prisma/seed.js:47` y `:383` (`token: 'seed-invitacion-pendiente'`), `:42` (`PASSWORD_DEMO = 'demo1234'`)

El seed no chequea `NODE_ENV` ni ninguna bandera antes de escribir, y ahora además crea una invitación **STAFF pendiente con token literal**. En un entorno alcanzable (staging con datos reales, demo pública), `POST /api/invitaciones/seed-invitacion-pendiente/aceptar` es una activación no autenticada que entrega `GESTOR` de la Org A del seed a cualquiera que conozca el string. Verificado que la fila existe con ese token exacto:

```
docker exec consorcIA-postgres psql -c "select email,token,usada_at from invitaciones"
 invitado@demo.com | seed-invitacion-pendiente | …
```

El riesgo marginal sobre las passwords demo (`demo1234`, ya conocidas) es bajo, pero el token predecible no requiere ni conocer un email.

**Remediación:** abortar el seed si `NODE_ENV === 'production'` o si falta `SEED_ALLOW=1`; generar el token con `randomUUID()` e imprimirlo por consola (el `make seed` ya loguea la URL, así que la DX no se pierde).

---

### SEC-09 · LOW · `bcrypt` cost 10
`backend/src/routes/invitaciones.routes.js:169` y `backend/src/routes/auth.routes.js:101` usan `bcrypt.hash(password, 10)`. Recomendado 12 para 2026. Ya señalado en S2; el accept de invitaciones lo replica.

### SEC-10 · LOW · Política de password mínima (8 caracteres, sin más)
`invitaciones.routes.js:39` y `auth.routes.js:32`: solo longitud ≥ 8, sin complejidad ni chequeo contra listas de passwords filtradas. Sin rate limiting (SEC-05) el spraying con las 1000 passwords más comunes es viable.

### SEC-11 · LOW · Tokens en `localStorage`
`frontend/src/stores/auth.store.js` persiste `accessToken` y `refreshToken` en `localStorage` (cualquier XSS los exfiltra, y el refresh dura 7 días). Ya documentado como LOW en S2; S4 suma `establecerSesion()` como tercera vía de escritura (register, accept de invitación, cambio de organización), sin cambiar el modelo de almacenamiento. Sin regresión.

### SEC-12 · LOW · RLS: `usuarios` queda sin policy y la nueva de `invitaciones` es inerte (y rompería el flujo público)
`backend/prisma/migrations/20260729020000_s4_identidad_global/migration.sql:66-67` dropea `organizacion_isolation_usuarios` y hace `DISABLE ROW LEVEL SECURITY` sobre `usuarios`. Es correcto para identidad global —la tabla ya no tiene tenant— pero se pierde la capa de defensa en profundidad y el aislamiento de personas pasa a depender enteramente de la aplicación. Complementariamente, `20260729024000_s4_invitaciones/migration.sql:53-55` agrega una policy que compara con `current_setting('app.current_organizacion_id')`, GUC que **nadie setea** (`db/prisma.js` conecta como owner, que bypasea RLS): la policy es inerte hoy y, el día que el backend migre a un rol non-owner, romperá `GET /api/invitaciones/:token`, que es público y no tiene organización en contexto.

### SEC-13 · LOW · Token de invitación en la URL del SPA
`frontend/src/pages/InvitacionPage.jsx:62` (`/invitacion/:token`). El token viaja en el path: queda en el historial del navegador, en los access logs de nginx y se filtra por `Referer` a cualquier recurso externo que la página cargue en el futuro. Hoy la página no carga nada externo. Mitigación habitual: mover el token a fragmento (`#`) o canjearlo por un token de sesión corta al primer GET.

### SEC-14 · LOW · `buscarPendiente` no filtra por vencimiento y el accept concurrente puede devolver 500
`backend/src/services/invitaciones.service.js:32-36`: el comentario dice "Pendiente = sin usar y **vigente**: una vencida no bloquea", pero la query solo filtra `usadaAt: null`. Consecuencia: una invitación vencida sigue bloqueando el alta con `409 INVITACION_PENDIENTE` y el admin necesita `reenviar: true` para un caso que la spec considera libre. Además, en `invitaciones.routes.js:172-197`, dos accepts paralelos de **tokens distintos** para un email inexistente colisionan en el `usuario.create` y el `P2002` cae al `errorHandler` como `500 ERROR_INTERNO` (el catch solo mapea `esInvitacionUsada`). No es un bypass —la transacción revierte— pero es ruido de 500 en un endpoint público.

---

## Lo sólido (verificado, no solo leído)

- **Un solo uso bajo concurrencia.** `updateMany({ where: { id, usadaAt: null } })` dentro de la transacción (`invitaciones.routes.js:260-266`) serializa por lock de fila. Tres aceptaciones paralelas del mismo token: `1×200`, `2×410 INVITACION_INVALIDA`. Los vínculos se aplicaron una sola vez.
- **Revocación de membresía efectiva en el momento.** Con un access token emitido antes de la baja: `GET /api/organizaciones/me → 403 SIN_MEMBRESIA`; `POST /auth/cambiar-organizacion → 403`; `POST /auth/refresh` degrada el contexto a `org_id: null, roles: []`. La revalidación de `tenant.middleware.js:35-47` cierra la ventana de 15 minutos para la membresía.
- **Switch de organización fail-closed.** `cambiar-organizacion` a una org sin membresía (o inexistente, o con membresía desactivada) devuelve el mismo `403 SIN_MEMBRESIA` sin filtrar qué organizaciones existen. Revalida además que el `Usuario` siga activo (`auth.routes.js:236-243`).
- **Sin IDOR en staff.** `PATCH /me/usuarios/:usuarioId` con el id de un miembro de otra organización → `404 USUARIO_NO_ENCONTRADO`; la membresía se resuelve por `(organizacionId del JWT, usuarioId)`.
- **Cerbos fail-closed y política correcta.** Gestor contra `staff`: `403` en `read` y en `create`. `staff.yaml` no tiene regla para gestor y no hay `EFFECT_DENY` innecesario (el default deniega). `residente.yaml` replica el scope doble de `unidad.yaml` (org + `edificio_id in edificios_asignados`). El middleware traduce PDP caído / timeout / payload raro a 403.
- **Login uniforme.** `401 CREDENCIALES_INVALIDAS` idéntico para email inexistente, cuenta con `password_hash NULL` y password incorrecta (`auth.routes.js:143-155`); el `bcrypt.compare` se saltea con short-circuit sobre `usuario?.passwordHash`, así que hay una diferencia de timing teórica, pero el estado "sin activar" ya se filtra de forma explícita por SEC-04, que es el problema real. **Ningún usuario con `password_hash NULL` puede loguearse** (verificado: 18 usuarios en la DB demo, todos los `NULL` rechazados).
- **Rotación de refresh.** `getdel` atómico (`auth.service.js:170`), un refresh usado no se puede reusar, y el TTL de 7 días se re-crea en cada rotación. El formato viejo se parsea con tolerancia sin abrir un bypass.
- **Migración de identidad global limpia.** Emails normalizados a lowercase con abort si hay colisiones (`:15-24`), datos migrados a `organizacion_usuarios` con guard de huérfanos (`:50-60`), policy RLS e índices viejos dropeados (`:66-74`), columnas eliminadas y unique global creado. Grep de todo `backend/src` y `prisma`: **cero** referencias residuales a `usuarios.organizacion_id` o `usuario.rol`.
- **Scope de org en las queries nuevas.** `staff` (`organizacionId` del JWT en todas), `gestorEdificio` (siempre por `edificio: { organizacionId }`, incluso al borrar: `reemplazarEdificiosDelGestor` solo toca los edificios de la org), `unidadUsuario` (`organizacionId` + `unidadId`), invitaciones (`organizacionId`). El `payload.unidadId` de una invitación RESIDENTE se revalida contra la org de la invitación (`invitaciones.routes.js:155-158`) y el `payload.edificioIds` de una STAFF también (`:219-225`).
- **Invariante del último `org_admin`** protegida con `SELECT … FOR UPDATE` sobre la organización (`staff.routes.js:121-123`), lo que cierra la carrera TOCTOU de dos degradaciones simultáneas — mismo patrón que la lección aprendida en S2.
- **`password_hash` nunca se serializa.** Se `select`-ea en `staff.routes.js:170` y `residentes.routes.js:90` para derivar `cuentaActivada`, pero `serializarMiembro` / `serializarVinculo` construyen objetos con campos explícitos. Correcto hoy; conviene derivar el booleano en la query para no pasear el hash.
- **Frontend del slice sin XSS.** `InvitacionPage`, `RegisterPage` y `OrganizacionSelector` no usan `dangerouslySetInnerHTML`; email enmascarado en la pantalla pública; `autoComplete="new-password"` en los campos de password; el 410 no distingue causas.
- **Inyección.** Todo Prisma parametrizado; los dos `$queryRaw` (`lockOrganizacion`, `lockEdificio`) usan template tag con parámetro, no interpolación. Zod con strip de claves extra en todos los bodies nuevos.

---

## Los 3 más críticos

1. **SEC-01 (CRITICAL)** — Sesión completa de cualquier cuenta activada con solo su email, desde cualquier tenant. Toma de control total, silenciosa (la password no cambia) y con refresh de 7 días. Bloquea el ship.
2. **SEC-02 (HIGH)** — Fijación de password sobre una identidad no activada que otro tenant aprovisionó: el atacante entra en el tenant de la víctima y la persona real nunca puede activar su cuenta.
3. **SEC-03 (HIGH)** — Membresía sin consentimiento: cambia la organización por defecto de una persona ajena y le borra sus roles de residente de la sesión.

Los tres comparten raíz: con identidad global, **el email pasó a ser una credencial de aprovisionamiento** y cualquier `org_admin` puede invocar efectos sobre una identidad que no le pertenece. La remediación de fondo es una sola: que ningún efecto sobre un `Usuario` preexistente (credenciales, estado global, membresía activa, sesión) pueda dispararlo una organización sin una prueba de consentimiento del titular; el alta autónoma queda limitada a emails que todavía no existen en el sistema.

---

## Nota de método

- Sin mutaciones de git y sin escrituras de código: el único archivo escrito es este reporte.
- Verificación activa con `curl` contra el stack local (`localhost:3000`) y lecturas `SELECT` en la DB demo. **Residuo en la DB demo** (todo revertible con `make seed`): usuarios `e2e-staff-secaudit@demo.com` y `e2e-staff-conc@demo.com` (limpiados por el prefijo `e2e-staff-` del reseed), y membresías de staff en la Org B demo para `propietario1@demo.com` y `admin@demo.com` (las membresías de las orgs demo se recrean en el reseed). No se ejecutó ningún borrado, reset ni `npm install`.
- Durante la auditoría otro agente estaba operando el mismo stack (aparecen invitaciones y organizaciones ajenas al seed, y los UUID de las orgs demo cambian entre pruebas por reseeds concurrentes). No afecta a ninguno de los hallazgos: todos se reprodujeron con datos creados dentro de la misma corrida.
