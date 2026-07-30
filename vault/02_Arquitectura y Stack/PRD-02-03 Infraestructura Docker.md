---
title: "PRD-02-03: Infraestructura Docker"
description: "Docker Compose completo para desarrollo local. 12 servicios, networking, volúmenes, health checks y scripts de setup."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [docker, infraestructura, compose, local, dev, servicios]
outcomes:
  - "Levantar toda la plataforma localmente con un solo comando"
  - "Tener 12 servicios orquestados con health checks y dependencias"
  - "Configurar networking interna segura entre servicios"
  - "Persistir datos en volúmenes Docker independientes"
  - "Automatizar setup inicial, migraciones y seed data"
---

# PRD-02-03: Infraestructura Docker

> **One command to rule them all:** `make up` levanta toda la plataforma.  
> **12 servicios:** PostgreSQL + pgvector, Redis, MinIO, Cerbos, Backend, Frontend, OCR, Embeddings, Nginx, Prometheus, Grafana.
>
> **Implementado en:** `../../app` (sibling del vault). Este documento está sincronizado con esa implementación (última sync: 2026-07-28).

---

## 1. Servicios del Stack Docker

| Servicio | Imagen | Puerto | Rol | Health Check |
|----------|--------|--------|-----|--------------|
| **postgres** | `pgvector/pgvector:pg17` | 5432 | DB + pgvector (RAG) | `pg_isready` |
| **redis** | `redis:7-alpine` | 6379 | Cache, sesiones, colas | `redis-cli ping` |
| **minio** | `minio/minio:latest` | 9000/9001 | Storage S3-compatible | HTTP `/minio/health/live` |
| **cerbos** | `ghcr.io/cerbos/cerbos:latest` | 3592/3593 | RBAC/ABAC | Desde host (imagen distroless, sin `wget`/`curl`) |
| **backend** | NodeJS 20 + Express (build local) | 3000 | API REST + motor contable | HTTP `/health` |
| **frontend** | React 19 + Vite (dev server) | 5173 | UI web con HMR | HTTP `/` |
| **ocr-service** (profile `gpu`) | Python 3.12 + FastAPI (build local) | 8000 | Unlimited-OCR parsing | HTTP `/health` |
| **embeddings-service** | Python 3.12 + FastAPI (build local) | 8001 | Nemotron 3 Embed 1B | HTTP `/health` |
| **nginx** | `nginx:alpine` | 80/443 | Reverse proxy | HTTP `/health` |
| **prometheus** | `prom/prometheus:latest` | 9090 | Métricas | Desde host (`make health`) |
| **grafana** | `grafana/grafana:latest` | 3001 | Dashboards | HTTP `/api/health` (desde host) |
| **jaeger** | `jaegertracing/all-in-one:latest` | 16686 | Distributed tracing | Desde host (`make health`) |

> **Puertos host remapeables:** los puertos publicados se controlan por variables del `.env` (`DB_PORT`, `REDIS_PORT`, `MINIO_API_PORT`, etc.). Si un puerto default está ocupado en el host, se remapea solo en el `.env` local — los puertos internos de la red Docker no cambian.

---

## 2. Docker Compose Completo

```yaml
# docker-compose.yml
# Sin clave `version:` (deprecada en Compose v2).

services:
  # ==========================================
  # CAPA DE DATOS
  # ==========================================

  postgres:
    image: pgvector/pgvector:pg17
    container_name: consorcIA-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-consorcia}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-consorcia_dev_2026}
      POSTGRES_DB: ${DB_NAME:-consorcia}
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-consorcia} -d ${DB_NAME:-consorcia}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - consorcIA-network

  redis:
    image: redis:7-alpine
    container_name: consorcIA-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - consorcIA-network

  minio:
    image: minio/minio:latest
    container_name: consorcIA-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:-minioadmin123}
    ports:
      - "${MINIO_API_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
    networks:
      - consorcIA-network

  # ==========================================
  # SEGURIDAD
  # ==========================================

  cerbos:
    image: ghcr.io/cerbos/cerbos:latest
    container_name: consorcIA-cerbos
    restart: unless-stopped
    ports:
      - "${CERBOS_PORT:-3592}:3592"
      - "${CERBOS_ADMIN_PORT:-3593}:3593"
    volumes:
      - ./cerbos/policies:/policies
      - ./cerbos/config.yaml:/config.yaml
    command: ["server", "--config=/config.yaml"]
    # Sin healthcheck interno: la imagen Cerbos es distroless (no trae wget/curl).
    # Se verifica desde el host con `make health`.
    networks:
      - consorcIA-network

  # ==========================================
  # MICROSERVICIOS PYTHON
  # ==========================================

  ocr-service:
    profiles: ["gpu"]
    build:
      context: ./services/ocr
      dockerfile: Dockerfile
    container_name: consorcIA-ocr
    restart: unless-stopped
    environment:
      - PYTHONUNBUFFERED=1
      - CUDA_VISIBLE_DEVICES=${CUDA_DEVICES:-0}
      - MODEL_PATH=/models/unlimited-ocr
      - PORT=8000
    ports:
      - "${OCR_PORT:-8000}:8000"
    volumes:
      - ocr_models:/models
      - ./tmp/ocr-uploads:/tmp/uploads
    # Requiere GPU NVIDIA (no disponible en macOS). Descomentar en host con GPU:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - consorcIA-network
    depends_on:
      - postgres

  embeddings-service:
    build:
      context: ./services/embeddings
      dockerfile: Dockerfile
    container_name: consorcIA-embeddings
    restart: unless-stopped
    environment:
      - PYTHONUNBUFFERED=1
      - MODEL_NAME=nvidia/Nemotron-3-Embed-1B
      - PORT=8001
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=consorcia
      - DB_USER=consorcia
      - DB_PASSWORD=consorcia_dev_2026
    ports:
      - "${EMBEDDINGS_PORT:-8001}:8001"
    volumes:
      - embedding_models:/models
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - consorcIA-network
    depends_on:
      - postgres
      - redis

  # ==========================================
  # BACKEND NODEJS
  # ==========================================

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    container_name: consorcIA-backend
    restart: unless-stopped
    environment:
      - NODE_ENV=development
      - PORT=3000
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=consorcia
      - DB_USER=consorcia
      - DB_PASSWORD=consorcia_dev_2026
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin123
      - CERBOS_HOST=cerbos
      - CERBOS_PORT=3592
      - OCR_SERVICE_URL=http://ocr-service:8000
      - EMBEDDINGS_SERVICE_URL=http://embeddings-service:8001
      - JWT_SECRET=${JWT_SECRET:-consorcia_jwt_secret_dev_2026}
      - AGENTMAIL_API_KEY=${AGENTMAIL_API_KEY:-}
      - CHEAPERINFERENCE_API_KEY=${CHEAPERINFERENCE_API_KEY:-}
      - NEMOTRON_API_KEY=${NEMOTRON_API_KEY:-}
      - MERCADOPAGO_ACCESS_TOKEN=${MERCADOPAGO_ACCESS_TOKEN:-}
    ports:
      - "${BACKEND_PORT:-3000}:3000"
    volumes:
      - ./backend:/app
      - /app/node_modules
      - backend_uploads:/app/uploads
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - consorcIA-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      cerbos:
        condition: service_started
      minio:
        condition: service_healthy

  # ==========================================
  # FRONTEND REACT
  # ==========================================

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    container_name: consorcIA-frontend
    restart: unless-stopped
    environment:
      - VITE_API_URL=http://localhost:3000
      - VITE_WS_URL=ws://localhost:3000
      - CHOKIDAR_USEPOLLING=true
    ports:
      - "${FRONTEND_PORT:-5173}:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    networks:
      - consorcIA-network
    depends_on:
      - backend

  # ==========================================
  # REVERSE PROXY
  # ==========================================

  nginx:
    image: nginx:alpine
    container_name: consorcIA-nginx
    restart: unless-stopped
    ports:
      - "${NGINX_HTTP_PORT:-80}:80"
      - "${NGINX_HTTPS_PORT:-443}:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - backend
      - frontend
      - grafana
    networks:
      - consorcIA-network

  # ==========================================
  # OBSERVABILIDAD
  # ==========================================

  prometheus:
    image: prom/prometheus:latest
    container_name: consorcIA-prometheus
    restart: unless-stopped
    ports:
      - "${PROMETHEUS_PORT:-9090}:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    networks:
      - consorcIA-network

  grafana:
    image: grafana/grafana:latest
    container_name: consorcIA-grafana
    restart: unless-stopped
    ports:
      - "${GRAFANA_PORT:-3001}:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/datasources:/etc/grafana/provisioning/datasources
    networks:
      - consorcIA-network
    depends_on:
      - prometheus

  jaeger:
    image: jaegertracing/all-in-one:latest
    container_name: consorcIA-jaeger
    restart: unless-stopped
    ports:
      - "${JAEGER_UI_PORT:-16686}:16686"
      - "${JAEGER_COLLECTOR_PORT:-14268}:14268"
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    networks:
      - consorcIA-network

# ==========================================
# VOLÚMENES
# ==========================================
volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  minio_data:
    driver: local
  ocr_models:
    driver: local
  embedding_models:
    driver: local
  backend_uploads:
    driver: local
  prometheus_data:
    driver: local
  grafana_data:
    driver: local

# ==========================================
# REDES
# ==========================================
networks:
  consorcIA-network:
    driver: bridge
    ipam:
      config:
        # Si 172.24.0.0/16 colisiona con otra red local, elegir otra libre
        # (la original del diseño, 172.20.0.0/16, puede estar ocupada en el host)
        - subnet: 172.24.0.0/16
```

---

## 3. Makefile

```makefile
# Makefile - ConsorcIA Platform
.PHONY: setup up up-gpu down down-volumes restart logs logs-backend logs-frontend logs-ocr \
	shell-backend shell-frontend shell-db shell-redis \
	db-migrate db-seed db-studio db-reset test test-frontend lint format health clean build

# Variables
COMPOSE_FILE=docker-compose.yml
PROJECT_NAME=consorcia

# Puertos desde .env (con defaults de este documento)
-include .env
DB_PORT ?= 5432
REDIS_PORT ?= 6379
MINIO_API_PORT ?= 9000
CERBOS_PORT ?= 3592
BACKEND_PORT ?= 3000
FRONTEND_PORT ?= 5173
EMBEDDINGS_PORT ?= 8001
PROMETHEUS_PORT ?= 9090
GRAFANA_PORT ?= 3001
JAEGER_UI_PORT ?= 16686
NGINX_HTTP_PORT ?= 80

# ==========================================
# COMANDOS PRINCIPALES
# ==========================================

setup:
	@echo "🔧 Setup inicial de ConsorcIA..."
	@cp .env.example .env 2>/dev/null || true
	@mkdir -p tmp/ocr-uploads
	@mkdir -p cerbos/policies
	@mkdir -p nginx/ssl
	@mkdir -p prometheus
	@mkdir -p grafana/dashboards grafana/datasources
	@echo "✅ Setup completo. Ejecuta 'make up' para levantar los servicios."

up:
	@echo "🚀 Levantando ConsorcIA..."
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) up -d --build
	@echo "⏳ Esperando health checks..."
	@sleep 15
	@make health

up-gpu:
	@echo "🚀 Levantando ConsorcIA (incluye ocr-service con GPU)..."
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) --profile gpu up -d --build
	@echo "⏳ Esperando health checks..."
	@sleep 15
	@make health

down:
	@echo "🛑 Deteniendo ConsorcIA..."
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) --profile gpu down

down-volumes:
	@echo "🗑️  Deteniendo y eliminando volúmenes..."
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) --profile gpu down -v

restart:
	@make down
	@make up

# ==========================================
# LOGS
# ==========================================

logs:
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f

logs-backend:
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f backend

logs-frontend:
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f frontend

logs-ocr:
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) --profile gpu logs -f ocr-service

# ==========================================
# SHELLS
# ==========================================

shell-backend:
	@docker exec -it consorcIA-backend /bin/sh

shell-frontend:
	@docker exec -it consorcIA-frontend /bin/sh

shell-db:
	@docker exec -it consorcIA-postgres psql -U consorcia -d consorcia

shell-redis:
	@docker exec -it consorcIA-redis redis-cli

# ==========================================
# DATABASE
# ==========================================

db-migrate:
	@docker exec -it consorcIA-backend npx prisma migrate dev

db-seed:
	@docker exec -it consorcIA-backend npx prisma db seed

db-studio:
	@echo "🎨 Prisma Studio disponible en http://localhost:5555"
	@docker exec -it consorcIA-backend npx prisma studio --port 5555 --hostname 0.0.0.0

db-reset:
	@docker exec -it consorcIA-backend npx prisma migrate reset --force

# ==========================================
# TESTING
# ==========================================

test:
	@docker exec -it consorcIA-backend npm test

test-frontend:
	@docker exec -it consorcIA-frontend npm test

# ==========================================
# LINTING
# ==========================================

lint:
	@docker exec -it consorcIA-backend npm run lint
	@docker exec -it consorcIA-frontend npm run lint

format:
	@docker exec -it consorcIA-backend npm run format
	@docker exec -it consorcIA-frontend npm run format

# ==========================================
# HEALTH
# ==========================================

health:
	@echo "🏥 Health Check..."
	@curl -s http://localhost:$(BACKEND_PORT)/health && echo " ✅ Backend"
	@curl -s http://localhost:$(FRONTEND_PORT) > /dev/null && echo " ✅ Frontend"
	@curl -s http://localhost:$(MINIO_API_PORT)/minio/health/live > /dev/null && echo " ✅ MinIO"
	@curl -s -o /dev/null http://localhost:$(CERBOS_PORT)/ && echo " ✅ Cerbos (HTTP respondiendo)"
	@curl -s http://localhost:$(EMBEDDINGS_PORT)/health && echo " ✅ Embeddings"
	@curl -s http://localhost:$(PROMETHEUS_PORT)/-/healthy > /dev/null && echo " ✅ Prometheus"
	@curl -s http://localhost:$(GRAFANA_PORT)/api/health && echo " ✅ Grafana"
	@curl -s http://localhost:$(JAEGER_UI_PORT) > /dev/null && echo " ✅ Jaeger"
	@curl -s http://localhost:$(NGINX_HTTP_PORT)/health && echo " ✅ Nginx"

# ==========================================
# CLEANUP
# ==========================================

clean:
	@echo "🧹 Limpiando..."
	@docker system prune -f
	@docker volume prune -f

build:
	@docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) build --no-cache
```

---

## 4. .env.example

```bash
# ==========================================
# CONSORCIA - CONFIGURACIÓN LOCAL
# ==========================================

# Database
DB_USER=consorcia
DB_PASSWORD=consorcia_dev_2026
DB_NAME=consorcia
DB_PORT=5432

# Redis
REDIS_PORT=6379

# MinIO
MINIO_USER=minioadmin
MINIO_PASSWORD=minioadmin123
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001

# Cerbos
CERBOS_PORT=3592
CERBOS_ADMIN_PORT=3593

# Backend
BACKEND_PORT=3000
JWT_SECRET=consorcia_jwt_secret_dev_2026_change_in_prod

# Frontend
FRONTEND_PORT=5173

# OCR Service
OCR_PORT=8000
CUDA_DEVICES=0

# Embeddings Service
EMBEDDINGS_PORT=8001

# Nginx
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443

# Observabilidad
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_PASSWORD=admin
JAEGER_UI_PORT=16686
JAEGER_COLLECTOR_PORT=14268

# ==========================================
# API KEYS (rellenar con valores reales)
# ==========================================
AGENTMAIL_API_KEY=
CHEAPERINFERENCE_API_KEY=
NEMOTRON_API_KEY=
MERCADOPAGO_ACCESS_TOKEN=
KIMI_API_KEY=

# ==========================================
# FEATURE FLAGS
# ==========================================
ENABLE_SWARM=true
ENABLE_CHEAPERINFERENCE=true
ENABLE_AGENTMAIL=true
ENABLE_OCR=true
ENABLE_EMBEDDINGS=true
```

---

## 5. Dockerfiles

### 5.1 Backend (Development)

```dockerfile
# backend/Dockerfile.dev
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema
RUN apk add --no-cache curl

# Copiar package files
# (npm install hasta que exista package-lock.json; luego migrar a npm ci)
COPY package*.json ./
RUN npm install

# Copiar prisma schema (placeholder; `prisma generate` cuando haya modelos)
COPY prisma ./prisma/

# Copiar código fuente
COPY . .

# Puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3   CMD curl -f http://localhost:3000/health || exit 1

# Comando de desarrollo
CMD ["npm", "run", "dev"]
```

### 5.2 Backend (Production)

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3   CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
```

### 5.3 Frontend (Development)

```dockerfile
# frontend/Dockerfile.dev
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

### 5.4 OCR Service

```dockerfile
# services/ocr/Dockerfile
#
# Variante CPU-friendly para desarrollo en macOS (sin GPU NVIDIA).
# El servicio levanta con /health funcional; el modelo baidu/Unlimited-OCR
# requiere GPU y se carga solo en hosts con CUDA.
#
# Para producción / host con GPU NVIDIA, usar como imagen base:
#   FROM nvidia/cuda:12.9.0-runtime-ubuntu22.04
# e instalar Python 3.12 + torch con CUDA + transformers, y descomentar
# la reserva de GPU en docker-compose.yml (servicio ocr-service).

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y     curl     && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3   CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

### 5.5 Embeddings Service

```dockerfile
# services/embeddings/Dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y     curl     && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3   CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

---

## 6. Nginx Configuration

```nginx
# nginx/nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:3000;
    }

    upstream frontend {
        server frontend:5173;
    }

    upstream grafana {
        server grafana:3000;
    }

    server {
        listen 80;
        server_name localhost;

        # Frontend
        location / {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # API
        location /api/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # WebSockets
        location /ws/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # Grafana
        location /grafana/ {
            proxy_pass http://grafana/;
            proxy_set_header Host $host;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
```

---

## 7. Cerbos Configuration

```yaml
# cerbos/config.yaml
server:
  httpListenAddr: ":3592"
  grpcListenAddr: ":3593"
  adminAPI:
    enabled: true
    adminCredentials:
      username: cerbos
      passwordHash: JDJ5JDEwJEdEOVFzZDE4QW5LWi4wVnN1aS8zZHVQdE1xMWdUTUlPajZ5M2xTay5GVDdGbHBNd3E5RXku

storage:
  driver: "disk"
  disk:
    directory: /policies
    watchForChanges: true

schema:
  enforcement: reject
```

---

## 8. Prometheus Configuration

```yaml
# prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'backend'
    static_configs:
      - targets: ['backend:3000']
    metrics_path: /metrics

  - job_name: 'ocr-service'
    static_configs:
      - targets: ['ocr-service:8000']
    metrics_path: /metrics

  - job_name: 'embeddings-service'
    static_configs:
      - targets: ['embeddings-service:8001']
    metrics_path: /metrics
```

### 8.1 Datasource de Grafana (provisioning)

```yaml
# grafana/datasources/datasource.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
```

---

## 9. Init DB Script

```sql
-- init-db/01-init.sql
-- Crear schema para multi-tenancy (antes que las extensiones que lo referencian)
CREATE SCHEMA IF NOT EXISTS consorcia;

-- Las tablas de Prisma se crean sin calificar schema: el search_path del
-- usuario las dirige al schema consorcia (PRD-02-04 §1.1 "Un solo schema").
ALTER USER consorcia SET search_path = consorcia, public;

-- Crear extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- vector debe vivir en el schema consorcia: el backend conecta con
-- DATABASE_URL ...?schema=consorcia (search_path exclusivo de Prisma).
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA consorcia;

-- Función para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Comentario de versión
COMMENT ON DATABASE consorcia IS 'ConsorcIA Platform DB v1.0.0';
```

---

## 10. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **pgvector en vez de Vector DB dedicada** | RAG para documentos | Mismo servicio, backups unificados, queries JOIN con datos estructurados. Sin costo adicional. |
| **MinIO en vez de S3 local** | Desarrollo on-premise | API-compatible con S3. Migración a AWS S3 es transparente (cambiar endpoint). |
| **Docker Compose en vez de Kubernetes** | Desarrollo local | Simplicidad. K8s es overkill para dev local. ECS/Fargate en prod. |
| **OCR CPU-friendly en dev, CUDA en prod** | Unlimited-OCR requiere GPU | macOS no tiene GPU NVIDIA: en dev el servicio corre en `python:3.12-slim` bajo profile `gpu` (sin modelo, `/parse` → 501; fallback Nemotron Nano 12B VL vía API). En prod: imagen `nvidia/cuda:12.9.0-runtime` + GPU cloud (AWS g4dn o similar). |
| **Health checks donde la imagen lo permite** | Orquestación robusta | Docker Compose espera `service_healthy` en postgres/redis/minio. Cerbos (distroless), Jaeger y Prometheus se verifican desde el host con `make health`. |
| **Volúmenes nombrados** | Persistencia de datos | `postgres_data`, `redis_data`, etc. Permiten `docker compose down` sin perder datos. |
| **Network bridge dedicada** | Aislamiento | `consorcIA-network` con subnet `172.24.0.0/16`. Servicios solo se ven entre sí. |

---

## 11. Estado de Implementación

**Implementado y verificado el 2026-07-28** en `../../app` (sibling del vault). Los 11 servicios sin GPU levantan con `make up` y los 9 health checks de `make health` pasan. `ocr-service` queda bajo profile `gpu` (`make up-gpu` en hosts con NVIDIA).

Este documento está **sincronizado** con esa implementación: los bloques de código de §2–§9 son copia fiel de los archivos reales. Si una futura implementación diverge de este PRD, se actualiza este documento en la misma tarea (regla de sincronización del AGENTS.md del vault).

Notas vigentes a tener en cuenta:

- **Puertos host:** remapeables vía `.env` sin tocar el compose (los puertos internos de la red Docker no cambian).
- **OCR sin GPU:** fallback a Nemotron Nano 12B VL vía API ([[PRD-02-02 Stack Tecnológico]] §8.3).
- **`npm install` en Dockerfiles dev:** migrar a `npm ci` cuando exista `package-lock.json`.

> [!note] PRD-08-01 obsoleto
> [[PRD-08-01 Docker Compose Local]] describía una variante anterior de este stack (Temporal, Elasticsearch, pgAdmin, Mailhog, PostgreSQL 16). Fue marcado `obsoleto`: **este documento es el canónico**.

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]  
*Documento relacionado:* [[PRD-08-01 Docker Compose Local]] (obsoleto)
