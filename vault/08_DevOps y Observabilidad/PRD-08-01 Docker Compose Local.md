---
title: "PRD-08-01: Docker Compose Local"
description: "OBSOLETO. Variante anterior del entorno local (Temporal, Elasticsearch, pgAdmin, Mailhog). El stack vigente e implementado es PRD-02-03."
author: "ConsorcIA Team"
date: 2026-07-28
status: "obsoleto"
priority: "P0"
tags: [devops, docker, compose, local, desarrollo, infraestructura, obsoleto]
outcomes:
  - "Redirigir al lector al documento canónico (PRD-02-03)"
  - "Conservar el registro de alternativas evaluadas y descartadas"
---

# PRD-08-01: Docker Compose Local

> [!warning] Documento obsoleto — no usar
> Este documento describía una variante **anterior** del entorno de desarrollo local que **no coincide** con el stack definitivo de [[PRD-02-02 Stack Tecnológico]] ni con la implementación real (`../../app`).
>
> **El documento canónico es [[PRD-02-03 Infraestructura Docker]]** (12 servicios, implementado y verificado el 2026-07-28). Toda referencia a "Docker Compose local" debe apuntar ahí.

---

## 1. Por qué quedó obsoleto

Esta variante se diseñó antes de la decisión final de stack ([[PRD-02-02 Stack Tecnológico]], [[PRD-09-01 Decisiones de Arquitectura]]). Las diferencias irreconciliables con el stack vigente:

| Componente de esta variante | Reemplazado por | Motivo |
|-----------------------------|-----------------|--------|
| **Temporal** (workflow engine) | Kimi3 Swarm + colas en Redis | El Swarm orquesta agentes nativamente; Temporal agregaba infra sin uso en el MVP. |
| **Elasticsearch + Kibana** | pgvector (RAG) + Prometheus/Grafana | Búsqueda semántica vía embeddings en PostgreSQL; observabilidad con el stack OTel. |
| **Mailhog** (SMTP mock) | AgentMail | El producto usa inboxes programáticos de AgentMail, no SMTP. |
| **pgAdmin / Redis Commander** | Prisma Studio / `redis-cli` | UIs de administración innecesarias en el stack mínimo. |
| **PostgreSQL 16** | PostgreSQL 17 (`pgvector/pgvector:pg17`) | Versión fijada por el stack definitivo. |
| **`agent-worker` (workers Temporal)** | Agentes Swarm dentro del backend Node | Sin Temporal no hay workers separados. |

## 2. Qué se conserva como referencia

- La idea de **un solo comando para levantar todo** (`make up`) se mantuvo en PRD-02-03.
- El patrón de **healthchecks + `depends_on` con `service_healthy`** se mantuvo, salvo en imágenes distroless (Cerbos).
- El `.env.example` con API keys externas se fusionó en el de PRD-02-03.

---

*Documento canónico:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]  
*Documento relacionado:* [[PRD-08-03 Deploy AWS]]
