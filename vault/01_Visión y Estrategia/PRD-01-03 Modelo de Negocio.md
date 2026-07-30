---
title: "PRD-01-03: Modelo de Negocio"
description: "Estructura de ingresos, pricing, segmentos de clientes, canales de distribución y proyecciones financieras de ConsorcIA."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [negocio, pricing, revenue, freemium, b2b2c, monetizacion, consorcIA]
outcomes:
  - "Definir streams de ingreso primarios y secundarios"
  - "Establecer pricing competitivo vs mercado argentino"
  - "Modelar unit economics por edificio y por habitante"
  - "Identificar métricas de negocio críticas (LTV, CAC, churn)"
  - "Proyectar revenue por fase de desarrollo"
---

# PRD-01-03: Modelo de Negocio

> **ConsorcIA opera bajo un modelo Freemium B2B2C:** la administradora paga por el ERP del consorcio, los habitantes acceden gratis a la gestión personal del hogar, y el benchmarking se monetiza como producto de datos.

---

## 1. Streams de Ingreso

### 1.1 Ingreso primario: SaaS por edificio (B2B)

> **El contrato y la facturación son con la organización** (administración/estudio, identificada por su CUIT), que es el cliente del SaaS. El precio se calcula **por edificio adherido** a la organización.

| Plan | Precio/edificio/mes | UF incluidas | Features |
|------|---------------------|--------------|----------|
| **Starter** | Gratis | Hasta 10 UF | Gestión básica, portal residente limitado, 1 organización / 1 edificio |
| **Pro** | ARS 45.000-60.000 | Hasta 30 UF | Liquidación completa, cobranzas MP, comunicaciones, reportes |
| **Business** | ARS 80.000-120.000 | Hasta 60 UF | Multi-edificio, kanban, OCR, dashboard avanzado, API |
| **Enterprise** | Custom | 60+ UF | White-label, SLAs dedicados, soporte prioritario, onboarding presencial |

> **Nota:** Los precios están en ARS y se ajustan mensualmente por inflación (IPC o CER). Alternativa: pricing en USD stablecoin para contratos anuales. El plan Business **no es flat**: se cobra por cada edificio adherido a la organización.

### 1.2 Ingreso secundario: Módulo personal del hogar (B2C)

| Plan | Precio/habitante/año | Features |
|------|----------------------|----------|
| **Free** | Gratis | Seguimiento de expensas, costos básicos, dashboard personal |
| **Premium** | ARS 2.500-4.000 | Análisis avanzado, comparativas de costos, extracción automática de impuestos, alertas de anomalías |

> **Estrategia:** El 80% de los habitantes usa la versión free (hook viral). El 20% paga por insights avanzados.

### 1.3 Ingreso terciario: Benchmarking como producto de datos (B2B2D)

| Producto | Cliente | Precio | Datos |
|----------|---------|--------|-------|
| **Reporte trimestral** | Desarrolladores, inversores | USD 500-2.000 | Costos por m² por zona, antigüedad, amenities |
| **API de benchmarking** | Fintechs, aseguradoras | USD 0.05-0.10/consulta | KPIs agregados y anonimizados en tiempo real |
| **Consultoría de datos** | Gobierno, cámaras | Custom | Estudios sectoriales, informes de mercado |

### 1.4 Ingreso cuaternario: Servicios adicionales

- **Onboarding asistido:** ARS 150.000-300.000 por migración de cartera completa (>5 edificios) de una organización.
- **Capacitación:** ARS 50.000 por taller grupal para administradores.
- **Integraciones custom:** USD 2.000-5.000 por conector a sistema legacy.

---

## 2. Unit Economics

### 2.1 Por edificio (plan Pro)

```
Ingreso mensual:        ARS 52.500 (promedio Pro)
Costo de infra:         ARS 3.500  (~USD 3.50)
Costo de tokens:        ARS 500    (~USD 0.50)
Costo de soporte:       ARS 2.000  (1h/mes promedio)
─────────────────────────────────────────────────
Margen bruto:           ARS 46.500 (~88%)
```

> **El cliente real es la organización, no el edificio.** El LTV de una organización = margen por edificio × N edificios de su cartera. Ejemplo: una organización con 10 edificios Pro aporta un margen bruto de ~ARS 465.000/mes, 10 veces el unit economics por edificio.

### 2.2 Por habitante (módulo personal Premium)

```
Ingreso anual:          ARS 3.250 (promedio)
Costo de infra:         ARS 150   (~USD 0.15/año)
Costo de tokens:        ARS 50    (~USD 0.05/año)
─────────────────────────────────────────────────
Margen bruto:           ARS 3.050 (~94%)
```

### 2.3 Métricas de negocio objetivo

| Métrica | Año 1 | Año 2 | Año 3 |
|---------|-------|-------|-------|
| Organizaciones activas | 50 | 150 | 400 |
| Edificios activos | 500 | 2.000 | 6.000 |
| ARPU edificio/mes | ARS 52.500 | ARS 65.000 | ARS 80.000 |
| ARPU organización/mes | ARS 525.000 | ARS 867.000 | ARS 1.200.000 |
| Habitantes Premium | 2.000 | 10.000 | 35.000 |
| Revenue mensual | ARS 26M | ARS 130M | ARS 480M |
| CAC (organización) | ARS 200.000 | ARS 150.000 | ARS 100.000 |
| LTV/CAC ratio | >3x | >4x | >5x |
| Churn mensual organización | <2% | <1.5% | <1% |
| Churn mensual edificio | <5% | <3% | <2% |
| NPS administradores | >8 | >8.5 | >9 |

> **Churn de organización vs churn de edificio:** el churn de una organización es crítico — implica perder toda su cartera de edificios de golpe. El churn de un edificio individual (cambio de administrador del consorcio, decisión de la asamblea) es tolerable si la organización retiene el resto de la cartera.

---

## 3. Segmentos de Clientes

### 3.1 Administradoras independientes (nicho inicial)

- **Perfil:** 1-3 personas, 5-20 edificios, usan Excel + WhatsApp.
- **Dolor:** No tienen tiempo para liquidaciones manuales, pierden reclamos.
- **Willingness to pay:** Media-Alta. Valoran el tiempo ahorrado.
- **Estrategia:** Migración asistida gratuita. Primer mes gratis.

### 3.2 Estudios administradores medianos

- **Perfil:** 10-50 empleados, 50-200 edificios, usan ConsorcioAbierto o Adminia.
- **Dolor:** Costos de software altos, falta de IA, churn de clientes por falta de transparencia.
- **Willingness to pay:** Alta. Buscan diferenciación competitiva.
- **Estrategia:** Demo de importación inteligente de PDFs (onboarding masivo).

### 3.3 Grandes administradoras / In-house (Fase 3)

- **Perfil:** 200+ edificios, departamento de sistemas propio.
- **Dolor:** Necesitan API, white-label, SLAs.
- **Willingness to pay:** Muy alta.
- **Estrategia:** Enterprise custom, precio por volumen.

### 3.4 Habitantes / Propietarios (B2C)

- **Perfil:** Inquilinos y dueños de UF en consorcios administrados por la plataforma.
- **Dolor:** No entienden sus expensas, no tienen visión de su costo de vida real.
- **Willingness to pay:** Baja-Media. El free es suficiente para la mayoría.
- **Estrategia:** Viralidad orgánica. "Traé a tu administrador".

---

## 4. Canales de Distribución

| Canal | Fase | Estrategia |
|-------|------|------------|
| **Venta directa (inside sales)** | MVP | Demo personalizada, migración asistida |
| **Referidos (admin → admin)** | Fase 2 | Créditos por recomendación (1 mes gratis) |
| **Viralidad B2C → B2B** | Fase 2 | Habitante usa app → recomienda a su admin |
| **Alianzas estratégicas** | Fase 3 | Colegios de administradores, estudios contables, aseguradoras |
| **Marketplace / Integraciones** | Fase 3 | Presencia en catálogos de software para consorcios |
| **Content marketing** | Continuo | Blog, webinars, guías de compliance (SEO) |

---

## 5. Estrategia de Pricing

### 5.1 Principios

1. **Pricing por edificio, no por UF:** Simplifica la venta. La competencia cobra por UF lo cual penaliza edificios grandes.
2. **Starter gratis como anzuelo:** Captura consorcios pequeños (71% del mercado tiene <10 UF). Upsell natural al crecer.
3. **Precio en ARS con ajuste mensual:** Protege contra inflación. Contratos anuales con descuento del 15%.
4. **Benchmarking como upsell:** El admin ve comparativas → quiere más datos → paga Business.

### 5.2 Comparativa de pricing vs competencia

| Competidor | Modelo | Precio ref. (30 UF) | Precio ConsorcIA Pro (30 UF) | Diferencia |
|------------|--------|---------------------|------------------------------|------------|
| ConsorcioAbierto | Por UF | ARS 24.000-42.000 | ARS 52.500 | +25-120% |
| Adminia | Por edificio | ARS 55.000-70.000 | ARS 52.500 | -4 a -25% |
| CONSO | Por UF | ARS 88.500 | ARS 52.500 | -41% |
| Octopus | Premium | ARS 100.000+ | ARS 52.500 | -47% |

> **Posicionamiento:** "Más barato que CONSO y Octopus, más features que ConsorcioAbierto, precio fijo por edificio como Adminia."

---

## 6. Proyección Financiera

### 6.1 Revenue por fase

```
Fase 1 (MVP, Mes 1-4):        $0      (beta gratuito)
Fase 2 (Mes 5-7):             $8.000/mes   (100 edificios Pro)
Fase 3 (Mes 8-12):            $40.000/mes  (500 edificios mix)
Año 2:                        $200.000/mes (2.000 edificios)
Año 3:                        $800.000/mes (6.000 edificios + benchmarking)
```

### 6.2 Costos operativos por fase

| Fase | Infra + Tokens/mes | Equipo/mes | Total/mes | Margen |
|------|-------------------|------------|-----------|--------|
| MVP | $400 | $15.000 | $15.400 | N/A |
| Fase 2 | $1.000 | $20.000 | $21.000 | -62% |
| Fase 3 | $3.500 | $22.000 | $25.500 | 37% |
| Año 2 | $8.000 | $25.000 | $33.000 | 83% |
| Año 3 | $25.000 | $35.000 | $60.000 | 92% |

> **Punto de equilibrio operativo:** Mes 10-12 (500 edificios activos).

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Pricing base** | Por edificio | Simplifica venta, no penaliza edificios grandes |
| **Moneda** | ARS con ajuste mensual | Mercado local. USD para enterprise anual. |
| **Modelo B2C** | Freemium con upsell Premium | Maximiza adopción. Margen del 94% en Premium. |
| **Benchmarking** | Producto separado B2B | No diluye el core. Alto valor para inversores. |
| **Contratos** | Mensual con descuento anual 15% | Reduce churn, mejora cash flow. |

---

*Documento relacionado:* [[PRD-01-01 Visión del Producto]]  
*Documento relacionado:* [[PRD-01-02 Estrategia de MVP y Fases]]  
*Documento relacionado:* [[PRD-01-04 Análisis Competitivo]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-04-09 Gestión Personal del Hogar]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]