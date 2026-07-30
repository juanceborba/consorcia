---
title: "PRD-01-01: Visión del Producto"
description: "Propuesta de valor, mercado objetivo, diferenciadores estratégicos y veredicto de viabilidad de ConsorcIA."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [vision, producto, mercado, consorcIA, diferenciador, viabilidad]
outcomes:
  - "Comprender el mercado argentino de software para consorcios (300K+ consorcios, 71% con <10 UF)"
  - "Identificar 5 diferenciadores que ningún competidor tiene"
  - "Validar viabilidad técnica y económica del proyecto"
  - "Definir el positioning frente a ConsorcioAbierto, Adminia, CONSO, Octopus"
  - "Establecer el principio rector: ERP de consorcio primero, diferenciadores después"
---

# PRD-01-01: Visión del Producto

> **ConsorcIA** es una plataforma de gestión de consorcios potenciada por IA que combina un ERP de consorcio completo, una app de gestión personal del hogar y un motor de benchmarking de costos. Su stack tecnológico revolucionario reduce los costos operativos en un 70-85% respecto a la competencia.

---

## 1. El Problema

### 1.1 Contexto del mercado argentino

| Indicador | Dato |
|-----------|------|
| Consorcios en CABA | **122.561** |
| Unidades funcionales en CABA | **1.601.806** |
| Administradores activos en CABA | **9.428** |
| Promedio UF por consorcio | **13.1** |
| Consorcios con 1-10 UF | **71%** |
| Consorcios con 11-20 UF | **14.6%** |
| Estimación total Argentina | **~300.000-350.000 consorcios** |

### 1.2 Estado de digitalización

- La **mayoría de administradores** trabaja con **Excel + WhatsApp manual**.
- Los que usan software se dividen entre **ConsorcioAbierto** y **AdminProp**.
- Un administrador con 8 edificios y 30 UF promedio = **240 propietarios** respondiendo por WhatsApp.
- **Ley 5983 CABA** obliga plataforma web oficial para administradores a título oneroso.

### 1.3 Dolores identificados

1. **Comunicación caótica:** WhatsApp sin trazabilidad, reclamos perdidos, falta de historial.
2. **Liquidación manual:** Excel propenso a errores, recibos sin QR, incumplimiento Ley 941.
3. **Cobranzas ineficientes:** Sin links de pago, conciliación manual, morosidad alta.
4. **Falta de transparencia:** Propietarios no entienden en qué se gastan sus expensas.
5. **Sin benchmarking:** No hay forma de comparar costos entre edificios similares.
6. **Gestión personal ausente:** Habitantes no tienen herramientas para entender su costo de vida real.

---

## 2. La Propuesta

### 2.1 Producto dual: ERP + Gestión Personal

```
┌─────────────────────────────────────────────────────────────┐
│                    CONSORCIA PLATFORM                        │
├─────────────────────────────┬───────────────────────────────┤
│    ERP DE CONSORCIO         │   GESTIÓN PERSONAL DEL HOGAR   │
│    (B2B - Admin paga)       │   (B2C - Habitante gratis)     │
├─────────────────────────────┼───────────────────────────────┤
│ • Gestión de edificios      │ • Seguimiento de expensas      │
│ • Gestor de gastos          │ • Costos de vivienda           │
│ • Liquidación expensas      │ • Servicios (luz, gas, agua)   │
│ • Cobranzas (MP, QR)        │ • Suscripciones (Netflix, etc) │
│ • Kanban de tareas          │ • Alquileres externos          │
│ • Dashboard admin           │ • Seguros                      │
│ • Importación inteligente   │ • Impuestos (DReI, API, IIBB)  │
│ • Comunicaciones (email)    │ • Dashboard personal           │
│ • Reportes mensuales        │                                │
├─────────────────────────────┴───────────────────────────────┤
│              BENCHMARKING (datos agregados)                  │
│    Costos por m², KPIs comparativos, insights macro          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Diferenciadores que NADIE tiene 🔴

| Feature | ConsorcIA | ¿Quién lo tiene? |
|---------|-----------|------------------|
| **Gestión personal del hogar** | Sí | **NADIE** |
| **Dashboard de benchmarking** | Sí | **NADIE** |
| **Kanban con flujo de comunicación** | Sí | Parcial (Adminia tiene ADA en WhatsApp) |
| **Importación inteligente de PDFs** | Sí | **NADIE** |
| **Gestión de impuestos desde servicios** | Sí | **NADIE** |
| **Agentes IA orquestados (Swarm)** | Sí | Adminia (ADA), CONSO (Copiloto) — parcial |
| **Costos de tokens 95% menores** | Sí | **NADIE** (Nemotron + CheaperInference) |

### 2.3 Modelo de negocio sugerido

**Freemium B2B2C:**

- **Administradora paga** por el módulo de gestión del consorcio (SaaS por edificio).
- **Habitantes acceden gratis** a su módulo de gestión personal del hogar.
- **Habitantes pueden pagar** por features premium (análisis avanzado, comparativas).
- **Benchmarking** como producto de datos B2B (desarrolladores, inversores, aseguradoras).

**Pricing de referencia:**

| Segmento | Precio de referencia |
|----------|---------------------|
| ConsorcioAbierto | ARS 800-1.400/UF |
| Adminia (30 UF) | ARS 55-70K/edificio |
| CONSO | ARS 2.950/UF/mes |
| Octopus | Premium ($$$) |

**Pricing sugerido ConsorcIA** (los planes se contratan a nivel organización; el precio se calcula por edificio adherido):

| Plan | Precio | Incluye |
|------|--------|---------|
| **Starter** | Gratis | 1 organización, 1 edificio, hasta 10 UF, funciones básicas |
| **Pro** | ARS 45-60K/edificio/mes | Hasta 30 UF, liquidación completa, portal residente |
| **Business** | ARS 80-120K/edificio/mes | Hasta 60 UF, multi-edificio, kanban, OCR |
| **Módulo personal** | ARS 2.500-4.000/habitante/año | Opcional, features premium |

---

## 3. Roles del Sistema

### 3.1 Roles principales

| Rol | Descripción | Acceso |
|-----|-------------|--------|
| **Administración/Estudio (Organización)** | Cliente del SaaS: contrata el plan y gestiona N edificios. Los roles de staff son **org_admin** (dueño/configuración) y **gestor** (operador de edificios) | Full multi-edificio |
| **Administrador** | Persona responsable que opera dentro de una organización: gestiona el consorcio, carga gastos, liquida expensas | Full |
| **Propietario** | Dueño de la UF, recibe expensas, paga, consulta | Portal + app |
| **Inquilino (Habitante)** | Vive en la UF, recibe info, genera solicitudes | Portal + app |
| **Consejo de Propietarios** | Órgano de control, accede a reportes (art. 2064 CCyC) | Reportes |
| **Encargado** | Accede a órdenes de trabajo, tareas asignadas | Tareas |
| **Proveedor/Contratista** | Carga facturas, seguimiento de pagos | Portal limitado |

### 3.2 Roles adicionales (según CCyC)

- **Usufructuarios / Titulares de derecho real de uso** — obligados al pago (art. 2050 CCyC).
- **Subadministrador** — en edificios con sectores independientes (art. 2068 CCyC).

---

## 4. Veredicto de Viabilidad

### 4.1 Fortalezas

1. **Diferenciador único:** Gestión personal del hogar = hook para habitantes. Potencial viralidad.
2. **Benchmarking:** Valioso para propietarios, inversores, desarrolladores. Posible modelo freemium.
3. **Kanban con trazabilidad:** Resuelve el dolor real de reclamos perdidos en WhatsApp.
4. **Importación inteligente:** Onboarding masivo para administradoras con carteras grandes.
5. **Costos operativos dominantes:** 70-85% menores que la competencia gracias al stack.

### 4.2 Debilidades / Riesgos

1. **Complejidad del producto:** Son DOS productos en uno. Duplica scope, tiempo y costos.
2. **Barrera regulatoria:** Cumplir Ley 941, Ley 14.701, normativa provincial es complejo.
3. **Competencia establecida:** ConsorcioAbierto tiene +12.000 consorcios. Cambiar de sistema es costoso.
4. **Modelo de monetización dual:** El modelo B2B ya está resuelto — paga la **organización** (administradora/estudio), suscripción por edificio adherido; el consorcio y el habitante no pagan en el modelo ERP B2B. Queda abierto el canal B2C (módulo personal Premium).
5. **Datos comparativos sensibles:** Benchmarking requiere datos reales. Privacidad crítica (Ley 25.326).

### 4.3 Oportunidades

- **71% de consorcios tienen <10 UF** — muchos usan Excel. Mercado subatendido.
- **Tendencia a la transparencia** — Ley 5983 obliga plataforma web.
- **IA como nivelador** — un agente IA bien hecho puede competir con plataformas maduras.
- **PropTech en crecimiento** — Mercado global USD 44.590M en 2026, CAGR 11.9%.

### 4.4 Amenazas

- **Plataforma oficial gratuita de CABA** (art. 23 Ley 5983) — básica pero puede satisfacer a consorcios pequeños.
- **Consolidación del mercado** — Adminia y CONSO crecen rápido con IA.
- **Crisis económica argentina** — volatilidad cambiaria, recorte de gastos en tecnología.

### 4.5 Veredicto Final

> **SÍ, VIABLE con condiciones.** El mercado es grande (300.000+ consorcios), está sub-digitado, y hay espacio para un jugador que combine cumplimiento legal impecable + UX moderna + diferenciadores reales.
>
> **Condición crítica:** Foco inicial en el ERP de consorcio (Fases 1-2). La gestión personal del hogar es el "Trojan Horse" para adquisición, pero sin el núcleo duro no hay producto.

---

## 5. Principio Rector

```
┌─────────────────────────────────────────────────────────────┐
│  PRINCIPIO RECTOR: ARQUITECTURA HÍBRIDA                      │
│                                                              │
│  Swarm orquesta flujos, conversa con usuarios, parsea       │
│  documentos y genera insights.                               │
│                                                              │
│  El núcleo contable es código determinístico.                │
│  Los agentes NO calculan expensas.                           │
│                                                              │
│  Esto no es una limitación — es un REQUISITO DE COMPLIANCE. │
│  La Ley 941 y el CCyC exigen precisión matemática.           │
│  Un LLM que "alucine" un coeficiente expone al consorcio   │
│  a reclamos judiciales.                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Stack backend** | NodeJS + Express | Mismo lenguaje que frontend, shared types, mejor para webhooks |
| **Orquestación IA** | Kimi3 Swarm | Router nativo, SDK Node disponible |
| **Modelos LLM** | Nemotron + CheaperInference | 85-95% más barato que Kimi API solo |
| **IDE** | Antigravity | 50-70% más rápido en desarrollo, gratis |
| **OCR** | baidu/Unlimited-OCR | One-shot parsing, self-hosted, $0 en tokens |
| **Email** | AgentMail | Diseñado para agentes, webhooks, labeling automático |
| **RBAC** | Cerbos | Políticas como código, ABAC, audit log, <1ms |
| **DB** | PostgreSQL + pgvector | Multi-tenant, RAG sin servicio adicional |
| **Frontend** | React 19 + Vite + shadcn/ui | Moderno, rápido, accesible, sin vendor lock-in |

---

## 7. Métricas de Éxito

| Métrica | MVP (Mes 4) | Fase 2 (Mes 7) | Año 1 |
|---------|-------------|----------------|-------|
| Edificios activos | 10 | 100 | 500 |
| Organizaciones | 5 | 20 | 50 |
| Propietarios registrados | 150 | 1.500 | 7.500 |
| Liquidaciones generadas | 10/mes | 100/mes | 500/mes |
| Tickets Kanban | 50/mes | 500/mes | 2.500/mes |
| Costo por edificio/mes | $200 | $100 | $50 |
| NPS administradores | >7 | >8 | >8.5 |

---

## 8. Glosario Rápido

| Término | Definición |
|---------|------------|
| **Organización** | Administración o estudio administrador de consorcios; cliente del SaaS. Una organización gestiona N edificios. |
| **UF** | Unidad Funcional (departamento, local, cochera) |
| **PH** | Propiedad Horizontal |
| **RPA** | Registro Público de Administradores (CABA) |
| **RPAC** | Registro Público de Administradores de Consorcios (PBA) |
| **Ordinarias** | Gastos regulares mensuales |
| **Extraordinarias** | Gastos no recurrentes (reparaciones, mejoras) |
| **Coeficiente** | Porcentaje de participación de cada UF |
| **Categoría A/B/C** | Criterios de distribución de gastos |

---

*Documento relacionado:* [[PRD-01-02 Estrategia de MVP y Fases]]  
*Documento relacionado:* [[PRD-01-03 Modelo de Negocio]]  
*Documento relacionado:* [[PRD-01-04 Análisis Competitivo]]
