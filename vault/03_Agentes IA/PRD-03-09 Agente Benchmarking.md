---
title: "PRD-03-09: Agente Benchmarking"
description: "Especificación del agente especializado en análisis comparativo de costos entre edificios, generación de insights agregados y anonimizados, y reportes de mercado para inversores y desarrolladores."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P2"
tags: [agente, benchmarking, analytics, datos, anonimizacion, mercado, swarm, consorcIA]
outcomes:
  - "Definir métricas comparativas y KPIs de benchmarking"
  - "Especificar algoritmos de anonimización y agregación"
  - "Diseñar reportes comparativos por segmento"
  - "Establecer políticas de privacidad y consentimiento"
  - "Documentar modelo de monetización de datos"
---

# PRD-03-09: Agente Benchmarking

> **El Agente Benchmarking transforma los datos operativos de cientos de consorcios en inteligencia de mercado. Opera exclusivamente con datos anonimizados y agregados, generando comparativas que ayudan a administradoras a optimizar costos y a inversores a tomar decisiones informadas.**

---

## 1. Responsabilidades

### 1.1 Scope del agente

| Responsabilidad | Sí/No | Detalle |
|-----------------|-------|---------|
| Agregar datos de múltiples edificios | ✅ | Solo con consentimiento explícito |
| Anonimizar datos antes de procesar | ✅ | K-anonimidad (k≥5) obligatoria |
| Calcular percentiles de costos | ✅ | Por zona, antigüedad, amenities |
| Generar reportes comparativos | ✅ | Para admins (gratis) y terceros (pago) |
| Detectar outliers de mercado | ✅ | Edificios con costos atípicos |
| Sugerir optimizaciones | ✅ | "Su gasto de limpieza está en el percentil 90" |
| Vender datos individuales | ❌ | NUNCA. Solo agregados y anonimizados. |
| Identificar edificios específicos | ❌ | Los reportes nunca nombran ni identifican consorcios. |
| Modificar datos originales | ❌ | Solo lectura de datos anonimizados. |

### 1.2 Límites explícitos

- **Ley 25.326:** Todo dato personal o identificable debe ser anonimizado antes de entrar al pipeline de benchmarking.
- **Consentimiento:** Cada edificio debe opt-in explícitamente para contribuir datos al benchmarking.
- **K-anonimidad:** Ningún dato agregado puede provenir de menos de 5 edificios. Si hay <5 edificios en un segmento, no se genera reporte.

---

## 2. Métricas de Benchmarking

### 2.1 KPIs comparativos

| KPI | Unidad | Segmentación | Frecuencia |
|-----|--------|--------------|------------|
| **Expensas por m²** | ARS/m² | Zona, antigüedad, amenities, categoría | Mensual |
| **Gasto de limpieza por m²** | ARS/m² | Zona, m² totales, frecuencia de servicio | Mensual |
| **Gasto de electricidad por m²** | ARS/m² | Zona, antigüedad, tipo de calefacción | Mensual |
| **Gasto de agua por m²** | ARS/m² | Zona, amenities (pileta, jardín) | Mensual |
| **Gasto de seguros por UF** | ARS/UF | Zona, antigüedad, suma asegurada | Trimestral |
| **Sueldos de encargado por UF** | ARS/UF | Zona, horas de trabajo, CCT | Trimestral |
| **Morosidad promedio** | % | Zona, antigüedad, rango de expensas | Mensual |
| **Tickets de mantenimiento por UF** | N/UF/mes | Zona, antigüedad | Mensual |
| **Ratio ord/ext** | % | Zona, antigüedad | Mensual |

### 2.2 Segmentación de mercado

```
Segmentos:
├── Geográfico
│   ├── CABA: Palermo, Belgrano, Caballito, Nuñez, Villa Crespo, etc.
│   ├── GBA Norte: Vicente López, San Isidro, Tigre
│   ├── GBA Oeste: Morón, Haedo, Ramos Mejía
│   └── GBA Sur: Avellaneda, Quilmes, Lanús
├── Antigüedad
│   ├── <5 años (nuevo)
│   ├── 5-20 años (moderno)
│   ├── 20-40 años (estándar)
│   └── >40 años (antiguo)
├── Amenities
│   ├── Básico (ascensor, portero eléctrico)
│   ├── Medio (+ sum, parrilla, jardín)
│   └── Premium (+ pileta, gimnasio, cocheras mecánicas)
└── Tamaño
    ├── Pequeño: 1-10 UF
    ├── Mediano: 11-30 UF
    ├── Grande: 31-60 UF
    └── Muy grande: >60 UF
```

---

## 3. Pipeline de Anonimización

### 3.1 Proceso de k-anonimidad

```
Datos crudos del edificio
        │
        ▼
┌─────────────────┐
│ Paso 1:         │ → Eliminar: nombre edificio, dirección exacta,
│ Pseudonimización│   matrícula RPA, nombre admin, emails, teléfonos
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 2:         │ → Agrupar por segmento (zona + antigüedad + amenities)
│ Agregación      │   Calcular: promedio, mediana, percentil 25/75/90
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 3:         │ → Verificar que cada celda del reporte tenga
│ Validación k≥5  │   datos de ≥5 edificios. Si no, no incluir.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 4:         │ → Agregar ruido diferencial (ε=1.0) para
│ Ruido           │   prevenir re-identificación por combinación
│ diferencial     │   de atributos
└────────┬────────┘
         │
         ▼
   Datos listos para benchmarking
```

### 3.2 Ejemplo de anonimización

```
ANTES (dato crudo):
  Edificio: "Torre del Parque"
  Dirección: "Av. del Libertador 4500, CABA"
  Admin: María González
  Expensas/m²: ARS 8.500
  Zona: Palermo
  Antigüedad: 15 años
  Amenities: Medio

DESPUÉS (dato anonimizado):
  ID: hash_7a3f9e2d
  Expensas/m²: ARS 8.500
  Segmento: Palermo + 5-20 años + Medio

AGREGADO (reporte):
  Segmento: Palermo, 5-20 años, Medio
  N edificios: 23
  Expensas/m²: Promedio ARS 7.800 | Mediana ARS 7.500 | P90 ARS 10.200
```

---

## 4. Reportes Generados

### 4.1 Reporte para administradoras (gratis, Fase 3)

```
📊 Benchmarking — Edificio [Pseudónimo] — Julio 2026

Segmento: Palermo | 5-20 años | Medio | 25 UF

EXPENSAS POR M²
  Su edificio:     ARS 8.500/m²
  Promedio zona:   ARS 7.800/m²
  Mediana zona:    ARS 7.500/m²
  Percentil:       72° (más caro que el 72% de edificios similares)

GASTO DE LIMPIEZA POR M²
  Su edificio:     ARS 450/m²
  Promedio zona:   ARS 380/m²
  Percentil:       85° ⚠️
  💡 Sugerencia: Revisar contrato de limpieza o frecuencia de servicio.

MOROSIDAD
  Su edificio:     8%
  Promedio zona:   12%
  Percentil:       35° ✅ (mejor que el promedio)

MANTENIMIENTO
  Tickets/UF/mes:  0.15
  Promedio zona:   0.22
  Percentil:       28° ✅ (menos reclamos que el promedio)
```

### 4.2 Reporte para inversores (pago, B2B)

```
📈 Informe de Mercado — PropTech Argentina — Q3 2026

MERCADO: CABA + GBA | 1.200 edificios analizados

TENDENCIAS
• Expensas promedio subieron 4.2% mensual (ajustado por inflación).
• Edificios con pileta tienen un 18% más de gastos de mantenimiento.
• Morosidad estable en 11% promedio, con picos en zonas GBA Sur.

OPORTUNIDADES
• Edificios >40 años en Palermo tienen expensas 35% menores que nuevos.
  Potencial de renovación con aumento de valor.
• El 60% de edificios no tiene seguro de RC actualizado.

RANKING POR ZONA (expensas/m²)
  1. Puerto Madero:    ARS 15.200
  2. Recoleta:         ARS 12.800
  3. Palermo:          ARS 10.500
  ...
```

---

## 5. Monetización de Datos

### 5.1 Productos de datos

| Producto | Cliente | Precio | Datos incluidos |
|----------|---------|--------|-----------------|
| **Reporte mensual admin** | Administradoras | Gratis (incluido en Business+) | Comparativa de su edificio vs segmento |
| **Reporte trimestral mercado** | Inversores, desarrolladores | USD 500-2.000 | Tendencias, rankings, oportunidades |
| **API de benchmarking** | Fintechs, aseguradoras | USD 0.05-0.10/query | KPIs agregados en tiempo real |
| **Consultoría custom** | Gobierno, cámaras | Custom | Estudios sectoriales, informes regulatorios |

### 5.2 Modelo de revenue sharing

- Los edificios que contribuyen datos al benchmarking reciben un **descuento del 10%** en su plan mensual.
- Esto incentiva la participación sin comprometer privacidad.

---

## 6. Integración con otros agentes

| Agente | Interacción | Trigger |
|--------|-------------|---------|
| **Dashboard** | Recibe datos agregados para comparativas | Reporte mensual del admin |
| **Contable** | Recibe gastos categorizados para agregación | Cierre mensual |
| **Kanban** | Recibe tickets de mantenimiento para métricas | Cierre mensual |
| **Comunicador** | Envía reportes de benchmarking | Mensual o bajo demanda |

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Anonimización** | K-anonimidad (k≥5) + ruido diferencial | Cumple Ley 25.326. Imposible re-identificar. |
| **Consentimiento** | Opt-in explícito | Transparencia total. Sin consentimiento, no hay benchmarking. |
| **Segmentación mínima** | 5 edificios por celda | Previene identificación por exclusión. |
| **Modelo para narrativas** | Nemotron Super 120B | Requiere contexto largo para analizar tendencias de mercado. |
| **Datos personales** | NUNCA incluidos | Ni siquiera pseudonimizados. Solo métricas agregadas. |
| **Revenue sharing** | 10% descuento por contribución | Incentiva participación sin pagar en efectivo. |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-03-08 Agente Dashboard]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]  
*Documento relacionado:* [[PRD-06-03 Ley 25.326]]