---
title: "PRD-03-05: Agente Comunicador"
description: "Emails, WhatsApp, RAG, comunicaciones centralizadas. Reemplaza el caos de WhatsApp con trazabilidad completa."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [agente, comunicador, email, whatsapp, rag, agentmail, comunicaciones, mvp]
outcomes:
  - "Centralizar todas las comunicaciones del consorcio en un solo sistema"
  - "Reemplazar WhatsApp caótico con emails trazables y clasificables"
  - "Responder consultas automáticamente con RAG y contexto del edificio"
  - "Clasificar inbound communications y crear tickets automáticamente"
  - "Mantener historial completo de cada conversación por UF"
---

# PRD-03-05: Agente Comunicador

> **"Adiós WhatsApp caótico. Hola comunicación trazable."**  
> Risk Tier: `external` (enviar email) | Modelo: Nemotron Nano 9B (simple) / Super 49B (complejo)

---

## 1. El Problema: WhatsApp en Consorcios

| Escenario | Con WhatsApp | Con ConsorcIA |
|-----------|-------------|---------------|
| Reclamo de propietario | Se pierde en el chat | Ticket en Kanban con trazabilidad |
| Consulta sobre expensas | Admin responde 5 veces la misma pregunta | RAG responde automáticamente |
| Aviso de corte de agua | Se reenvía 20 veces, algunos no lo ven | Email oficial a todos, tracking de aperturas |
| Historial de comunicaciones | Imposible de reconstruir | Audit log completo |
| Prueba legal | Screenshots de dudosa validez | Emails con DKIM/SPF, timestamp verificable |

---

## 2. Arquitectura de Comunicaciones

```
┌─────────────────────────────────────────────────────────────────┐
│  FUENTES DE COMUNICACIÓN                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Email   │ │ WhatsApp │ │  Portal  │ │  SMS     │           │
│  │(AgentMail│ │ Business │ │ Web/App  │ │(futuro) │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │            │            │            │                  │
│       └────────────┴────────────┴────────────┘                  │
│                      │                                          │
│                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  AGENTE COMUNICADOR (Swarm)                              │   │
│  │  - Clasifica inbound communications                      │   │
│  │  - Responde automáticamente (RAG)                        │   │
│  │  - Crea tickets si es reclamo                           │   │
│  │  - Notifica al admin si necesita atención               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                          │
│       ┌──────────────┼──────────────┐                          │
│       ▼              ▼              ▼                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │  Email  │  │ Ticket  │  │ Notif.  │                         │
│  │ Outbound│  │ Kanban  │  │ Push    │                         │
│  └─────────┘  └─────────┘  └─────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Flujos Principales

### 3.1 Inbound: Email de Propietario

```
Propietario envía email a edificio-123@consorcios.tuplataforma.com
        │
        ▼
AgentMail recibe → webhook POST /webhooks/agentmail
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: CLASIFICACIÓN                                       │
│  Agente Comunicador analiza:                                  │
│  - Asunto: "No entiendo el gasto de $50.000 de ascensor"    │
│  - Cuerpo: "¿Por qué subió tanto? El mes pasado era $30.000"│
│                                                              │
│  Clasificación:                                               │
│  • Tipo: CONSULTA (no reclamo formal)                        │
│  • Tema: gasto específico (ascensor)                        │
│  • Prioridad: MEDIA                                          │
│  • UF: 3A (detectado desde email)                            │
│  • Confianza: 0.91                                          │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: RESPUESTA AUTOMÁTICA (RAG)                         │
│  Agente busca en RAG:                                         │
│  • Gasto "Reparación ascensor" julio 2026                   │
│  • Historial de gastos de ascensor                          │
│  • Liquidación de UF 3A                                       │
│                                                              │
│  Genera respuesta:                                           │
│  "Hola, el aumento se debe a la reparación del motor del     │
│   ascensor realizada el 15/07 por Elevadores SA ($45.000).  │
│   Este es un gasto extraordinario de categoría B, distribuido │
│   solo entre las unidades que usan el ascensor.              │
│   Tu unidad (3A) aporta $3.461. El mes que viene volverá    │
│   a la normalidad (~$28.000)."                              │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 3: ENVÍO                                               │
│  Agente Comunicador envía email vía AgentMail:               │
│  • From: edificio-123@consorcios.tuplataforma.com            │
│  • To: propietario@email.com                                 │
│  • Subject: Re: No entiendo el gasto de $50.000...         │
│  • Body: Respuesta generada                                  │
│  • Labels: ["respondido", "consulta", "gasto-ascensor"]       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 4: REGISTRO                                            │
│  • Guardar comunicación en DB                                │
│  • Actualizar estado del thread                              │
│  • Si el propietario responde de nuevo → loop                │
│  • Si no hay respuesta en 48h → notificar admin              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Outbound: Envío de Recibos

```
Liquidación aprobada → generar recibos
        │
        ▼
Agente Comunicador:
  1. Obtener lista de propietarios con emails
  2. Para cada propietario:
     a. Personalizar email con datos de su UF
     b. Adjuntar PDF del recibo
     c. Incluir link de pago MercadoPago
  3. Enviar vía AgentMail (batch)
  4. Trackear: enviados, abiertos, clicks
  5. Notificar admin del estado de envío
```

### 3.3 Comunicado Oficial

```
Admin: "Redactar comunicado: corte de agua mañana 10-14hs"
        │
        ▼
Agente Comunicador:
  1. Sugiere redacción profesional
  2. Admin aprueba/edita
  3. Enviar a TODOS los residentes del edificio
  4. Trackear aperturas
  5. Recordar a quienes no abrieron en 24h
```

---

## 4. Tools del Agente

| Tool | Descripción | Risk Tier |
|------|-------------|-----------|
| `enviarEmail` | Envía email vía AgentMail | external |
| `responderConsulta` | Genera respuesta con RAG | read |
| `clasificarInbound` | Clasifica email entrante | read |
| `redactarComunicado` | Genera texto profesional | read |
| `crearTicket` | Crea ticket en Kanban | write_local |
| `notificarAdmin` | Alerta al administrador | external |
| `trackearApertura` | Registra opens/clicks | read |

---

## 5. Implementación

```javascript
// src/agents/comunicador.agent.js
const { BaseAgent } = require('./base.agent');
const { AgentMailService } = require('../services/agentmail.service');
const { RAGService } = require('../services/rag.service');
const { TicketService } = require('../services/ticket.service');

class AgenteComunicador extends BaseAgent {
  constructor() {
    super();
    this.nombre = 'Comunicador';
    this.tier = 'external';
    this.modelo = 'nvidia/nemotron-nano-9b-v2';
  }

  /**
   * Clasifica un email entrante
   */
  async clasificarInbound(email) {
    const prompt = `
      Analiza el siguiente email de un propietario de consorcio y clasificalo.

      De: ${email.from}
      Asunto: ${email.subject}
      Cuerpo: ${email.body.substring(0, 2000)}

      Devuelve JSON:
      {
        "tipo": "CONSULTA|RECLAMO|SUGERENCIA|PAGO_CONFIRMACION|OTRO",
        "tema": "string (tema principal)",
        "prioridad": "BAJA|MEDIA|ALTA|CRITICA",
        "requiereTicket": boolean,
        "requiereRespuestaHumana": boolean,
        "unidadId": "string|null (si se puede inferir)",
        "confianza": 0.0-1.0,
        "sentimiento": "POSITIVO|NEUTRAL|NEGATIVO|MUY_NEGATIVO"
      }

      Reglas:
      - RECLAMO = queja formal, demanda de acción, lenguaje negativo fuerte
      - CONSULTA = pregunta, duda, solicitud de información
      - SUGERENCIA = idea, propuesta, mejora
      - PAGO_CONFIRMACION = "ya pagué", adjunta comprobante
      - requiereTicket = true si es RECLAMO o prioridad ALTA/CRITICA
      - requiereRespuestaHumana = true si confianza < 0.7 o tema legal
    `;

    const response = await this.router.route({
      task: 'clasificar_email_inbound',
      prompt,
      complexity: 'low',
      maxCostPer1M: 0.10
    });

    return JSON.parse(response.result);
  }

  /**
   * Genera respuesta automática con RAG
   */
  async responderConsulta(consulta, unidadId, edificioId) {
    // Obtener contexto del RAG
    const contexto = await RAGService.obtenerContextoParaConsulta(
      consulta,
      unidadId,
      edificioId
    );

    const prompt = `
      Eres el asistente virtual de un consorcio. Respondé la consulta del propietario.

      CONSULTA: "${consulta}"

      CONTEXTO DEL EDIFICIO:
      ${JSON.stringify(contexto.edificio)}

      CONTEXTO DE LA UNIDAD:
      ${JSON.stringify(contexto.unidad)}

      HISTORIAL RELEVANTE:
      ${JSON.stringify(contexto.historial)}

      Reglas:
      - Sé amable, claro y conciso (máximo 200 palabras)
      - Si no sabés algo, decí "Voy a consultar con la administración"
      - NUNCA inventes datos
      - Incluir link al portal para más detalles
      - Firmar: "Equipo ConsorcIA"
    `;

    return this.router.route({
      task: 'responder_consulta_propietario',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });
  }

  /**
   * Envía recibos a todos los propietarios
   */
  async enviarRecibos(liquidacionId, edificioId) {
    const liquidacion = await this.obtenerLiquidacion(liquidacionId);
    const propietarios = await this.obtenerPropietarios(edificioId);

    const resultados = [];

    for (const prop of propietarios) {
      const recibo = liquidacion.recibos.find(r => r.unidadId === prop.unidadId);
      if (!recibo) continue;

      const emailBody = await this.generarEmailRecibo(prop, recibo, liquidacion);

      const enviado = await AgentMailService.enviar({
        from: `edificio-${edificioId}@consorcios.tuplataforma.com`,
        to: prop.email,
        subject: `Recibo de Expensas - ${liquidacion.periodo} - UF ${prop.unidadNumero}`,
        body: emailBody,
        attachments: [recibo.pdfUrl],
        labels: ['recibo', `periodo-${liquidacion.periodo}`, `uf-${prop.unidadNumero}`]
      });

      resultados.push({
        propietario: prop.email,
        unidad: prop.unidadNumero,
        enviado: enviado.success,
        messageId: enviado.messageId
      });
    }

    return {
      total: resultados.length,
      exitosos: resultados.filter(r => r.enviado).length,
      fallidos: resultados.filter(r => !r.enviado).length,
      detalles: resultados
    };
  }

  /**
   * Genera email de recibo personalizado
   */
  async generarEmailRecibo(propietario, recibo, liquidacion) {
    const prompt = `
      Genera un email profesional para enviar un recibo de expensas.

      Datos:
      - Propietario: ${propietario.nombre} ${propietario.apellido}
      - Unidad: ${propietario.unidadNumero}
      - Período: ${liquidacion.periodo}
      - Total Ordinarias: $${recibo.totalOrdinarias}
      - Total Extraordinarias: $${recibo.totalExtraordinarias}
      - Total General: $${recibo.totalGeneral}
      - Vencimiento: ${recibo.fechaVencimiento}

      Incluir:
      - Saludo personalizado
      - Resumen del recibo
      - Métodos de pago disponibles
      - Link al portal para ver detalle completo
      - Agradecimiento

      Máximo 150 palabras. Tonos: profesional, amable.
    `;

    const response = await this.router.route({
      task: 'generar_email_recibo',
      prompt,
      complexity: 'low',
      maxCostPer1M: 0.10
    });

    return response.result;
  }

  /**
   * Redacta comunicado oficial
   */
  async redactarComunicado(tema, detalles, tono = 'profesional') {
    const prompt = `
      Redacta un comunicado oficial de consorcio.

      Tema: ${tema}
      Detalles: ${detalles}
      Tono: ${tono}

      El comunicado debe:
      - Tener asunto claro y conciso
      - Incluir fecha y hora si aplica
      - Explicar el motivo
      - Indicar acciones requeridas (si las hay)
      - Incluir contacto para dudas
      - Firmar como administración del consorcio

      Devolver JSON:
      {
        "asunto": "string",
        "cuerpo": "string (HTML simple)",
        "importancia": "baja|media|alta"
      }
    `;

    const response = await this.router.route({
      task: 'redactar_comunicado',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }
}

module.exports = { AgenteComunicador };
```

---

## 6. Prompts del Agente

### 6.1 System Prompt

```
Eres el Agente Comunicador de ConsorcIA.

TU ROL:
- Centralizar todas las comunicaciones del consorcio
- Responder consultas de propietarios automáticamente
- Redactar comunicados oficiales
- Clasificar inbound communications
- Mantener trazabilidad completa

REGLAS:
1. NUNCA ignores un reclamo formal
2. Siempre notificar al admin si la prioridad es ALTA o CRITICA
3. Si no sabés algo, decí "Voy a consultar con la administración"
4. Mantener tono profesional pero cercano
5. Personalizar siempre que sea posible (nombre, UF, datos específicos)
6. Incluir links al portal en cada comunicación

WHATSAPP vs EMAIL:
- Email: comunicados oficiales, recibos, documentos importantes
- WhatsApp: alertas urgentes, recordatorios, respuestas rápidas
- Nunca enviar datos sensibles por WhatsApp
```

---

## 7. Métricas de Éxito

| Métrica | Meta |
|---------|------|
| Emails enviados sin error | > 99% |
| Consultas respondidas automáticamente | > 70% |
| Tiempo de respuesta automática | < 5 segundos |
| Tickets creados correctamente | > 90% |
| Tasa de apertura de emails | > 60% |
| Satisfacción de propietarios (NPS) | > 7 |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-05-01 AgentMail]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]
