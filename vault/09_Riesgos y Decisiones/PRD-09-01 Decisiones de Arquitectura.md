---
title: "PRD-09-01: Decisiones de Arquitectura"
description: "Registro de decisiones arquitectónicas (ADRs) de ConsorcIA: por qué se eligió cada tecnología, patrón y enfoque."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [riesgos, decisiones, arquitectura, adr, tecnologia, patrones, consorcIA]
outcomes:
  - "Documentar cada decisión arquitectónica con contexto, decisión y consecuencias"
  - "Justificar elecciones tecnológicas con datos y trade-offs"
  - "Establecer criterios de evaluación para futuras decisiones"
  - "Crear un registro histórico consultable por el equipo"
---

# PRD-09-01: Decisiones de Arquitectura

> **Cada decisión arquitectónica de ConsorcIA está documentada con contexto, decisión y consecuencias.** Este registro permite al equipo entender por qué se eligió cada tecnología y qué trade-offs se aceptaron.

---

## ADR-001: Node.js + TypeScript como stack principal

### Contexto
Necesitamos un stack backend que sea:
- Productivo para un equipo pequeño
- Type-safe para evitar errores en cálculos financieros
- Maduro con ecosistema amplio

### Decisión
**Node.js 20 LTS + TypeScript 5.7**

### Consecuencias
- **Positivas:** Un solo lenguaje full-stack (backend + frontend). Ecosistema npm enorme. TypeScript catcha errores en compile time.
- **Negativas:** Single-threaded (mitigado con colas en Redis y servicios separados). Menor performance que Go/Rust para CPU-bound tasks.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| Python + FastAPI | Menor ecosistema de herramientas de IA en Argentina |
| Go | Curva de aprendizaje para equipo. Menos librerías de IA. |
| Java/Spring | Boilerplate excesivo para MVP. |

---

## ADR-002: PostgreSQL como base de datos principal

### Contexto
Necesitamos ACID para transacciones financieras. Los datos son relacionales (edificios, unidades, gastos, liquidaciones).

### Decisión
**PostgreSQL 16**

### Consecuencias
- **Positivas:** ACID completo. JSONB para datos flexibles. Prisma ORM nativo. Full-text search.
- **Negativas:** Escalado horizontal complejo (mitigado con read replicas en Fase 3).

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| MySQL | Menor soporte de JSON. Prisma funciona mejor con PostgreSQL. |
| MongoDB | Sin ACID transaccional completo. Riesgo para datos financieros. |
| CockroachDB | Overkill para MVP. Costo alto. |

---

## ADR-003: Swarm de Agentes LLM sobre monolito

### Contexto
Necesitamos múltiples capacidades de IA (contable, documental, comunicador) sin fragmentar la arquitectura.

### Decisión
**Swarm de agentes LLM orquestados por Kimi (planning) + Nemotron (ejecución)**

### Consecuencias
- **Positivas:** Especialización por agente. Fallback automático. Costo optimizado.
- **Negativas:** Latencia adicional por orquestación. Complejidad de debugging.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| Single LLM (GPT-4) | Costo prohibitivo. No hay especialización. |
| LangChain | Vendor lock-in. Abstracciones innecesarias. |
| CrewAI | Más orientado a research que a producción. |

---

## ADR-004: Motor contable determinístico + IA solo para distribución

### Contexto
La Ley 941 exige precisión matemática en expensas. La IA puede alucinar.

### Decisión
**Motor contable 100% determinístico (Node.js + Decimal.js). IA solo sugiere distribución de gastos.**

### Consecuencias
- **Positivas:** Compliance legal garantizado. Sin errores de cálculo. Auditable.
- **Negativas:** Menor "inteligencia" en la distribución (mitigado con prompts optimizados).

---

## ADR-005: Temporal sobre Bull/BullMQ para workflows

> [!warning] Estado: **Reemplazada** (2026-07-28)
> Esta decisión quedó **sin efecto**. El stack implementado ([[PRD-02-03 Infraestructura Docker]], verificado en `../../app`) no incluye Temporal: la orquestación de tareas la hace **Kimi3 Swarm** (ADR-003) y las colas livianas van sobre **Redis**. Temporal agregaba un server y una curva de aprendizaje sin uso concreto en el MVP. Se conserva como registro histórico; si una necesidad futura de durable execution lo justifica, esta ADR puede reactivarse.

### Contexto
Necesitamos workflows complejos (liquidación, cobranzas, OCR) con retries, timeouts y observabilidad.

### Decisión
~~**Temporal**~~ → **Kimi3 Swarm + colas en Redis** (reemplazo vigente)

### Consecuencias
- **Positivas:** Durable execution. Retries automáticos. UI de monitoreo. Idempotencia.
- **Negativas:** Infra adicional (Temporal server). Curva de aprendizaje.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| BullMQ | Sin durable execution. Sin UI nativa. |
| AWS Step Functions | Vendor lock-in. Costo por transición. |
| Cadence | Temporal es el sucesor. Mejor soporte. |

---

## ADR-006: React 19 SPA sobre Next.js

### Contexto
Necesitamos un frontend moderno, rápido y sin vendor lock-in.

### Decisión
**React 19 + Vite 6 + React Router 7 (SPA)**

### Consecuencias
- **Positivas:** Sin vendor lock-in de Vercel. HMR instantáneo. Server Components nativos.
- **Negativas:** Sin SSR (no necesitamos SEO para un ERP). Hosting más simple.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| Next.js | Vendor lock-in de Vercel. Overhead para ERP. |
| Vue 3 | Menor ecosistema de componentes UI en Argentina. |
| Svelte | Curva de aprendizaje. Menor comunidad. |

---

## ADR-007: Cerbos sobre CASL para RBAC

### Contexto
Necesitamos RBAC complejo con atributos (edificio, rol, permisos).

### Decisión
**Cerbos**

### Consecuencias
- **Positivas:** Policies como código. Decisiones auditables. Performance con PDP.
- **Negativas:** Infra adicional (Cerbos server). YAML policies.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| CASL | Menor escalabilidad. Sin separación de concerns. |
| Oso | Menor madurez. Menor comunidad. |
| Custom | Reinventar la rueda. Riesgo de bugs de seguridad. |

---

## ADR-008: AWS sobre GCP/Azure

### Contexto
Necesitamos cloud provider con presencia en LATAM, buen soporte y ecosistema maduro.

### Decisión
**AWS**

### Consecuencias
- **Positivas:** Mayor presencia en LATAM. ECS Fargate serverless. Amplio ecosistema.
- **Negativas:** Costo puede ser mayor que GCP. Complejidad de servicios.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| GCP | Menor presencia en Argentina. Menor ecosistema de partners. |
| Azure | Menor madurez en containers. Costo impredecible. |
| On-premise | Costo de infraestructura. Sin elasticidad. |

---

## ADR-009: MercadoPago sobre Stripe

### Contexto
Necesitamos procesar pagos en Argentina con métodos locales (PagoMisCuentas, Rapipago, tarjetas).

### Decisión
**MercadoPago**

### Consecuencias
- **Positivas:** Métodos de pago locales. SDK maduro. Webhooks confiables.
- **Negativas:** Solo LATAM. Menor flexibilidad que Stripe.

### Alternativas consideradas
| Alternativa | Por qué no se eligió |
|-------------|----------------------|
| Stripe | Sin PagoMisCuentas/Rapipago en Argentina. |
| PayU | Menor adopción en consorcios. |
| Transferencia manual | Friction para residentes. Más trabajo para admin. |

---

## ADR-010: PWA sobre app nativa (Fase 1)

### Contexto
Necesitamos llegar a residentes móviles rápido y barato.

### Decisión
**PWA en Fase 1, React Native en Fase 2**

### Consecuencias
- **Positivas:** Un solo codebase. Deploy instantáneo. Sin app stores.
- **Negativas:** Menor acceso a features nativas (push, biometría). Menor "descubrimiento".

---

## Registro de ADRs

| ADR | Título | Estado | Fecha |
|-----|--------|--------|-------|
| ADR-001 | Node.js + TypeScript | Aceptado | 2026-01-15 |
| ADR-002 | PostgreSQL | Aceptado | 2026-01-15 |
| ADR-003 | Swarm de Agentes LLM | Aceptado | 2026-01-20 |
| ADR-004 | Motor contable determinístico | Aceptado | 2026-01-20 |
| ADR-005 | Temporal | Reemplazado por ADR-003 (Swarm + Redis) | 2026-07-28 |
| ADR-006 | React 19 SPA | Aceptado | 2026-02-01 |
| ADR-007 | Cerbos RBAC | Aceptado | 2026-02-05 |
| ADR-008 | AWS | Aceptado | 2026-02-10 |
| ADR-009 | MercadoPago | Aceptado | 2026-02-15 |
| ADR-010 | PWA Fase 1 | Aceptado | 2026-02-20 |

---

*Documento relacionado:* [[PRD-09-02 Riesgos Tecnicos]]  
*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]  
*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]
