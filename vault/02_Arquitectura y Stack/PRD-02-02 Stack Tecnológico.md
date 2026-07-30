---
title: "PRD-02-02: Stack Tecnológico"
description: "Justificación detallada de cada componente del stack. Comparativas, trade-offs y decisiones de diseño."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [stack, tecnologia, componentes, comparativa, trade-off, decision]
outcomes:
  - "Justificar cada elección del stack con datos cuantitativos"
  - "Documentar alternativas evaluadas y descartadas"
  - "Establecer criterios de migración entre opciones (local → cloud)"
  - "Definir versiones exactas de cada dependencia"
  - "Crear matriz de compatibilidad entre componentes"
---

# PRD-02-02: Stack Tecnológico

> **Stack revolucionario:** Antigravity + Kimi3 Swarm + Nemotron + CheaperInference + NodeJS + React + Unlimited-OCR.  
> **Resultado:** 70-85% menos costos operativos que la competencia.

---

## 1. Stack Final Definitivo

| Capa | Componente | Rol | Tipo | Versión |
|------|-----------|-----|------|---------|
| **IDE / Dev** | Antigravity (Google) | Acelerador de desarrollo. Agent-first IDE. | Dev tool | Latest (Nov 2025) |
| **Orquestación** | Kimi3 Swarm | Router de agentes. Distribuye tareas entre agentes especializados. | Core IA | Latest |
| **Modelos LLM** | NVIDIA Nemotron (via NIM/DeepInfra/OpenRouter) | Modelos de inferencia. Ultra baratos, open source. | Core IA | Varios (ver tabla) |
| **Modelos LLM** | Kimi K2/K3 | Modelo principal para tareas complejas y orquestación Swarm. | Core IA | Latest |
| **Router LLM** | CheaperInference.com | Harness de routing dinámico. Determina el modelo más económico en tiempo real. | Core IA | Latest |
| **Frontend** | React 19 + Vite 6 | UI web. SPA con componentes reutilizables. | Presentación | React 19, Vite 6 |
| **Backend** | NodeJS 20 + Express 5 | API REST. Motor contable, autenticación, webhooks. | Servicios | Node 20, Express 5 |
| **OCR** | baidu/Unlimited-OCR (HuggingFace) | Parsing de PDFs de expensas. Modelo de visión-language. | Servicios | Latest |
| **Email** | AgentMail | Inboxes programáticos para agentes. Webhooks, labeling, dominio propio. | Comunicación | Latest |
| **RBAC** | Cerbos | Autorización como código. RBAC + ABAC. Open source, self-hosted. | Seguridad | Latest |
| **DB** | PostgreSQL 17 (local → AWS RDS) | Datos estructurados. Multi-tenant (por organización). | Datos | PG 17 |
| **Cache/Colas** | Redis 7 (local → ElastiCache) | Sesiones, cache de respuestas Swarm, colas de tareas. | Datos | Redis 7 |
| **Storage** | MinIO (local → S3) | PDFs, recibos, comprobantes. | Datos | Latest |
| **Vector DB** | pgvector (extensión PostgreSQL) | Embeddings para RAG. Sin servicio adicional. | Datos | Latest |
| **CI/CD** | GitHub Actions + Docker Hub | Build, test, push de imágenes. | DevOps | Latest |
| **Infra** | Docker Compose (dev) → AWS ECS/Fargate (prod) | Containers. Escalabilidad. | Infra | Docker Compose, ECS |
| **Monitoring** | OpenTelemetry + Jaeger + Prometheus/Grafana | Trazabilidad de agentes, métricas, logs. | Observabilidad | Latest |

---

## 2. IDE / Dev: Antigravity

### 2.1 ¿Qué es?

Antigravity es la plataforma de desarrollo **agent-first** de Google, lanzada en noviembre 2025. No es un IDE tradicional — es un **"Manager Surface"** donde vos sos el manager y los agentes son tu equipo de desarrollo.

### 2.2 Características clave

- **Manager Surface:** interfaz para spawnear, orquestar y observar múltiples agentes trabajando en paralelo en diferentes workspaces.
- **Editor View:** IDE tradicional con tab completions, inline commands, agent en sidebar.
- **Parallel Agent Orchestration:** múltiples agentes simultáneos. Uno escribe código, otro corre tests, otro investiga GitHub issues.
- **Artifacts:** los agentes dejan diffs, screenshots, logs, summaries para review.
- **GitHub Integration:** lee issues, PRs, crea branches, comenta, cierra issues automáticamente.
- **Free y Open Source:** sin costo de licencia.

### 2.3 Impacto en tiempos de desarrollo

| Tarea | Sin Antigravity | Con Antigravity | Ahorro |
|-------|----------------|-----------------|--------|
| Scaffolding inicial (React + Express + Docker) | 3-4 días | 4-6 horas | ~80% |
| Generación de componentes React | 2-3 días | 4-8 horas | ~70% |
| API endpoints (CRUD + validaciones) | 2-3 días | 6-12 horas | ~65% |
| Tests unitarios | 2-3 días | 4-8 horas | ~70% |
| Documentación técnica | 1-2 días | 2-4 horas | ~75% |
| Debugging de bugs complejos | 1-2 días | 4-8 horas | ~65% |
| Refactors cross-file | 2-3 días | 6-12 horas | ~65% |
| Integración de librerías nuevas | 1-2 días | 3-6 horas | ~70% |

**Ahorro estimado total en desarrollo: 50-70%**

### 2.4 Flujo de trabajo sugerido

```
1. Manager Surface: spawnear agentes paralelos
   ├── Agente "Backend-API" → scaffold Express + endpoints
   ├── Agente "Frontend-React" → scaffold React + componentes base
   ├── Agente "DB-Schema" → modelos PostgreSQL + migraciones
   ├── Agente "Cerbos-Policies" → YAML de RBAC
   └── Agente "Docker-Infra" → Docker Compose + configs

2. Editor View: review de artifacts + ajustes manuales
   - Revisar cada diff generado por los agentes
   - Corregir edge cases
   - Validar decisiones arquitectónicas

3. Manager Surface: agente de integración
   - Conectar backend + frontend
   - Validar flujos end-to-end
   - Generar tests E2E

4. GitHub Bot: automatización de PRs
   - Crear PRs desde branches de agentes
   - Descripción automática de cambios
   - Asignar reviewers
```

> **Nota importante:** Antigravity acelera el CÓDIGO, pero no reemplaza las decisiones de arquitectura, diseño de UX, o validación de compliance legal. El Tech Lead sigue siendo crítico.

---

## 3. Orquestación: Kimi3 Swarm

### 3.1 ¿Qué es?

Kimi3 Swarm es un **router de agentes** que distribuye tareas entre agentes especializados. Cada agente tiene un rol definido, herramientas (tools) y un contexto específico.

### 3.2 Por qué Swarm (y no LangChain/CrewAI)

| Aspecto | LangChain | CrewAI | Kimi3 Swarm | Ganador |
|---------|-----------|--------|-------------|---------|
| SDK Node | Parcial | No | **Sí** | **Swarm** |
| Orquestación nativa | Sí | Sí | Sí | Empate |
| Simplicidad | Media | Media | **Alta** | **Swarm** |
| Costo de tokens | Similar | Similar | Similar | Empate |
| Integración con Kimi | Indirecta | Indirecta | **Nativa** | **Swarm** |
| Documentación | Extensa | Buena | **Creciente** | Empate |

**Veredicto:** Swarm gana por SDK Node nativo e integración directa con Kimi. Para este proyecto (stack NodeJS), es la elección natural.

### 3.3 Arquitectura de agentes

```
┌─────────────────────────────────────────────────────────────────┐
│  SWARM ROUTER → distribuye tareas entre agentes especializados  │
└─────────────────────────────────────────────────────────────────┘
         │           │           │           │           │
    ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
    │ Agente  │ │ Agente  │ │ Agente  │ │ Agente  │ │ Agente  │
    │Onboard  │ │Contable │ │Docu-    │ │Comuni-  │ │Cobranzas│
    │         │ │(wrapper)│ │mental   │ │cador    │ │         │
    └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
         │           │           │           │           │
    ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
    │ Agente  │ │ Agente  │ │ Agente  │ │ Agente  │ │ Agente  │
    │Kanban   │ │Dashboard│ │Bench-   │ │Portal   │ │Seguri-  │
    │(Fase 2) │ │(Fase 2) │ │marking  │ │Residente│ │dad/RBAC │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

---

## 4. Modelos LLM: NVIDIA Nemotron

### 4.1 ¿Por qué Nemotron cambia todo?

Nemotron es la familia de modelos open source de NVIDIA, optimizados para inferencia eficiente en hardware NVIDIA. La clave: son **10x-50x más baratos** que APIs cerradas y algunos son **gratuitos**.

### 4.2 Tabla de modelos y precios (Julio 2026)

| Modelo | Params | Context | Input/1M | Output/1M | Uso recomendado |
|--------|--------|---------|----------|-----------|-----------------|
| **Nemotron 3 Nano 30B** | 30B (activa 3B) | 262K | **$0.05** | $0.20 | Tareas simples: clasificación, labeling, parsing |
| **Nemotron Nano 9B v2** | 9B | 131K | **$0.06** | $0.20 | Chat simple, respuestas cortas, consultas frecuentes |
| **Nemotron Super 49B** | 49B | 128K | **$0.10** | $0.40 | RAG, parsing de documentos, tareas medianas |
| **Nemotron 3 Super 120B** | 120B (activa 12B) | 1M | **$0.085** | $0.40 | Tareas complejas: análisis, reportes, reasoning |
| **Nemotron 70B Instruct** | 70B | 128K | $1.20 | $1.20 | Tareas críticas: comunicados legales, explicaciones |
| **Nemotron Nano 12B VL** | 12B | 128K | $0.20 | $0.60 | OCR + vision: parsing de PDFs con imágenes |
| **Nemotron 3 Embed 1B** | 1B | - | **$0** | **$0** | Embeddings para RAG (**GRATIS** en OpenRouter) |
| **Nemotron 3.5 Content Safety** | - | - | **$0** | **$0** | Moderación de contenido (**GRATIS**) |

### 4.3 Comparativa de costos vs Kimi API

| Tarea | Tokens estimados/mes | Kimi K2 (~$1.00/1M) | Nemotron Nano 9B ($0.06/1M) | Nemotron Super 49B ($0.10/1M) | **Ahorro** |
|-------|---------------------|---------------------|-------------------------------|-------------------------------|------------|
| Clasificar ticket | 10M | $10 | $0.60 | $1.00 | **90-94%** |
| Responder consulta | 50M | $50 | $3.00 | - | **94%** |
| Label email | 20M | $20 | $1.20 | - | **94%** |
| Analizar PDF expensas | 30M | $30 | - | $3.00 | **90%** |
| Generar reporte mensual | 15M | $15 | - | $1.50 | **90%** |
| Explicar liquidación | 10M | $10 | - | $1.00 | **90%** |
| Embeddings RAG | 100M | $100 | **$0** (Embed 1B gratis) | - | **100%** |

**Ahorro promedio usando Nemotron: 85-95% vs usar solo Kimi API.**

### 4.4 Deployment options

| Opción | Costo | Cuándo usar |
|--------|-------|-------------|
| **OpenRouter** (API) | Precios de tabla arriba | Rápido, sin infra propia. Ideal para MVP. |
| **DeepInfra** (API) | Similar a OpenRouter | Alternativa a OpenRouter. Buen uptime. |
| **NVIDIA NIM** (self-hosted) | Costo de GPU (H100/H200) | A escala grande. Requiere ML infra experience. |
| **vLLM local** (self-hosted) | Costo de GPU local | Para desarrollo local o data residency. |
| **Ollama** (local desktop) | **$0** (usa tu GPU) | Desarrollo local, sin costo de tokens. |

**Recomendación para este proyecto:**
- **Desarrollo (Mes 1-4):** Ollama local con Nemotron Nano 9B + Super 49B. Costo de tokens: **$0**.
- **Staging (Mes 3-4):** OpenRouter/DeepInfra. Costo bajo.
- **Producción (Mes 4+):** OpenRouter/DeepInfra inicialmente. Migrar a NIM/vLLM self-hosted cuando el volumen de tokens supere $3.000-5.000/mes (break-even con GPU dedicada).

---

## 5. Router LLM: CheaperInference.com

### 5.1 ¿Qué es?

CheaperInference.com es un **harness de routing dinámico** para LLMs. Es como un "agregador de precios" para APIs de modelos: monitorea en tiempo real los precios y disponibilidad de decenas de proveedores y enruta cada request al modelo más barato que cumpla con los requisitos de calidad.

### 5.2 Funcionamiento

```
Request entrante: "Clasificar este ticket de reclamo"
  │
  v
┌─────────────────────────────┐
│  CheaperInference Router    │
│                             │
│  1. Analizar la tarea       │
│     → complejidad: BAJA     │
│     → requiere vision: NO   │
│     → requiere reasoning: NO│
│                             │
│  2. Consultar precios en    │
│     tiempo real:            │
│     - Nemotron Nano 9B @   │
│       DeepInfra: $0.06/1M  │
│     - Nemotron Nano 9B @   │
│       OpenRouter: $0.05/1M │
│     - Qwen 2.5 @ Together: │
│       $0.04/1M             │
│                             │
│  3. Seleccionar: Qwen 2.5  │
│     (más barato, calidad    │
│     suficiente para        │
│     clasificación)          │
│                             │
│  4. Enviar request          │
│  5. Cachear respuesta       │
│  6. Registrar costo         │
└─────────────────────────────┘
```

### 5.3 Beneficios

| Beneficio | Impacto |
|-----------|---------|
| **Precio dinámico** | Siempre usa el proveedor más barato disponible. Ahorro adicional **10-30%** sobre Nemotron fijo. |
| **Failover automático** | Si un proveedor cae, redirige al siguiente. Sin downtime. |
| **Quality gates** | Define umbral mínimo de calidad por tarea. Nunca usa un modelo demasiado barato para una tarea compleja. |
| **A/B testing de modelos** | Puede probar 2 modelos en paralelo y comparar calidad vs costo. |
| **Una sola API key** | No hay que gestionar keys de múltiples proveedores. Un solo punto de integración. |
| **Analytics de costos** | Dashboard de gasto por tarea, por agente, por organización y edificio. |

### 5.4 Integración con Swarm

```javascript
const cheaperInference = require('cheaperinference');

const router = cheaperInference.createRouter({
  providers: ['openrouter', 'deepinfra', 'together'],
  defaultQuality: 'high',
  cacheEnabled: true,
  cacheTtl: 3600, // 1 hora
});

// En cada agente Swarm:
async function clasificarTicket(texto) {
  const response = await router.route({
    task: 'classification',
    complexity: 'low',
    requiresVision: false,
    prompt: `Clasifica este reclamo: ${texto}`,
    maxCostPer1M: 0.10, // No pagar más de $0.10 por 1M tokens
  });

  // El router seleccionó automáticamente el modelo más barato
  // Ejemplo: Nemotron Nano 9B @ OpenRouter por $0.05/1M

  return response.result;
}
```

---

## 6. Frontend: React 19 + Vite 6

### 6.1 Stack frontend completo

| Componente | Elección | Razón | Versión |
|------------|----------|-------|---------|
| Framework | React 19 | Latest, Server Components, Actions | 19.x |
| Build tool | Vite 6 | Rápido, HMR instantáneo | 6.x |
| Styling | Tailwind CSS 4 | Utility-first, rápido de prototipar | 4.x |
| Componentes | shadcn/ui | Accesible, customizable, sin vendor lock-in | Latest |
| Estado global | Zustand | Simple, ligero, TypeScript-friendly | Latest |
| Formularios | React Hook Form + Zod | Validación declarativa | Latest |
| Queries | TanStack Query (React Query) | Cache, sync, optimistic updates | Latest |
| Charts | Recharts | Simple, React-native | Latest |
| PDF viewer | react-pdf | Preview de recibos en el browser | Latest |
| Kanban | @dnd-kit | Drag and drop nativo, accesible | Latest |
| Mapas | Leaflet | Zonas geográficas para benchmarking | Latest |
| Testing | Vitest + React Testing Library | Rápido, moderno | Latest |

### 6.2 Estructura del frontend

```
frontend/
  src/
    app/                    # React Router 7 (file-based routing)
      layout.tsx
      page.tsx              # Landing / login
      dashboard/
        page.tsx            # Dashboard admin
        layout.tsx
      organizaciones/
        page.tsx            # Selector de organización / edificio de trabajo
      edificios/
        page.tsx            # Lista de edificios
        [id]/
          page.tsx          # Detalle de edificio
      expensas/
        page.tsx            # Gestión de expensas
      liquidaciones/
        page.tsx            # Liquidaciones mensuales
      kanban/
        page.tsx            # Tablero Kanban
      residente/
        page.tsx            # Portal del residente
    components/
      ui/                   # shadcn components
      forms/                # Formularios reutilizables
      charts/               # Gráficos
      kanban/               # Componentes de kanban
      layout/               # Navbar, sidebar, etc.
    hooks/
      useAuth.ts
      useOrganizacion.ts
      useEdificio.ts
      useExpensas.ts
      useKanban.ts
    lib/
      api.ts                # Axios client
      cerbos.ts             # Cerbos client
      utils.ts
    types/
      index.ts              # Shared types (Node + React)
    stores/
      auth.store.ts         # Zustand (sesión + organizacionId)
  public/
  tests/
  Dockerfile
  package.json
```

---

## 7. Backend: NodeJS 20 + Express 5

### 7.1 ¿Por qué NodeJS? (cambio desde Python/FastAPI)

| Aspecto | Python/FastAPI | NodeJS/Express | Impacto |
|---------|---------------|----------------|---------|
| Ecosistema Swarm | Python SDK nativo | Node SDK disponible | Kimi tiene SDK Node. Swarm puede correr en Node. |
| Performance I/O | Buena (async) | Excelente (event loop) | Mejor para webhooks concurrentes de AgentMail. |
| Frontend synergy | Lenguaje diferente | Mismo lenguaje (JS/TS) | Shared types, shared validation schemas (Zod). |
| NPM ecosystem | PyPI | NPM (más grande) | Más librerías para web, auth, pagos. |
| OCR | Python nativo (transformers) | Requiere microservicio Python | baidu/Unlimited-OCR requiere Python + CUDA. |
| Motor contable | Python (decimal exacto) | NodeJS (decimal.js) | Misma precisión con librería decimal. |
| Dev velocity | Buena | Excelente con Antigravity | Antigravity genera mejor código NodeJS/React. |

### 7.2 Arquitectura del backend

```
backend/
  src/
    config/              # Configs (DB, Redis, LLM router)
    agents/              # Agentes Swarm (Node SDK)
      onboarding.agent.js
      contable.agent.js
      documental.agent.js
      comunicador.agent.js
      cobranzas.agent.js
      kanban.agent.js
      dashboard.agent.js
    core/                # Motor contable DETERMINÍSTICO
      liquidacion.engine.js
      distribucion.coeficientes.js
      recibos.generator.js      # PDF con QR (Ley 941)
      conciliacion.bancaria.js
    routes/              # Express routers
      auth.routes.js
      organizaciones.routes.js
      edificios.routes.js
      unidades.routes.js
      gastos.routes.js
      liquidaciones.routes.js
      cobros.routes.js
      comunicaciones.routes.js
      kanban.routes.js
      webhooks.routes.js        # AgentMail, MercadoPago
    services/            # Lógica de negocio
      organizacion.service.js
      edificio.service.js
      expensa.service.js
      email.service.js          # AgentMail integration
      ocr.service.js            # Llama a microservicio Python
      pdf.service.js
    middleware/          # Express middlewares
      auth.middleware.js        # JWT validation
      rbac.middleware.js        # Cerbos integration
      tenant.middleware.js      # Multi-tenant isolation (org → edificio)
      validation.middleware.js  # Zod schemas
    models/              # Prisma ORM models
      schema.prisma
    db/                  # Prisma client, migrations
      prisma.js
    llm/                 # Integración LLMs
      swarm.router.js           # Kimi3 Swarm orchestration
      cheaper.router.js         # CheaperInference harness
      nemotron.client.js        # Nemotron API client
    utils/               # Helpers
    app.js               # Express app setup (exporta la app, sin listen)
    server.js            # Entry point: app.listen (los tests importan app.js)
  tests/
  prisma/
    schema.prisma        # Modelo de datos
  docker/
    Dockerfile
  docker-compose.yml
  package.json
```

---

## 8. OCR: baidu/Unlimited-OCR

### 8.1 ¿Qué es?

Unlimited-OCR es un modelo de **visión-language de Baidu**, disponible en Hugging Face. Diseñado para **"one-shot long-horizon parsing"**: parsear documentos largos en una sola pasada, sin necesidad de dividirlos en chunks.

### 8.2 Características

- Parsea documentos enteros (no página por página)
- Entiende layout, tablas, firmas, sellos
- Soporta PDFs e imágenes
- Requiere: Python 3.12, CUDA 12.9, PyTorch 2.10, transformers 4.57
- Puede correr con SGLang para batch inference concurrente

### 8.3 Flujo de uso

```python
# microservicio-ocr/main.py
from transformers import AutoModel, AutoTokenizer
from PIL import Image
import fitz  # PyMuPDF

model = AutoModel.from_pretrained("baidu/Unlimited-OCR", trust_remote_code=True)
tokenizer = AutoTokenizer.from_pretrained("baidu/Unlimited-OCR", trust_remote_code=True)

def parsear_pdf_expensas(pdf_path):
    # Convertir PDF a imágenes
    doc = fitz.open(pdf_path)
    imagenes = [page.get_pixmap().tobytes() for page in doc]

    # Unlimited-OCR parsea todo el documento en una pasada
    resultado = model.chat(
        tokenizer,
        images=imagenes,
        question="Extrae todos los gastos de este resumen de expensas. Para cada gasto, devuelve: concepto, monto, categoría (A/B/C), fecha. Si hay un total, valida que la suma de los gastos cuadre.",
        image_mode="gundam"  # Modo optimizado para documentos
    )

    return resultado
```

**Costo: $0** (self-hosted en GPU cloud en producción).

> **Nota dev (2026-07-28):** en desarrollo local (macOS, sin GPU NVIDIA) el servicio OCR corre bajo profile `gpu` de Docker Compose sin modelo cargado (`POST /parse` → 501). Ver [[PRD-02-03 Infraestructura Docker]] §10–§11.

**Alternativa:** Nemotron Nano 12B VL ($0.20/1M input) para OCR sin self-hosting.

---

## 9. Email: AgentMail

### 9.1 ¿Qué es?

AgentMail es una plataforma **API-first diseñada exclusivamente para dar inboxes de email a agentes IA**. No es un servicio de email tradicional.

### 9.2 Características clave

- **Creación programática de inboxes:** cada consorcio puede tener su propio email
- **Dominios propios:** `edificio-123@consorcios.tuplataforma.com`
- **Webhooks + WebSockets:** notificación en tiempo real cuando llega un email
- **Extracción de datos estructurados** desde emails no estructurados
- **Labeling automático** con prompts definidos por el usuario
- **Full-text search** across todos los inboxes
- **SPF, DKIM, DMARC** incluidos

### 9.3 Costo estimado

| Escenario | Inboxes | Costo/mes | vs Gmail Workspace |
|-----------|---------|-----------|-------------------|
| Desarrollo | 5-10 | $0-20 | vs $60-120 |
| Piloto (10 edificios) | 15-20 | $10-40 | vs $180-240 |
| Escala (500 edificios) | 500+ | $250-1.000 | vs $6.000+ |

---

## 10. RBAC: Cerbos

### 10.1 ¿Qué es?

Cerbos PDP (Policy Decision Point) es una capa de autorización **open source** que permite definir políticas de acceso como código YAML. Soporta RBAC tradicional y ABAC (context-aware).

### 10.2 Ventajas sobre RBAC casero

| Aspecto | RBAC Casero | Cerbos |
|---------|-------------|--------|
| Políticas | if/else en código | YAML versionable en Git |
| Cambios de permiso | Requiere deploy | Cambio en YAML + hot reload |
| Contexto dinámico | Imposible sin código complejo | ABAC nativo |
| Audit | Manual | Log automático de cada decisión |
| Performance | Depende de implementación | <1ms por decisión |

**Costo: $0** (open source, self-hosted en Docker).

---

## 11. Matriz de Compatibilidad

| Componente | NodeJS 20 | React 19 | PostgreSQL 17 | Redis 7 | Docker |
|------------|-----------|----------|---------------|---------|--------|
| Kimi3 Swarm SDK | ✅ | N/A | N/A | N/A | ✅ |
| CheaperInference | ✅ | N/A | N/A | N/A | ✅ |
| Nemotron (OpenRouter) | ✅ | N/A | N/A | N/A | ✅ |
| Prisma ORM | ✅ | N/A | ✅ | N/A | ✅ |
| Cerbos | ✅ | N/A | N/A | N/A | ✅ |
| AgentMail | ✅ | N/A | N/A | N/A | ✅ |
| MercadoPago SDK | ✅ | N/A | N/A | N/A | ✅ |
| Unlimited-OCR | N/A | N/A | N/A | N/A | ✅ (Python) |
| pgvector | N/A | N/A | ✅ | N/A | ✅ |
| React 19 | N/A | ✅ | N/A | N/A | ✅ |
| Vite 6 | N/A | ✅ | N/A | N/A | ✅ |

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]
