---
title: "PRD-04-09: Gestión Personal del Hogar"
description: "Especificación del subsistema B2C para habitantes: seguimiento de costos de vivienda, servicios, suscripciones, seguros, impuestos y dashboard personal de gastos."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P2"
tags: [b2c, habitante, costos, vivienda, servicios, impuestos, dashboard, consorcIA, fase3]
outcomes:
  - "Definir entidades y relaciones del subsistema personal"
  - "Especificar extracción automática de impuestos desde servicios"
  - "Diseñar dashboard de costos de vivienda personal"
  - "Establecer modelo freemium con features premium"
  - "Documentar integración con módulo de expensas del consorcio"
---

# PRD-04-09: Gestión Personal del Hogar

> **La Gestión Personal del Hogar es el "Trojan Horse" de ConsorcIA. Ningún competidor ofrece a los habitantes una herramienta para entender y controlar su costo de vida real. Es el hook viral que convierte a un inquilino en evangelista de la plataforma.**

---

## 1. Visión General

### 1.1 Concepto

```
COSTO TOTAL DE VIVIENDA =
  ├── Expensas del consorcio (automático desde el ERP)
  ├── Alquiler (manual o importado)
  ├── Servicios (luz, gas, agua, internet, cable)
  ├── Suscripciones (Netflix, Spotify, etc.)
  ├── Alquileres externos (cochera, baulera)
  ├── Seguros (vivienda, incendio, vida)
  └── Impuestos (DReI, API, IIBB, Tasas, IVA)
      └── Extraídos automáticamente de los servicios cargados
```

### 1.2 Diferenciador clave

| Feature | ConsorcIA | Competidores |
|---------|-----------|--------------|
| Expensas integradas desde consorcio | ✅ | ❌ |
| Seguimiento de servicios del hogar | ✅ | ❌ |
| Extracción automática de impuestos | ✅ | ❌ |
| Dashboard de costo de vida real | ✅ | ❌ |
| Comparativa de costos (F3) | ✅ | ❌ |
| Suscripciones y alquileres externos | ✅ | ❌ |

---

## 2. Entidades del Subsistema

### 2.1 Modelo de datos

```typescript
// Usuario habitante (vinculado a UF del consorcio)
interface Habitante {
  id: string;
  userId: string;              // Auth principal
  edificioId: string;
  unidadFuncionalId: string;   // Su UF en el consorcio
  esPropietario: boolean;
  esInquilino: boolean;
  fechaInicio: Date;
  fechaFin?: Date;
}

// Costo de vivienda (agregado mensual)
interface CostoVivienda {
  id: string;
  habitanteId: string;
  mes: number;
  anio: number;
  categorias: {
    expensas: Decimal;         // Automático desde ERP
    alquiler: Decimal;         // Manual
    servicios: Decimal;        // Suma de servicios activos
    suscripciones: Decimal;    // Suma de suscripciones
    alquileresExternos: Decimal;
    seguros: Decimal;
    impuestos: Decimal;        // Calculado automáticamente
  };
  total: Decimal;
  createdAt: Date;
}

// Servicio del hogar
interface ServicioHogar {
  id: string;
  habitanteId: string;
  tipo: 'luz' | 'gas' | 'agua' | 'internet' | 'cable' | 'telefonia' | 'otro';
  proveedor: string;           // "Edesur", "Metrogas", "Fibertel", etc.
  numeroCliente: string;
  periodicidad: 'mensual' | 'bimestral' | 'trimestral';
  montoEstimado?: Decimal;    // Para proyección
  facturas: FacturaServicio[];
  activo: boolean;
}

// Factura de servicio
interface FacturaServicio {
  id: string;
  servicioId: string;
  periodo: string;             // "06/2026"
  monto: Decimal;
  vencimiento: Date;
  pagada: boolean;
  fechaPago?: Date;
  archivoUrl?: string;         // PDF de la factura
  impuestosExtraidos: ImpuestoExtraido[];
  createdAt: Date;
}

// Impuesto extraído automáticamente
interface ImpuestoExtraido {
  id: string;
  facturaId: string;
  tipo: 'drei' | 'api' | 'iibb' | 'tasas' | 'iva' | 'otro';
  monto: Decimal;
  porcentajeAplicado?: Decimal; // Ej: 21% para IVA
  baseImponible?: Decimal;
  confianza: number;            // 0-1 (OCR + LLM)
  verificado: boolean;          // Usuario confirmó
}

// Suscripción
interface Suscripcion {
  id: string;
  habitanteId: string;
  nombre: string;              // "Netflix", "Spotify", etc.
  categoria: 'streaming' | 'musica' | 'gaming' | 'software' | 'otro';
  montoMensual: Decimal;
  moneda: 'ARS' | 'USD';
  periodicidadCobro: 'mensual' | 'anual';
  proximoVencimiento: Date;
  activo: boolean;
}

// Alquiler externo
interface AlquilerExterno {
  id: string;
  habitanteId: string;
  tipo: 'cochera' | 'baulera' | 'deposito' | 'otro';
  direccion?: string;
  montoMensual: Decimal;
  inicioContrato: Date;
  finContrato?: Date;
  activo: boolean;
}

// Seguro
interface SeguroHogar {
  id: string;
  habitanteId: string;
  tipo: 'vivienda' | 'incendio' | 'vida' | 'auto' | 'otro';
  aseguradora: string;
  numeroPoliza: string;
  montoAnual: Decimal;
  cobertura: string;
  vencimiento: Date;
  activo: boolean;
}
```

---

## 3. Extracción Automática de Impuestos

### 3.1 Tipos de impuestos soportados

| Impuesto | Origen | Cálculo | Frecuencia |
|----------|--------|---------|------------|
| **DReI** (Derecho Real de Inmueble) | Factura de luz/gas | Porcentaje sobre consumo | Bimestral |
| **API** (Alumbrado, Barrido y Limpieza) | Factura de luz | Porcentaje sobre consumo | Bimestral |
| **IIBB** (Ingresos Brutos) | Factura de servicios | Porcentaje sobre total | Mensual |
| **Tasas municipales** | Factura de ABL | Monto fijo + variable | Mensual |
| **IVA** | Todas las facturas | 21% sobre servicios, 10.5% energía | Mensual |

### 3.2 Algoritmo de extracción

```
Factura de servicio subida (PDF o imagen)
        │
        ▼
┌─────────────────────────────┐
│ Paso 1: OCR de factura      │ → Extraer texto completo
│ (OCR Service)               │   (Unlimited-OCR o Nemotron VL)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 2: Detección de        │ → Nemotron Super 49B analiza el texto
│ conceptos impositivos       │   Busca: "DReI", "API", "IIBB",
│                             │   "Tasa", "IVA", "Impuesto"
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 3: Extracción de       │ → Regex + LLM para montos
│ montos                      │   Ej: "DReI: $1.245,60"
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 4: Cálculo de          │ → Si no está explícito, calcular
│ porcentajes                 │   desde base imponible
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 5: Verificación        │ → Usuario revisa y confirma
│ por usuario                 │   (similar a preview de importación)
└─────────────┬───────────────┘
              │
              ▼
        Impuestos persistidos
```

### 3.3 Ejemplo de extracción

```
FACTURA EDESUR — Junio 2026

Consumo: 450 kWh
Tarifa: $180,00/kWh
Subtotal: $81.000

DReI (2,5%): $2.025,00
API (1,2%): $972,00
IIBB (3%): $2.520,00
IVA (10,5%): $9.102,38

TOTAL: $95.619,38

─────────────────────────────────────────
EXTRACCIÓN AUTOMÁTICA:
  DReI:  $2.025,00  ✅ (detectado en factura)
  API:   $972,00    ✅ (detectado en factura)
  IIBB:  $2.520,00  ✅ (detectado en factura)
  IVA:   $9.102,38  ✅ (detectado en factura)

  Base imponible: $81.000
  Total impuestos: $14.619,38 (15,3% de la factura)
```

---

## 4. Dashboard Personal

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  MI HOGAR — Dashboard                    [👤 Juan Pérez, 3B]   │
├─────────────────────────────────────────────────────────────────┤
│  Período: [Julio 2026 ▼]                                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ COSTO TOTAL DE VIVIENDA: $185.000                       │   │
│  │                                                         │   │
│  │ [Donut chart]                                           │   │
│  │ Expensas:     35%  ($65.000)  ████████                  │   │
│  │ Alquiler:     30%  ($55.000)  ███████                   │   │
│  │ Servicios:    15%  ($28.000)  ████                      │   │
│  │ Suscripciones: 5%  ($9.000)   █                         │   │
│  │ Seguros:      10%  ($18.000)  ██                        │   │
│  │ Impuestos:     5%  ($10.000)  █                         │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────┐  ┌────────────────────────┐        │
│  │ Evolución mensual      │  │ Próximos vencimientos  │        │
│  │ [Line chart: 6 meses]  │  │ • Expensas: 10/07      │        │
│  │                        │  │ • Luz: 15/07 ($12.500) │        │
│  │                        │  │ • Netflix: 20/07       │        │
│  │                        │  │ • Seguro: 01/08        │        │
│  └────────────────────────┘  └────────────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────┐  ┌────────────────────────┐        │
│  │ Mis servicios          │  │ Mis suscripciones      │        │
│  │ • Luz: $12.500/mes     │  │ • Netflix: $5.500      │        │
│  │ • Gas: $8.000/mes      │  │ • Spotify: $2.500      │        │
│  │ • Agua: $4.500/mes     │  │ • Gympass: $8.000      │        │
│  │ • Internet: $15.000    │  │                        │        │
│  │ [+ Agregar servicio]   │  │ [+ Agregar suscripción]│        │
│  └────────────────────────┘  └────────────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  💡 PREMIUM: Compará tu costo de vivienda con edificios        │
│     similares. [Activar Premium — $3.250/año]                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Features por plan

| Feature | Free | Premium |
|---------|------|---------|
| Seguimiento de expensas | ✅ | ✅ |
| Dashboard de costos | ✅ | ✅ |
| Servicios y suscripciones | Hasta 5 | Ilimitado |
| Extracción de impuestos | Manual | Automática (OCR) |
| Comparativa de costos | ❌ | ✅ (benchmarking personal) |
| Alertas de vencimiento | Básicas | Avanzadas (proyección) |
| Exportar a Excel/PDF | ❌ | ✅ |
| Multi-hogar | ❌ | ✅ (hasta 3) |

---

## 5. Integración con ERP del Consorcio

### 5.1 Flujo de datos

```
ERP del Consorcio                    Subsistema Personal
        │                                    │
        │── Liquidación generada ───────────▶│
        │   (expensas ordinarias + ext)      │
        │                                    │
        │── Recibo con QR ──────────────────▶│
        │   (detalle por UF)                 │
        │                                    │
        │◀── Confirmación de pago ───────────│
        │   (habitante marca como pagado)    │
        │                                    │
        │── Estado de cuenta ───────────────▶│
        │   (deuda histórica por UF)         │
```

### 5.2 Sincronización

- **Expensas:** Automática. Al generar la liquidación, cada habitante ve su monto en el dashboard.
- **Pagos:** Bidireccional. Si el habitante paga vía MercadoPago, se registra en ambos sistemas.
- **Deuda:** Automática. El habitante ve su deuda actualizada en tiempo real.

---

## 6. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Expensas automáticas** | Sí, desde ERP | El habitante no carga nada. Zero friction. |
| **Impuestos** | Extracción automática con verificación | OCR + LLM sugiere, usuario confirma. Balance automatización/control. |
| **Plan freemium** | Free limitado, Premium $3.250/año | Maximiza adopción. 20% de conversión a Premium = revenue saludable. |
| **Multi-hogar** | Premium only | Caso de uso nicho (inversores con varias propiedades). |
| **Datos del consorcio** | Solo lectura para el habitante | El habitante nunca modifica datos del ERP. |
| **Privacidad** | Datos personales encriptados | Ley 25.326. El habitante controla qué comparte. |

---

*Documento relacionado:* [[PRD-01-01 Visión del Producto]]  
*Documento relacionado:* [[PRD-01-03 Modelo de Negocio]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]