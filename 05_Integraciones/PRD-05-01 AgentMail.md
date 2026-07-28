---
title: "PRD-05-01: AgentMail"
description: "Emails programáticos para agentes IA. Inboxes por consorcio, webhooks, labeling automático, dominios propios."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [integracion, agentmail, email, webhooks, inbox, comunicaciones, mvp]
outcomes:
  - "Crear inboxes programáticos para cada consorcio"
  - "Recibir emails vía webhook en tiempo real"
  - "Clasificar emails automáticamente con labels"
  - "Enviar emails personalizados desde dominios propios"
  - "Mantener historial completo de comunicaciones"
---

# PRD-05-01: AgentMail

> **"Cada consorcio tiene su propio email. Cada email se clasifica automáticamente."**  
> AgentMail reemplaza WhatsApp caótico con comunicación trazable y programática.

---

## 1. ¿Qué es AgentMail?

AgentMail es una plataforma **API-first diseñada para dar inboxes de email a agentes IA**. No es un servicio de email tradicional como SendGrid o AWS SES.

### 1.1 Diferencias clave

| Aspecto | SendGrid/SES | AgentMail |
|---------|-------------|-----------|
| Diseño | Email marketing masivo | Agentes IA conversacionales |
| Inboxes | No | Sí, programáticas |
| Dominios | Compartido | Propios por agente/consorcio |
| Webhooks | Limitados | Nativos, en tiempo real |
| Labeling | No | Automático con prompts |
| Full-text search | No | Sí, across todos los inboxes |
| Costo | $0.10/1K emails | $0.05/1K o menos |

### 1.2 Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  PROPIETARIO / ADMIN                                           │
│  envía email a: edificio-123@consorcios.tuplataforma.com       │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  AGENTMAIL                                                     │
│  • Recibe email                                               │
│  • Aplica labels automáticos (IA)                             │
│  • Almacena en inbox del consorcio                            │
│  • Dispara webhook a ConsorcIA backend                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONSORCIA BACKEND                                            │
│  • Recibe webhook POST /webhooks/agentmail                     │
│  • Agente Documental clasifica                                │
│  • Agente Comunicador responde (si aplica)                    │
│  • Crea ticket en Kanban (si es reclamo)                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Configuración

### 2.1 Setup Inicial

```javascript
// src/services/agentmail.service.js
const axios = require('axios');

class AgentMailService {
  constructor() {
    this.baseUrl = 'https://api.agentmail.com/v1';
    this.apiKey = process.env.AGENTMAIL_API_KEY;
  }

  /**
   * Crea un inbox para un consorcio
   */
  async crearInbox(edificioId, nombreEdificio) {
    const slug = nombreEdificio
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .substring(0, 30);

    const response = await axios.post(
      `${this.baseUrl}/inboxes`,
      {
        name: `Consorcio ${nombreEdificio}`,
        email: `edificio-${edificioId}@consorcios.tuplataforma.com`,
        webhook_url: `${process.env.API_URL}/webhooks/agentmail`,
        auto_labeling: true,
        labeling_prompt: `
          Clasifica este email de un consorcio argentino:
          - Tipo: CONSULTA|RECLAMO|SUGERENCIA|PAGO_CONFIRMACION|OTRO
          - Prioridad: BAJA|MEDIA|ALTA|CRITICA
          - Tema: string
        `
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );

    return response.data;
  }

  /**
   * Envía email desde el inbox del consorcio
   */
  async enviar({ from, to, subject, body, attachments = [], labels = [] }) {
    const response = await axios.post(
      `${this.baseUrl}/emails`,
      {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        body,
        attachments,
        labels,
        track_opens: true,
        track_clicks: true
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );

    return response.data;
  }

  /**
   * Obtiene métricas de un inbox
   */
  async obtenerMetricas(inboxId) {
    const response = await axios.get(
      `${this.baseUrl}/inboxes/${inboxId}/metrics`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );

    return response.data;
  }
}

module.exports = { AgentMailService };
```

### 2.2 Webhook Handler

```javascript
// routes/webhooks.routes.js
router.post('/agentmail',
  async (req, res) => {
    const { inbox_id, email, labels, timestamp } = req.body;

    // Validar firma del webhook
    if (!validarFirmaAgentMail(req.body, req.headers['x-signature'])) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    // Obtener edificio desde inbox_id
    const edificio = await prisma.edificio.findFirst({
      where: { agentmailInboxId: inbox_id }
    });

    if (!edificio) {
      return res.status(404).json({ error: 'Inbox no vinculado a edificio' });
    }

    // Guardar comunicación en DB
    await prisma.comunicacion.create({
      data: {
        organizacionId: edificio.organizacionId,
        edificioId: edificio.id,
        tipo: 'EMAIL',
        asunto: email.subject,
        contenido: email.body,
        destinatarios: [email.from],
        createdBy: 'system'
      }
    });

    // Delegar a Agente Documental para clasificación
    const clasificacion = await agenteDocumental.clasificarInbound({
      from: email.from,
      subject: email.subject,
      body: email.body,
      labels
    });

    // Si es reclamo o consulta, crear ticket o responder
    if (clasificacion.tipo === 'RECLAMO') {
      await agenteKanban.crearTicket({
        edificioId: edificio.id,
        titulo: email.subject,
        descripcion: email.body,
        prioridad: clasificacion.prioridad,
        fuente: 'email',
        referenciaExterna: email.message_id
      });
    } else if (clasificacion.tipo === 'CONSULTA') {
      const respuesta = await agenteComunicador.responderConsulta(
        email.body,
        null, // unidadId (inferir desde email)
        edificio.id
      );

      await agenteComunicador.enviarEmail({
        from: `edificio-${edificio.id}@consorcios.tuplataforma.com`,
        to: email.from,
        subject: `Re: ${email.subject}`,
        body: respuesta.result
      });
    }

    res.status(200).send('OK');
  }
);
```

---

## 3. Costos

| Escenario | Inboxes | Emails/mes | Costo/mes |
|-----------|---------|-----------|-----------|
| Desarrollo | 5-10 | 100 | $0-5 |
| Piloto (10 edificios) | 15-20 | 500 | $10-25 |
| Escala (100 edificios) | 100+ | 5.000 | $50-150 |
| Escala (500 edificios) | 500+ | 25.000 | $250-750 |

**vs Gmail Workspace:** $6/usuario/mes × 500 = $3.000/mes

---

## 4. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **Un inbox por edificio** | Organización | Cada consorcio tiene su propio email. Propietarios saben a quién escribir |
| **Dominio propio** | Branding | `consorcios.tuplataforma.com` en vez de `@gmail.com`. Más profesional. En el plan Enterprise white-label, la organización puede usar su propio dominio (ej. `@administracion-x.com`) |
| **Webhook en tiempo real** | Velocidad | Email llega → procesado en < 5 segundos. No polling |
| **Labels automáticos** | Clasificación | IA clasifica antes de que el admin lo vea. Priorización automática |
| **Tracking opens/clicks** | Métricas | Saber quién leyó el recibo, quién hizo click en el pago |

---

*Documento relacionado:* [[PRD-03-05 Agente Comunicador]]  
*Documento relacionado:* [[PRD-03-04 Agente Documental]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]
