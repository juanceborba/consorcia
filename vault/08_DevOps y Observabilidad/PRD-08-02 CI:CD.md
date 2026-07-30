---
title: "PRD-08-02: CI/CD"
description: "Pipeline de integracion continua y despliegue continuo para ConsorcIA: GitHub Actions, testing, linting, build y deploy automatizado."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [devops, ci, cd, github-actions, testing, deploy, pipeline, consorcIA]
outcomes:
  - "Configurar pipeline CI/CD con GitHub Actions"
  - "Implementar testing automatico en cada push"
  - "Establecer linting, type checking y security scanning"
  - "Automatizar deploy a staging y produccion"
  - "Documentar flujo de trabajo Git (trunk-based)"
---

# PRD-08-02: CI/CD

> **El pipeline CI/CD de ConsorcIA automatiza testing, linting, build y deploy.** Cada push a main pasa por validacion exhaustiva antes de llegar a produccion. El flujo es trunk-based con feature flags.
>
> **Estado de implementación (2026-07-28):** está vigente en `app/.github/workflows/ci.yml` un **subconjunto MVP** de este pipeline — gate con dos jobs: tests del backend (Node 20 + Postgres/pgvector + Redis como services, migraciones + seed + `npm test`) y build del frontend. Lint, E2E Playwright, seguridad y los deploys a staging/prod (AWS) quedan pendientes según este documento.

---

## 1. Estrategia de Branching

### 1.1 Trunk-based development

```
main (produccion)
  |
  |-- feature/gastos-ocr
  |     |-- PR -> review -> merge -> deploy staging -> deploy prod
  |
  |-- feature/chat-swarm
  |     |-- PR -> review -> merge -> deploy staging -> deploy prod
  |
  |-- hotfix/security-patch
        |-- PR -> review -> merge -> deploy prod (skip staging)
```

**Reglas:**
- `main` siempre deployable
- Feature branches cortos (< 3 dias)
- PRs requieren 1 review + CI verde
- Hotfixes pueden skippear staging

---

## 2. GitHub Actions Workflows

### 2.1 Estructura

```
.github/
|-- workflows/
|   |-- ci.yml              # CI: test, lint, build
|   |-- deploy-staging.yml  # Deploy a staging
|   |-- deploy-prod.yml     # Deploy a produccion
|   |-- security.yml        # Security scanning
|   |-- cleanup.yml         # Cleanup de recursos
```

### 2.2 CI Pipeline (ci.yml)

```yaml
name: CI

on:
  push:
    branches: [main, 'feature/**']
  pull_request:
    branches: [main]

jobs:
  # ==========================================
  # BACKEND
  # ==========================================
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: consorcia_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: api/package-lock.json
      - run: cd api && npm ci
      - run: cd api && npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/consorcia_test
      - run: cd api && npm run test:ci
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/consorcia_test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret
      - run: cd api && npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./api/coverage/lcov.info

  backend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: api/package-lock.json
      - run: cd api && npm ci
      - run: cd api && npm run lint
      - run: cd api && npm run typecheck

  # ==========================================
  # FRONTEND
  # ==========================================
  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: cd frontend && npm ci
      - run: cd frontend && npm run test:ci
      - run: cd frontend && npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/lcov.info

  frontend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run typecheck

  # ==========================================
  # E2E
  # ==========================================
  e2e-test:
    runs-on: ubuntu-latest
    needs: [backend-test, frontend-test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  # ==========================================
  # BUILD
  # ==========================================
  build:
    runs-on: ubuntu-latest
    needs: [backend-test, frontend-test, backend-lint, frontend-lint]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd api && npm ci && npm run build
      - run: cd frontend && npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build-artifacts
          path: |
            api/dist
            frontend/dist
```

### 2.3 Deploy Staging (deploy-staging.yml)

```yaml
name: Deploy Staging

on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    needs: [build]
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push API
        run: |
          cd api
          docker build -t consorcia-api:staging .
          docker tag consorcia-api:staging ${{ secrets.ECR_REGISTRY }}/consorcia-api:staging
          docker push ${{ secrets.ECR_REGISTRY }}/consorcia-api:staging
      - name: Build and push Frontend
        run: |
          cd frontend
          docker build -t consorcia-frontend:staging .
          docker tag consorcia-frontend:staging ${{ secrets.ECR_REGISTRY }}/consorcia-frontend:staging
          docker push ${{ secrets.ECR_REGISTRY }}/consorcia-frontend:staging
      - name: Deploy to ECS Staging
        run: |
          aws ecs update-service \
            --cluster consorcia-staging \
            --service api \
            --force-new-deployment
          aws ecs update-service \
            --cluster consorcia-staging \
            --service frontend \
            --force-new-deployment
```

### 2.4 Deploy Produccion (deploy-prod.yml)

```yaml
name: Deploy Production

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to deploy'
        required: true
        type: string

jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.version }}
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: Deploy to ECS Production
        run: |
          aws ecs update-service \
            --cluster consorcia-prod \
            --service api \
            --force-new-deployment
          aws ecs update-service \
            --cluster consorcia-prod \
            --service frontend \
            --force-new-deployment
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "ConsorcIA ${{ github.event.inputs.version }} deployed to production"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 2.5 Security Scanning (security.yml)

```yaml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm audit --audit-level=moderate
      - run: npx audit-ci --moderate

  code-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v3

  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
```

---

## 3. Environments

| Environment | URL | Proposito | Deploy |
|-------------|-----|-----------|--------|
| **Local** | localhost | Desarrollo | Manual (make up) |
| **Staging** | staging.consorcia.app | Testing, QA | Auto en push a main |
| **Production** | consorcia.app | Produccion | Manual (workflow dispatch) |

---

## 4. Decisiones de Diseno

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **GitHub Actions** | Sobre GitLab CI/CD | Mejor integracion con GitHub. Marketplace extenso. |
| **Trunk-based** | Sobre GitFlow | Simplifica merges. Main siempre deployable. |
| **Staging auto** | En push a main | Detectar problemas antes de produccion. |
| **Prod manual** | Workflow dispatch | Control humano sobre deploys a produccion. |
| **CodeQL** | Sobre SonarQube | Integrado en GitHub. Gratis para repos publicos. |
| **TruffleHog** | Sobre GitGuardian | Open source. Escanea secrets en CI. |
| **Codecov** | Coverage reports | Visualizacion de cobertura en PRs. |

---

*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-08-03 Deploy AWS]]  
*Documento relacionado:* [[PRD-08-04 Monitoring]]
