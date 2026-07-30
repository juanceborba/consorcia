---
title: "PRD-03-02: Agente Onboarding"
description: "Configuración conversacional de edificios y unidades. Parseo de descripciones en lenguaje natural, validación de coeficientes, importación de reglamentos."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [agente, onboarding, edificio, unidades, coeficientes, reglamento, mvp]
outcomes:
  - "Configurar un edificio completo mediante conversación en <10 minutos"
  - "Parsear descripciones en lenguaje natural a estructura de datos validada"
  - "Validar matemáticamente que suma de coeficientes = 1.000000"
  - "Importar y parsear reglamentos de PH desde PDF"
  - "Generar preview visual del edificio antes de confirmar"
---

# PRD-03-02: Agente Onboarding

> **"Configurá tu edificio hablando."**  
> El agente Onboarding convierte descripciones conversacionales en estructuras de datos validadas.  
> Risk Tier: `write_local` | Modelo: Nemotron Super 49B

---

## 1. Objetivo

Permitir que un administrador configure un edificio completo (tipologías, unidades, coeficientes, categorías A/B/C) mediante una **conversación natural**, sin necesidad de formularios complejos.

Antes de configurar el primer edificio, el agente da de alta (o identifica) la **organización** — la administración/estudio, cliente del SaaS — con su nombre, CUIT, plan y matrícula RPA del administrador responsable. Si la organización ya existe (segundo edificio en adelante), el agente salta ese paso y agrega el edificio a la cartera, lo que habilita el **onboarding masivo de carteras** (N edificios de una misma administradora).

---

## 2. Flujo de Onboarding

```
┌─────────────────────────────────────────────────────────────────┐
│  CONVERSACIÓN CON AGENTE ONBOARDING                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ── PASO 0: ORGANIZACIÓN (solo la primera vez) ──              │
│                                                                 │
│  Agente: "¿Ya tenés una organización en ConsorcIA?             │
│           Si no, la damos de alta ahora: nombre de la          │
│           administradora, CUIT, plan y matrícula RPA            │
│           del administrador responsable."                       │
│                                                                 │
│  Admin: "Primera vez. Estudio López, CUIT 30-71234567-8,       │
│          plan Pro."                                             │
│                                                                 │
│  Agente: "✅ Organización creada. Ahora sí, contame del        │
│           primer edificio. (Si la organización ya existía,     │
│           este paso se saltea y el edificio se suma             │
│           directo a tu cartera.)"                               │
│                                                                 │
│  ── PASO 1 EN ADELANTE: EDIFICIO ──                            │
│                                                                 │
│  Admin: "Tengo un edificio en Av. Libertador 1234, CABA.       │
│          12 pisos, 2 deptos por piso, cocheras en PB,           │
│          bauleras en subsuelo. Total 34 unidades."            │
│                                                                 │
│  Agente: "Perfecto. Veo que tenés:                             │
│           • 24 departamentos (12 pisos × 2)                    │
│           • 8 cocheras en planta baja                          │
│           • 2 bauleras en subsuelo                             │
│           • Total: 34 unidades                                 │
│                                                                 │
│           ¿Es correcto? [Sí] [No, corregir]"                   │
│                                                                 │
│  Admin: "Sí, pero son 10 cocheras, no 8"                        │
│                                                                 │
│  Agente: "Actualizado: 10 cocheras. Total: 36 unidades.         │
│           Ahora necesito los m² de cada tipo para              │
│           calcular coeficientes. ¿Tenés el plano?"             │
│                                                                 │
│  Admin: "Deptos: 85m² cada uno. Cocheras: 15m².                │
│          Bauleras: 8m²"                                        │
│                                                                 │
│  Agente: "Calculando coeficientes por m²...                    │
│           • Deptos: 85/3064 = 0.027742 cada uno                │
│           • Cocheras: 15/3064 = 0.004896 cada una              │
│           • Bauleras: 8/3064 = 0.002611 cada una               │
│                                                                 │
│           Validación: Suma = 1.000000 ✅                        │
│                                                                 │
│           ¿Querés asignar categorías A/B/C ahora               │
│           o usar las defaults?"                                 │
│                                                                 │
│  Admin: "Defaults por ahora"                                    │
│                                                                 │
│  Agente: "✅ Edificio configurado. Resumen:                   │
│           • 36 unidades creadas                                │
│           • Coeficientes validados                             │
│           • Categorías: A=todas, B=ninguna, C=ninguna          │
│                                                                 │
│           [Ver preview del edificio] [Ir al dashboard]"         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Tools del Agente

| Tool | Descripción | Risk Tier |
|------|-------------|-----------|
| `crearOrganizacion` | Alta de organización (nombre, CUIT, plan, matrícula RPA) | write_local |
| `crearEdificio` | Crea registro en tabla `edificios`, vinculado a la organización | write_local |
| `crearUnidad` | Crea unidad con tipo, m², coeficiente | write_local |
| `validarCoeficientes` | Verifica suma = 1.000000 | read |
| `sugerirCoeficientes` | Calcula coeficientes por m² | read |
| `importarReglamento` | Parsea PDF de reglamento PH | read |
| `asignarCategorias` | Configura A/B/C por unidad | write_local |
| `generarPreview` | Crea representación visual del edificio | read |

---

## 4. Implementación

```javascript
// src/agents/onboarding.agent.js
const { BaseAgent } = require('./base.agent');
const { EdificioService } = require('../services/edificio.service');
const { CoeficientesValidator } = require('../core/validators/coeficientes.validator');
const Decimal = require('decimal.js');

class AgenteOnboarding extends BaseAgent {
  constructor() {
    super();
    this.nombre = 'Onboarding';
    this.tier = 'write_local';
    this.modelo = 'nvidia/nemotron-super-49b';
  }

  /**
   * Parsea descripción conversacional del edificio
   */
  async parsearDescripcion(descripcion) {
    const prompt = `
      Eres un asistente especializado en configuración de consorcios en Argentina.
      Parsea la siguiente descripción de un edificio y extrae la estructura.

      Descripción del administrador:
      "${descripcion}"

      Extrae y devuelve SOLO un JSON con esta estructura:
      {
        "nombre": "string",
        "direccion": "string",
        "ciudad": "string",
        "provincia": "string",
        "codigoPostal": "string",
        "unidades": [
          {
            "tipo": "departamento|cochera|baulera|local|oficina",
            "cantidad": number,
            "m2PorUnidad": number,
            "pisos": "string (ej: '1-12')",
            "letras": "string (ej: 'A,B')"
          }
        ],
        "servicios": ["ascensor", "calefaccion", "agua_caliente"],
        "sectores": ["torre_a", "torre_b"]
      }

      Reglas:
      - Si no se menciona ciudad, asumir "CABA"
      - Si no se menciona provincia, asumir "Buenos Aires"
      - Extraer dirección completa si está presente
      - Calcular cantidad total de unidades
      - Si hay dudas, marcar "necesita_confirmacion": true
    `;

    const response = await this.router.route({
      task: 'parsear_descripcion_edificio',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }

  /**
   * Calcula coeficientes por m²
   */
  calcularCoeficientes(unidades) {
    // Calcular m² totales
    const m2Total = unidades.reduce((sum, u) => {
      return sum.plus(new Decimal(u.cantidad).times(u.m2PorUnidad));
    }, new Decimal(0));

    const resultado = [];

    for (const tipo of unidades) {
      const coeficienteBase = new Decimal(tipo.m2PorUnidad).div(m2Total);

      for (let i = 1; i <= tipo.cantidad; i++) {
        const numero = this._generarNumeroUnidad(tipo, i);
        resultado.push({
          numero,
          tipo: tipo.tipo,
          m2: tipo.m2PorUnidad,
          coeficiente: coeficienteBase.toFixed(6),
          categoriaA: true,
          categoriaB: [],
          categoriaC: null
        });
      }
    }

    // Validar
    const validacion = CoeficientesValidator.validar(resultado);
    if (!validacion.valido) {
      throw new Error(`Validación de coeficientes fallida: ${JSON.stringify(validacion.errores)}`);
    }

    return resultado;
  }

  /**
   * Genera número de unidad según tipo
   */
  _generarNumeroUnidad(tipo, index) {
    if (tipo.tipo === 'departamento') {
      const piso = Math.ceil(index / tipo.letras.split(',').length);
      const letra = tipo.letras.split(',')[
        (index - 1) % tipo.letras.split(',').length
      ].trim();
      return `${piso}${letra}`;
    }
    if (tipo.tipo === 'cochera') return `Coch-${index}`;
    if (tipo.tipo === 'baulera') return `Baul-${index}`;
    if (tipo.tipo === 'local') return `Loc-${index}`;
    if (tipo.tipo === 'oficina') return `Of-${index}`;
    return `${tipo.tipo}-${index}`;
  }

  /**
   * Devuelve el organizacionId del contexto actual (sale del JWT del usuario).
   * Si el usuario todavía no pertenece a ninguna organización, devuelve null
   * y el flujo conversacional dispara el alta vía tool `crearOrganizacion`.
   */
  async getCurrentOrganizacion() {
    return this.contexto?.organizacionId ?? null;
  }

  /**
   * Flujo completo de onboarding
   */
  async onboardingCompleto(descripcion, adminId) {
    // Paso 0: Resolver organización (alta o existente).
    // Si el usuario ya pertenece a una organización (segundo edificio en
    // adelante), se reutiliza y el edificio se suma a la cartera: así se
    // soporta el onboarding masivo de carteras de una misma administradora.
    const organizacionId = await this.getCurrentOrganizacion();

    // Paso 1: Parsear descripción
    const parsed = await this.parsearDescripcion(descripcion);

    // Paso 2: Calcular coeficientes
    const unidades = this.calcularCoeficientes(parsed.unidades);

    // Paso 3: Crear edificio en DB (con aprobación si es exec)
    const edificio = await this.ejecutarConAprobacion('write_local', 
      async () => EdificioService.crear({
        nombre: parsed.nombre,
        direccion: parsed.direccion,
        ciudad: parsed.ciudad,
        provincia: parsed.provincia,
        codigoPostal: parsed.codigoPostal,
        totalM2: unidades.reduce((s, u) => s + parseFloat(u.m2), 0),
        organizacionId
      }),
      { adminId }
    );

    // Paso 4: Crear unidades
    for (const unidad of unidades) {
      await this.ejecutarConAprobacion('write_local',
        async () => EdificioService.crearUnidad({
          ...unidad,
          edificioId: edificio.id,
          organizacionId
        }),
        { adminId }
      );
    }

    // Paso 5: Generar preview
    const preview = await this.generarPreview(edificio.id);

    return {
      edificio,
      unidadesCreadas: unidades.length,
      preview,
      siguientePaso: 'configurar_gastos_fijos'
    };
  }

  /**
   * Genera preview visual del edificio
   */
  async generarPreview(edificioId) {
    const edificio = await EdificioService.obtenerConUnidades(edificioId);

    return {
      tipo: 'preview_edificio',
      datos: {
        nombre: edificio.nombre,
        totalUnidades: edificio.unidades.length,
        porTipo: this._agruparPorTipo(edificio.unidades),
        coeficientesValidos: true,
        distribucionM2: this._calcularDistribucionM2(edificio.unidades)
      }
    };
  }

  _agruparPorTipo(unidades) {
    return unidades.reduce((acc, u) => {
      acc[u.tipo] = (acc[u.tipo] || 0) + 1;
      return acc;
    }, {});
  }

  _calcularDistribucionM2(unidades) {
    const total = unidades.reduce((s, u) => s + parseFloat(u.m2), 0);
    return unidades.map(u => ({
      numero: u.numero,
      tipo: u.tipo,
      m2: u.m2,
      porcentaje: ((parseFloat(u.m2) / total) * 100).toFixed(2)
    }));
  }
}

module.exports = { AgenteOnboarding };
```

---

## 5. Prompts del Agente

### 5.1 System Prompt

```
Eres el Agente Onboarding de ConsorcIA, un asistente especializado en 
configuración de edificios de Propiedad Horizontal en Argentina.

TU ROL:
- Guiar al administrador en la configuración inicial de su edificio
- Parsear descripciones en lenguaje natural
- Calcular coeficientes de participación
- Validar matemáticamente toda la configuración
- Sugerir categorías A/B/C de distribución

REGLAS:
1. NUNCA inventes datos. Si falta información, preguntá.
2. Siempre validá que la suma de coeficientes = 1.000000
3. Explicá los cálculos de forma clara y sencilla
4. Ofrecé defaults razonables pero permití personalización
5. Mostrá previews antes de confirmar cambios irreversibles

CONOCIMIENTO LEGAL:
- Art. 2037-2072 CCyC: Propiedad Horizontal
- Ley 941 CABA: Requisitos de recibos y QR
- Coeficientes = m² de UF / m² total del edificio
- Categoría A: gastos generales (todos pagan)
- Categoría B: servicios específicos (solo quienes lo usan)
- Categoría C: sectores específicos (solo quienes pertenecen)
```

### 5.2 Prompt de Parseo de Reglamento

```javascript
async parsearReglamento(pdfBuffer) {
  const prompt = `
    Analiza el siguiente reglamento de Propiedad Horizontal y extrae:

    1. DISTRIBUCIÓN DE GASTOS:
       - ¿Qué gastos son categoría A (generales)?
       - ¿Qué gastos son categoría B (servicios específicos)?
       - ¿Qué gastos son categoría C (sectores)?

    2. COEFICIENTES:
       - Tabla de coeficientes por unidad (si existe)
       - Criterio de cálculo (m², valor, otro)

    3. SERVICIOS:
       - Lista de servicios comunes (ascensor, calefacción, etc.)
       - ¿Quién paga cada servicio?

    4. SECTORES:
       - ¿Hay sectores independientes?
       - ¿Qué unidades pertenecen a cada sector?

    5. NORMAS ESPECIALES:
       - Cualquier norma que afecte la distribución de gastos

    Devuelve JSON estructurado.
  `;

  // Enviar PDF a OCR service primero
  const texto = await this.ocrService.parsearPDF(pdfBuffer);

  return this.router.route({
    task: 'parsear_reglamento_ph',
    prompt: prompt + "\n\nTEXTO DEL REGLAMENTO:\n" + texto,
    complexity: 'high',
    maxCostPer1M: 0.50
  });
}
```

---

## 6. Edge Cases

| Escenario | Comportamiento |
|-----------|---------------|
| **Suma coeficientes != 1** | Rechazar y sugerir ajuste. Mostrar cuál unidad ajustar |
| **Unidad sin m²** | Pedir dato obligatorio. No permitir continuar |
| **Reglamento contradice Ley 941** | Alertar al admin. Sugerir consultar abogado |
| **Edificio con subconsorcios** | Crear edificio padre + edificios hijo dentro de la misma organización. Vincular |
| **Cocheras con coeficiente 0** | Permitir (algunos reglamentos). Documentar decisión |
| **Cambio de coeficientes post-creación** | Requerir aprobación. Recalcular liquidaciones futuras |

---

## 7. Métricas de Éxito

| Métrica | Meta |
|---------|------|
| Tiempo de onboarding | < 10 minutos |
| Edificios configurados sin error | > 95% |
| Validación de coeficientes | 100% |
| Satisfacción del admin (NPS) | > 8 |
| Tokens usados por onboarding | < $0.05 |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]
