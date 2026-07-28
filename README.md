# ConsorcIA — App

Stack de desarrollo local de ConsorcIA, generado a partir de los PRDs del vault
(`../vault/02_Arquitectura y Stack/PRD-02-03 Infraestructura Docker.md`).

## Quickstart

```bash
make setup   # copia .env.example → .env y crea directorios
make up      # build + up -d + health check
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
make logs-backend  # logs del backend
make shell-db      # psql dentro del contenedor
make down          # detener todo
make down-volumes  # detener y borrar datos
```

## Estructura

- `backend/` — Node 20 + Express 5 (API REST, motor contable futuro).
- `frontend/` — React 19 + Vite 6.
- `services/ocr/` — FastAPI + Unlimited-OCR (GPU).
- `services/embeddings/` — FastAPI + Nemotron 3 Embed 1B (RAG, PRD-05-06).
- `cerbos/`, `nginx/`, `prometheus/`, `grafana/`, `init-db/` — configs de infra.
