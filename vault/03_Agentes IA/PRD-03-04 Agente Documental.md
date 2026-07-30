---
title: "PRD-03-04: Agente Documental"
description: "OCR, parsing de PDFs, normalización de conceptos, mapeo al plan de cuentas. One-shot long-horizon parsing con Unlimited-OCR."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [agente, documental, ocr, pdf, parsing, unlimited-ocr, conceptos, mvp]
outcomes:
  - "Extraer datos estructurados de PDFs de expensas con >90% de precisión"
  - "Normalizar conceptos contra el plan de cuentas existente"
  - "Sugerir categorías A/B/C para gastos detectados en documentos"
  - "Validar que la suma de gastos extraídos cuadre con el total del documento"
  - "Generar preview tabulado antes de confirmar carga"
---

# PRD-03-04: Agente Documental

> **"Leé el PDF de expensas como si fueras un contador."**  
> Risk Tier: `read` (parsing) / `write_local` (guardar en DB) | Modelo: Nemotron Nano 12B VL (vision) / Super 49B (text)

---

## 1. Objetivo

Procesar documentos PDF (resúmenes de expensas, facturas, comprobantes) y extraer datos estructurados que puedan cargarse automáticamente en el sistema.

---

## 2. Flujo de Procesamiento

```
Admin sube PDF de expensas
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: OCR (Unlimited-OCR microservicio Python)          │
│  - Convierte PDF a imágenes                                  │
│  - Parsea documento completo en una pasada                   │
│  - Extrae texto, tablas, montos, fechas                     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: EXTRACCIÓN ESTRUCTURADA (Agente Documental)        │
│  - Identifica conceptos de gastos                           │
│  - Extrae montos y fechas                                   │
│  - Detecta totales y subtotales                             │
│  - Valida que suma de gastos = total del documento         │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 3: NORMALIZACIÓN                                      │
│  - Mapea conceptos al plan de cuentas existente             │
│  - Sugiere categorías A/B/C                                 │
│  - Detecta conceptos nuevos                                 │
│  - Sugiere si son ordinarios o extraordinarios              │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 4: PREVIEW TABULADO                                   │
│  - Muestra tabla editable al admin                          │
│  - Permite corregir conceptos, montos, categorías          │
│  - Detecta discrepancias (ej: monto no cuadra)            │
│  - Admin confirma → carga batch                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tools del Agente

| Tool | Descripción | Risk Tier |
|------|-------------|-----------|
| `parsearPDF` | Envía PDF a microservicio OCR | read |
| `extraerGastos` | Identifica conceptos y montos | read |
| `validarSuma` | Verifica que suma de gastos = total | read |
| `normalizarConcepto` | Mapea al plan de cuentas | read |
| `sugerirCategoria` | Sugiere A/B/C por concepto | read |
| `generarPreview` | Crea tabla editable | read |
| `cargarBatch` | Guarda gastos validados en DB | write_local |

---

## 4. Implementación

```javascript
// src/agents/documental.agent.js
const { BaseAgent } = require('./base.agent');
const { OCRService } = require('../services/ocr.service');
const { GastoService } = require('../services/gasto.service');
const { RAGService } = require('../services/rag.service');

class AgenteDocumental extends BaseAgent {
  constructor() {
    super();
    this.nombre = 'Documental';
    this.tier = 'read'; // parsing es read, carga es write_local
    this.modelo = 'nvidia/nemotron-super-49b';
  }

  /**
   * Procesa un PDF de expensas completo
   */
  async procesarPDF(pdfBuffer, edificioId) {
    // Paso 1: OCR
    const textoExtraido = await OCRService.parsearPDF(pdfBuffer);

    // Paso 2: Extraer gastos estructurados
    const gastos = await this.extraerGastos(textoExtraido, edificioId);

    // Paso 3: Validar suma
    const validacion = this.validarSuma(gastos, textoExtraido);

    // Paso 4: Normalizar conceptos
    const normalizados = await this.normalizarConceptos(gastos, edificioId);

    return {
      gastos: normalizados,
      validacion,
      preview: this.generarPreview(normalizados),
      textoOriginal: textoExtraido.substring(0, 1000) // Primeros 1000 chars para referencia
    };
  }

  /**
   * Extrae gastos estructurados del texto OCR
   */
  async extraerGastos(texto, edificioId) {
    const prompt = `
      Analiza el siguiente texto extraído de un resumen de expensas de consorcio.
      Extrae TODOS los gastos mencionados.

      TEXTO:
      ${texto}

      Devuelve SOLO un JSON array con esta estructura:
      [
        {
          "concepto": "string (nombre del gasto)",
          "monto": number,
          "fecha": "YYYY-MM-DD|null",
          "proveedor": "string|null",
          "categoria": "A|B|C|null",
          "servicioEspecifico": "string|null",
          "esOrdinario": boolean|null,
          "confianza": 0.0-1.0
        }
      ]

      Reglas:
      - Extraer TODOS los gastos, no solo los principales
      - Si hay un "total" o "suma", incluirlo como verificación
      - Si el monto tiene IVA incluido, anotar el monto total
      - Si hay gastos con "varios" o "diversos", intentar desagregar
      - Fecha: usar la fecha del documento si no hay fecha específica
    `;

    const response = await this.router.route({
      task: 'extraer_gastos_pdf',
      prompt,
      complexity: 'high',
      maxCostPer1M: 0.50
    });

    return JSON.parse(response.result);
  }

  /**
   * Valida que la suma de gastos extraídos cuadre con el total del documento
   */
  validarSuma(gastos, textoOriginal) {
    const sumaExtraida = gastos.reduce((s, g) => s + (g.monto || 0), 0);

    // Buscar total en el texto original
    const totalMatch = textoOriginal.match(/total[\s:]*[$\s]*([\d.,]+)/i);
    const totalDocumento = totalMatch ? parseFloat(totalMatch[1].replace('.', '').replace(',', '.')) : null;

    if (totalDocumento) {
      const diferencia = Math.abs(sumaExtraida - totalDocumento);
      const porcentajeDif = (diferencia / totalDocumento) * 100;

      return {
        cuadra: diferencia < 0.01,
        sumaExtraida,
        totalDocumento,
        diferencia,
        porcentajeDiferencia: porcentajeDif,
        alerta: porcentajeDif > 5 ? 'ALTA' : porcentajeDif > 1 ? 'MEDIA' : 'NINGUNA'
      };
    }

    return {
      cuadra: null,
      sumaExtraida,
      totalDocumento: null,
      mensaje: 'No se encontró total en el documento para validar'
    };
  }

  /**
   * Normaliza conceptos contra el plan de cuentas existente
   */
  async normalizarConceptos(gastos, edificioId) {
    const planDeCuentas = await GastoService.obtenerPlanDeCuentas(edificioId);

    const normalizados = [];

    for (const gasto of gastos) {
      // Buscar coincidencia en plan de cuentas (RAG)
      const match = await RAGService.buscarConceptoSimilar(
        gasto.concepto,
        planDeCuentas,
        { umbral: 0.75 }
      );

      if (match) {
        normalizados.push({
          ...gasto,
          conceptoNormalizado: match.concepto,
          categoria: match.categoria,
          servicioEspecifico: match.servicioEspecifico,
          esOrdinario: match.esOrdinario,
          esNuevo: false,
          confianzaMatch: match.score
        });
      } else {
        // Concepto nuevo — sugerir categoría
        const sugerencia = await this.sugerirCategoriaNuevo(gasto.concepto);
        normalizados.push({
          ...gasto,
          conceptoNormalizado: gasto.concepto,
          categoria: sugerencia.categoria,
          servicioEspecifico: sugerencia.servicioEspecifico,
          esOrdinario: sugerencia.esOrdinario,
          esNuevo: true,
          confianzaMatch: 0
        });
      }
    }

    return normalizados;
  }

  /**
   * Sugiere categoría para un concepto nuevo
   */
  async sugerirCategoriaNuevo(concepto) {
    const prompt = `
      Concepto de gasto de consorcio: "${concepto}"

      Sugiere:
      1. Categoría de distribución (A/B/C)
      2. Si es ordinario o extraordinario
      3. Servicio específico (solo si es B)

      Devuelve JSON:
      {
        "categoria": "A|B|C",
        "esOrdinario": boolean,
        "servicioEspecifico": "string|null",
        "justificacion": "string"
      }
    `;

    const response = await this.router.route({
      task: 'sugerir_categoria_nuevo',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }

  /**
   * Genera preview tabulado para el admin
   */
  generarPreview(gastos) {
    return {
      tipo: 'preview_tabla',
      columnas: ['concepto', 'monto', 'categoria', 'esOrdinario', 'esNuevo', 'confianza'],
      filas: gastos.map(g => ({
        concepto: g.conceptoNormalizado || g.concepto,
        monto: g.monto,
        categoria: g.categoria || 'PENDIENTE',
        esOrdinario: g.esOrdinario === null ? 'PENDIENTE' : g.esOrdinario ? 'Sí' : 'No',
        esNuevo: g.esNuevo ? '⚠️ Nuevo' : '✓ Existente',
        confianza: g.confianzaMatch || g.confianza
      })),
      totales: {
        cantidad: gastos.length,
        montoTotal: gastos.reduce((s, g) => s + (g.monto || 0), 0),
        nuevos: gastos.filter(g => g.esNuevo).length,
        pendientes: gastos.filter(g => !g.categoria).length
      }
    };
  }

  /**
   * Carga batch de gastos validados
   */
  async cargarBatch(gastos, edificioId, adminId) {
    const resultados = [];

    for (const gasto of gastos) {
      try {
        const creado = await this.ejecutarConAprobacion('write_local',
          async () => GastoService.crear({
            ...gasto,
            edificioId,
            createdBy: adminId
          }),
          { adminId }
        );
        resultados.push({ exito: true, gasto: creado });
      } catch (error) {
        resultados.push({ exito: false, error: error.message, gasto });
      }
    }

    return {
      cargados: resultados.filter(r => r.exito).length,
      fallidos: resultados.filter(r => !r.exito).length,
      detalles: resultados
    };
  }
}

module.exports = { AgenteDocumental };
```

---

## 5. Integración con OCR Microservicio

```javascript
// src/services/ocr.service.js
const axios = require('axios');
const FormData = require('form-data');

class OCRService {
  static async parsearPDF(pdfBuffer) {
    const form = new FormData();
    form.append('file', pdfBuffer, { filename: 'documento.pdf' });

    const response = await axios.post(
      `${process.env.OCR_SERVICE_URL}/parse`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 120000 // 2 minutos para documentos grandes
      }
    );

    return response.data.texto;
  }
}

module.exports = { OCRService };
```

---

## 6. Métricas de Éxito

| Métrica | Meta |
|---------|------|
| Precisión en extracción de conceptos | > 90% |
| Precisión en extracción de montos | > 95% |
| Validación de suma (cuadra) | > 98% |
| Precisión en normalización de conceptos | > 85% |
| Tiempo de procesamiento por PDF | < 30 segundos |
| Tokens usados por PDF | < $0.10 |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-05-05 OCR Service]]  
*Documento relacionado:* [[PRD-04-07 Importación Inteligente]]
