# AGENTS.md — ConsorcIA App

## Qué es esto

Código de **ConsorcIA** (SaaS de gestión de consorcios). Las specs canónicas viven en un vault de Obsidian **fuera de este repo**: `../../vault` (PRDs en español, `PRD-XX-YY Título.md`). Antes de implementar un módulo, leé su PRD.

## Estado del proyecto

- **S1 cerrado** (2026-07-28): stack + auth JWT + Cerbos + edificios read + portal shell. Ver `docs/sprints/S1-fundacion.md`.
- **S2 cerrado** (2026-07-28): edificios y unidades (CRUD + invariante de coeficientes, alta bulk con feedback inline, E2E + smoke). Ver `docs/sprints/S2-edificios-unidades.md`.
- Roadmap completo (S1→S6, slices verticales): `docs/ROADMAP.md`.

## Reglas duras (romperlas rompe el entorno)

1. **NUNCA `npm install` en el host (macOS).** `node_modules` es un volumen Docker anónimo. Instalaciones SIEMPRE dentro del contenedor: `docker exec consorcIA-backend npm install <pkg>` (o `consorcIA-frontend`).
2. **NUNCA resetear la DB** (`prisma migrate reset`, `down-volumes`) sin confirmación explícita del usuario. El seed es re-ejecutable: `make db-seed`.
3. **Stack dockerizado primero:** `make up` levanta todo; `make health` verifica; `make smoke` corre 18 chequeos end-to-end. Antes de commitear backend: `docker exec consorcIA-backend npm test` en verde.
   - **Gate automático:** el workflow `.github/workflows/ci.yml` corre los tests del backend + build del frontend en cada push a main y cada PR. Si el CI falla, el trabajo no está terminado — arreglarlo es prioridad sobre cualquier tarea nueva.
4. **Sin git push sin permiso del usuario.** Commits locales con mensajes en español estilo conventional commits (`feat(s2): ...`).

## Modelo de dominio canónico (no negociable)

- **Jerarquía:** `Organización → Edificio → Unidad → Usuario`. La **organización es el tenant raíz**: toda query scopea `organizacion_id` (+ `edificio_id` como segundo nivel). **No existe `tenant_id`** (modelo viejo, eliminado).
- **Roles (set único):** `superadmin`, `org_admin`, `gestor` (nivel organización) / `consejo`, `propietario`, `inquilino`, `encargado`, `proveedor` (nivel edificio).
- **Motor contable determinístico:** montos SIEMPRE con decimal.js en el backend. Los LLMs interpretan/explican, jamás calculan.
- **Auth:** JWT access 15 min (claims `sub, email, org_id, roles, edificios_asignados`) + refresh opaco en Redis 7 días con rotación. Autorización: Cerbos PDP (`cerbos/policies/`), fail-closed.

## Flujo de trabajo con tareas

1. Las tareas son **issues de GitHub** (`gh issue list`). Cada issue declara sus dependencias en el body. Tomá solo issues cuyas dependencias estén cerradas.
2. Al empezar un issue: asignarlo y comentar "En curso". Al terminar: commit con `Refs #N` o `Closes #N`.
3. **conductor** (skill en `~/.agents/skills/conductor/bin/sprint.sh`) coordina fases del sprint (think→plan→build→review/qa/security→ship) con locks en `.nanostack/` (local, gitignored). Un sprint por vez; `sprint.sh status` para ver el actual.
4. Verificación antes de cerrar: `npm test` (backend), `npm run build` (frontend), `make smoke`, y si tocás UI, el spec de Playwright en `frontend/e2e/` (corre desde el host, ver README).

## Regla de sincronización con el vault

Si el código diverge de un PRD (puertos, endpoints, schema, roles), **actualizá el PRD del vault en la misma tarea** — el PRD refleja lo que existe, no el diseño original. Convenciones del vault en `../../vault/AGENTS.md`. Errores del contrato API: `{ error: { code, message } }`.

## Credenciales demo (seed)

`admin@demo.com` / `demo1234` (org_admin, 2 edificios) · `gestor@demo.com` / `demo1234` (gestor, solo Torre Palermo).

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
