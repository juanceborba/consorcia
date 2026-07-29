# S2 — Auditoría de seguridad (edificios y unidades)

**Fecha:** 2026-07-28 · **Modo:** `--standard` (OWASP A01–A10 + STRIDE + dependencias)
**Scope:** diff del sprint `git diff origin/main...main` (50 archivos), políticas `cerbos/policies/edificio.yaml` y `unidad.yaml`, middlewares `auth` / `tenant` / `rbac` / `validation` / `error`, frontend del slice, CI y lockfiles.

**Veredicto:** `CRITICAL (0) HIGH (0) MEDIUM (3) LOW (5) = 8 hallazgos. Score: A`
**Apto para ship** (sin hallazgos bloqueantes). Los 3 MEDIUM son endurecimiento recomendado, no exploits demostrables contra otro tenant.

**Detectado:** Node 20 + Express 5 + Prisma 6 + Zod + Cerbos (PDP HTTP) · React 19 + Vite 6 + TanStack Query/Table + react-router 7.18.1 · Docker + GitHub Actions.

---

## Resumen de los vectores priorizados por el dominio

| Vector | Resultado |
|---|---|
| IDOR entre organizaciones | **Sin hallazgos.** Defensa en 3 capas verificada (ver "Lo sólido"). |
| Gestor accediendo edificios no asignados | **Sin hallazgos.** Filtro de query + `validarEdificio`/`validarUnidad` + condición Cerbos. |
| Bypass de la invariante de coeficientes | **SEC-01 (MEDIUM):** carrera TOCTOU — la validación y la escritura no son atómicas. |
| Inyección en endpoints nuevos | **Sin hallazgos.** Prisma parametrizado + Zod con strip de claves extra en todos los bodies. |
| Secretos en código / historia de git | **Sin hallazgos.** Scan del diff + `git log --all -- .env *.pem *.key` limpios; `.env` gitignored. |

---

## Hallazgos

### SEC-01 (MEDIUM) — Invariante de coeficientes vulnerable a carrera TOCTOU

**Qué:** la suma de coeficientes se valida *antes* de escribir, fuera de la transacción. Dos requests concurrentes leen el mismo estado, ambos validan OK y ambos commitean, dejando la suma ≠ 1.000000.

**Dónde:**
- `backend/src/routes/edificios.routes.js:208-227` (bulk: `findMany` de existentes en 208, `$transaction` de creates en 220)
- `backend/src/routes/unidades.routes.js:100-111` (PATCH: `sumaActualEdificio` en 101, `update` en 108)
- `backend/src/routes/unidades.routes.js:136-142` (DELETE: misma forma)

**Cómo explotarlo:** usuario autenticado (org_admin o gestor asignado) dispara dos `POST /api/edificios/:id/unidades` en paralelo sobre un edificio nuevo, cada uno con un lote que suma 1.0. Ambos pasan el check (léen 0 existentes) y commitean → suma final 2.0. También ocurre por accidente (doble submit + retry del frontend). No requiere otro tenant: es corrupción de datos financieros propios que luego arrastra al cálculo de expensas.

**Fix sugerido:** serializar la operación por edificio — lock transaccional (`SELECT ... FOR UPDATE` sobre la fila del edificio dentro de una `$transaction` interactiva que incluya la validación) o advisory lock de Postgres (`pg_advisory_xact_lock(hashtext(edificioId))`). Defensa adicional: constraint `CHECK` no es viable para agregados, pero un trigger o la re-validación post-commit con rollback cerraría la ventana.

### SEC-02 (MEDIUM) — Sin rate limiting en ningún endpoint (incluye login)

**Qué:** no existe `express-rate-limit` ni equivalente en el backend (grep de dependencias y código: cero resultados). Login, refresh y los endpoints de escritura del slice (bulk create, PATCH, DELETE) aceptan requests ilimitados por IP/usuario.

**Dónde:** `backend/src/app.js:19-72` (no hay middleware de rate limit); `backend/package.json` (sin la dependencia).

**Cómo explotarlo:** fuerza bruta de credenciales contra `POST /api/auth/login`, o abuso del bulk create por un usuario autenticado (cientos de unidades por request, requests ilimitados). Mitiga parcialmente: `express.json()` con límite default de 100 kb acota el tamaño del lote; bcryptjs acota la velocidad efectiva del login.

**Fix sugerido:** `express-rate-limit` con store Redis (ya disponible en el stack): p. ej. 10 req/min por IP en `/api/auth/login` y `/api/auth/refresh`, y un límite global razonable (p. ej. 300 req/min) para `/api/*`.

### SEC-03 (MEDIUM) — Mutaciones sin trail de auditoría (Repudiation)

**Qué:** alta/baja/edición de edificios y unidades (incl. coeficientes, dato financiero regulado por Ley 941) no dejan registro de quién/cuándo/qué cambió. Un org_admin puede modificar coeficientes y no hay forma de demostrarlo después.

**Dónde:** handlers de escritura de `backend/src/routes/edificios.routes.js:83-287` y `backend/src/routes/unidades.routes.js:91-154` — ninguno persiste auditoría.

**Fix sugerido:** tabla `audit_log` (actor, acción, recurso, diff antes/después, timestamp) escrita en la misma transacción que la mutación. Si está planificado para un sprint posterior (módulo de auditoría del roadmap), dejarlo registrado como deuda aceptada.

### SEC-04 (LOW) — Refresh token (7 días) persistido en localStorage

**Qué:** `zustand/persist` guarda el estado completo — incluidos `accessToken` y `refreshToken` — en `localStorage` (`frontend/src/stores/auth.store.js:30-76`, sin `partialize`). Cualquier XSS futuro exfiltra el refresh token opaco y da 7 días de acceso. Hoy no hay sinks XSS (grep de `dangerouslySetInnerHTML`/`innerHTML`/`eval`: cero; React escapa por default) ni CSP que lo mitigue.

**Fix sugerido (cuando se endurezca la sesión):** refresh token en cookie `HttpOnly; Secure; SameSite=Strict` o reducir su TTL; como mínimo `partialize` para no persistir el access token. Aceptable en esta etapa porque el modelo de amenaza actual no incluye XSS demostrado.

### SEC-05 (LOW) — react-router 7.18.1 dentro del rango de GHSA-qwww-vcr4-c8h2

**Qué:** `npm audit` reporta 1 HIGH: CSRF bypass en **modo RSC** de react-router 7.12.0–8.2.0 (`frontend/package-lock.json` fija 7.18.1). ConsorcIA usa react-router en modo SPA/declarativo con Vite (no RSC), por lo que el vector **no es aplicable** a este código; se reporta por higiene de dependencias.

**Fix sugerido:** subir a la versión parchada (≥ 7.18.2 según el advisory) en el próximo bump de dependencias — instalar dentro del contenedor, nunca en el host.

### SEC-06 (LOW) — Enumeración de recursos por código de respuesta (403 vs 404)

**Qué:** `validarEdificio` y `validarUnidad` devuelven 403 `FUERA_DE_ORGANIZACION` cuando el recurso existe pero es de otra org (`backend/src/middleware/tenant.middleware.js:38-42`, `backend/src/routes/unidades.routes.js:42-46`), revelando la existencia del ID. Impacto bajo: los IDs son UUIDv4 no adivinables, así que no hay oracle práctico.

**Fix sugerido (opcional):** uniformar a 404 para recursos ajenos, manteniendo 403 solo para "es tuyo pero no tenés permiso" (caso gestor no asignado).

### SEC-07 (LOW) — Bulk create sin tope de cantidad de ítems

**Qué:** `bulkUnidadesSchema = z.array(unidadSchema).min(1)` sin `.max()` (`backend/src/schemas/unidad.schema.js:33`). El límite implícito es el body parser (100 kb ≈ 400–600 unidades), suficiente para el dominio pero no declarado.

**Fix sugerido:** `.max(500)` explícito — convierte un límite accidental en contrato.

### SEC-08 (LOW) — CI: acciones sin pin de SHA e imágenes mutables

**Qué:** `.github/workflows/ci.yml` usa `actions/checkout@v4` y `actions/setup-node@v4` (tags, no SHA), `ghcr.io/cerbos/cerbos:latest` (línea ~60) y regenera el lockfile del frontend con `rm -f package-lock.json && npm install` (último step), lo que anula la garantía de supply chain del lockfile en el gate de build.

**Fix sugerido:** pinnear acciones por SHA, fijar la versión de Cerbos (misma que docker-compose), y resolver el bug npm/cli#4828 del lockfile en vez de borrarlo en CI.

---

## STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| API edificios/unidades (Express) | OK (JWT verificado, firma + exp) | **SEC-01** (carrera) | **SEC-03** (sin audit) | **SEC-06** (403/404); errores 500 genéricos OK | **SEC-02/SEC-07** (sin rate limit/tope) | OK (Cerbos fail-closed + scope tenant) |
| Middleware auth/tenant/rbac | OK (`Bearer` estricto, claims normalizados) | OK (org siempre del JWT, nunca del cliente) | — | OK (401 genérico, no revela motivo más allá de expirado) | OK (timeout 3 s al PDP, fail-closed) | OK (doble check: middleware + PDP) |
| Políticas Cerbos | — | OK (default-deny, sin DENY global conflictivo) | — | — | — | OK (scope doble org + edificios_asignados verificado) |
| Frontend (React) | OK (refresh con rotación, `queryClient.clear()` en logout — nuevo en S2, correcto) | — | — | **SEC-04** (tokens en localStorage) | — | — |
| CI/CD | — | **SEC-08** (tags mutables) | — | OK (secrets de test, no productivos) | — | — |

## OWASP A01–A10 (resultado compacto)

- **A01 Broken Access Control:** sin hallazgos — verificado manualmente endpoint por endpoint (lista filtrada por rol, `validarEdificio`/`validarUnidad` antes de Cerbos, attrs del recurso siempre desde DB/JWT, nunca del body). `superadmin` pasa por diseño (regla `'*'`).
- **A02 Cryptographic Failures:** SEC-04. JWT HS256 con secret de entorno (fail-closed si falta: `jwt.sign` lanza), bcryptjs para passwords.
- **A03 Injection:** sin hallazgos — Prisma parametrizado en todas las queries nuevas; Zod valida y **strip** de claves extra (`validation.middleware.js:18` reasigna `req.body` con `resultado.data`), lo que además cierra mass assignment (no se puede inyectar `organizacionId` por body).
- **A04 Insecure Design:** SEC-01 (invariante no atómica), SEC-03 (sin auditoría).
- **A05 Security Misconfiguration:** SEC-08; CORS con `credentials: true` y orígenes localhost hardcodeados (`app.js:23-26`) es aceptable en dev — **debe** venir de `CORS_ORIGIN` en producción (ya soportado).
- **A06 Vulnerable Components:** SEC-05 (backend: `npm audit` 0 vulnerabilidades).
- **A07 Auth Failures:** SEC-02 (sin rate limit en login); access token 15 min + refresh opaco con rotación en Redis: correcto.
- **A08 Data Integrity Failures:** SEC-01, SEC-08 (lockfile regenerado en CI).
- **A09 Logging Failures:** SEC-03; `console.error` sin formato estructurado ni request-id — suficiente en dev, deuda para observabilidad.
- **A10 SSRF:** sin hallazgos — no hay fetch a URLs provistas por el cliente; el único outbound es al PDP Cerbos (host de configuración) y `reglamentoPH` se valida como URL pero nunca se fetchea server-side.

## Notas INFO (no son hallazgos)

- Credenciales demo `admin@demo.com / demo1234` y `test12345` en tests/E2E/smoke: documentadas en `AGENTS.md`, solo entorno demo. No rotar; sí asegurarse de que nunca lleguen a un deploy productivo.
- Secrets del workflow de CI (`consorcia_dev_2026`, `ci_test_secret`): credenciales efímeras de service containers de CI, no productivas.
- `edificios_asignados` viaja en el JWT: revocar la asignación de un gestor tiene un lag de hasta 15 min (TTL del access token). Trade-off conocido del diseño (AGENTS.md); si se vuelve crítico, resolver asignaciones por request en el PDP.

## Lo sólido

1. **Aislamiento multi-tenant en 3 capas reales, no decorativas:** `organizacionId` siempre del JWT (`tenant.middleware.js:17`), scopeado en *cada* query Prisma, y re-verificado por Cerbos con `organizacion_id` del recurso desde la DB — el atributo nunca viene del cliente. Además `validarBody` strippea claves extra, así que no hay mass assignment de `organizacionId` por body.
2. **Cerbos fail-closed de verdad:** timeout de 3 s, respuesta ambigua o PDP caído → 403 (`rbac.middleware.js:47-66`), y las policies son default-deny sin reglas DENY que puedan conflictuar. La doble condición gestor (org + `edificio_id in edificios_asignados`) está bien formada en ambas policies.
3. **Invariante de coeficientes con motor determinístico:** `decimal.js` en toda la aritmética (`services/coeficientes.js`), formato estricto de 6 decimales por Zod, y errores 422 con `sumaActual`/`delta` sin filtrar internals. El único agujero es la atomicidad (SEC-01), no la matemática.
4. **Higiene del slice:** S2 agregó `queryClient.clear()` en logout (datos del tenant no sobreviven al cambio de sesión), soft delete coherente en los 3 niveles (query, `validarEdificio`, `validarUnidad`) y `npm audit` del backend en 0.
