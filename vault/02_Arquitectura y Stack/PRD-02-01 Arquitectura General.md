---
title: "PRD-02-01: Arquitectura General"
description: "Diagrama completo de arquitectura, capas del sistema, flujos de datos y decisiones de diseño a nivel macro."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [arquitectura, diagrama, capas, flujo, stack, consorcIA]
outcomes:
  - "Comprender la arquitectura de 6 capas del sistema"
  - "Visualizar el flujo completo de una liquidación de expensas"
  - "Entender la separación entre código determinístico y agentes IA"
  - "Identificar puntos de integración entre componentes"
  - "Documentar decisiones de diseño arquitectónicas con justificación"
---

# PRD-02-01: Arquitectura General

> **Arquitectura de 6 capas:** Presentación → Orquestación IA → Router LLM → Backend → Microservicios → Datos.  
> **Principio:** Swarm orquesta, el motor contable calcula. Nunca al revés.

---

## 1. Diagrama de Arquitectura Completa

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CAPA 1: PRESENTACIÓN                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐         │
│  │ React 19 +   │  │ React Native │  │ AgentMail Inboxes        │         │
│  │ Vite +       │  │ (Fase 2)     │  │ (dominio propio)         │         │
│  │ shadcn/ui    │  │              │  │                          │         │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘         │
│         │                  │                        │                      │
├─────────┼──────────────────┼────────────────────────┼──────────────────────┤
│         │    CAPA 2:       │    OPENWORKER-STYLE  │                      │
│         │    ORQUESTACIÓN  │    PATTERNS          │                      │
│         │    IA            │    - Risk Tiers      │                      │
│         │                  │    - Approval Inbox  │                      │
│         │    ┌─────────┐   │    - Task Decomp.    │                      │
│         └───▶│ Agentes │◀──┤    - Model Tiering   │                      │
│              │ Core    │   │    - Iteration Cap   │                      │
│              └────┬────┘   └──────────────────────┘                      │
│                   │                                                      │
│         ┌────────┼────────┬────────────┬────────────┐                    │
│         ▼        ▼        ▼            ▼            ▼                    │
│    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│    │Onboard │ │Contable│ │Documental│ │Comunic.│ │Cobranzas│             │
│    └────────┘ └────────┘ └────────┘ └────────┘ └────────┘              │
│                                                                         │
│    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────────┐             │
│    │ Kanban │ │Dashboard│ │Benchmark│ │ CERBOS PDP        │             │
│    │(Fase 2)│ │(Fase 2) │ │(Fase 3) │ │ (RBAC/ABAC)       │             │
│    └────────┘ └────────┘ └────────┘ └────────────────────┘             │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 3: ROUTER LLM (CheaperInference)                                   │
│  ┌────────────────────────────────────────────────────────────┐          │
│  │  Dynamic routing: Nemotron Nano 9B / Super 49B / Super   │          │
│  │  120B / Kimi K2. Fallback automático entre proveedores.  │          │
│  │  Quality gates. Cache. Analytics de costos por agente.   │          │
│  └────────────────────────────────────────────────────────────┘          │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 4: BACKEND NODEJS + EXPRESS                                         │
│  ┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐          │
│  │ Routes           │ │ Services     │ │ Core (deterministic)│          │
│  │ - auth           │ │ - edificio   │ │ - liquidacion.engine │          │
│  │ - expensas       │ │ - expensa    │ │ - recibos.generator  │          │
│  │ - webhooks       │ │ - email      │ │ - conciliacion       │          │
│  │ - organizaciones │ └──────────────┘ └──────────────────────┘          │
│  └──────────────────┘                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐              │
│  │ Middleware   │ │ LLM Clients  │ │ Utils                │              │
│  │ - auth (JWT) │ │ - Swarm Node │ │ - validation (Zod)   │              │
│  │ - rbac (Cerb)│ │ - Nemotron   │ │ - errors             │              │
│  │ - tenant(org)│ │ - CheaperInf.│ │ - logging            │              │
│  └──────────────┘ └──────────────┘ └──────────────────────┘              │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 5: MICROSERVICIOS PYTHON                                            │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ OCR Service             │  │ Embeddings Service      │              │
│  │ (FastAPI + Unlimited-   │  │ (Nemotron 3 Embed 1B    │              │
│  │  OCR)                   │  │  gratis)                │              │
│  │ - Parseo de PDFs        │  │ - RAG vector store      │              │
│  │ - Extracción de texto   │  │ - Semantic search       │              │
│  └─────────────────────────┘  └─────────────────────────┘              │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 6: DATOS                                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐                │
│  │ PostgreSQL 17 │ │ Redis 7       │ │ MinIO / S3        │                │
│  │ (local→RDS)  │ │ (cache+colas) │ │ (PDFs, recibos)   │                │
│  └──────────────┘ └──────────────┘ └────────────────────┘                │
│  ┌─────────────────────────────────────────────────────────┐             │
│  │ pgvector (embeddings en PostgreSQL, sin servicio extra)  │             │
│  └─────────────────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo Completo: Liquidación de Expensas

### 2.1 Secuencia de pasos

```
1. Gestor de la organización carga un gasto de un edificio de su cartera via portal web (React)
   │
   ▼
2. Backend NodeJS valida con Zod schema + Cerbos (¿tiene permiso?)
   │
   ▼
3. Agente Contable (Swarm) recibe el gasto
   ├── Parsea descripción en lenguaje natural
   ├── Sugiere categoría (A/B/C)
   ├── Llama a motor contable (NodeJS determinístico)
   │
   ▼
4. Motor contable calcula distribución exacta
   ├── decimal.js para precisión arbitraria
   ├── Valida suma de coeficientes = 1
   ├── Valida suma de montos = montoTotal
   ├── Distribuye según categoría A/B/C
   │
   ▼
5. Si monto > $100.000 o categoría cambia:
   ├── Crear tarea en Approval Inbox (OpenWorker pattern)
   ├── El gestor (u org_admin) debe aprobar antes de continuar
   │
   ▼
6. Gestor aprueba (o en modo auto si es batch)
   │
   ▼
7. Generar recibo PDF con QR (Ley 941)
   ├── Template validado por abogado
   ├── Matrícula RPA, separación ord/ext
   │
   ▼
8. Agente Comunicador envía recibo via AgentMail
   ├── Email personalizado a cada propietario
   ├── Dominio propio de la organización: edificio-123@consorcios.tuplataforma.com
   │
   ▼
9. Propietario responde al email
   ├── AgentMail recibe vía webhook → backend
   ├── Agente Documental clasifica respuesta
   │
   ▼
10. Si es reclamo:
    ├── Crear ticket en Kanban automáticamente (Fase 2)
    ├── Notificar al gestor asignado al edificio
    ├── Asignar a proveedor si es mantenimiento
    │
    Si es pago confirmado:
    ├── Agente Cobranzas registra cobro
    ├── Conciliación manual (MVP) o automática (Fase 2)
    │
    Si es consulta:
    ├── Agente Comunicador responde automáticamente con RAG
```

### 2.2 Diagrama de secuencia (simplificado)

```
Gestor         React          Backend        Swarm        Motor       Cerbos      AgentMail     Residente
  │              │               │             │            │           │            │             │
  │──carga gasto─▶│             │             │            │           │            │             │
  │              │──POST /gasto─▶│             │            │           │            │             │
  │              │               │──valida───▶│            │           │            │             │
  │              │               │◀──OK───────│            │           │            │             │
  │              │               │──llama─────▶│            │           │            │             │
  │              │               │            │──parse──▶  │           │            │             │
  │              │               │            │◀─sugiere──│           │            │             │
  │              │               │            │──calcular─▶│           │            │             │
  │              │               │            │◀─result───│           │            │             │
  │              │               │            │            │           │            │             │
  │              │               │◀─distribución────────────│           │            │             │
  │              │◀──preview─────│            │            │           │            │             │
  │◀──confirma───│               │            │            │           │            │             │
  │──aprobar────▶│               │            │            │           │            │             │
  │              │──POST /aprobar▶│            │            │           │            │             │
  │              │               │──genera──▶│            │           │            │             │
  │              │               │            │──PDF──────▶│           │            │             │
  │              │               │            │◀──recibo───│           │            │             │
  │              │               │──envía──────────────────────────────▶│            │
  │              │               │            │            │           │            │──email───────▶│
  │              │               │            │            │           │            │◀──respuesta──│
  │              │               │◀─webhook────────────────────────────│            │             │
  │              │               │──clasifica─▶│            │           │            │             │
  │              │               │            │            │           │            │             │
  │              │               │            │            │           │            │             │
```

---

## 3. Decisiones de Diseño Arquitectónicas

### 3.1 Separación Agentes vs Código Determinístico

| Capa | Componente | Tipo | Justificación |
|------|-----------|------|---------------|
| Orquestación | Kimi3 Swarm | IA | Flujos conversacionales, parsing de documentos, insights |
| Cálculo | Liquidación Engine | Determinístico | Precisión matemática exigida por Ley 941 |
| Autorización | Cerbos | Determinístico | <1ms, audit log, políticas versionables |
| Comunicación | AgentMail | Híbrido | Webhooks determinísticos, contenido generado por IA |
| OCR | Unlimited-OCR | IA | One-shot parsing de documentos complejos |
| Embeddings | Nemotron 3 Embed 1B | IA | Gratis, RAG para respuestas contextuales |

### 3.2 Por qué NodeJS + Express (y no Python/FastAPI)

| Aspecto | Python/FastAPI | NodeJS/Express | Ganador |
|---------|---------------|-----------------|---------|
| Ecosistema Swarm | Python SDK nativo | Node SDK disponible | Empate |
| Performance I/O | Buena (async) | Excelente (event loop) | **NodeJS** |
| Frontend synergy | Lenguaje diferente | Mismo lenguaje (JS/TS) | **NodeJS** |
| NPM ecosystem | PyPI | NPM (más grande) | **NodeJS** |
| OCR | Python nativo | Microservicio Python | Empate |
| Motor contable | Python (decimal) | NodeJS (decimal.js) | Empate |
| Dev velocity con Antigravity | Buena | Excelente | **NodeJS** |

**Veredicto:** NodeJS gana en sinergia frontend, performance de webhooks y velocidad de desarrollo con Antigravity. El microservicio Python cubre OCR.

### 3.3 Por qué Nemotron + CheaperInference

| Modelo | Input/1M | Output/1M | Uso | vs Kimi K2 |
|--------|----------|-----------|-----|------------|
| Nemotron 3 Nano 30B | $0.05 | $0.20 | Clasificación, labeling | **95% menos** |
| Nemotron Nano 9B v2 | $0.06 | $0.20 | Chat simple, consultas | **94% menos** |
| Nemotron Super 49B | $0.10 | $0.40 | RAG, parsing | **90% menos** |
| Nemotron 3 Super 120B | $0.085 | $0.40 | Análisis complejo | **91% menos** |
| Nemotron 3 Embed 1B | **$0** | **$0** | Embeddings | **100% menos** |
| Nemotron 3.5 Safety | **$0** | **$0** | Moderación | **100% menos** |

**CheaperInference** agrega:
- Routing dinámico al proveedor más barato (+10-20% ahorro)
- Failover automático entre proveedores
- Quality gates por tarea
- Analytics de costos por agente

### 3.4 Por qué PostgreSQL + pgvector (y no Vector DB dedicada)

| Opción | Costo | Complejidad | Justificación |
|--------|-------|-------------|---------------|
| PostgreSQL + pgvector | $0 extra | Baja | Mismo servicio, backups unificados, queries JOIN con datos estructurados |
| Pinecone | $70-200/mes | Media | Servicio adicional, costo extra innecesario |
| Weaviate | $50-150/mes | Media | Overkill para el volumen inicial |
| Qdrant | $30-100/mes | Media | Mismo problema que Pinecone |

**Veredicto:** pgvector es suficiente para el volumen de embeddings de ConsorcIA y elimina un servicio adicional.

### 3.5 Por qué AgentMail (y no SendGrid/AWS SES)

| Aspecto | SendGrid/SES | AgentMail | Ganador |
|---------|-------------|-----------|---------|
| Costo | $0.10/1K emails | $0.05/1K o menos | **AgentMail** |
| Webhooks | Limitados | Nativos, en tiempo real | **AgentMail** |
| Labeling automático | No | Sí, con prompts | **AgentMail** |
| Dominios por agente | No | Sí | **AgentMail** |
| Diseñado para agentes | No | Sí | **AgentMail** |
| Full-text search | No | Sí | **AgentMail** |

---

## 4. Puntos de Integración

### 4.1 Backend ↔ Microservicios Python

```javascript
// Comunicación gRPC o HTTP REST
const ocrClient = new OcrServiceClient('http://ocr-service:8000');

async function parsearPDF(pdfBuffer) {
  const response = await ocrClient.parseDocument({
    document: pdfBuffer,
    format: 'pdf',
    extract: ['concepts', 'amounts', 'categories', 'dates'],
    validate: true
  });
  return response.result;
}
```

### 4.2 Backend ↔ CheaperInference

```javascript
const cheaperInference = require('cheaperinference');

const router = cheaperInference.createRouter({
  providers: ['openrouter', 'deepinfra', 'together'],
  defaultQuality: 'high',
  cacheEnabled: true,
  cacheTtl: 3600,
  fallbackEnabled: true
});

async function clasificarTicket(texto) {
  return router.route({
    task: 'classification',
    complexity: 'low',
    requiresVision: false,
    prompt: `Clasifica este reclamo: ${texto}`,
    maxCostPer1M: 0.10
  });
}
```

### 4.3 Backend ↔ AgentMail

```javascript
// Webhook inbound
app.post('/webhooks/agentmail', async (req, res) => {
  const { inbox, from, subject, body, labels } = req.body;

  // Clasificar con Swarm
  const clasificacion = await swarmAgentDocumental.clasificarEmail({
    from, subject, body, labels
  });

  if (clasificacion.tipo === 'reclamo') {
    await kanbanService.crearTicket({
      edificioId: inbox.edificioId,
      unidadId: clasificacion.unidadId,
      descripcion: clasificacion.resumen,
      prioridad: clasificacion.prioridad,
      fuente: 'email'
    });
  }

  res.status(200).send('OK');
});
```

---

## 5. Escalabilidad

### 5.1 Estrategia de escalado

| Métrica | Estrategia |
|---------|-----------|
| < 100 edificios (~10 organizaciones) | Docker Compose en VPS (Hetzner/AWS Lightsail) |
| 100-500 edificios (~10-50 organizaciones) | AWS ECS Fargate, RDS, ElastiCache |
| 500-2.000 edificios (~50-200 organizaciones) | ECS con auto-scaling, read replicas RDS, Redis Cluster |
| 2.000-10.000 edificios (~200-1.000 organizaciones) | Multi-AZ, sharding por región, CDN global |

### 5.2 Costos proyectados de infraestructura

| Escenario | Infra/mes | Tokens/mes | Total/mes |
|-----------|-----------|------------|-----------|
| Piloto (10 edificios, 1-2 organizaciones) | $200-400 | $0.50-2 | $200-402 |
| Suave (100 edificios, ~10 organizaciones) | $400-800 | $5-20 | $405-820 |
| Escala (500 edificios, ~50 organizaciones) | $800-1.500 | $25-100 | $825-1.600 |
| Media (2.000 edificios, ~200 organizaciones) | $1.500-3.000 | $100-400 | $1.600-3.400 |
| Grande (10.000 edificios, ~1.000 organizaciones) | $3.000-6.000 | $500-2.000 | $3.500-8.000 |

---

## 6. Seguridad

### 6.1 Capas de seguridad

```
┌─────────────────────────────────────────┐
│  1. WAF (Cloudflare/AWS WAF)           │
├─────────────────────────────────────────┤
│  2. HTTPS/TLS 1.3 (Cloudflare)         │
├─────────────────────────────────────────┤
│  3. Rate limiting (Redis)               │
├─────────────────────────────────────────┤
│  4. Auth JWT + refresh tokens           │
├─────────────────────────────────────────┤
│  5. RBAC/ABAC (Cerbos)                  │
├─────────────────────────────────────────┤
│  6. Tenant isolation (DB level)         │
├─────────────────────────────────────────┤
│  7. Input validation (Zod)              │
├─────────────────────────────────────────┤
│  8. SQL injection prevention (Prisma)   │
├─────────────────────────────────────────┤
│  9. Audit logs (PostgreSQL)            │
├─────────────────────────────────────────┤
│  10. Encriptación en tránsito y reposo   │
└─────────────────────────────────────────┘
```

### 6.2 Multi-tenancy

Cada organización es un tenant aislado:
- **DB level:** `organizacion_id` en cada tabla, RLS (Row Level Security) en PostgreSQL. `edificio_id` es el segundo nivel de scope dentro de la organización
- **API level:** Middleware `organizacion.middleware.js` resuelve la organización desde el JWT, inyecta `organizacion_id` en cada request y valida que el `edificio_id` del request pertenezca a esa organización
- **Cerbos level:** Políticas verifican que el recurso pertenezca a la organización del usuario (y al edificio, vía ABAC)
- **Cache level:** Keys de Redis prefijadas con `org:{id}:` (y `edificio:{id}:` para datos por edificio)

---

*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]  
*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]
