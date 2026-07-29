# AGENTS.md — ConsorcIA App

## Qué es esto

Código de **ConsorcIA** (SaaS de gestión de consorcios). Las specs canónicas viven en un vault de Obsidian **fuera de este repo**: `../../vault` (PRDs en español, `PRD-XX-YY Título.md`). Antes de implementar un módulo, leé su PRD.

## Estado del proyecto

- **S1 cerrado** (2026-07-28): stack + auth JWT + Cerbos + edificios read + portal shell. Ver `docs/sprints/S1-fundacion.md`.
- **S2 cerrado** (2026-07-28): edificios y unidades (CRUD + invariante de coeficientes, alta bulk con feedback inline, E2E + smoke). Ver `docs/sprints/S2-edificios-unidades.md`. Refinado en #57 (2026-07-29): **la invariante de coeficientes es informativa**, no bloquea la escritura de unidades (ver "Invariante de coeficientes" abajo).
- **S4 cerrado** (2026-07-29): usuarios e identidad global (alta de staff por backoffice, residentes por invitación, switch de organización, seed multi-caso) + hardening S4-11 de la aceptación de invitaciones y del contexto de acceso. Ver `docs/sprints/S4-usuarios-identidad.md` y los reportes `S4-review.md` / `S4-qa.md` / `S4-security.md`.
- **S3 listo para arrancar**: gastos + motor contable (liquidación, recibos PDF/QR Ley 941). Backlog: `docs/sprints/S3-gastos-liquidacion.md`. Issues en GitHub con milestone "S3".
- Roadmap completo (S1→S6, slices verticales): `docs/ROADMAP.md`.

## Reglas duras (romperlas rompe el entorno)

1. **NUNCA `npm install` en el host (macOS).** `node_modules` es un volumen Docker anónimo. Instalaciones SIEMPRE dentro del contenedor: `docker exec consorcIA-backend npm install <pkg>` (o `consorcIA-frontend`).
2. **NUNCA resetear la DB** (`prisma migrate reset`, `down-volumes`) sin confirmación explícita del usuario. El seed es re-ejecutable: `make db-seed`.
3. **Stack dockerizado primero:** `make up` levanta todo; `make health` verifica; `make smoke` corre 101 chequeos end-to-end. Antes de commitear backend: `docker exec consorcIA-backend npm test` en verde.
   - **Gate automático:** el workflow `.github/workflows/ci.yml` corre los tests del backend + build del frontend en cada push a main y cada PR. Si el CI falla, el trabajo no está terminado — arreglarlo es prioridad sobre cualquier tarea nueva.
4. **Sin git push sin permiso del usuario.** Commits locales con mensajes en español estilo conventional commits (`feat(s2): ...`).

## Modelo de dominio canónico (no negociable)

- **Jerarquía:** `Organización → Edificio → Unidad → Usuario`. La **organización es el tenant raíz**: toda query scopea `organizacion_id` (+ `edificio_id` como segundo nivel). **No existe `tenant_id`** (modelo viejo, eliminado).
- **EXCEPCIÓN documentada — la identidad es global** (S4-01, PRD-04-11 §2): el `Usuario` **no cuelga de la organización**. Su email es único en todo el sistema (lowercase) y no tiene `organizacionId` ni `rol`; una persona = un login = N unidades en N consorcios de N administraciones. Lo que sí está scopeado son los **vínculos**: `OrganizacionUsuario` (staff, con `activo` para la baja lógica), `GestorEdificio` (edificios de un gestor, filtrados por org al leerlos) e `UnidadUsuario` (residente). Consecuencias que hay que respetar al escribir código: nunca buscar un usuario "dentro de" una organización, la org activa de la sesión sale de la membresía (no del usuario), un residente puro **no tiene org activa** (`organizacionId: null`) y borrar una organización no borra a sus personas.
- **Roles (set único):** `superadmin`, `org_admin`, `gestor` (nivel organización) / `consejo`, `propietario`, `inquilino`, `encargado`, `proveedor` (nivel edificio). Los roles de organización viven en `OrganizacionUsuario.rol` (solo `ORG_ADMIN`/`GESTOR` son staff); los de residente se derivan de `UnidadUsuario` — un residente **nunca** lleva membresía de organización.
- **Motor contable determinístico:** montos SIEMPRE con decimal.js en el backend. Los LLMs interpretan/explican, jamás calculan.
- **Invariante de coeficientes (PRD-04-01 §1.3, revisada en #57):** Σcoeficientes de un edificio = 1.000000 (tolerancia 0.000001). **No bloquea la carga de unidades**: el bulk, el PATCH y el DELETE guardan igual y devuelven `coeficientes: { suma, delta, cuadra }` (informativo, 6 decimales) — la UI lo muestra como alerta warning, nunca como error. El **gate duro es la liquidación (S3)**: antes de emitir expensas hay que llamar a `validarParaLiquidacion` (`backend/src/services/coeficientes.js`) y rechazar con `422 COEFICIENTES_NO_CUADRAN` si `ok === false`.
- **Auth:** JWT access 15 min (claims `sub, email, org_id, roles, edificios_asignados`) + refresh opaco en Redis 7 días con rotación. Autorización: Cerbos PDP (`cerbos/policies/`), fail-closed.

## Flujo de trabajo con tareas

1. Las tareas son **issues de GitHub** (`gh issue list`). Cada issue declara sus dependencias en el body. Tomá solo issues cuyas dependencias estén cerradas.
2. Al empezar un issue: asignarlo y comentar "En curso". Al terminar: commit con `Refs #N` o `Closes #N`.
3. **conductor** (skill en `~/.agents/skills/conductor/bin/sprint.sh`) coordina fases del sprint (think→plan→build→review/qa/security→ship) con locks en `.nanostack/` (local, gitignored). Un sprint por vez; `sprint.sh status` para ver el actual.
4. Verificación antes de cerrar: `npm test` (backend), `npm run build` (frontend), `make smoke`, y si tocás UI, el spec de Playwright en `frontend/e2e/` (corre desde el host, ver README).

## Regla de sincronización con el vault

Si el código diverge de un PRD (puertos, endpoints, schema, roles), **actualizá el PRD del vault en la misma tarea** — el PRD refleja lo que existe, no el diseño original. Convenciones del vault en `../../vault/AGENTS.md`. Errores del contrato API: `{ error: { code, message } }`.

## Credenciales demo (seed)

Password de **todos** los usuarios activados: `demo1234`. Reseed idempotente: `make db-seed` (o `docker exec consorcIA-backend node prisma/seed.js`). El seed borra y recrea las dos organizaciones demo por CUIT, limpia el residuo de los specs E2E (`e2e-staff-*`, `e2e-residente-*`) y desactiva las membresías de los usuarios demo en organizaciones ajenas al seed. **Nunca** hace `prisma migrate reset`.

Cubre los 8 casos de PRD-04-11 §10:

| # | Caso | Email | Vínculos |
|---|------|-------|----------|
| 1 | org_admin de Org A | `admin@demo.com` | staff ORG_ADMIN · ve los 2 edificios |
| 1 | gestor limitado | `gestor@demo.com` | staff GESTOR · solo Torre Palermo |
| 2 | staff adicional | `gestor2@demo.com` | staff GESTOR · Torre Palermo + Edificio San Martín |
| 3 | org_admin de Org B | `admin.sur@demo.com` | staff ORG_ADMIN de "Administración Sur S.R.L." · Edificio Lomas |
| 4 | residente multi-consorcio | `multiconsorcio@demo.com` | **un solo Usuario**: propietario de Torre Palermo 2A (Org A) y Lomas 1A (Org B) |
| 5 | inquilino simple | `inquilino@demo.com` | inquilino de Torre Palermo 1A |
| 6 | propietario multi-UF | `propietario2@demo.com` | propietario de Torre Palermo 3B **y** 4B |
| 7 | invitación pendiente | `invitado@demo.com` | staff GESTOR (San Martín) **sin activar**: no tiene password, no puede loguear |
| 8 | staff multi-organización | `multiorg@demo.com` | **un solo Usuario**: GESTOR de Org A (Torre Palermo) **y** ORG_ADMIN de Org B → es el único login que muestra el **selector de organización** del header |

Resto de residentes (solo `UnidadUsuario`, sin membresía staff): `propietario1@demo.com` (Torre Palermo PB), `propietario3@demo.com` (San Martín PB), `propietario.sur@demo.com` (Lomas PB). `encargado@demo.com` existe como identidad **sin vínculos** (el rol ENCARGADO es de scope edificio y todavía no tiene modelo; loguea pero Cerbos le niega todo).

- **Organizaciones:** Org A "Administración Demo S.A." (CUIT `30-71234567-8`, 2 edificios / 20 UFs) · Org B "Administración Sur S.R.L." (CUIT `30-71234569-4`, 1 edificio / 5 UFs).
- **Invitación pendiente (caso 7):** token fijo → `http://localhost:5173/invitacion/seed-invitacion-pendiente`. Aceptarla define la password de `invitado@demo.com` y la consume; el reseed la vuelve a dejar pendiente.
- **Aceptación de invitaciones (S4-11, PRD-04-11 §6.3):** la aceptación **nunca** emite sesión ni fija password sobre un `Usuario` preexistente. Solo la invitación que creó la identidad (`Invitacion.creaUsuario`) puede activarla; una invitación a una cuenta ya activada responde `200 { yaActivada: true }` **sin tokens**, y una sobre una identidad que aprovisionó otra organización responde `409 ACTIVACION_NO_DISPONIBLE`. Si escribís un test que inserta invitaciones con Prisma para un email **que ya existe sin password**, seteale `creaUsuario: true` o el accept te va a devolver 409.

## Estructura

- `backend/` — Node 20 + Express 5 + Prisma (schema `consorcia` en PostgreSQL 17). Entry: `src/server.js` (app importable en `src/app.js`).
- `frontend/` — React 19 + Vite 6 + Tailwind 4 + shadcn/ui (style base-nova, **Base UI no Radix**: `render=` en vez de `asChild`).
- `services/` — OCR (profile `gpu`, sin modelo en dev) y embeddings (FastAPI stubs).
- `cerbos/`, `nginx/`, `prometheus/`, `grafana/`, `init-db/` — configs de infra.
- `docs/` — ROADMAP + backlogs por sprint. `scripts/smoke.sh` — smoke E2E con curl.

## Notas del entorno

- Puertos locales remapeados en `.env` (5435/6381/9002/9003/8002) porque los defaults están ocupados por otros proyectos del host. `make health` lee los puertos del `.env`.
- `ocr-service` no levanta por defecto (profile `gpu`; macOS no tiene NVIDIA).
- shadcn style `base-nova`: revisar la API del componente antes de asumir la de Radix.
