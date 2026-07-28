---
title: "PRD-03-01: Arquitectura de Agentes"
description: "Swarm router, orquestación de agentes, patrones OpenWorker (Risk Tiers, Approval Inbox, Task Decomposition, Model Tiering, Iteration Cap)."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [agentes, swarm, orquestacion, openworker, patrones, risk-tiers, approval-inbox]
outcomes:
  - "Definir la arquitectura de 9 agentes especializados con roles claros"
  - "Implementar 5 patrones de OpenWorker para seguridad y control"
  - "Establecer límites de iteración para evitar loops infinitos de tokens"
  - "Configurar model tiering por agente para optimizar costos"
  - "Documentar flujos de handoff entre agentes"
---

# PRD-03-01: Arquitectura de Agentes

> **9 agentes especializados. 5 patrones de OpenWorker. 0 acciones sorpresa.**  
> Swarm orquesta, el motor contable calcula, el admin aprueba.

---

## 1. Arquitectura de Agentes

```
┌─────────────────────────────────────────────────────────────────┐
│  KIMI3 SWARM ROUTER (Node SDK)                                  │
│  - Distribuye tareas entre agentes                               │
│  - Gestiona contexto y memoria por conversación                 │
│  - Aplica patrones OpenWorker                                    │
└─────────────────────────────────────────────────────────────────┘
         │           │           │           │           │
    ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
    │ AGENTE  │ │ AGENTE  │ │ AGENTE  │ │ AGENTE  │ │ AGENTE  │
    │ONBOARD  │ │CONTABLE │ │DOCUMENTAL│ │COMUNIC. │ │COBRANZAS│
    │  (MVP)  │ │  (MVP)  │ │  (MVP)  │ │  (MVP)  │ │  (MVP)  │
    └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
         │           │           │           │           │
    ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
    │ AGENTE  │ │ AGENTE  │ │ AGENTE  │ │ AGENTE  │ │ CERBOS  │
    │KANBAN   │ │DASHBOARD│ │BENCH-   │ │PORTAL   │ │ PDP     │
    │ (Fase2) │ │ (Fase2) │ │MARKING  │ │RESIDENTE│ │(RBAC)   │
    │         │ │         │ │ (Fase3) │ │ (MVP)   │ │         │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

---

## 2. Definición de Agentes

### 2.1 Agente Onboarding (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | Configura edificios y unidades mediante conversación |
| **Modelo** | Nemotron Super 49B (medium) |
| **Tools** | `crearEdificio`, `crearUnidad`, `validarCoeficientes`, `importarReglamento` |
| **Input** | Descripción conversacional del edificio |
| **Output** | Estructura completa del edificio listo para usar |
| **Risk Tier** | write_local |

**Flujo:**
```
Admin: "Tengo un edificio de 10 pisos, 2 departamentos por piso, 
        cocheras en PB y bauleras en subsuelo"
        │
        ▼
Agente Onboarding:
  1. Sugiere tipologías: deptos 1-10A, 1-10B, cocheras 1-20, bauleras 1-10
  2. Pide confirmación de coeficientes (o sugiere por m²)
  3. Valida que suma = 1.000000
  4. Crea edificio + unidades en DB
  5. Genera resumen visual del edificio
```

### 2.2 Agente Contable (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | Wrapper del motor contable. Parsea, categoriza, explica. |
| **Modelo** | Nemotron Super 49B (medium) / Kimi K2 (high para explicaciones) |
| **Tools** | `cargarGasto`, `sugerirCategoria`, `calcularDistribucion`, `generarLiquidacion`, `explicarLiquidacion` |
| **Input** | Gasto en lenguaje natural o datos estructurados |
| **Output** | Gasto categorizado + distribución calculada + explicación |
| **Risk Tier** | write_local (carga) / exec (liquidación) |

**Flujo:**
```
Admin: "Cargar gasto: Reparación ascensor $45.000, pagado a Elevadores SA"
        │
        ▼
Agente Contable:
  1. Parsea: concepto="Reparación ascensor", monto=45000, proveedor="Elevadores SA"
  2. Sugiere categoría: B (servicio específico: ascensor)
  3. Valida con motor contable (determinístico)
  4. Muestra preview de distribución
  5. Admin confirma → guarda en DB
  6. Si admin pregunta "¿por qué pagamos tanto?" → explica con contexto histórico
```

> **CRÍTICO:** El agente NUNCA calcula. Solo wrappea llamadas al motor contable.

### 2.3 Agente Documental (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | OCR, parsing de PDFs, normalización de conceptos |
| **Modelo** | Nemotron Nano 12B VL (vision) / Nemotron Super 49B (text) |
| **Tools** | `parsearPDF`, `extraerTexto`, `normalizarConcepto`, `mapearPlanCuentas` |
| **Input** | PDF de expensas, facturas, comprobantes |
| **Output** | Datos estructurados extraídos + sugerencias de categorización |
| **Risk Tier** | read (parsing) / write_local (guardar en DB) |

**Flujo:**
```
Admin: "Subo el resumen de expensas de julio" [PDF]
        │
        ▼
Agente Documental:
  1. OCR del PDF (Unlimited-OCR microservicio)
  2. Extrae: conceptos, montos, fechas, categorías
  3. Normaliza conceptos vs plan de cuentas existente
  4. Sugiere categorías A/B/C para gastos nuevos
  5. Muestra preview tabulado
  6. Admin revisa y confirma → carga al sistema
```

### 2.4 Agente Comunicador (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | Envía y responde comunicaciones. Email, WhatsApp, RAG. |
| **Modelo** | Nemotron Nano 9B (simple) / Nemotron Super 49B (complejo) |
| **Tools** | `enviarEmail`, `responderConsulta`, `redactarComunicado`, `traducirLegalese` |
| **Input** | Consulta de propietario o instrucción del admin |
| **Output** | Email/WhatsApp enviado o respuesta generada |
| **Risk Tier** | external (enviar email real) |

**Flujo:**
```
Propietario (email): "No entiendo el gasto de $50.000 de ascensor"
        │
        ▼
AgentMail webhook → Backend
        │
        ▼
Agente Documental clasifica: "consulta sobre gasto específico"
        │
        ▼
Agente Comunicador:
  1. Busca contexto en RAG (gasto, historial de ascensor)
  2. Genera respuesta clara: "El gasto corresponde a la reparación 
     del motor del ascensor realizada el 15/07 por Elevadores SA. 
     Este es un gasto de categoría B, distribuido solo entre las 
     unidades que usan el ascensor..."
  3. Envía respuesta vía AgentMail
  4. Si es reclamo formal → crea ticket en Kanban (Fase 2)
```

### 2.5 Agente Cobranzas (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | Gestiona cobros, recordatorios, links de pago |
| **Modelo** | Nemotron Nano 9B (simple) |
| **Tools** | `generarRecordatorio`, `crearLinkPago`, `registrarCobro`, `sugerirPlanPago` |
| **Input** | Estado de cobros, instrucciones del admin |
| **Output** | Email/WhatsApp de recordatorio + link MercadoPago |
| **Risk Tier** | external (enviar email) / write_local (registrar cobro) |

### 2.6 Agente Kanban (Fase 2)

| Atributo | Valor |
|----------|-------|
| **Rol** | Gestiona tareas del consorcio. Clasifica, asigna, resume. |
| **Modelo** | Nemotron Super 49B (medium) |
| **Tools** | `crearTicket`, `clasificarTicket`, `asignarTicket`, `resumirEstado` |
| **Input** | Solicitud entrante (email, WhatsApp, portal) |
| **Output** | Ticket en Kanban con estado, prioridad, asignación |
| **Risk Tier** | write_local |

### 2.7 Agente Dashboard (Fase 2)

| Atributo | Valor |
|----------|-------|
| **Rol** | Genera insights y narrativas para el admin |
| **Modelo** | Nemotron 3 Super 120B (complex) |
| **Tools** | `analizarGastos`, `detectarAnomalias`, `generarNarrativa`, `compararPeriodos` |
| **Input** | Datos de gastos, liquidaciones, cobros |
| **Output** | Reporte narrativo con insights y recomendaciones |
| **Risk Tier** | read |

### 2.8 Agente Benchmarking (Fase 3)

| Atributo | Valor |
|----------|-------|
| **Rol** | Compara costos entre edificios (datos anonimizados) |
| **Modelo** | Nemotron 3 Super 120B (complex) |
| **Tools** | `analizarDatosAgregados`, `generarKPIs`, `compararZonas` |
| **Input** | Datos anonimizados de múltiples edificios |
| **Output** | Reporte comparativo con KPIs |
| **Risk Tier** | read |

### 2.9 Agente Portal Residente (MVP)

| Atributo | Valor |
|----------|-------|
| **Rol** | Chatbot en el portal para consultas de propietarios |
| **Modelo** | Nemotron Nano 9B (simple) / Super 49B (complejo) |
| **Tools** | `consultarExpensas`, `consultarDocumentos`, `consultarEstadoCuenta` |
| **Input** | Pregunta del propietario |
| **Output** | Respuesta contextual con datos del propietario |
| **Risk Tier** | read |

---

## 3. Patrones de OpenWorker

### 3.1 Patrón 1: Sistema de 4 Tiers de Riesgo ⭐ ALTA PRIORIDAD

Cada acción de un agente se clasifica en 4 niveles de riesgo:

```
┌─────────────────────────────────────────────────────────────┐
│  TIER DE RIESGO     │ DESCRIPCIÓN        │ EJEMPLO          │
├─────────────────────────────────────────────────────────────┤
│  read               │ Sin side effects   │ Ver expensas,    │
│                     │                    │ consultar estado │
├─────────────────────────────────────────────────────────────┤
│  write_local        │ Muta el workspace  │ Cargar un gasto, │
│                     │ (scopeado)         │ crear unidad     │
├─────────────────────────────────────────────────────────────┤
│  exec               │ Ejecuta procesos   │ Generar PDF de   │
│                     │                    │ liquidación      │
├─────────────────────────────────────────────────────────────┤
│  external           │ Side effects fuera │ Enviar email     │
│                     │ del sistema        │ real, procesar   │
│                     │                    │ pago             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Patrón 2: 5 Modos de Permiso

```
┌─────────────────────────────────────────────────────────────┐
│  MODO          │ QUÉ PERMITE              │ USO             │
├─────────────────────────────────────────────────────────────┤
│  discuss       │ Solo lectura             │ Modo auditor    │
├─────────────────────────────────────────────────────────────┤
│  plan          │ Planificación sin        │ "Veamos cómo    │
│                │ ejecución                │ quedaría la     │
│                │                          │ liquidación"    │
├─────────────────────────────────────────────────────────────┤
│  interactive   │ Pregunta antes de        │ MODO DEFAULT    │
│  (default)     │ write/exec/external      │ para admins     │
├─────────────────────────────────────────────────────────────┤
│  auto          │ Ejecuta todo scopeado    │ Tareas batch    │
│                │                          │ nocturnas       │
├─────────────────────────────────────────────────────────────┤
│  custom        │ Auto-approve de tools    │ "Siempre        │
│                │ específicas              │ permitir enviar │
│                │                          │ emails, preguntar│
│                │                          │ antes de gastos  │
│                │                          │ >$100K"         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Patrón 3: Approval Inbox ⭐ ALTA PRIORIDAD

Antes de cualquier acción de tier `exec` o `external`, el agente crea una tarea en el **Approval Inbox** del admin:

```
┌─────────────────────────────────────────────────────────────┐
│  APPROVAL INBOX (Dashboard del Admin)                       │
├─────────────────────────────────────────────────────────────┤
│  [PENDIENTE] Cargar gasto: Reparación ascensor - $45.000   │
│     Solicitado por: Agente Contable | Tier: write_local    │
│     [Aprobar] [Rechazar] [Ver detalle]                      │
│                                                             │
│  [PENDIENTE] Generar liquidación Julio 2026               │
│     Solicitado por: Agente Contable | Tier: exec           │
│     [Aprobar] [Rechazar] [Preview]                          │
│                                                             │
│  [APROBADO] Enviar recibos a 45 propietarios              │
│     Ejecutado: 2026-07-25 14:30 | Por: Admin María        │
└─────────────────────────────────────────────────────────────┘
```

**Implementación:**
```javascript
// src/agents/base.agent.js
class BaseAgent {
  async ejecutarConAprobacion(tier, accion, datos) {
    if (tier === 'read') {
      return await accion(datos);
    }

    // Crear tarea en Approval Inbox
    const approvalId = await this.crearApprovalTask({
      agente: this.nombre,
      tier,
      accion: accion.name,
      datos,
      timestamp: new Date()
    });

    // Esperar aprobación (o timeout)
    const aprobacion = await this.esperarAprobacion(approvalId, { timeout: 3600000 });

    if (aprobacion.estado === 'APROBADO') {
      return await accion(datos);
    } else {
      throw new Error(`Acción rechazada por ${aprobacion.aprobadoPor}`);
    }
  }
}
```

### 3.4 Patrón 4: Descomposición de Tareas en Pasos

OpenWorker descompone tareas complejas en pasos ejecutables:

```
Tarea: "Liquidar expensas de julio 2026"
  │
  ├── Paso 1: Recolectar todos los gastos del mes
  │     → Agente Contable: SELECT * FROM gastos WHERE mes=7
  │
  ├── Paso 2: Verificar categorización de gastos
  │     → Agente Documental: detectar sin categoría → sugerir
  │
  ├── Paso 3: Calcular distribución por coeficientes A/B/C
  │     → Motor Contable (determinístico): aplicar coeficientes
  │
  ├── Paso 4: Generar recibos en PDF con QR (Ley 941)
  │     → Agente Contable: llamar a Recibos Generator
  │
  ├── Paso 5: Enviar recibos a propietarios vía AgentMail
  │     → Agente Comunicador: email personalizado por unidad
  │
  └── Paso 6: Registrar cobros esperados
        → Agente Cobranzas: crear registros (estado: pendiente)
```

**Implementación:**
```javascript
// src/agents/swarm.task-decomposer.js
class TaskDecomposer {
  async decomponer(tarea, contexto) {
    const prompt = `
      Descompón la siguiente tarea en pasos ejecutables:

      Tarea: "${tarea}"
      Contexto: ${JSON.stringify(contexto)}

      Para cada paso, indica:
      - número
      - descripción
      - agente responsable
      - tools a usar
      - tier de riesgo
      - dependencias (qué pasos deben completarse antes)

      Responde en formato JSON array.
    `;

    const response = await this.router.route({
      task: 'decomponer_tarea',
      prompt,
      complexity: 'medium'
    });

    return JSON.parse(response.result);
  }
}
```

### 3.5 Patrón 5: Cap de Iteraciones

Limitar a **12 iteraciones modelo→tool** para evitar loops infinitos:

```javascript
// src/agents/swarm.orchestrator.js
class SwarmOrchestrator {
  MAX_ITERATIONS = 12;

  async ejecutarFlujo(agente, tarea) {
    let iteracion = 0;
    let estado = { completado: false, resultado: null };

    while (!estado.completado && iteracion < this.MAX_ITERATIONS) {
      iteracion++;

      const respuesta = await agente.pensar(tarea, estado);

      if (respuesta.accion === 'finalizar') {
        estado.completado = true;
        estado.resultado = respuesta.resultado;
      } else if (respuesta.accion === 'usar_tool') {
        const toolResult = await this.ejecutarTool(respuesta.tool, respuesta.params);
        estado = { ...estado, ultimoToolResult: toolResult };
      } else if (respuesta.accion === 'delegar') {
        const subAgente = this.obtenerAgente(respuesta.agente);
        estado = await this.ejecutarFlujo(subAgente, respuesta.subtarea);
      }
    }

    if (iteracion >= this.MAX_ITERATIONS && !estado.completado) {
      throw new Error(`Límite de iteraciones alcanzado (${this.MAX_ITERATIONS}). Tarea: ${tarea}`);
    }

    return estado.resultado;
  }
}
```

---

## 4. Flujo de Handoff entre Agentes

```
┌─────────────────────────────────────────────────────────────────┐
│  FLUJO: "Propietario reclama por email"                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Propietario envía email a edificio-123@consorcios.app      │
│     → AgentMail recibe → webhook a Backend                     │
│                                                                 │
│  2. Agente Documental clasifica:                                │
│     → "reclamo sobre gasto de ascensor"                         │
│     → Confianza: 0.92                                          │
│                                                                 │
│  3. Swarm Router decide:                                       │
│     → Si confianza > 0.85: crear ticket automáticamente       │
│     → Si confianza < 0.85: escalar a admin para revisión     │
│                                                                 │
│  4. Agente Kanban (Fase 2):                                     │
│     → Crea ticket: "Reclamo ascensor - UF 3A"                 │
│     → Prioridad: MEDIA (basado en sentimiento del email)      │
│     → Asigna a: admin del edificio                            │
│     → Estado: NUEVO                                           │
│                                                                 │
│  5. Agente Comunicador:                                        │
│     → Notifica al admin: "Nuevo ticket creado automáticamente"  │
│     → Responde al propietario: "Tu reclamo fue registrado..." │
│                                                                 │
│  6. Admin resuelve ticket en Kanban                             │
│     → Agente Comunicador notifica al propietario               │
│     → Agente Cobranzas actualiza estado si aplica              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **9 agentes especializados** | En vez de 1 generalista | Especialización = mejor calidad, menor costo. Un agente de clasificación no necesita entender liquidaciones |
| **Swarm Router central** | Orquestación | Un solo punto de entrada. Distribuye tareas, gestiona contexto, aplica patrones OpenWorker |
| **Risk Tiers** | Seguridad | El admin controla qué puede hacer la IA. Zero acciones sorpresa |
| **Approval Inbox** | Transparencia | El admin ve exactamente qué quiere hacer la IA antes de que pase |
| **Task Decomposition** | Complejidad | Tareas grandes se dividen en pasos pequeños. Si falla, se sabe exactamente dónde |
| **Iteration Cap (12)** | Costos | Un agente confundido no consume tokens eternamente. Límite hard |
| **Model tiering por agente** | Costos | Agente Comunicador (chat simple) usa Nano 9B. Agente Dashboard (análisis) usa Super 120B |
| **Agente Contable = wrapper** | Compliance | El agente NUNCA calcula. Solo parsea, sugiere, explica. El motor contable hace los números |

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-06 Router LLM]]  
*Documento relacionado:* [[PRD-03-02 Agente Onboarding]]  
*Documento relacionado:* [[PRD-03-03 Agente Contable]]
