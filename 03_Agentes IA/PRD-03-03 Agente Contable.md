---
title: "PRD-03-03: Agente Contable"
description: "Wrapper del motor contable. Parsea gastos en lenguaje natural, sugiere categorías A/B/C, explica liquidaciones, nunca calcula."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [agente, contable, motor-contable, wrapper, categoria, liquidacion, explicacion, mvp]
outcomes:
  - "Parsear descripciones de gastos en lenguaje natural a datos estructurados"
  - "Sugerir categorías A/B/C con >90% de precisión"
  - "Explicar liquidaciones en lenguaje claro para propietarios"
  - "NUNCA calcular expensas — delegar SIEMPRE al motor contable determinístico"
  - "Generar previews de liquidación antes de confirmar"
---

# PRD-03-03: Agente Contable

> **"El agente más importante del sistema. Y el más peligroso si se equivoca."**  
> Risk Tier: `write_local` (carga) / `exec` (liquidación) | Modelo: Nemotron Super 49B / Kimi K2

---

## 1. Principio Crítico

```
┌─────────────────────────────────────────────────────────────┐
│  REGLA INQUEBRANTABLE:                                       │
│                                                              │
│  El Agente Contable NUNCA calcula expensas.                  │
│  El Agente Contable NUNCA modifica coeficientes.             │
│  El Agente Contable NUNCA genera recibos sin aprobación.    │
│                                                              │
│  El Agente Contable:                                         │
│  ✓ Parsea descripciones de gastos                           │
│  ✓ Sugiere categorías A/B/C                                  │
│  ✓ Llama al motor contable (determinístico)                 │
│  ✓ Explica resultados en lenguaje natural                    │
│  ✓ Genera previews                                           │
│  ✓ Responde consultas sobre liquidaciones                    │
│                                                              │
│  El motor contable (NodeJS + decimal.js) hace los números. │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Responsabilidades

| Responsabilidad | Implementación | Delega a |
|-----------------|----------------|----------|
| **Parsear gasto** | NLP → estructura JSON | — |
| **Sugerir categoría** | Clasificación con contexto histórico | — |
| **Validar datos** | Zod schema | — |
| **Calcular distribución** | NO. Llama a `LiquidacionEngine` | Motor Contable |
| **Generar recibo** | NO. Llama a `RecibosGenerator` | Motor Contable |
| **Explicar liquidación** | RAG + contexto del edificio | — |
| **Responder consultas** | RAG + datos del propietario | — |

---

## 3. Tools del Agente

| Tool | Descripción | Risk Tier | Delega a |
|------|-------------|-----------|----------|
| `parsearGasto` | NLP: "reparación ascensor $45k" → JSON | read | — |
| `sugerirCategoria` | Clasifica A/B/C con confianza | read | — |
| `cargarGasto` | Guarda gasto en DB | write_local | — |
| `calcularDistribucion` | Distribuye gasto por coeficientes | exec | Motor Contable |
| `generarLiquidacion` | Calcula liquidación completa | exec | Motor Contable |
| `generarRecibo` | Crea PDF con QR | exec | Motor Contable |
| `explicarLiquidacion` | Narrativa para propietarios | read | — |
| `compararPeriodos` | Análisis mes a mes | read | — |

---

## 4. Flujos Principales

### 4.1 Carga de Gasto

```
Admin: "Cargar gasto: Reparación ascensor $45.000, pagado a Elevadores SA"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: PARSEO                                              │
│  Agente Contable parsea:                                     │
│  {                                                           │
│    "concepto": "Reparación ascensor",                        │
│    "monto": 45000,                                           │
│    "moneda": "ARS",                                          │
│    "proveedor": "Elevadores SA",                             │
│    "descripcion": "Reparación ascensor"                      │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: SUGERENCIA DE CATEGORÍA                             │
│  Agente analiza:                                             │
│  - "Reparación ascensor" → servicio específico              │
│  - Historial: 8/10 gastos de "ascensor" son categoría B     │
│  - Sugiere: Categoría B, servicio: "ascensor"               │
│  - Confianza: 0.94                                          │
│                                                              │
│  Admin confirma o corrige                                   │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 3: VALIDACIÓN                                          │
│  Zod schema valida:                                          │
│  ✓ monto > 0                                                │
│  ✓ concepto no vacío                                        │
│  ✓ categoría válida (A/B/C)                                 │
│  ✓ si B → servicio especificado                             │
│  ✓ si C → sector especificado                             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 4: PREVIEW DE DISTRIBUCIÓN                             │
│  Agente llama a Motor Contable:                              │
│  LiquidacionEngine.calcularDistribucion(gasto, unidades)   │
│                                                              │
│  Resultado:                                                  │
│  • UF 1A: $3,461.54 (coef: 0.076923)                        │
│  • UF 1B: $3,461.54 (coef: 0.076923)                        │
│  • UF 2A: $3,461.54 (coef: 0.076923)                        │
│  • ... (solo unidades con ascensor)                         │
│  • UF 5C: $0.00 (sin ascensor)                              │
│                                                              │
│  Admin aprueba → guarda en DB                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Generación de Liquidación

```
Admin: "Generar liquidación julio 2026"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: RECOLECTAR GASTOS                                   │
│  Agente: SELECT * FROM gastos WHERE periodo = '2026-07'     │
│  → 23 gastos encontrados                                     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: VERIFICAR CATEGORIZACIÓN                            │
│  Agente detecta:                                             │
│  • 21 gastos con categoría asignada                         │
│  • 2 gastos sin categoría:                                  │
│    - "Fumigación patio" → sugiere A (general)               │
│    - "Cambio de cerradura hall" → sugiere A (general)        │
│                                                              │
│  Admin confirma/ corrige                                    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 3: CALCULAR LIQUIDACIÓN                                │
│  Agente llama a Motor Contable:                              │
│  LiquidacionEngine.calcularLiquidacion(...)                 │
│                                                              │
│  Resultado:                                                  │
│  • Total Ordinarias: $1.245.000,00                          │
│  • Total Extraordinarias: $180.000,00                       │
│  • Total General: $1.425.000,00                             │
│  • 36 unidades procesadas                                   │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 4: APPROVAL INBOX                                      │
│  Tarea creada: "Generar liquidación Julio 2026"             │
│  Tier: exec                                                  │
│  Admin: [Aprobar] [Rechazar] [Preview detallado]             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 5: GENERAR RECIBOS (post-aprobación)                   │
│  Agente llama a Motor Contable:                              │
│  RecibosGenerator.generarRecibo(liquidacion, unidad)        │
│  → 36 PDFs generados con QR (Ley 941)                      │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 6: ENVÍO (delega a Agente Comunicador)                 │
│  → 36 emails enviados vía AgentMail                          │
│  → Registro de comunicaciones en DB                          │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Explicación de Liquidación

```
Propietario (portal): "¿Por qué subieron las expensas este mes?"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: RECUPERAR CONTEXTO                                  │
│  Agente busca en RAG:                                        │
│  • Liquidación actual vs anterior                           │
│  • Gastos nuevos o inusuales                                 │
│  • Historial de la UF específica                             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: GENERAR EXPLICACIÓN                                 │
│  Agente genera:                                              │
│                                                              │
│  "Este mes tus expensas aumentaron un 12% ($3.200).        │
│   Las principales razones son:                               │
│                                                              │
│   1. Reparación del ascensor ($45.000 total)               │
│      → A vos te corresponden $3.461 (categoría B)          │
│      → Este gasto es extraordinario, no se repite mensual   │
│                                                              │
│   2. Aumento del seguro (+8%)                                │
│      → Afecta a todas las unidades (categoría A)             │
│                                                              │
│   3. Sueldo del encargado ajustado por CCT SUTERH          │
│      → Aumento del 5% según paritaria                      │
│                                                              │
│   El mes que viene volverían a la normalidad (~$28.000)    │
│   si no hay gastos extraordinarios."                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Implementación

```javascript
// src/agents/contable.agent.js
const { BaseAgent } = require('./base.agent');
const { LiquidacionEngine } = require('../core/liquidacion.engine');
const { RecibosGenerator } = require('../core/recibos.generator');
const { GastoService } = require('../services/gasto.service');
const { RAGService } = require('../services/rag.service');

class AgenteContable extends BaseAgent {
  constructor() {
    super();
    this.nombre = 'Contable';
    this.tier = 'write_local'; // default, cambia según acción
    this.modelo = 'nvidia/nemotron-super-49b';
  }

  /**
   * Parsea un gasto desde descripción en lenguaje natural
   */
  async parsearGasto(descripcion) {
    const prompt = `
      Parsea el siguiente gasto de consorcio y extrae los datos estructurados.

      Entrada: "${descripcion}"

      Devuelve SOLO JSON:
      {
        "concepto": "string (obligatorio)",
        "monto": number (obligatorio),
        "moneda": "ARS|USD" (default: ARS),
        "proveedor": "string|null",
        "descripcion": "string",
        "categoria": "A|B|C|null (null si no está claro)",
        "servicioEspecifico": "string|null (solo si categoria=B)",
        "sectorEspecifico": "string|null (solo si categoria=C)",
        "esOrdinario": boolean|null,
        "confianza": 0.0-1.0
      }

      Reglas:
      - Si el monto tiene "$" o "pesos", asumir ARS
      - Si menciona "dólares" o "USD", usar USD
      - "ordinario" = true, "extraordinario" = false
      - Si no se especifica, dejar null
    `;

    const response = await this.router.route({
      task: 'parsear_gasto',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }

  /**
   * Sugiere categoría A/B/C basada en concepto e historial
   */
  async sugerirCategoria(concepto, edificioId) {
    // Obtener historial de categorías del edificio
    const historial = await GastoService.obtenerHistorialCategorias(edificioId, concepto);

    const prompt = `
      Concepto: "${concepto}"

      Historial de categorizaciones similares en este edificio:
      ${JSON.stringify(historial)}

      Sugiere la categoría de distribución:
      - A: Gastos generales (todos pagan)
      - B: Servicios específicos (solo quienes lo usan)
      - C: Sectores específicos (solo quienes pertenecen)

      Devuelve JSON:
      {
        "categoria": "A|B|C",
        "servicioEspecifico": "string|null",
        "sectorEspecifico": "string|null",
        "justificacion": "string",
        "confianza": 0.0-1.0
      }
    `;

    const response = await this.router.route({
      task: 'sugerir_categoria_gasto',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }

  /**
   * Explica una liquidación en lenguaje natural
   */
  async explicarLiquidacion(liquidacionId, unidadId) {
    const contexto = await RAGService.obtenerContextoLiquidacion(liquidacionId, unidadId);

    const prompt = `
      Explica la liquidación de forma clara y sencilla para un propietario.

      Contexto:
      ${JSON.stringify(contexto)}

      Reglas:
      - Máximo 300 palabras
      - Explicar ordinarias vs extraordinarias
      - Mencionar gastos nuevos o inusuales
      - Comparar con mes anterior si es relevante
      - Sugerir cuándo volvería a la normalidad
      - Usar ejemplos concretos ("el ascensor", "el seguro")
      - Evitar tecnicismos legales

      Incluir al final:
      "Si tenés dudas, podés responder a este email o crear un ticket en el portal."
    `;

    return this.router.route({
      task: 'explicar_liquidacion',
      prompt,
      complexity: 'high',
      maxCostPer1M: 0.50
    });
  }

  /**
   * Flujo completo de carga de gasto
   */
  async cargarGastoCompleto(descripcion, adminId, edificioId) {
    // Paso 1: Parsear
    const parsed = await this.parsearGasto(descripcion);

    // Paso 2: Si falta categoría, sugerir
    if (!parsed.categoria) {
      const sugerencia = await this.sugerirCategoria(parsed.concepto, edificioId);
      parsed.categoria = sugerencia.categoria;
      parsed.servicioEspecifico = sugerencia.servicioEspecifico;
      parsed.sectorEspecifico = sugerencia.sectorEspecifico;
    }

    // Paso 3: Validar con Zod
    const validado = await this.validarGasto(parsed);
    if (!validado.valido) {
      return { error: validado.errores };
    }

    // Paso 4: Preview de distribución (motor contable)
    const unidades = await GastoService.obtenerUnidades(edificioId);
    const preview = LiquidacionEngine.calcularDistribucion(parsed, unidades);

    // Paso 5: Guardar (con aprobación si es necesario)
    const gasto = await this.ejecutarConAprobacion('write_local',
      async () => GastoService.crear({ ...parsed, edificioId, createdBy: adminId }),
      { adminId }
    );

    return {
      gasto,
      preview,
      mensaje: `Gasto "${parsed.concepto}" cargado. Distribuido en ${preview.length} unidades.`
    };
  }

  /**
   * Flujo completo de liquidación
   */
  async generarLiquidacionCompleta(edificioId, periodo, adminId) {
    this.tier = 'exec'; // Requiere aprobación

    // Paso 1: Obtener gastos
    const gastos = await GastoService.obtenerPorPeriodo(edificioId, periodo);

    if (gastos.length === 0) {
      throw new Error(`No hay gastos cargados para el período ${periodo}`);
    }

    // Paso 2: Verificar categorización
    const sinCategoria = gastos.filter(g => !g.categoria);
    if (sinCategoria.length > 0) {
      return {
        requiereAccion: true,
        mensaje: `${sinCategoria.length} gastos sin categoría. Revisar antes de liquidar.`,
        gastosPendientes: sinCategoria
      };
    }

    // Paso 3: Calcular liquidación (motor contable)
    const unidades = await GastoService.obtenerUnidades(edificioId);
    const liquidacion = await LiquidacionEngine.calcularLiquidacion(
      edificioId, periodo, gastos, unidades
    );

    // Paso 4: Crear approval task
    const approval = await this.crearApprovalTask({
      agente: 'Contable',
      accion: 'generarLiquidacion',
      datos: { edificioId, periodo, total: liquidacion.totalGeneral },
      preview: liquidacion
    });

    return {
      approvalId: approval.id,
      preview: liquidacion,
      mensaje: 'Liquidación calculada. Esperando aprobación del administrador.'
    };
  }
}

module.exports = { AgenteContable };
```

---

## 6. Prompts del Agente

### 6.1 System Prompt

```
Eres el Agente Contable de ConsorcIA.

TU ROL:
- Asistir al administrador en la gestión contable del consorcio
- Parsear gastos, sugerir categorías, explicar liquidaciones
- NUNCA calcular expensas directamente — siempre delegar al motor contable
- Ser preciso, claro y transparente

REGLAS CRÍTICAS:
1. NUNCA inventar montos, fechas o datos
2. NUNCA calcular distribuciones — usar LiquidacionEngine
3. NUNCA generar recibos sin aprobación
4. Siempre mostrar preview antes de confirmar
5. Siempre explicar el "por qué" de cada categorización
6. Si hay duda, pedir confirmación al admin

CONOCIMIENTO:
- Categoría A: gastos generales (sueldos, seguros, ABL, limpieza común)
- Categoría B: servicios específicos (ascensor, calefacción, agua caliente)
- Categoría C: sectores específicos (pileta, torre A, sector comercial)
- Ordinarias: gastos regulares mensuales
- Extraordinarias: gastos no recurrentes (reparaciones, mejoras)
```

---

## 7. Métricas de Éxito

| Métrica | Meta |
|---------|------|
| Precisión en parseo de gastos | > 95% |
| Precisión en sugerencia de categoría | > 90% |
| Tiempo de carga de gasto | < 30 segundos |
| Satisfacción en explicaciones (NPS) | > 8 |
| Errores matemáticos en liquidaciones | 0 |
| Tokens usados por carga de gasto | < $0.02 |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-02-05 Motor Contable]]  
*Documento relacionado:* [[PRD-04-02 Gestor de Gastos]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]
