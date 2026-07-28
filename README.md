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

Password de todos los usuarios del seed: `demo1234`.

| Usuario | Rol | Alcance |
|---------|-----|---------|
| `admin@demo.com` | `org_admin` | Los 2 edificios (Torre Palermo, Edificio San Martín) |
| `gestor@demo.com` | `gestor` | Solo Torre Palermo |

También hay 3 propietarios, 1 inquilino y 1 encargado (`propietario1..3@demo.com`, `inquilino@demo.com`, `encargado@demo.com`).

### Verificación (smoke y tests)

```bash
make smoke   # smoke E2E con curl: health → login → edificios → detalle → refresh → logout
make test    # tests de API del backend (node --test, dentro del contenedor)
```

- **Tests de API** (`backend/tests/`): integración real contra la DB/Redis/Cerbos
  del stack. Levantan la app Express en un puerto efímero; cubren login,
  rotación/revocación de refresh tokens, scope de edificios por rol y
  aislamiento entre organizaciones (crean y borran una org de prueba).
- **Smoke E2E en browser** (`frontend/e2e/`, Playwright): corre **desde el
  host**, no en el contenedor. Setup una sola vez:

  ```bash
  cd frontend
  npm install -D @playwright/test
  npx playwright install chromium
  npm run test:e2e   # requiere el stack levantado (localhost:5173)
  ```

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
make smoke         # smoke E2E del slice S1 (scripts/smoke.sh)
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
