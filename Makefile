# Makefile - ConsorcIA Platform
.PHONY: setup up up-gpu down down-volumes restart logs logs-backend logs-frontend logs-ocr \
	shell-backend shell-frontend shell-db shell-redis \
	db-migrate db-seed db-studio db-reset test test-frontend smoke lint format health clean build

# Variables
COMPOSE_FILE=docker-compose.yml
PROJECT_NAME=consorcia

# Puertos desde .env (con defaults del PRD-02-03)
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

# Smoke E2E del slice S1 contra el stack levantado (S1-14)
smoke:
	@./scripts/smoke.sh

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
