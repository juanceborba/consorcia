---
title: "PRD-04-08: Dashboard Administrador"
description: "Especificación del panel de control para administradoras: métricas financieras, operativas y de adopción, con visualizaciones interactivas, alertas y reportes exportables."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [dashboard, admin, metricas, charts, visualizacion, analytics, consorcIA, fase2]
outcomes:
  - "Definir KPIs y métricas del dashboard por categoría"
  - "Especificar componentes de visualización y filtros"
  - "Diseñar sistema de alertas y notificaciones en tiempo real"
  - "Establecer reportes exportables (PDF, Excel)"
  - "Documentar integración con Agente Dashboard"
---

# PRD-04-08: Dashboard Administrador

> **El Dashboard Administrador es el centro de comando de la administradora. Muestra el estado financiero, operativo y de adopción del consorcio en tiempo real, con alertas proactivas y la capacidad de exportar cualquier vista a PDF o Excel.**

---

## 1. Visión General

### 1.1 Layout del dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  CONSORCIA — Dashboard                    [🔔 3] [👤 María G.] │
├─────────────────────────────────────────────────────────────────┤
│  Selector: [Edificio Corrientes 1234 ▼]  [Julio 2026 ▼]        │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ Gasto Total│ │ Cobrado    │ │ Morosidad  │ │ Tickets    │   │
│  │ $2.450.000 │ │ $2.100.000 │ │ 8%         │ │ 16 (2⚠️)   │   │
│  │ ▲ 12% vs   │ │ ▲ 5% vs    │ │ ▼ 2pp vs   │ │ ▼ 3 vs     │   │
│  │   junio    │ │   junio    │ │   junio    │ │   junio    │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ Evolución de Gastos      │  │ Distribución A/B/C       │    │
│  │ [Line chart: 6 meses]    │  │ [Pie chart]              │    │
│  │                          │  │                          │    │
│  │                          │  │  A: 78%  B: 15%  C: 7%   │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ Gastos por Categoría     │  │ Morosidad por UF         │    │
│  │ [Bar chart: top 10]      │  │ [Table + heatmap]        │    │
│  │                          │  │                          │    │
│  │ Luz: $245K               │  │ UF 3B: $45K 🔴           │    │
│  │ Agua: $89K               │  │ UF 5A: $32K 🟠           │    │
│  │ ABL: $156K               │  │ UF 2C: $12K 🟡           │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ Tickets por Estado       │  │ Actividad Reciente       │    │
│  │ [Kanban mini]            │  │ [Timeline]               │    │
│  │                          │  │                          │    │
│  │ Nuevo: 3  Prog: 5        │  │ 14:30 Liquidación generada│   │
│  │ Resuelto: 8  Cerrado: 45 │  │ 11:00 Ticket #234 resuelto│   │
│  └──────────────────────────┘  └──────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  [📥 Exportar PDF]  [📥 Exportar Excel]  [🤖 Narrativa IA]    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Métricas por Categoría

### 2.1 Métricas financieras

| Métrica | Cálculo | Frecuencia de actualización | Alerta |
|---------|---------|----------------------------|--------|
| **Gasto total del mes** | Σ gastos | Tiempo real (al cargar gasto) | >20% vs mes anterior |
| **Gasto por UF** | Gasto total / n UF | Tiempo real | >15% vs mes anterior |
| **Gasto por m²** | Gasto total / m² totales | Tiempo real | >15% vs mes anterior |
| **Total liquidado** | Σ expensas ordinarias + extraordinarias | Al generar liquidación | — |
| **Total cobrado** | Σ pagos registrados | Tiempo real (al registrar pago) | <90% del liquidado |
| **Morosidad** | Deuda total / Liquidado total | Tiempo real | >10% |
| **Deuda por UF** | Σ deuda de cada UF | Tiempo real | UF con >3 meses de deuda |
| **Ratio ord/ext** | Extraordinarias / Total | Al generar liquidación | Ext >30% |
| **Variación interanual** | (Actual - Año pasado) / Año pasado | Mensual | >25% |

### 2.2 Métricas operativas

| Métrica | Cálculo | Frecuencia | Alerta |
|---------|---------|------------|--------|
| **Tickets abiertos** | Count(estado ≠ cerrado) | Tiempo real | >20% del promedio |
| **Tickets vencidos** | Count(SLA vencido) | Tiempo real | >0 |
| **SLA cumplido** | Resueltos a tiempo / Total resueltos | Semanal | <80% |
| **Tiempo promedio resolución** | AVG(cierre - creación) | Semanal | >SLA configurado |
| **Tickets por categoría** | Count por categoría | Mensual | Cambio >50% vs mes anterior |
| **Satisfacción (NPS)** | Promedio encuestas post-cierre | Mensual | <7 |

### 2.3 Métricas de adopción

| Métrica | Cálculo | Frecuencia |
|---------|---------|------------|
| **Residentes activos** | UF con login en el mes / Total | Mensual |
| **Tasa de apertura de emails** | Emails abiertos / Enviados | Por campaña |
| **Uso del portal** | Sesiones / UF activas | Semanal |
| **App instalada** | UF con app / Total UF (Fase 2) | Mensual |
| **Notificaciones push leídas** | Push abiertos / Push enviados | Semanal |

---

## 3. Componentes de Visualización

### 3.1 Charts implementados

| Chart | Librería | Uso | Interactividad |
|-------|----------|-----|----------------|
| **Line chart** | Recharts | Evolución temporal (6-12 meses) | Hover para tooltip, zoom |
| **Bar chart** | Recharts | Comparativas por categoría | Click para drill-down |
| **Pie chart** | Recharts | Distribución A/B/C, % ord/ext | Hover para detalle |
| **Heatmap** | Custom (CSS Grid) | Morosidad por UF | Click para ver detalle UF |
| **Area chart** | Recharts | Acumulado de cobros vs liquidado | Hover para valores |
| **Radar chart** | Recharts | Benchmarking multidimensional (F3) | Comparativa con promedio |
| **Table** | TanStack Table | Listados detallados | Sort, filter, paginate |

### 3.2 Filtros globales

```typescript
interface DashboardFilters {
  edificioId: string;           // Selector de edificio (multi-edificio en Business+)
  periodo: {
    tipo: 'mes' | 'trimestre' | 'anio' | 'custom';
    mes?: number;
    anio?: number;
    desde?: Date;
    hasta?: Date;
  };
  comparativa: 'mes_anterior' | 'mismo_mes_anio_pasado' | 'promedio_6m' | 'ninguna';
  categoria?: string;           // Filtrar por categoría de gasto
  uf?: string;                  // Filtrar por unidad funcional
}
```

---

## 4. Alertas y Notificaciones

### 4.1 Tipos de alerta

| Tipo | Color | Icono | Ejemplo |
|------|-------|-------|---------|
| **Crítica** | 🔴 Rojo | 🚨 | "Morosidad superó el 15%" |
| **Advertencia** | 🟠 Naranja | ⚠️ | "Gasto de luz subió 30%" |
| **Info** | 🔵 Azul | ℹ️ | "Reporte mensual disponible" |
| **Éxito** | 🟢 Verde | ✅ | "Liquidación generada correctamente" |

### 4.2 Centro de notificaciones

```
┌─────────────────────────────────────────┐
│  🔔 Notificaciones (3 no leídas)        │
├─────────────────────────────────────────┤
│  🚨 Crítica  hace 2h                    │
│  Morosidad del edificio alcanzó el 15%  │
│  [Ver detalle]                          │
├─────────────────────────────────────────┤
│  ⚠️ Advertencia  hace 5h                │
│  El gasto de electricidad subió un 30%  │
│  respecto al mes pasado                 │
│  [Ver detalle]                          │
├─────────────────────────────────────────┤
│  ✅ Info  hace 1d                       │
│  Reporte mensual de julio generado      │
│  [Descargar PDF]                        │
└─────────────────────────────────────────┘
```

### 4.3 Configuración de alertas

```typescript
interface AlertaConfig {
  edificioId: string;
  alertas: {
    tipo: 'morosidad' | 'gasto' | 'sla' | 'ticket' | 'adopcion';
    umbral: number;
    operador: '>' | '<' | '==';
    frecuencia: 'inmediata' | 'diaria' | 'semanal';
    canales: ('email' | 'push' | 'dashboard')[];
    activa: boolean;
  }[];
}
```

---

## 5. Exportaciones

### 5.1 Exportar a PDF

- **Contenido:** Vista actual del dashboard (respetando filtros aplicados).
- **Formato:** A4, orientación landscape para charts anchos.
- **Generación:** Backend genera PDF con Puppeteer/Playwright (headless Chrome).
- **Tiempo:** <10 segundos.

### 5.2 Exportar a Excel

- **Contenido:** Datos tabulares subyacentes a cada chart.
- **Formato:** .xlsx con múltiples hojas (Gastos, Cobros, Tickets, etc.).
- **Generación:** Backend con librería `xlsx` (NodeJS).
- **Tiempo:** <5 segundos.

### 5.3 Narrativa IA

- **Botón "🤖 Narrativa IA"** en cada sección del dashboard.
- Al hacer click, el Agente Dashboard genera un párrafo explicando los datos visibles.
- Ejemplo: "En julio, el gasto total fue de $2.450.000, un 12% más que en junio. El principal impulsor fue una reparación extraordinaria de $180.000..."

---

## 6. Integración con Agente Dashboard

| Función | Agente Dashboard | Frontend |
|---------|------------------|----------|
| Calcular KPIs | ✅ (orquesta queries) | Renderiza charts |
| Detectar anomalías | ✅ (algoritmo + LLM) | Muestra alertas |
| Generar narrativas | ✅ (Nemotron Super 49B) | Muestra texto |
| Crear reporte mensual | ✅ (genera contenido) | Backend arma PDF |
| Sugerir acciones | ✅ (basado en datos) | Muestra como tooltip |

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Librería de charts** | Recharts | Nativa React, simple, suficiente para el MVP. |
| **Actualización** | Tiempo real (WebSocket/SSE) | Los gastos y pagos impactan inmediatamente. |
| **Filtros persistentes** | LocalStorage | El admin retoma donde dejó al recargar. |
| **Exportación PDF** | Puppeteer headless | Fidelidad visual perfecta. |
| **Narrativa IA** | Por sección, no por dashboard completo | Reduce tokens y mejora relevancia. |
| **Responsive** | Sí, hasta tablet | El admin puede revisar desde tablet en reuniones. |
| **Multi-edificio** | Business+ | Starter/Pro ven un edificio a la vez. |

---

*Documento relacionado:* [[PRD-03-08 Agente Dashboard]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-04-06 Kanban de Tareas]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]  
*Documento relacionado:* [[PRD-07-02 Diseño de Componentes]]