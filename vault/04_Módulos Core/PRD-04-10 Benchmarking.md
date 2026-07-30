---
title: "PRD-04-10: Benchmarking"
description: "Especificación del módulo de inteligencia de mercado: agregación anonimizada de datos, KPIs comparativos, reportes por segmento y API de datos para terceros."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P2"
tags: [benchmarking, datos, mercado, analytics, api, b2b, consorcIA, fase3]
outcomes:
  - "Definir arquitectura de pipeline de datos anonimizados"
  - "Especificar KPIs comparativos por segmento de mercado"
  - "Diseñar reportes para administradoras e inversores"
  - "Establecer API pública de benchmarking con rate limiting"
  - "Documentar políticas de privacidad y consentimiento"
---

# PRD-04-10: Benchmarking

> **El módulo de Benchmarking transforma los datos operativos de miles de consorcios en inteligencia de mercado accionable. Es el único producto en Argentina que permite a una administradora saber si sus expensas son competitivas y a un inversor entender tendencias de mercado en tiempo real.**

---

## 1. Visión General

### 1.1 Concepto

```
DATOS OPERATIVOS (miles de edificios)
        │
        ▼
┌─────────────────────────────┐
│ Pipeline de Anonimización   │ → K-anonimidad, ruido diferencial,
│ (Agente Benchmarking)       │   eliminación de PII
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Base de Datos Agregada      │ → Solo métricas, nunca datos
│ (PostgreSQL + pgvector)     │   individuales
└─────────────┬───────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ Reportes │    │ API Pública  │
│ Internos │    │ (B2B)        │
└──────────┘    └──────────────┘
```

### 1.2 Diferenciador clave

| Feature | ConsorcIA | Competidores |
|---------|-----------|--------------|
| Benchmarking de expensas por m² | ✅ | ❌ |
| Comparativa por zona y antigüedad | ✅ | ❌ |
| KPIs de morosidad por segmento | ✅ | ❌ |
| API de datos para terceros | ✅ (F3) | ❌ |
| Reportes para inversores | ✅ (F3) | ❌ |
| Datos anonimizados con k-anonimidad | ✅ | N/A |

---

## 2. Pipeline de Datos

### 2.1 Ingesta

```
Fuente                          Frecuencia    Datos
─────────────────────────────────────────────────────────
Liquidaciones de expensas       Mensual       Gastos por categoría, total, ord/ext
Tickets de kanban               Tiempo real   Categorías, tiempos de resolución
Cobranzas                       Tiempo real   Montos cobrados, morosidad, planes de pago
Gastos por servicio             Mensual       Luz, gas, agua, limpieza, seguros
Importaciones inteligentes      Bajo demanda  Conceptos detectados, montos
```

### 2.2 Transformación y anonimización

```typescript
interface PipelineStep {
  step: 'pseudonimizacion' | 'agregacion' | 'validacion_k' | 'ruido_diferencial';
  descripcion: string;
}

// 1. PSEUDONIMIZACIÓN
// Eliminar: nombre edificio, dirección exacta, matrícula RPA,
// nombre admin, emails, teléfonos, nombres de propietarios

// 2. AGREGACIÓN
// Agrupar por: zona + antigüedad + amenities + tamaño
// Calcular: COUNT, AVG, MEDIAN, P25, P75, P90, STDDEV

// 3. VALIDACIÓN K-ANONIMIDAD
// Verificar que cada celda tenga ≥5 edificios
// Si no, no incluir en reporte

// 4. RUIDO DIFERENCIAL
// Agregar ruido Laplaciano (ε=1.0) para prevenir
// ataques de re-identificación por combinación de atributos
```

### 2.3 Ejemplo de transformación

```
DATOS CRUDOS (5 edificios en Palermo, 10-20 años, Medio):
  Edificio A: expensas $8.500/m², morosidad 5%, 25 UF
  Edificio B: expensas $9.200/m², morosidad 12%, 30 UF
  Edificio C: expensas $7.800/m², morosidad 8%, 20 UF
  Edificio D: expensas $8.900/m², morosidad 6%, 28 UF
  Edificio E: expensas $8.100/m², morosidad 15%, 22 UF

DATOS AGREGADOS (k=5):
  Segmento: Palermo | 10-20 años | Medio
  N edificios: 5
  Expensas/m²: AVG $8.500 | MEDIAN $8.500 | P25 $7.950 | P75 $9.050 | P90 $9.200
  Morosidad: AVG 9.2% | MEDIAN 8% | P25 5% | P75 13.5%
  UF promedio: 25
```

---

## 3. KPIs Comparativos

### 3.1 Métricas financieras

| KPI | Unidad | Segmentos | Frecuencia |
|-----|--------|-----------|------------|
| Expensas por m² | ARS/m² | Zona, antigüedad, amenities, tamaño | Mensual |
| Expensas ordinarias por m² | ARS/m² | Zona, antigüedad | Mensual |
| Expensas extraordinarias por m² | ARS/m² | Zona, antigüedad | Mensual |
| Gasto de limpieza por m² | ARS/m² | Zona, tamaño, frecuencia | Mensual |
| Gasto de electricidad por m² | ARS/m² | Zona, antigüedad, calefacción | Mensual |
| Gasto de agua por m² | ARS/m² | Zona, amenities | Mensual |
| Gasto de seguros por UF | ARS/UF | Zona, antigüedad, suma asegurada | Trimestral |
| Sueldos de encargado por UF | ARS/UF | Zona, horas, CCT | Trimestral |

### 3.2 Métricas operativas

| KPI | Unidad | Segmentos | Frecuencia |
|-----|--------|-----------|------------|
| Morosidad promedio | % | Zona, antigüedad, rango expensas | Mensual |
| Tickets de mantenimiento por UF | N/UF/mes | Zona, antigüedad | Mensual |
| Tiempo promedio de resolución | Horas | Zona, categoría | Mensual |
| SLA cumplido | % | Zona, tamaño | Mensual |
| Ratio ord/ext | % | Zona, antigüedad | Mensual |

### 3.3 Métricas de mercado

| KPI | Unidad | Segmentos | Frecuencia |
|-----|--------|-----------|------------|
| Precio de expensas vs valor m² | Ratio | Zona, antigüedad | Trimestral |
| Incidencia de expensas sobre alquiler | % | Zona, tamaño | Trimestral |
| Tasa de crecimiento de expensas | % mensual | Zona, antigüedad | Mensual |
| Concentración de gastos (top 3 categorías) | % | Zona | Mensual |

---

## 4. Reportes

### 4.1 Reporte para administradoras (gratis en plan Business+)

```
📊 Benchmarking — Tu Edificio vs Mercado — Julio 2026

SEGMENTO: Palermo | 10-20 años | Medio | 25 UF

EXPENSAS POR M²
  Tu edificio:     $8.500/m²
  Promedio mercado: $8.200/m²
  Mediana:         $7.900/m²
  Percentil:       62° (más caro que el 62% de edificios similares)

  💡 Tu edificio está un 3.6% por encima del promedio.
     Revisar: gasto de limpieza ($450/m² vs promedio $380/m²)

MOROSIDAD
  Tu edificio:     8%
  Promedio mercado: 11%
  Percentil:       35° ✅ (mejor que el promedio)

MANTENIMIENTO
  Tickets/UF/mes:  0.15
  Promedio:        0.22
  Percentil:       28° ✅ (menos reclamos que el promedio)

TOP 3 CATEGORÍAS DE GASTO (vs mercado)
  1. Luz:        28% (tu) vs 25% (mercado)
  2. Limpieza:   22% (tu) vs 18% (mercado) ⚠️
  3. ABL:        15% (tu) vs 16% (mercado)
```

### 4.2 Reporte para inversores (pago, trimestral)

```
📈 Informe de Mercado PropTech Argentina — Q3 2026

MUESTRA: 1.200 edificios | CABA + GBA | Todos los segmentos

TENDENCIAS CLAVE
• Expensas promedio: $8.200/m² (↑4.2% real ajustado por inflación)
• Segmento más caro: Puerto Madero ($15.200/m²)
• Segmento más barato: GBA Sur ($4.800/m²)
• Morosidad estable: 11% promedio

OPORTUNIDADES DE INVERSIÓN
• Edificios >40 años en Palermo: expensas 35% menores que nuevos
  → Potencial de renovación con aumento de valor
• 60% de edificios no tiene seguro de RC actualizado
  → Oportunidad para aseguradoras

RANKING POR ZONA (expensas/m², medianas)
  1. Puerto Madero  $15.200
  2. Recoleta       $12.800
  3. Belgrano       $11.500
  4. Palermo        $10.500
  5. Nuñez          $9.200
  ...

PROYECCIÓN Q4 2026
• Se espera aumento del 3-5% real en expensas por ajuste tarifario
• Morosidad podría subir al 13% por contexto económico
```

---

## 5. API Pública de Benchmarking

### 5.1 Endpoints

```
GET /api/v1/benchmarking/expensas
  Query params:
    - zona: string (ej: "palermo")
    - antiguedad: string (ej: "10-20")
    - amenities: string (ej: "medio")
    - tamaño: string (ej: "11-30")
    - metrica: "avg" | "median" | "p25" | "p75" | "p90"
  Response:
    {
      "segmento": "palermo|10-20|medio|11-30",
      "n_edificios": 23,
      "expensas_por_m2": 8500.00,
      "moneda": "ARS",
      "periodo": "2026-07",
      "confianza": "alta"  // alta: k≥20, media: k≥10, baja: k≥5
    }

GET /api/v1/benchmarking/morosidad
  // Similar, retorna morosidad promedio por segmento

GET /api/v1/benchmarking/ranking
  Query params:
    - metrica: "expensas_por_m2" | "morosidad" | "mantenimiento"
    - zonas: string[]
  Response:
    {
      "ranking": [
        { "zona": "puerto_madero", "valor": 15200.00 },
        { "zona": "recoleta", "valor": 12800.00 },
        ...
      ]
    }
```

### 5.2 Rate limiting y pricing

| Plan | Requests/mes | Precio |
|------|--------------|--------|
| **Free** | 100 | Gratis (para fintechs early-stage) |
| **Starter** | 10.000 | USD 500/mes |
| **Pro** | 100.000 | USD 2.000/mes |
| **Enterprise** | Ilimitado | Custom |

---

## 6. Consentimiento y Privacidad

### 6.1 Flujo de opt-in

```
Admin del edificio
        │
        ▼
┌─────────────────────────────┐
│ Configuración del edificio  │
│ [✅ Contribuir datos al     │
│    benchmarking]            │
│                             │
│ Beneficios:                 │
│ • 10% de descuento mensual  │
│ • Reportes comparativos     │
│   gratis                    │
│ • Datos 100% anonimizados   │
└─────────────────────────────┘
```

### 6.2 Garantías de privacidad

- **K-anonimidad:** Ningún dato agregado proviene de menos de 5 edificios.
- **Ruido diferencial:** ε=1.0 en todos los cálculos agregados.
- **Sin PII:** Nunca se almacenan nombres, direcciones, matrículas, emails.
- **Revocable:** El admin puede desactivar la contribución en cualquier momento.
- **Auditable:** Logs de qué datos fueron incluidos en qué reporte.

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **K-anonimidad** | k≥5 | Balance entre granularidad y privacidad. |
| **Ruido diferencial** | ε=1.0 | Estándar académico. Bajo impacto en precisión. |
| **Opt-in** | Sí, explícito | Transparencia total. Ley 25.326. |
| **Revenue sharing** | 10% descuento | Incentivo no monetario, fácil de implementar. |
| **API pública** | Fase 3 | Primero validar calidad de datos con reportes internos. |
| **Segmentación** | Zona + antigüedad + amenities + tamaño | Suficiente para comparativas útiles. |
| **Actualización** | Mensual | Los datos operativos se cierran mensualmente. |

---

*Documento relacionado:* [[PRD-03-09 Agente Benchmarking]]  
*Documento relacionado:* [[PRD-01-03 Modelo de Negocio]]  
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]  
*Documento relacionado:* [[PRD-06-03 Ley 25.326]]  
*Documento relacionado:* [[PRD-05-06 Embeddings y RAG]]