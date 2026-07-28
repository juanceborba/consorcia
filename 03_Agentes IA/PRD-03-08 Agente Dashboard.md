---
title: "PRD-03-08: Agente Dashboard"
description: "Especificación del agente especializado en análisis de datos, generación de insights narrativos, detección de anomalías y reportes mensuales automáticos para la administradora."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P1"
tags: [agente, dashboard, analytics, insights, anomalias, reportes, swarm, consorcIA]
outcomes:
  - "Definir métricas y KPIs que el agente monitorea"
  - "Especificar algoritmos de detección de anomalías"
  - "Diseñar generación de narrativas automáticas"
  - "Establecer reporte mensual automático"
  - "Documentar integración con el motor contable y kanban"
---

# PRD-03-08: Agente Dashboard

> **El Agente Dashboard es el analista de datos del consorcio. No solo muestra números: los interpreta, detecta patrones, alerta sobre anomalías y genera reportes narrativos que una administradora puede entender y actuar en segundos.**

---

## 1. Responsabilidades

### 1.1 Scope del agente

| Responsabilidad | Sí/No | Detalle |
|-----------------|-------|---------|
| Calcular KPIs mensuales | ✅ | Gasto total, gasto por UF, morosidad, etc. |
| Detectar anomalías | ✅ | Comparativa mes a mes, año a año |
| Generar narrativas | ✅ | Texto en lenguaje natural explicando los datos |
| Crear reporte mensual | ✅ | PDF automático con resumen ejecutivo |
| Sugerir acciones | ✅ | "El gasto de luz subió 30% → revisar contrato" |
| Predecir tendencias | ⚠️ | Proyección simple (3 meses) basada en histórico |
| Comparar con benchmarking | ⚠️ | Delega al Agente Benchmarking (Fase 3) |
| Modificar datos | ❌ | Solo lectura. Nunca escribe en DB. |
| Aprobar gastos | ❌ | Solo lectura. No toma decisiones operativas. |

### 1.2 Límites explícitos

- **Solo lectura.** El agente nunca modifica datos del consorcio. Es un observador, no un actor.
- **No reemplaza al contador.** Las sugerencias son informativas, no vinculantes.
- **Datos scopeados por organización y edificio.** No puede ver datos de otros edificios para benchmarking (eso lo hace el Agente Benchmarking con datos anonimizados).

---

## 2. Métricas y KPIs Monitoreados

### 2.1 KPIs financieros

| KPI | Fórmula | Frecuencia | Umbral de alerta |
|-----|---------|------------|------------------|
| **Gasto total mensual** | Σ gastos del mes | Mensual | >20% vs mes anterior |
| **Gasto por UF** | Gasto total / n UF | Mensual | >15% vs mes anterior |
| **Gasto por m²** | Gasto total / m² totales | Mensual | >15% vs mes anterior |
| **Morosidad** | UF con deuda / UF total | Mensual | >10% |
| **Cobranza efectiva** | Cobrado / Liquidado | Mensual | <90% |
| **Ratio ord/ext** | Ordinarias / Extraordinarias | Mensual | Ext >30% del total |
| **Variación interanual** | (Mes actual - Mes año pasado) / Mes año pasado | Mensual | >25% |

### 2.2 KPIs operativos

| KPI | Fórmula | Frecuencia | Umbral de alerta |
|-----|---------|------------|------------------|
| **Tickets abiertos** | Count(estado ≠ cerrado) | Diario | >20% del promedio |
| **SLA cumplido** | Tickets resueltos a tiempo / Total | Semanal | <80% |
| **Tiempo promedio de resolución** | AVG(fecha cierre - fecha creación) | Semanal | >SLA configurado |
| **Tickets por categoría** | Count por categoría | Mensual | Anomalía si cambia >50% |
| **Satisfacción (NPS)** | Encuestas post-cierre | Mensual | <7 |

### 2.3 KPIs de adopción

| KPI | Fórmula | Frecuencia |
|-----|---------|------------|
| **Residentes activos** | UF con login en el mes / Total UF | Mensual |
| **Tasa de apertura de emails** | Emails abiertos / Emails enviados | Por campaña |
| **Uso del portal** | Sesiones / UF activas | Semanal |

---

## 3. Detección de Anomalías

### 3.1 Tipos de anomalía detectadas

```
Anomalías:
├── Financieras
│   ├── Gasto inesperado (concepto nuevo, monto atípico)
│   ├── Suba brusca de un servicio (luz, gas, agua)
│   ├── Morosidad concentrada en pocas UF
│   └── Desbalance ord/ext (demasiadas extraordinarias)
├── Operativas
│   ├── Tickets acumulados sin resolución
│   ├── SLA recurrentemente incumplido
│   └── Categoría de ticket inusualmente alta
├── De adopción
│   ├── Caída de uso del portal
│   └── Baja tasa de apertura de comunicados
└── De datos
    ├── Coeficientes que no suman 100%
    └── UF sin expensas asignadas
```

### 3.2 Algoritmo de detección

```
Para cada KPI:
  1. Calcular media móvil de los últimos 6 meses
  2. Calcular desvío estándar (σ)
  3. Si valor actual > media + 2σ → ANOMALÍA MEDIA
  4. Si valor actual > media + 3σ → ANOMALÍA ALTA
  5. Si valor actual < media - 2σ → ANOMALÍA MEDIA (caída)
  6. Si concepto nuevo y monto > umbral → ANOMALÍA ALTA
```

### 3.3 Ejemplos de alertas generadas

| Condición | Alerta generada | Severidad |
|-----------|-----------------|-----------|
| Gasto de luz subió 35% vs mes anterior | "El gasto de electricidad aumentó un 35% respecto a junio. Revisar si hubo aumento tarifario o fuga." | Media |
| 5 UF concentran el 60% de la morosidad | "El 60% de la deuda corresponde a 5 unidades. Sugerir contacto personalizado." | Alta |
| Tickets de mantenimiento +200% | "Los reclamos de mantenimiento se duplicaron. Posible problema estructural." | Alta |
| Coeficientes suman 99.8% | "Los coeficientes no suman 100%. Revisar reglamento de PH." | Crítica |

---

## 4. Generación de Narrativas

### 4.1 Prompt template para narrativas

```
Contexto: Sos el analista de datos de un consorcio. Tenés que explicarle
a la administradora, en 3-5 oraciones claras, qué pasó este mes.

Datos del mes:
- Gasto total: $X (variación Y% vs mes anterior, Z% vs mismo mes año pasado)
- Top 3 gastos: [lista]
- Morosidad: X%
- Tickets resueltos: X de Y
- Anomalías detectadas: [lista]

Instrucciones:
1. Empezar con el dato más importante.
2. Mencionar solo anomalías reales (no ruido).
3. Sugerir una acción concreta.
4. Usar lenguaje profesional pero accesible.
5. No usar jerga técnica.
```

### 4.2 Ejemplo de narrativa generada

```
📊 Resumen de Julio 2026 — Edificio Corrientes 1234

El gasto total del mes fue de $2.450.000, un 12% más que en junio,
principalmente por una reparación de $180.000 en la bomba de agua.
Sin ese gasto extraordinario, el aumento hubiera sido del 4%, dentro
de lo esperado por inflación.

La morosidad se mantiene estable en 8%, por debajo del umbral de alerta.
Se resolvieron 14 de 16 tickets pendientes (87% de SLA cumplido).

⚠️ Alerta: El gasto de electricidad subió un 22% respecto al mes pasado.
Recomendamos revisar el contrato con Edenor y verificar que no haya
fugas en las instalaciones comunes.

💡 Acción sugerida: Programar inspección de instalaciones eléctricas
para agosto.
```

---

## 5. Reporte Mensual Automático

### 5.1 Contenido del reporte

```
REPORTE MENSUAL — [Nombre Edificio] — [Mes/Año]

1. RESUMEN EJECUTIVO (narrativa del Agente Dashboard)
2. ESTADO FINANCIERO
   2.1 Gastos del mes (tabla + gráfico)
   2.2 Comparativa mes a mes (6 meses)
   2.3 Comparativa año a año
   2.4 Distribución A/B/C
3. ESTADO DE COBRANZAS
   3.1 Total liquidado vs cobrado
   3.2 Morosidad por UF
   3.3 Planes de pago activos
4. ESTADO DE TAREAS
   4.1 Tickets creados, resueltos, pendientes
   4.2 SLA cumplido/incumplido
   4.3 Categorías de tickets
5. ANOMALÍAS Y ALERTAS
   5.1 Lista de anomalías detectadas
   5.2 Acciones sugeridas
6. PRÓXIMOS PASOS
   6.1 Tareas recomendadas para el mes siguiente
   6.2 Vencimientos importantes
```

### 5.2 Distribución automática

- **Admin:** Recibe el reporte completo vía email (AgentMail) el día 5 de cada mes.
- **Consejo de Propietarios:** Recibe versión resumida (sin detalle por UF) el mismo día.
- **Portal:** Disponible para descarga en PDF desde el dashboard del admin.

---

## 6. Integración con otros agentes

| Agente | Datos recibidos | Uso |
|--------|-----------------|-----|
| **Contable** | Gastos, liquidaciones, cobros | KPIs financieros |
| **Kanban** | Tickets, estados, SLAs | KPIs operativos |
| **Cobranzas** | Pagos, morosidad, planes | KPIs de cobranza |
| **Benchmarking** | Datos agregados anonimizados | Comparativas de mercado (Fase 3) |
| **Comunicador** | Narrativas generadas | Envía reportes por email |

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Modelo para narrativas** | Nemotron Super 49B | Requiere reasoning para interpretar datos correctamente |
| **Frecuencia de reporte** | Mensual (día 5) | Da tiempo a cerrar el mes contablemente |
| **Solo lectura** | Sí | El agente nunca modifica datos. Previene alucinaciones destructivas. |
| **Umbral de anomalía** | 2σ (media) / 3σ (alta) | Balance entre sensibilidad y ruido |
| **Narrativas en español** | Sí | Mercado argentino. Modelo multilingüe de Nemotron funciona bien. |
| **Reporte en PDF** | Generado por backend | El agente genera el contenido, el backend arma el PDF. |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-03-03 Agente Contable]]  
*Documento relacionado:* [[PRD-03-07 Agente Kanban]]  
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]