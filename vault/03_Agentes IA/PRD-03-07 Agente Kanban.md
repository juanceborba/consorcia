---
title: "PRD-03-07: Agente Kanban"
description: "Especificación del agente especializado en gestión de tareas del consorcio: clasificación, asignación, seguimiento de SLAs y comunicación integrada entre solicitante y administración."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P1"
tags: [agente, kanban, tareas, swarm, clasificacion, sla, comunicacion, consorcIA]
outcomes:
  - "Definir responsabilidades y límites del Agente Kanban"
  - "Especificar flujo de clasificación automática de solicitudes"
  - "Establecer reglas de asignación y escalamiento"
  - "Diseñar integración con AgentMail para comunicación bidireccional"
  - "Documentar políticas de SLA y notificaciones"
---

# PRD-03-07: Agente Kanban

> **El Agente Kanban es el cerebro operativo del sistema de tareas del consorcio. Recibe solicitudes desde múltiples canales (email, WhatsApp, portal), las clasifica automáticamente, sugiere asignación, mantiene el historial de comunicación y garantiza que nada se pierda.**

---

## 1. Responsabilidades

### 1.1 Scope del agente

| Responsabilidad | Sí/No | Detalle |
|-----------------|-------|---------|
| Clasificar solicitudes entrantes | ✅ | Por tipo, urgencia, categoría |
| Crear tickets en el kanban | ✅ | Con metadata completa |
| Asignar a responsable | ✅ | Sugerir, no forzar (requiere aprobación admin) |
| Escalar según SLA | ✅ | Alertas automáticas |
| Responder al solicitante | ✅ | Acuses de recibo, actualizaciones de estado |
| Cerrar tickets | ⚠️ | Solo si el admin lo aprueba o es auto-resoluble |
| Modificar estados del kanban | ✅ | Transiciones válidas según workflow |
| Generar reportes de tareas | ⚠️ | Delega al Agente Dashboard |
| Calcular costos de reparación | ❌ | Delega al Agente Contable |
| Aprobar gastos | ❌ | Requiere Approval Inbox (OpenWorker pattern) |

### 1.2 Límites explícitos

- **NO aprueba gastos.** Cualquier ticket que implique un gasto >ARS 10.000 genera una tarea de aprobación en el Approval Inbox del admin.
- **NO modifica datos del edificio.** No puede cambiar coeficientes, unidades, ni reglamento.
- **NO accede a datos de otros consorcios.** Operación estrictamente scopeada por `organizacion_id` y `edificio_id`.

---

## 2. Flujo de Clasificación Automática

### 2.1 Entradas del sistema

```
Canal de entrada:
├── AgentMail (email a edificio-123@consorcios.consorcia.com)
├── WhatsApp Business API
├── Portal web (formulario del residente)
└── Creación manual por admin
```

### 2.2 Pipeline de clasificación

```
Solicitud entrante
        │
        ▼
┌─────────────────┐
│ Paso 1: Parseo  │ → Extraer: solicitante, UF, descripción,
│ de contenido    │   adjuntos, urgencia implícita
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 2:         │ → Modelo Nemotron Nano 9B
│ Clasificación   │   Categorías: mantenimiento, reclamo,
│ por tipo        │   consulta, pago, solicitud mejora,
│                 │   emergencia, denuncia
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 3:         │ → Heurísticas + Nemotron
│ Detección de    │   Urgencia: alta (emergencia),
│ urgencia        │   media (reclamo), baja (consulta)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 4:         │ → Matching con plan de cuentas + historial
│ Enriquecimiento │   Sugerir: proveedor histórico, costo
│ de contexto     │   estimado, documentación relacionada
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Paso 5:         │ → Crear ticket en estado "Nuevo"
│ Creación de     │   Notificar al admin + solicitante
│ ticket          │   Agregar al Approval Inbox si requiere gasto
└─────────────────┘
```

### 2.3 Categorías de clasificación

| Categoría | Descripción | SLA | Asignación default |
|-----------|-------------|-----|-------------------|
| **Mantenimiento** | Reparaciones, averías, servicios | 48h | Encargado / Proveedor |
| **Reclamo** | Quejas, incumplimientos | 24h | Administrador |
| **Consulta** | Preguntas sobre expensas, reglamento | 72h | Agente Comunicador (auto) |
| **Solicitud de mejora** | Ampliaciones, cambios | 7 días | Consejo de Propietarios |
| **Emergencia** | Inundación, electricidad, seguridad | 4h | Admin + Encargado (urgente) |
| **Pago / Cobranza** | Consultas sobre deuda, planes | 24h | Agente Cobranzas |
| **Denuncia** | Incumplimiento normas convivencia | 48h | Consejo de Propietarios |

---

## 3. Estados del Kanban y Transiciones

### 3.1 Workflow por defecto

```
[NUEVO] → [TRIAGE] → [ASIGNADO] → [EN PROGRESO] → [PENDIENTE APROBACION]
                                              ↓
                                        [RESUELTO] → [CERRADO]
                                              ↓
                                        [RECHAZADO]
```

### 3.2 Reglas de transición

| De | A | Quién puede | Condición |
|----|---|-------------|-----------|
| NUEVO | TRIAGE | Sistema (auto) | Clasificación completada |
| TRIAGE | ASIGNADO | Admin o Agente Kanban | Asignación confirmada |
| ASIGNADO | EN PROGRESO | Responsable asignado | Primer comentario o acción |
| EN PROGRESO | PENDIENTE APROBACION | Responsable | Requiere gasto >ARS 10.000 |
| PENDIENTE APROBACION | EN PROGRESO | Admin (Approval Inbox) | Gasto aprobado |
| PENDIENTE APROBACION | RECHAZADO | Admin | Gasto rechazado |
| EN PROGRESO | RESUELTO | Responsable | Tarea completada |
| RESUELTO | CERRADO | Admin o solicitante | Validación final (48h auto-close) |
| Cualquiera | CANCELADO | Admin | Ticket inválido o duplicado |

---

## 4. Comunicación Integrada

### 4.1 Flujo solicitante ↔ consorcio

```
Solicitante envía email a edificio-123@consorcios.consorcia.com
                    │
                    ▼
            AgentMail recibe
                    │
                    ▼
            Agente Kanban clasifica
                    │
                    ▼
            ┌───────────────┐
            │ Si es consulta│ → Agente Comunicador responde auto
            │ simple        │   (ej: "¿Cuándo arreglan el ascensor?")
            └───────────────┘
                    │
                    ▼
            ┌───────────────┐
            │ Si requiere   │ → Crea ticket, notifica admin
            │ acción        │   Acuse de recibo al solicitante
            └───────────────┘
                    │
                    ▼
            Admin actualiza ticket
                    │
                    ▼
            Agente Kanban notifica
            al solicitante vía email
            (AgentMail outbound)
```

### 4.2 Templates de notificación

| Evento | Canal | Contenido |
|--------|-------|-----------|
| Ticket creado | Email | N° ticket, categoría, SLA, link al portal |
| Estado cambiado | Email + Push | "Su solicitud #123 pasó a EN PROGRESO" |
| SLA próximo a vencer | Email admin | Alerta 24h antes del vencimiento |
| Ticket resuelto | Email | Resumen de acciones, link para confirmar cierre |
| Ticket cerrado | Email | Encuesta NPS de 1-5 estrellas |

---

## 5. SLA y Escalamiento

### 5.1 Políticas de SLA

| Prioridad | Tiempo de respuesta | Tiempo de resolución | Escalamiento |
|-----------|---------------------|----------------------|--------------|
| **Crítica** | 1h | 4h | Admin + encargado + notificación push |
| **Alta** | 4h | 24h | Admin + email urgente |
| **Media** | 24h | 72h | Admin + email normal |
| **Baja** | 72h | 7 días | Admin + resumen semanal |

### 5.2 Escalamiento automático

```
SLA al 50%  → Notificación al responsable asignado
SLA al 80%  → Notificación al admin + cambio de prioridad
SLA al 100% → Escalamiento a admin principal + registro en dashboard
SLA >120%   → Alerta en reporte mensual + posible penalización interna
```

---

## 6. Integración con otros agentes

| Agente | Interacción | Trigger |
|--------|-------------|---------|
| **Comunicador** | Envía notificaciones | Cambio de estado, SLA próximo |
| **Contable** | Estima costos de reparación | Ticket categorizado como mantenimiento |
| **Documental** | Adjunta documentos relevantes | Ticket relacionado con gasto histórico |
| **Dashboard** | Alimenta métricas de kanban | Cierre de tickets, incumplimientos de SLA |
| **Cobranzas** | Deriva consultas de deuda | Clasificación "Pago / Cobranza" |

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Clasificador** | Nemotron Nano 9B | Rápido, barato, suficiente para categorización |
| **Asignación** | Sugerida, no forzada | El admin mantiene control. OpenWorker pattern. |
| **SLA** | Configurable por edificio | Algunos consorcios tienen encargado 24h, otros no |
| **Comunicación** | AgentMail + email | Los propietarios mayores no usan WhatsApp |
| **Auto-cierre** | 48h después de resuelto | Evita tickets abiertos eternamente |
| **Approval Inbox** | Gastos >ARS 10.000 | Control humano sobre gastos significativos |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-03-05 Agente Comunicador]]  
*Documento relacionado:* [[PRD-04-06 Kanban de Tareas]]  
*Documento relacionado:* [[PRD-05-01 AgentMail]]  
*Documento relacionado:* [[PRD-05-03 WhatsApp Business API]]