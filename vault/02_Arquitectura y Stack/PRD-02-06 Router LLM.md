---
title: "PRD-02-06: Router LLM"
description: "CheaperInference + Nemotron + model tiering. Routing dinámico, failover, quality gates y analytics de costos."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [llm, router, cheaperinference, nemotron, model-tiering, costos, fallback]
outcomes:
  - "Implementar routing dinámico al modelo más económico disponible"
  - "Configurar model tiering por tipo de tarea (simple/medio/complejo)"
  - "Garantizar failover automático entre proveedores de LLM"
  - "Monitorear costos de tokens por agente, tarea, organización y edificio"
  - "Reducir costos de tokens en 85-95% vs usar Kimi API solo"
---

# PRD-02-06: Router LLM

> **CheaperInference.com + Nemotron = costos de tokens casi irrelevantes.**  
> A escala (10.000 edificios), los tokens cuestan lo mismo que un buen café por mes.

---

## 1. Arquitectura del Router

```
┌─────────────────────────────────────────────────────────────┐
│  REQUEST ENTRANTE                                           │
│  "Clasificar este ticket de reclamo"                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. ANALIZADOR DE TAREA                                     │
│     - Complejidad: BAJA / MEDIA / ALTA                      │
│     - Requiere visión: SÍ / NO                              │
│     - Requiere reasoning: SÍ / NO                         │
│     - Tipo: clasificación / chat / parsing / reporte       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CONSULTOR DE PRECIOS (tiempo real)                       │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│     │ OpenRouter  │ │ DeepInfra   │ │ Together    │         │
│     │ Nano 9B:    │ │ Nano 9B:    │ │ Qwen 2.5:   │         │
│     │ $0.05/1M    │ │ $0.06/1M    │ │ $0.04/1M    │         │
│     │ Super 49B:  │ │ Super 49B:  │ │             │         │
│     │ $0.10/1M    │ │ $0.10/1M    │ │             │         │
│     └─────────────┘ └─────────────┘ └─────────────┘         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. SELECTOR DE MODELO                                       │
│     Quality Gate: ¿El modelo más barato cumple el mínimo?  │
│     → SÍ: Usar el más barato                                 │
│     → NO: Subir al siguiente tier de calidad                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. EJECUTOR                                                 │
│     - Enviar request al proveedor seleccionado             │
│     - Con timeout y retry logic                             │
│     - Si falla → failover al siguiente proveedor           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. POST-PROCESAMIENTO                                     │
│     - Cachear respuesta (Redis TTL configurable)           │
│     - Registrar costo en analytics                           │
│     - Loguear decisión de routing para auditoría           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Configuración del Router

```javascript
// src/llm/cheaper.router.js
const axios = require('axios');
const Redis = require('ioredis');

const redis = new Redis({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });

// ==========================================
// CONFIGURACIÓN DE MODELOS POR TAREA
// ==========================================
const TASK_MODELS = {
  // ─── Tareas SIMPLES → modelos baratos ───
  'clasificar_ticket': {
    complexity: 'low',
    minQuality: 0.7,
    preferredModels: [
      { provider: 'together', model: 'qwen-2.5-7b', costPer1M: 0.04 },
      { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-30b', costPer1M: 0.05 },
      { provider: 'deepinfra', model: 'nvidia/nemotron-nano-9b-v2', costPer1M: 0.06 }
    ]
  },
  'responder_consulta': {
    complexity: 'low',
    minQuality: 0.75,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-nano-9b-v2', costPer1M: 0.06 },
      { provider: 'deepinfra', model: 'nvidia/nemotron-nano-9b-v2', costPer1M: 0.06 }
    ]
  },
  'label_email': {
    complexity: 'low',
    minQuality: 0.8,
    preferredModels: [
      { provider: 'together', model: 'qwen-2.5-7b', costPer1M: 0.04 },
      { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-30b', costPer1M: 0.05 }
    ]
  },

  // ─── Tareas MEDIAS → modelos intermedios ───
  'analizar_pdf_expensas': {
    complexity: 'medium',
    minQuality: 0.8,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-super-49b', costPer1M: 0.10 },
      { provider: 'deepinfra', model: 'nvidia/nemotron-super-49b', costPer1M: 0.10 }
    ]
  },
  'generar_reporte_mensual': {
    complexity: 'medium',
    minQuality: 0.82,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b', costPer1M: 0.085 },
      { provider: 'deepinfra', model: 'nvidia/nemotron-super-49b', costPer1M: 0.10 }
    ]
  },
  'sugerir_categoria_gasto': {
    complexity: 'medium',
    minQuality: 0.8,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-super-49b', costPer1M: 0.10 }
    ]
  },

  // ─── Tareas COMPLEJAS → modelos grandes ───
  'explicar_liquidacion': {
    complexity: 'high',
    minQuality: 0.9,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b', costPer1M: 0.085 },
      { provider: 'openrouter', model: 'kimi-k2', costPer1M: 1.00 }
    ]
  },
  'redactar_comunicado_legal': {
    complexity: 'high',
    minQuality: 0.95,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-70b-instruct', costPer1M: 1.20 },
      { provider: 'openrouter', model: 'kimi-k2', costPer1M: 1.00 }
    ]
  },
  'parsear_pdf_complejo': {
    complexity: 'high',
    minQuality: 0.85,
    preferredModels: [
      { provider: 'openrouter', model: 'nvidia/nemotron-nano-12b-vl', costPer1M: 0.20 }
    ]
  }
};

// ==========================================
// CONFIGURACIÓN DE PROVEEDORES
// ==========================================
const PROVIDERS = {
  'openrouter': {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://consorcia.app', 'X-Title': 'ConsorcIA' }
  },
  'deepinfra': {
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    apiKey: process.env.DEEPINFRA_API_KEY
  },
  'together': {
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: process.env.TOGETHER_API_KEY
  }
};

class CheaperInferenceRouter {
  constructor(options = {}) {
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTtl = options.cacheTtl || 3600; // 1 hora
    this.fallbackEnabled = options.fallbackEnabled !== false;
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Rutea un request al modelo más económico disponible
   */
  async route({ task, prompt, complexity, requiresVision = false, maxCostPer1M = null, organizacionId }) {
    const startTime = Date.now();
    const taskConfig = TASK_MODELS[task] || TASK_MODELS['responder_consulta'];

    // 1. Verificar cache
    if (this.cacheEnabled) {
      const cacheKey = this._cacheKey(organizacionId, task, prompt);
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { result: JSON.parse(cached), cached: true, cost: 0 };
      }
    }

    // 2. Seleccionar modelo
    const candidates = taskConfig.preferredModels.filter(m => {
      if (requiresVision && !m.model.includes('vl')) return false;
      if (maxCostPer1M && m.costPer1M > maxCostPer1M) return false;
      return true;
    });

    if (candidates.length === 0) {
      throw new Error(`No hay modelos disponibles para la tarea ${task} con los constraints dados`);
    }

    // 3. Intentar cada candidato (failover)
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const result = await this._execute(candidate, prompt);

        // 4. Cachear respuesta
        if (this.cacheEnabled) {
          await redis.setex(
            this._cacheKey(organizacionId, task, prompt),
            this.cacheTtl,
            JSON.stringify(result)
          );
        }

        // 5. Registrar métricas
        await this._logMetrics({
          task,
          organizacionId,
          model: candidate.model,
          provider: candidate.provider,
          costPer1M: candidate.costPer1M,
          latency: Date.now() - startTime,
          success: true
        });

        return {
          result,
          model: candidate.model,
          provider: candidate.provider,
          cost: this._estimateCost(prompt, result, candidate.costPer1M),
          latency: Date.now() - startTime,
          cached: false
        };

      } catch (error) {
        lastError = error;
        console.warn(`Fallo con ${candidate.provider}/${candidate.model}:`, error.message);

        await this._logMetrics({
          task,
          organizacionId,
          model: candidate.model,
          provider: candidate.provider,
          success: false,
          error: error.message
        });

        if (!this.fallbackEnabled) break;
      }
    }

    throw new Error(`Todos los modelos fallaron para la tarea ${task}. Último error: ${lastError?.message}`);
  }

  /**
   * Ejecuta un request contra un proveedor específico
   */
  async _execute(candidate, prompt) {
    const provider = PROVIDERS[candidate.provider];

    const response = await axios.post(
      `${provider.baseUrl}/chat/completions`,
      {
        model: candidate.model,
        messages: [
          { role: 'system', content: 'Eres un asistente especializado en administración de consorcios en Argentina.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3, // Baja creatividad para consistencia
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
          ...provider.headers
        },
        timeout: this.timeout
      }
    );

    return response.data.choices[0].message.content;
  }

  /**
   * Genera una key de cache determinística
   */
  _cacheKey(organizacionId, task, prompt) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(`${task}:${prompt}`).digest('hex');
    // Prefijo por organización: las respuestas cacheadas nunca se comparten entre tenants
    return `llm:cache:${organizacionId}:${task}:${hash}`;
  }

  /**
   * Estima el costo de un request (aproximado)
   */
  _estimateCost(prompt, response, costPer1M) {
    // Estimación: 1 token ≈ 4 caracteres
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(response.length / 4);
    const totalTokens = inputTokens + outputTokens;
    return (totalTokens / 1_000_000) * costPer1M;
  }

  /**
   * Loguea métricas para analytics
   */
  async _logMetrics(metrics) {
    // Key por organización (no lista global con campo org): aísla el analytics
    // entre tenants y el trim queda acotado a los últimos 10K de cada una
    const key = `llm:metrics:${metrics.organizacionId}`;
    await redis.lpush(key, JSON.stringify({
      ...metrics,
      timestamp: new Date().toISOString()
    }));
    await redis.ltrim(key, 0, 9999);
  }

  /**
   * Obtiene analytics de costos
   */
  async getAnalytics({ organizacionId, desde, hasta, groupBy = 'task' }) {
    const metrics = await redis.lrange(`llm:metrics:${organizacionId}`, 0, -1);
    const parsed = metrics.map(m => JSON.parse(m));

    // Filtrar por fecha
    const filtered = parsed.filter(m => {
      const ts = new Date(m.timestamp);
      return ts >= new Date(desde) && ts <= new Date(hasta);
    });

    // Agrupar
    const grouped = {};
    for (const m of filtered) {
      const key = m[groupBy];
      if (!grouped[key]) grouped[key] = { requests: 0, cost: 0, errors: 0 };
      grouped[key].requests++;
      if (m.success) grouped[key].cost += m.cost || 0;
      else grouped[key].errors++;
    }

    return grouped;
  }
}

module.exports = { CheaperInferenceRouter };
```

---

## 3. Model Tiering (Patrón OpenWorker)

```javascript
// src/llm/model.tiering.js

/**
 * Asigna automáticamente el modelo adecuado según la complejidad de la tarea.
 * Basado en el patrón de OpenWorker de Andrew Ng.
 */
class ModelTiering {
  static TIERS = {
    SIMPLE: {
      maxCostPer1M: 0.10,
      models: [
        'nvidia/nemotron-3-nano-30b',
        'nvidia/nemotron-nano-9b-v2',
        'qwen-2.5-7b'
      ],
      useCases: [
        'clasificar_ticket',
        'label_email',
        'responder_consulta_simple',
        'validar_datos_formulario'
      ]
    },
    MEDIUM: {
      maxCostPer1M: 0.50,
      models: [
        'nvidia/nemotron-super-49b',
        'nvidia/nemotron-3-super-120b'
      ],
      useCases: [
        'analizar_pdf_expensas',
        'generar_reporte_mensual',
        'sugerir_categoria_gasto',
        'resumen_conversacion'
      ]
    },
    COMPLEX: {
      maxCostPer1M: 2.00,
      models: [
        'nvidia/nemotron-3-super-120b',
        'nvidia/nemotron-70b-instruct',
        'kimi-k2'
      ],
      useCases: [
        'explicar_liquidacion',
        'redactar_comunicado_legal',
        'analisis_legal_complejo',
        'reasoning_multi_paso'
      ]
    },
    VISION: {
      maxCostPer1M: 1.00,
      models: [
        'nvidia/nemotron-nano-12b-vl'
      ],
      useCases: [
        'parsear_pdf_con_imagenes',
        'analizar_comprobante_foto',
        'extraer_texto_documento_escaneado'
      ]
    },
    FREE: {
      maxCostPer1M: 0,
      models: [
        'nvidia/nemotron-3-embed-1b',
        'nvidia/nemotron-3.5-content-safety'
      ],
      useCases: [
        'generar_embeddings',
        'moderar_contenido',
        'similaridad_semantica'
      ]
    }
  };

  static getTierForTask(task) {
    for (const [tierName, tier] of Object.entries(this.TIERS)) {
      if (tier.useCases.includes(task)) {
        return { name: tierName, ...tier };
      }
    }
    return this.TIERS.MEDIUM; // Default
  }

  static getModelForTask(task, preferredProvider = 'openrouter') {
    const tier = this.getTierForTask(task);
    return tier.models.map(model => ({
      model,
      provider: preferredProvider,
      costPer1M: this._getCost(model, preferredProvider)
    }));
  }

  static _getCost(model, provider) {
    const costs = {
      'nvidia/nemotron-3-nano-30b': { openrouter: 0.05, deepinfra: 0.05 },
      'nvidia/nemotron-nano-9b-v2': { openrouter: 0.06, deepinfra: 0.06 },
      'nvidia/nemotron-super-49b': { openrouter: 0.10, deepinfra: 0.10 },
      'nvidia/nemotron-3-super-120b': { openrouter: 0.085, deepinfra: 0.085 },
      'nvidia/nemotron-70b-instruct': { openrouter: 1.20, deepinfra: 1.20 },
      'nvidia/nemotron-nano-12b-vl': { openrouter: 0.20, deepinfra: 0.20 },
      'nvidia/nemotron-3-embed-1b': { openrouter: 0, deepinfra: 0 },
      'kimi-k2': { openrouter: 1.00, deepinfra: 1.00 }
    };
    return costs[model]?.[provider] || 1.00;
  }
}

module.exports = { ModelTiering };
```

---

## 4. Integración con Swarm

```javascript
// src/agents/contable.agent.js
const { CheaperInferenceRouter } = require('../llm/cheaper.router');
const { ModelTiering } = require('../llm/model.tiering');

class AgenteContable {
  constructor() {
    this.router = new CheaperInferenceRouter({
      cacheEnabled: true,
      cacheTtl: 1800, // 30 min
      fallbackEnabled: true
    });
  }

  /**
   * Sugiere la categoría de un gasto basado en su descripción
   */
  async sugerirCategoria(descripcionGasto) {
    const prompt = `
      Analiza el siguiente gasto de un consorcio y sugiere su categoría de distribución:

      Descripción: "${descripcionGasto}"

      Categorías:
      - A: Gastos generales (sueldos, seguros, ABL, limpieza común)
      - B: Servicios específicos (ascensor, calefacción, agua caliente)
      - C: Sectores específicos (pileta, torre A, sector comercial)

      Responde SOLO con: {"categoria": "A|B|C", "servicio": "nombre" (solo si es B), "sector": "nombre" (solo si es C), "confianza": 0.0-1.0}
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
  async explicarLiquidacion(liquidacion, unidad) {
    const prompt = `
      Explica la siguiente liquidación de expensas de forma clara y sencilla:

      Consorcio: ${liquidacion.edificioNombre}
      Período: ${liquidacion.periodo}
      Unidad: ${unidad.numero}
      Propietario: ${unidad.propietarioNombre}

      Expensas Ordinarias: $${liquidacion.totalOrdinarias}
      Expensas Extraordinarias: $${liquidacion.totalExtraordinarias}
      Total: $${liquidacion.totalGeneral}

      Detalle de gastos:
      ${liquidacion.detalles.map(d => `- ${d.concepto}: $${d.montoAsignado}`).join('\n')}

      Explica:
      1. Qué son las expensas ordinarias vs extraordinarias
      2. Por qué esta unidad paga ese monto (coeficiente, servicios)
      3. Cómo se distribuyeron los gastos
      4. Qué opciones de pago tiene

      Usa lenguaje claro, evita tecnicismos. Máximo 300 palabras.
    `;

    return this.router.route({
      task: 'explicar_liquidacion',
      prompt,
      complexity: 'high',
      maxCostPer1M: 0.50
    });
  }
}

module.exports = { AgenteContable };
```

---

## 5. Analytics de Costos

### 5.1 Dashboard de Costos

```javascript
// src/llm/analytics.js
class LLMCostAnalytics {
  async getDashboard({ organizacionId, periodo }) {
    const metrics = await this.router.getAnalytics({
      organizacionId,
      desde: `${periodo}-01`,
      hasta: `${periodo}-31`,
      groupBy: 'task'
    });

    return {
      resumen: {
        totalRequests: Object.values(metrics).reduce((s, m) => s + m.requests, 0),
        totalCost: Object.values(metrics).reduce((s, m) => s + m.cost, 0),
        totalErrors: Object.values(metrics).reduce((s, m) => s + m.errors, 0),
        avgCostPerRequest: totalCost / totalRequests
      },
      porTarea: metrics,
      ahorroVsKimi: this._calcularAhorro(metrics),
      recomendaciones: this._generarRecomendaciones(metrics)
    };
  }

  _calcularAhorro(metrics) {
    const costoActual = Object.values(metrics).reduce((s, m) => s + m.cost, 0);
    // Estimación de costo con Kimi K2 a $1.00/1M
    const costoKimi = costoActual * 10; // Aproximadamente 10x más caro
    return {
      costoActual,
      costoEstimadoKimi: costoKimi,
      ahorroAbsoluto: costoKimi - costoActual,
      ahorroPorcentual: ((costoKimi - costoActual) / costoKimi * 100).toFixed(2)
    };
  }

  _generarRecomendaciones(metrics) {
    const recomendaciones = [];

    // Si hay muchos errores en un proveedor, sugerir cambio
    for (const [task, data] of Object.entries(metrics)) {
      const errorRate = data.errors / data.requests;
      if (errorRate > 0.05) {
        recomendaciones.push({
          tipo: 'alerta',
          mensaje: `Tarea "${task}" tiene ${(errorRate * 100).toFixed(1)}% de errores. Considerar cambiar de proveedor.`
        });
      }
    }

    // Si el cache hit rate es bajo, sugerir aumentar TTL
    // (esto requeriría tracking adicional de cache hits)

    return recomendaciones;
  }
}
```

---

## 6. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **CheaperInference en vez de un solo proveedor** | Costos variables | Precios cambian. Un proveedor puede ser más barato hoy, otro mañana. Routing dinámico = siempre óptimo |
| **Cache por tarea + prompt hash** | Latencia y costo | "¿Cuánto debo?" se pregunta 100 veces al día. Cachear por 1 hora = 99% de ahorro |
| **Temperature 0.3** | Consistencia | Baja creatividad = respuestas más determinísticas. Ideal para clasificación y parsing |
| **Failover entre 3 proveedores** | Disponibilidad | Si OpenRouter cae, DeepInfra responde. Si ambos caen, Together. Sin downtime |
| **Model tiering por tarea** | Costo vs calidad | No usar un modelo de $1.20/1M para clasificar un ticket. No usar uno de $0.05 para redactar un comunicado legal |
| **Embeddings gratis** | Nemotron 3 Embed 1B | $0 en OpenRouter. RAG sin costo adicional |
| **Moderación gratis** | Nemotron 3.5 Safety | $0 en OpenRouter. Cumplimiento de contenido sin costo |
| **Logging de métricas en Redis** | Analytics | Lpush + ltrim = O(1) para append, O(N) para trim. Eficiente para alta frecuencia |

---

## 7. Proyección de Costos

| Escenario | Tokens/mes | Kimi API solo | Nemotron + CheaperInference | **Ahorro** |
|-----------|------------|---------------|------------------------------|------------|
| MVP piloto (10 edificios) | ~2.000 | $20-40 | **$0.50-2.00** | **95-98%** |
| Lanzamiento (100 edificios) | ~20.000 | $200-400 | **$5-20** | **95-98%** |
| Escala temprana (500) | ~100.000 | $1.000-2.000 | **$25-100** | **95-98%** |
| Escala media (2.000) | ~400.000 | $4.000-8.000 | **$100-400** | **95-98%** |
| Escala grande (10.000) | ~2.000.000 | $20.000-40.000 | **$500-2.000** | **95-98%** |

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-02 Stack Tecnológico]]  
*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]
