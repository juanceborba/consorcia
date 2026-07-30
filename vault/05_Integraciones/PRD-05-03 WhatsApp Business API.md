---
title: "PRD-05-03: WhatsApp Business API"
description: "Especificación de la integración con WhatsApp Business API para comunicaciones bidireccionales: notificaciones automáticas, chatbot de consultas frecuentes y creación de tickets desde mensajes."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [whatsapp, api, comunicaciones, chatbot, notificaciones, integracion, consorcIA]
outcomes:
  - "Definir flujos de mensajes outbound e inbound"
  - "Especificar clasificación automática de mensajes entrantes"
  - "Diseñar chatbot de consultas frecuentes con RAG"
  - "Establecer integración con Kanban para creación de tickets"
  - "Documentar políticas de uso y costos de conversaciones"
---

# PRD-05-03: WhatsApp Business API

> **WhatsApp es el canal de comunicación que los propietarios ya usan. La integración con WhatsApp Business API permite enviar notificaciones proactivas (expensas, vencimientos, alertas) y recibir consultas que el Agente Comunicador responde automáticamente o convierte en tickets del Kanban.**

---

## 1. Alcance de la Integración

### 1.1 Casos de uso

| Caso | Dirección | Actor | Fase |
|------|-----------|-------|------|
| Notificación de expensas | Outbound | Agente Comunicador | MVP |
| Recordatorio de vencimiento | Outbound | Agente Cobranzas | MVP |
| Confirmación de pago | Outbound | Agente Cobranzas | MVP |
| Alerta de ticket creado/actualizado | Outbound | Agente Kanban | Fase 2 |
| Consulta "¿Cuánto debo?" | Inbound | Propietario → Agente Comunicador | MVP |
| Consulta "¿Cuándo arreglan X?" | Inbound | Propietario → Agente Kanban | Fase 2 |
| Reclamo / Solicitud | Inbound | Propietario → Agente Kanban | Fase 2 |
| Consulta general sobre expensas | Inbound | Propietario → Agente Comunicador (RAG) | Fase 2 |

### 1.2 Tipos de conversación (Meta)

| Tipo | Costo | Uso |
|------|-------|-----|
| **User-initiated** | ~$0.005-0.008 | El propietario escribe primero. Ventana de 24h para responder. |
| **Business-initiated** | ~$0.03-0.05 | La plataforma envía primero. Requiere template aprobado por Meta. |
| **Free entry point** | $0 | El propietario entra por un anuncio o QR. Primer conversación gratis. |

---

## 2. Arquitectura de Integración

### 2.1 Diagrama de flujo

```
Propietario (WhatsApp)          Meta Cloud API          Backend ConsorcIA
        │                              │                        │
        │── "¿Cuánto debo?" ──────────▶│                        │
        │                              │── Webhook ─────────────▶│
        │                              │   (message_received)    │
        │                              │                        │
        │                              │                        │── Clasificar
        │                              │                        │   (Agente Kanban)
        │                              │                        │
        │                              │                        │── Si es consulta:
        │                              │                        │   Agente Comunicador
        │                              │                        │   responde con RAG
        │                              │                        │
        │◀── "Debes $45.000 de ────────│◀── Enviar mensaje ─────│
        │    expensas de julio.        │                        │
        │    Vencimiento: 10/08"       │                        │
        │                              │                        │
        │── "Se rompió la canilla" ────▶│                        │
        │                              │── Webhook ─────────────▶│
        │                              │                        │── Clasificar:
        │                              │                        │   "mantenimiento"
        │                              │                        │
        │                              │                        │── Crear ticket
        │                              │                        │   #234 en Kanban
        │                              │                        │
        │◀── "Ticket #234 creado. ─────│◀── Enviar mensaje ─────│
        │    Te avisamos cuando        │                        │
        │    tengamos novedades."      │                        │
```

### 2.2 Configuración de WhatsApp Business Account

```typescript
interface WhatsAppConfig {
  // Credenciales de Meta
  phoneNumberId: string;      // ID del número de teléfono de WABA
  businessAccountId: string;  // ID de la cuenta de negocio
  accessToken: string;        // Token de acceso (rotar cada 60 días)

  // Webhook
  webhookVerifyToken: string; // Token para verificación de webhook
  webhookUrl: string;         // https://api.consorcia.com/webhooks/whatsapp

  // Templates aprobados por Meta
  templates: WhatsAppTemplate[];
}

interface WhatsAppTemplate {
  name: string;               // "expensas_notificacion", "pago_confirmado", etc.
  language: 'es_AR';
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  components: {
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    text: string;             // "Hola {{1}}, tus expensas de {{2}} son {{3}}"
    example?: { body_text: string[][] };
  }[];
}
```

---

## 3. Templates de Mensajes

### 3.1 Templates aprobados (MVP)

| Template | Categoría | Variables | Uso |
|----------|-----------|-----------|-----|
| `expensas_notificacion` | UTILITY | nombre, mes, monto, vencimiento | Notificar expensas disponibles |
| `pago_confirmado` | UTILITY | nombre, monto, fecha, metodo | Confirmar pago recibido |
| `vencimiento_recordatorio` | UTILITY | nombre, monto, dias_restantes | Recordar vencimiento próximo |
| `ticket_actualizado` | UTILITY | nombre, ticket_id, estado, mensaje | Notificar cambio de estado |
| `comunicado_general` | UTILITY | nombre, asunto, resumen | Comunicados del consorcio |

### 3.2 Ejemplo de template

```
Nombre: expensas_notificacion
Categoría: UTILITY

[HEADER]
💰 Expensas de {{2}}

[BODY]
Hola {{1}},

Tus expensas de {{2}} ya están disponibles.

📋 Monto total: {{3}}
📅 Vencimiento: {{4}}

Podés pagar online desde el portal o con el link de pago.

[FOOTER]
ConsorcIA — Gestión inteligente de consorcios

[BUTTONS]
[🔗 Pagar online] → URL dinámica
[📄 Ver detalle] → URL al portal
```

---

## 4. Clasificación de Mensajes Inbound

### 4.1 Pipeline de procesamiento

```
Mensaje entrante de WhatsApp
        │
        ▼
┌─────────────────────────────┐
│ Paso 1: Identificar         │ → Match número de teléfono con UF
│ remitente                   │   Si no existe → respuesta genérica
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 2: Clasificar          │ → Nemotron Nano 9B
│ intención                   │   Intenciones:
│                             │   - consulta_expensas
│                             │   - consulta_estado_ticket
│                             │   - reclamo_mantenimiento
│                             │   - reclamo_general
│                             │   - pago_consulta
│                             │   - consulta_general
│                             │   - spam
└─────────────┬───────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ CONSULTA │    │ ACCIÓN       │
│ SIMPLE   │    │ REQUERIDA    │
└────┬─────┘    └──────┬───────┘
     │                 │
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ Agente   │    │ Agente       │
│ Comunica-│    │ Kanban       │
│ dor      │    │ (crea ticket)│
│ responde │    │              │
│ con RAG  │    │ Notifica     │
└──────────┘    │ al solicitante
                └──────────────┘
```

### 4.2 Ejemplos de clasificación

| Mensaje | Intención detectada | Acción |
|---------|---------------------|--------|
| "¿Cuánto debo?" | `consulta_expensas` | Agente Comunicador responde con deuda actual |
| "¿Ya arreglaron la canilla?" | `consulta_estado_ticket` | Agente Kanban busca ticket y responde estado |
| "Se rompió la canilla del baño" | `reclamo_mantenimiento` | Agente Kanban crea ticket #234 |
| "No me gusta el nuevo encargado" | `reclamo_general` | Agente Kanban crea ticket (baja prioridad) |
| "¿Puedo pagar en cuotas?" | `pago_consulta` | Agente Cobranzas responde opciones |
| "¿Cuándo es la próxima asamblea?" | `consulta_general` | Agente Comunicador responde con RAG |
| "Comprá criptomonedas acá" | `spam` | Ignorar, posible bloqueo |

---

## 5. RAG para Consultas Frecuentes

### 5.1 Base de conocimiento

```
Documentos indexados (pgvector):
├── Reglamento de PH del edificio
├── Actas de asambleas (últimas 2 años)
├── Comunicados del consorcio
├── FAQ del edificio (creada por admin)
├── Ley 941 (resumen para propietarios)
├── CCyC artículos relevantes
└── Historial de tickets resueltos
```

### 5.2 Flujo RAG

```
Consulta: "¿Puedo tener perro en el departamento?"
        │
        ▼
┌─────────────────────────────┐
│ 1. Embedding de la consulta │ → Nemotron 3 Embed 1B (gratis)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 2. Semantic search en       │ → pgvector, top 5 chunks
│    pgvector                 │   (reglamento + actas + FAQ)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 3. Generar respuesta        │ → Nemotron Super 49B
│    con contexto             │   "Según el reglamento art. 12,
│                             │    se permiten mascotas de hasta
│                             │    10kg con previa autorización..."
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 4. Enviar por WhatsApp      │ → Texto conciso (<400 chars)
│    + link al documento      │   "Ver reglamento completo: [link]"
└─────────────────────────────┘
```

---

## 6. Costos y Límites

### 6.1 Estimación de costos

| Escenario | Conversaciones/mes | Costo estimado |
|-----------|-------------------|----------------|
| MVP (10 edificios, 150 UF) | ~500 | $15-25 |
| Lanzamiento (100 edificios) | ~5.000 | $150-250 |
| Escala (500 edificios) | ~25.000 | $750-1.250 |
| Escala grande (2.000 edificios) | ~100.000 | $3.000-5.000 |

### 6.2 Estrategia de reducción de costos

- **User-initiated vs Business-initiated:** Fomentar que el propietario escriba primero (más barato).
- **Consolidar notificaciones:** Un solo mensaje con múltiples datos vs varios mensajes.
- **AgentMail como alternativa:** Para comunicados masivos, usar email (más barato) y WhatsApp solo para urgentes.
- **Respuestas cacheadas:** "¿Cuánto debo?" → cachear por 1h para la misma UF.

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **API** | WhatsApp Business API (Meta) | Oficial, confiable, soportada. No usar APIs no oficiales. |
| **Templates** | UTILITY category | Menor costo y mayor tasa de aprobación por Meta. |
| **Inbound** | Clasificación automática + RAG | Reduce carga del admin. 70% de consultas se resuelven sin humano. |
| **Outbound** | Solo notificaciones esenciales | Evitar spam. Respetar horario (9am-8pm). |
| **Fallback** | Si no entiende → "Te contactará el admin" | Transparencia. No inventar respuestas. |
| **Idioma** | Español argentino (es_AR) | Templates en lenguaje local. |
| **Opt-out** | "Escribí BAJA para dejar de recibir mensajes" | Ley 25.326. Respetar derecho del usuario. |

---

*Documento relacionado:* [[PRD-03-05 Agente Comunicador]]  
*Documento relacionado:* [[PRD-03-07 Agente Kanban]]  
*Documento relacionado:* [[PRD-04-06 Kanban de Tareas]]  
*Documento relacionado:* [[PRD-05-01 AgentMail]]  
*Documento relacionado:* [[PRD-05-06 Embeddings y RAG]]