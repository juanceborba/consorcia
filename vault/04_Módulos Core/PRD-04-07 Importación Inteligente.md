---
title: "PRD-04-07: Importación Inteligente"
description: "Especificación del módulo de carga masiva de gastos mediante OCR de PDFs de expensas: upload, preview interactivo, discovery de conceptos, normalización y tabulación dinámica."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [ocr, importacion, pdf, gastos, discovery, tabulacion, consorcIA, fase2]
outcomes:
  - "Definir flujo end-to-end de importación de PDFs de expensas"
  - "Especificar algoritmo de discovery y normalización de conceptos"
  - "Diseñar interfaz de preview interactivo antes de confirmar carga"
  - "Establecer mecanismo de tabulación dinámica (pre-existentes + nuevos)"
  - "Documentar integración con OCR Service y Agente Documental"
---

# PRD-04-07: Importación Inteligente

> **La Importación Inteligente permite a una administradora cargar un PDF de expensas del mes anterior y, en minutos, tener todos los gastos descubiertos, normalizados y listos para liquidar. Es el diferenciador clave para onboarding masivo de carteras grandes.**

---

## 1. Visión General

### 1.1 Problema que resuelve

```
ANTES:
  Admin recibe PDF de expensas del mes anterior
  → Lee página por página
  → Copia cada concepto a Excel manualmente
  → Tarda 2-3 horas por edificio
  → Errores de tipeo frecuentes
  → Conceptos nuevos requieren crear filas nuevas

DESPUÉS:
  Admin sube PDF
  → OCR extrae todo el texto en 30 segundos
  → Agente Documental descubre conceptos y montos
  → Sistema sugiere categorías y distribución A/B/C
  → Admin revisa preview interactivo
  → Confirma → gastos cargados en 2 minutos
```

### 1.2 Diferenciador clave

| Feature | ConsorcIA | Competidores |
|---------|-----------|--------------|
| OCR de PDFs enteros | ✅ (Unlimited-OCR) | Octopus (parcial), Adminia (parcial) |
| Preview interactivo | ✅ | ❌ |
| Discovery de conceptos nuevos | ✅ | ❌ |
| Tabulación dinámica | ✅ | ❌ |
| Normalización automática | ✅ | ❌ |
| Sugerencia de categoría A/B/C | ✅ | ❌ |

---

## 2. Flujo de Importación

### 2.1 Diagrama de secuencia

```
Admin                           Frontend          Backend          OCR Service        Agente Documental
  │                                │                  │                   │                    │
  │── Selecciona PDF ─────────────▶│                  │                   │                    │
  │                                │── Upload ───────▶│                   │                    │
  │                                │                  │── Guardar en ─────▶│                    │
  │                                │                  │   MinIO/S3        │                    │
  │                                │                  │◀── URL ───────────│                    │
  │                                │                  │                   │                    │
  │                                │                  │── Enviar PDF ───────────────────────────▶│
  │                                │                  │                   │                    │
  │                                │                  │◀── Texto extraído ──────────────────────│
  │                                │                  │   (tablas, conceptos, montos)           │
  │                                │                  │                   │                    │
  │                                │                  │── Parseo + Discovery ───────────────────▶│
  │                                │                  │                   │                    │
  │                                │                  │◀── Conceptos mapeados ──────────────────│
  │                                │                  │   (existentes + nuevos sugeridos)       │
  │                                │                  │                   │                    │
  │                                │◀── Preview ──────│                   │                    │
  │◀── Muestra tabla interactiva ──│                  │                   │                    │
  │                                │                  │                   │                    │
  │── Edita/Ajusta conceptos ──────▶│                  │                   │                    │
  │                                │── Confirmar ────▶│                   │                    │
  │                                │                  │── Crear gastos ──▶│                    │
  │                                │                  │   en DB           │                    │
  │                                │                  │                   │                    │
  │◀── "12 gastos importados" ─────│◀─────────────────│                   │                    │
```

### 2.2 Pasos detallados

| Paso | Duración estimada | Actor | Output |
|------|-------------------|-------|--------|
| 1. Upload PDF | 5-10 seg | Admin | Archivo en MinIO/S3 |
| 2. OCR extracción | 20-60 seg | OCR Service | Texto estructurado (JSON) |
| 3. Discovery conceptos | 10-30 seg | Agente Documental | Lista de conceptos con montos |
| 4. Mapeo a plan de cuentas | 5-15 seg | Agente Documental | Conceptos mapeados + sugerencias |
| 5. Preview interactivo | Variable | Admin | Tabla editable en frontend |
| 6. Confirmación y carga | 2-5 seg | Admin | Gastos persistidos en DB |
| **Total** | **2-5 min** | | |

---

## 3. OCR y Extracción de Datos

### 3.1 Entrada del OCR Service

```typescript
interface OcrRequest {
  pdfUrl: string;           // URL firmada de MinIO/S3
  edificioId: string;
  mes: number;              // 1-12
  anio: number;
  tipo: 'expensas' | 'recibo' | 'factura' | 'resumen_bancario';
}
```

### 3.2 Salida del OCR Service

```typescript
interface OcrResponse {
  paginas: {
    numero: number;
    texto: string;           // Texto completo de la página
    tablas: {
      filas: {
        celdas: string[];
      }[];
    }[];
  }[];
  conceptosDetectados: {
    concepto: string;        // "Luz Edesur"
    monto: string;           // "245.678,90"
    pagina: number;
    coordenadas?: { x: number; y: number; w: number; h: number };
  }[];
  metadata: {
    totalPaginas: number;
    confianzaPromedio: number; // 0-1
    tipoDetectado: string;
  };
}
```

### 3.3 Tipos de documentos soportados

| Tipo | Descripción | Complejidad |
|------|-------------|-------------|
| **Liquidación de expensas** | PDF distribuido por el admin anterior | Media |
| **Facturas de servicios** | Luz, gas, agua, ABL | Baja |
| **Recibos de sueldos** | Encargado, personal | Media |
| **Resumen bancario** | Extracto de cuenta del consorcio | Alta |
| **Contratos** | Seguros, limpieza, mantenimiento | Alta |
| **Actas de asamblea** | Decisiones, votaciones | Muy alta |

---

## 4. Discovery y Normalización

### 4.1 Algoritmo de discovery

```
Concepto detectado por OCR: "EDESUR - PERIODO 06/2026 - EDIFICIO"
        │
        ▼
┌─────────────────────────────┐
│ Paso 1: Normalización       │ → "edesur periodo 06 2026 edificio"
│ de texto                    │   (minúsculas, sin tildes, sin puntuación)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 2: Matching fuzzy      │ → Comparar con plan de cuentas existente
│ con plan de cuentas         │   usando Levenshtein + embeddings
└─────────────┬───────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ MATCH    │    │ NO MATCH     │
│ >85%     │    │ <85%         │
└────┬─────┘    └──────┬───────┘
     │                 │
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ Asignar  │    │ Paso 3:      │
│ concepto │    │ Sugerir      │
│ existente│    │ nuevo        │
│          │    │ concepto     │
└──────────┘    └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │ Paso 4:      │
                │ Clasificar   │
                │ categoría    │
                │ A/B/C        │
                └──────────────┘
```

### 4.2 Ejemplo de normalización

```
OCR detecta:          Normaliza a:           Sugerencia:
─────────────────────────────────────────────────────────────
"EDESUR JUNIO"        "luz electrica"        Concepto existente
"Luz y Fuerza"        "luz electrica"        Concepto existente (sinónimo)
"AGUAS BONAERENSES"   "agua corriente"       Concepto existente
"ABL MUNICIPAL"       "abl"                  Concepto existente
"SEGURO CONSORCIO"    "seguro responsabilidad civil"  Concepto existente
"REPARACION ASCENSOR" "reparacion ascensor"  NUEVO CONCEPTO
"LIMPIEZA JUNIO"      "limpieza"             Concepto existente
"GASTOS BANCARIOS"    "gastos bancarios"     Concepto existente
"INTERESES MORATORIOS""intereses moratorios" NUEVO CONCEPTO
```

### 4.3 Tabulación dinámica

```typescript
interface TabulacionDinamica {
  filas: {
    concepto: string;           // Normalizado
    conceptoOriginal: string;   // Texto del OCR
    monto: Decimal;
    categoriaSugerida: 'A' | 'B' | 'C';
    distribucionSugerida: 'coeficiente' | 'igual' | 'por_uf';
    esNuevo: boolean;           // ¿No existe en plan de cuentas?
    confianza: number;          // 0-1
    accion: 'aceptar' | 'editar' | 'ignorar' | 'crear_nuevo';
  }[];
  totales: {
    aceptados: Decimal;
    pendientes: Decimal;
    ignorados: Decimal;
  };
}
```

---

## 5. Preview Interactivo

### 5.1 Interfaz de preview

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORTACIÓN INTELIGENTE — Julio 2026                           │
│  Archivo: liquidacion_julio_2026.pdf (3 páginas)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Concepto detectado      │ Monto      │ Cat. │ Acción   │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ✅ Luz (EDESUR)         │ $245.678   │  A   │ [Aceptar]│   │
│  │ ✅ Agua (AySA)          │ $89.450    │  A   │ [Aceptar]│   │
│  │ ✅ ABL                  │ $156.000   │  A   │ [Aceptar]│   │
│  │ ✅ Limpieza             │ $180.000   │  A   │ [Aceptar]│   │
│  │ ⚠️ Reparación ascensor  │ $45.000    │  C   │ [Editar] │   │
│  │    (concepto nuevo)     │            │      │          │   │
│  │ ⚠️ Intereses moratorios │ $12.500    │  A   │ [Editar] │   │
│  │    (concepto nuevo)     │            │      │          │   │
│  │ ❌ Pago a proveedor X   │ $0         │  —   │ [Ignorar]│   │
│  │    (monto no detectado) │            │      │          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Total aceptado: $671.128  │  Total pendiente: $57.500        │
│                                                                 │
│  [💾 Guardar como borrador]  [✅ Confirmar importación]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Acciones disponibles en preview

| Acción | Descripción | Resultado |
|--------|-------------|-----------|
| **Aceptar** | Confirma el concepto detectado | Se carga como gasto |
| **Editar** | Modifica concepto, monto o categoría | Se carga con correcciones |
| **Ignorar** | Descarta el concepto | No se carga |
| **Crear nuevo** | Agrega concepto al plan de cuentas | Se carga y se persiste nuevo concepto |
| **Dividir** | Divide un concepto en varios | Útil para facturas combinadas |
| **Merge** | Une conceptos detectados como separados | Útil para OCR que dividió mal |

---

## 6. Persistencia y Auditoría

### 6.1 Registro de importación

```typescript
interface ImportacionRegistro {
  id: string;
  edificioId: string;
  adminId: string;
  archivoOriginal: string;      // URL en MinIO/S3
  mes: number;
  anio: number;
  estado: 'procesando' | 'preview' | 'confirmado' | 'error';
  conceptosDetectados: number;
  conceptosAceptados: number;
  conceptosNuevos: number;
  confianzaPromedio: number;
  gastosCreados: string[];     // IDs de gastos
  createdAt: Date;
  confirmadoAt?: Date;
}
```

### 6.2 Auditoría

- Cada importación queda registrada con el PDF original.
- El admin puede reabrir una importación histórica y ver el preview original.
- Los conceptos nuevos creados quedan vinculados a la importación que los originó.

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **OCR engine** | baidu/Unlimited-OCR | One-shot parsing de documentos largos. Self-hosted = $0. |
| **Preview obligatorio** | Sí | El admin SIEMPRE revisa antes de confirmar. Zero trust en OCR. |
| **Conceptos nuevos** | Sugeridos, no forzados | El plan de cuentas es decisión del admin. |
| **Matching** | Fuzzy (Levenshtein) + embeddings | Captura sinónimos y variaciones de nombre. |
| **Persistencia PDF** | MinIO/S3 permanente | Auditoría legal. La Ley 941 exige conservación de documentos. |
| **Microservicio OCR** | Python + FastAPI separado | Unlimited-OCR requiere Python + CUDA. No mezclar con NodeJS. |
| **Batch** | 1 PDF a la vez (inicial) | Evita timeouts. Futuro: batch de múltiples PDFs. |

---

*Documento relacionado:* [[PRD-03-04 Agente Documental]]  
*Documento relacionado:* [[PRD-04-02 Gestor de Gastos]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-05-05 OCR Service]]  
*Documento relacionado:* [[PRD-05-06 Embeddings y RAG]]