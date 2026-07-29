# ConsorcIA — App

Stack de desarrollo local de ConsorcIA, generado a partir de los PRDs del vault
(`../vault/02_Arquitectura y Stack/PRD-02-03 Infraestructura Docker.md`).

## Quickstart

```bash
make setup   # copia .env.example → .env y crea directorios
make up      # build + up -d + health check
```

## Desarrollo

Flujo diario contra el stack dockerizado:

```bash
make up          # build + up -d + health check
make db-migrate  # prisma migrate dev (dentro del contenedor backend)
make db-seed     # datos demo del seed (prisma/seed.js)
```

### Credenciales demo

Password de todos los usuarios activados del seed: `demo1234`. El seed cubre los 7 casos de PRD-04-11 §10 (dos organizaciones, staff, residente multi-consorcio, invitación pendiente); el detalle completo está en `AGENTS.md` → "Credenciales demo (seed)".

| Usuario | Rol | Alcance |
|---------|-----|---------|
| `admin@demo.com` | `org_admin` | Org A: los 2 edificios (Torre Palermo, Edificio San Martín) |
| `gestor@demo.com` | `gestor` | Org A: solo Torre Palermo |
| `gestor2@demo.com` | `gestor` | Org A: ambos edificios |
| `admin.sur@demo.com` | `org_admin` | Org B ("Administración Sur S.R.L."): Edificio Lomas |
| `multiconsorcio@demo.com` | `propietario` | Una UF en Org A y otra en Org B, con **un solo login** |
| `invitado@demo.com` | `gestor` | Invitación PENDIENTE: sin password hasta abrir `/invitacion/seed-invitacion-pendiente` |

También hay 3 propietarios más, 1 inquilino y 1 encargado (`propietario1..3@demo.com`, `propietario.sur@demo.com`, `inquilino@demo.com`, `encargado@demo.com`). Los residentes **no** tienen membresía de organización: solo vínculo a su unidad.

### Verificación (smoke y tests)

```bash
make smoke   # smoke E2E con curl (86 chequeos, S1+S2+S4): health → login → edificios → alta con unidades → invitaciones/staff/residentes → casos del seed multi-caso → refresh → logout
make test    # tests de API del backend (node --test, dentro del contenedor)
```

- **Tests de API** (`backend/tests/`): integración real contra la DB/Redis/Cerbos
  del stack. Levantan la app Express en un puerto efímero; cubren login,
  rotación/revocación de refresh tokens, scope de edificios por rol y
  aislamiento entre organizaciones (crean y borran una org de prueba).
- **Smoke E2E en browser** (`frontend/e2e/`, Playwright): corre **desde el
  host**, no en el contenedor. `@playwright/test` está declarado en
  devDependencies — recordá que las instalaciones se hacen SIEMPRE dentro del
  contenedor (`docker exec consorcIA-frontend npm install`), nunca en el host.
  Para ejecutarlo se usa el CLI de Playwright del host (global, con chromium
  ya cacheado):

  ```bash
  cd frontend
  playwright test   # requiere el stack levantado (localhost:5173)
  ```

  Specs: `smoke.spec.js` (S1: login → edificios → detalle → logout) y
  `edificio-unidades.spec.js` (S2: alta de edificio + bulk de unidades con
  invariante de coeficientes, con cleanup del edificio de prueba).

## Servicios

| Servicio | URL |
|----------|-----|
| Frontend (Vite) | http://localhost:5173 |
| Backend (Express) | http://localhost:3000 (`/health`, `/metrics`) |
| Nginx (proxy) | http://localhost |
| PostgreSQL 17 + pgvector | localhost:5435 * |
| Redis 7 | localhost:6381 * |
| MinIO | http://localhost:9002 (consola: :9003) * |
| Cerbos | http://localhost:3592 |
| Embeddings (FastAPI) | http://localhost:8002 * |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin/admin) |
| Jaeger | http://localhost:16686 |

\* Puertos remapeados en `.env` de esta máquina porque los defaults del PRD
(5432/6379/9000/9001/8001) ya estaban ocupados por otros proyectos Docker
(`itp-*`, `tqr-*`). Los puertos internos entre contenedores no cambian.

## OCR (requiere GPU NVIDIA)

El servicio `ocr-service` está bajo el profile `gpu` y **no levanta por defecto**
(macOS no tiene GPU NVIDIA). En un host con CUDA:

```bash
make up-gpu   # docker compose --profile gpu up -d --build
```

Sin GPU, el backend puede usar Nemotron Nano 12B VL vía API como fallback
(PRD-02-02 §8.3).

## Comandos útiles

```bash
make health        # verifica todos los endpoints
make smoke         # smoke E2E de los slices S1+S2 (scripts/smoke.sh)
make test          # tests de API del backend
make logs-backend  # logs del backend
make shell-db      # psql dentro del contenedor
make down          # detener todo
make down-volumes  # detener y borrar datos
```

## Estructura

- `backend/` — Node 20 + Express 5: API REST (auth JWT, multi-tenant, Cerbos)
  y motor contable futuro. `src/app.js` exporta la app, `src/server.js` la
  sirve. Tests de integración en `backend/tests/`.
- `frontend/` — React 19 + Vite 6 + Tailwind 4 + shadcn/ui: login, layout con
  sidebar/header, lista y detalle de edificios. E2E Playwright en `frontend/e2e/`.
- `scripts/` — utilidades de verificación (`smoke.sh`).
- `docs/` — documentación del proyecto (`docs/sprints/` con los backlogs).
- `services/ocr/` — FastAPI + Unlimited-OCR (GPU).
- `services/embeddings/` — FastAPI + Nemotron 3 Embed 1B (RAG, PRD-05-06).
- `cerbos/`, `nginx/`, `prometheus/`, `grafana/`, `init-db/` — configs de infra.
