---
title: "PRD-01-02: Estrategia de MVP y Fases"
description: "Roadmap detallado de 3 fases: MVP (meses 1-3), Fase 2 (meses 4-5.5), Fase 3 (meses 6-12). Priorización, entregables y dependencias."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [mvp, fases, roadmap, estrategia, timeline, priorizacion, consorcIA]
outcomes:
  - "Definir el scope exacto de cada fase con entregables medibles"
  - "Establecer dependencias críticas entre fases"
  - "Validar que el MVP sea comercializable sin diferenciadores"
  - "Planificar recursos humanos y técnicos por sprint"
  - "Mitigar el riesgo principal: sobredimensionar el MVP"
---

# PRD-01-02: Estrategia de MVP y Fases

> **Time-to-market: 4.5 - 5.5 meses** para producto comercializable.  
> **Principio:** Sin el núcleo duro (liquidación + cobranzas + portal) no hay producto. Los diferenciadores vienen después.

---

## 1. Principio de Priorización

```
┌─────────────────────────────────────────────────────────────┐
│  REGLA DE ORO:                                              │
│                                                              │
│  1. Cumplimiento legal > UX > Diferenciadores             │
│  2. Sin liquidación end-to-end → no hay producto          │
│  3. Sin cobranzas → no hay revenue                          │
│  4. Sin portal residente → no hay adopción                  │
│  5. Los diferenciadores (kanban, OCR, benchmarking) son      │
│     el "Trojan Horse" para adquisición, NO el core          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Fase 1: MVP (Meses 1-3)

### 2.1 Objetivo

Entregar un **ERP de consorcio funcional** que permita a una administradora:
1. Configurar un edificio completo con todas las tipologías.
2. Cargar gastos y liquidar expensas cumpliendo Ley 941.
3. Generar recibos con QR y matrícula RPA.
4. Cobrar vía MercadoPago.
5. Que los propietarios vean sus expensas en un portal web.

### 2.2 Timeline MVP

| Sprint | Duración | Entregable | Swarm acelera... |
|--------|----------|------------|------------------|
| **S0: Setup** | 2 sem | Docker Compose (PG+Redis+MinIO+Cerbos), Antigravity config, Swarm Node SDK, CheaperInference router | Terraform, Dockerfiles, modelos SQL, tests base |
| **S1: Modelo de datos** | 1.5 sem | Prisma schema, migraciones, seed data | Modelos SQLAlchemy, migraciones Alembic, validaciones |
| **S2: Motor contable** | 2 sem | Liquidación engine (NodeJS + decimal.js), distribución A/B/C, tests matemáticos | Tests unitarios exhaustivos, documentación, edge cases |
| **S3: Agentes Core** | 2 sem | Onboarding, Contable, Documental, Comunicador, Cobranzas | Flujos de carga, explicaciones de liquidación, componentes React |
| **S4: Portal Web** | 2 sem | React + shadcn/ui, dashboard admin, portal residente | Componentes React, conexión con API, UX patterns |
| **S5: Integraciones** | 1.5 sem | MercadoPago, AgentMail webhooks, WhatsApp API | Wrappers de APIs, manejo de errores, retry logic |
| **S6: Testing + Compliance** | 1 sem | E2E tests, validación Ley 941, seguridad | Casos de test, detección de vulnerabilidades, revisión compliance |

**Total MVP: 2.5 - 3 meses**

### 2.3 Features del MVP

#### MUST-HAVE (sin esto no hay producto)

- [ ] Gestión de unidades: deptos, locales, oficinas, cocheras, bauleras, subconsorcios
- [ ] Coeficientes de PH con categorías A/B/C
- [ ] Gestor de gastos con categorización y asignación
- [ ] Liquidación automática end-to-end
- [ ] Recibos con QR + matrícula RPA (Ley 941)
- [ ] Separación expensas ordinarias vs extraordinarias
- [ ] Cobros online (MercadoPago, QR, transferencia)
- [ ] Portal básico para copropietarios (ver expensas, informar pagos)
- [ ] Comunicaciones centralizadas (reemplazar WhatsApp caótico)
- [ ] Auth JWT + RBAC con Cerbos
- [ ] Multi-tenancy a nivel de organización (administración → N edificios)

#### NO INCLUIR EN MVP

- [ ] Kanban de tareas completo
- [ ] Importación inteligente de PDFs
- [ ] Dashboard de estadísticas avanzadas
- [ ] App móvil nativa
- [ ] Benchmarking
- [ ] Gestión personal del hogar
- [ ] Conciliación bancaria automática
- [ ] Sueldos CCT 589/10 SUTERH
- [ ] IA agéntica avanzada (solo wrapper del motor contable)

### 2.4 Métricas de éxito del MVP

| Métrica | Meta |
|---------|------|
| Edificios en beta | 5-10 |
| Liquidaciones sin errores matemáticos | 100% |
| Recibos con QR válidos | 100% |
| Tiempo de carga de gasto | <30 seg |
| Tiempo de generación de liquidación | <2 min |
| NPS administradores beta | >7 |

---

## 3. Fase 2: Diferenciadores (Meses 4-5.5)

### 3.1 Objetivo

Agregar los **diferenciadores clave** que ningún competidor tiene, validados con feedback del MVP.

### 3.2 Timeline Fase 2

| Sprint | Duración | Entregable | Swarm acelera... |
|--------|----------|------------|------------------|
| **S7: Kanban + Dashboard** | 2 sem | Kanban con estados, comunicación integrada, estadísticas | Clasifica tickets automáticamente, narra insights, detecta anomalías |
| **S8: Importación inteligente** | 2 sem | Upload PDFs de expensas, preview, tabulación dinámica | **Parsing de PDFs, mapeo de conceptos, discovery** |
| **S9: App Móvil** | 3 sem | React Native, notificaciones push | Screens, conexión con API, UX mobile-first |
| **S10: Benchmarking base** | 1.5 sem | Primeros KPIs comparativos, agregación anonimizada | Análisis de patrones, reportes narrativos |
| **S11: Deploy AWS + Polish** | 1.5 sem | ECS/Fargate, RDS, ElastiCache, optimización de tokens | Auditoría de costos, sugerencias de caching |

**Total Fase 2: 2 - 2.5 meses**

### 3.3 Features de Fase 2

- [ ] Kanban de tareas con estados y flujo de comunicación integrado
- [ ] Comunicación solicitante↔consorcio dentro del kanban
- [ ] Importación inteligente de PDFs de expensas (discovery + normalización)
- [ ] Preview interactivo de PDFs antes de confirmar carga
- [ ] Tabulación dinámica de conceptos (pre-existentes + nuevos)
- [ ] Dashboard de estadísticas para la administradora
- [ ] Reporte mensual automático (tareas finalizadas, pendientes, nuevas)
- [ ] App móvil nativa (React Native) para admin y residentes
- [ ] Notificaciones push
- [ ] Benchmarking base: costos por m², KPIs comparativos

### 3.4 Métricas de éxito de Fase 2

| Métrica | Meta |
|---------|------|
| Edificios activos | 100 |
| Tickets Kanban resueltos/mes | 500 |
| PDFs importados correctamente | >90% |
| Usuarios de app móvil | 500 |
| NPS | >8 |

---

## 4. Fase 3: Expansión (Meses 6-12)

### 4.1 Objetivo

Escalar con **gestión personal del hogar**, **benchmarking avanzado** e **IA agéntica**.

### 4.2 Features de Fase 3

- [ ] Gestión personal del hogar (alquiler, servicios, suscripciones, seguros, impuestos)
- [ ] Extracción automática de impuestos desde servicios (DReI, API, IIBB, Tasas, IVA)
- [ ] Dashboard de costos de vivienda personal
- [ ] Benchmarking avanzado con datos agregados y anonimizados
- [ ] IA agéntica (WhatsApp bot, OCR avanzado, conciliación bancaria)
- [ ] Sueldos CCT 589/10 con integración AFIP/ARCA
- [ ] API pública para integraciones de terceros
- [ ] White-label para estudios contables y aseguradoras

### 4.3 Métricas de éxito de Fase 3

| Métrica | Meta |
|---------|------|
| Edificios activos | 500 |
| Habitantes usando gestión personal | 2.000 |
| Revenue mensual | $80.000-120.000 |
| Margen operativo | >70% |

---

## 5. Roadmap Visual

```
Mes:  1    2    3    4    5    6    7    8    9    10   11   12
      ├────┴────┤    ├────┴────┤    ├────────────────────────┤
      │   MVP    │    │  Fase 2 │    │       Fase 3         │
      │  (2.5-3m)│    │ (2-2.5m)│    │      (6 meses)       │
      ├──────────┤    ├─────────┤    ├──────────────────────┤
      │ S0: Setup│    │ S7: Kanban│   │ Gestión personal    │
      │ S1: DB   │    │ S8: OCR  │    │ Benchmarking avanz. │
      │ S2: Motor│    │ S9: App  │    │ IA agéntica          │
      │ S3: Agentes│  │ S10: Bench│   │ Sueldos SUTERH       │
      │ S4: Portal│   │ S11: AWS │    │ API pública          │
      │ S5: Integr.│  └─────────┘    │ White-label          │
      │ S6: Test  │                  └──────────────────────┘
      └──────────┘
           ▼
      Beta 5-10 edificios
           ▼
      Release público (Mes 5.5)
```

---

## 6. Dependencias Críticas

| Dependencia | Bloquea | Mitigación |
|-------------|---------|------------|
| Motor contable (S2) | Todo el MVP | Prioridad máxima, tests exhaustivos |
| Cerbos policies (S0) | Todo el RBAC | Definir roles en semana 1 |
| Prisma schema (S1) | Todos los módulos | Diseñar con extensibilidad para Fase 2 |
| AgentMail setup (S0) | Comunicaciones | Configurar dominio y webhooks temprano |
| MercadoPago (S5) | Cobranzas | Sandbox desde semana 1 |

---

## 7. Recursos por Fase

### MVP (Meses 1-3)

| Rol | FTE | Meses | Costo |
|-----|-----|-------|-------|
| Tech Lead | 1.0 | 3 | $18.000 |
| Backend (NodeJS) | 1.0 | 3 | $13.500 |
| Frontend (React) | 1.0 | 3 | $12.000 |
| DevOps | 0.5 | 3 | $6.000 |
| UX/UI | 0.5 | 2 | $3.000 |
| **Subtotal** | | | **$52.500** |

### Fase 2 (Meses 4-5.5)

| Rol | FTE | Meses | Costo |
|-----|-----|-------|-------|
| Tech Lead | 1.0 | 2 | $12.000 |
| Backend | 1.0 | 2 | $9.000 |
| Frontend | 1.0 | 2 | $8.000 |
| DevOps | 0.5 | 2 | $4.000 |
| Mobile (React Native) | 0.5 | 2 | $3.000 |
| **Subtotal** | | | **$36.000** |

### Fase 3 (Meses 6-12)

| Rol | FTE | Meses | Costo |
|-----|-----|-------|-------|
| Tech Lead | 1.0 | 6 | $36.000 |
| Backend | 1.0 | 6 | $27.000 |
| Frontend | 1.0 | 6 | $24.000 |
| DevOps | 0.5 | 6 | $12.000 |
| Mobile | 0.5 | 4 | $6.000 |
| QA | 0.5 | 3 | $4.500 |
| **Subtotal** | | | **$109.500** |

**Total desarrollo 12 meses: ~$198.000 USD** (con Antigravity: ~$150.000)

---

## 8. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **MVP sin kanban** | El kanban es diferenciador, no core | Sin liquidación no hay producto. Kanban puede esperar. |
| **MVP sin app móvil** | Portal web responsive es suficiente | App nativa duplica costos y tiempo. PWA como intermediario. |
| **MVP sin OCR** | Carga manual de gastos | OCR es diferenciador Fase 2. MVP: carga manual + sugerencias del agente Contable. |
| **NodeJS en vez de Python** | Cambio desde Python/FastAPI | Mismo lenguaje frontend, mejor para webhooks, Antigravity genera mejor código Node. |
| **Nemotron en vez de Kimi API solo** | Costos de tokens | 85-95% más barato. A escala, la diferencia es $20.000 vs $500/mes. |

---

*Documento relacionado:* [[PRD-01-01 Visión del Producto]]  
*Documento relacionado:* [[PRD-01-03 Modelo de Negocio]]  
*Documento relacionado:* [[PRD-02-01 Arquitectura General]]
