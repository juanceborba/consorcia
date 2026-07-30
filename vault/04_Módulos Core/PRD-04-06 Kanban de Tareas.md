---
title: "PRD-04-06: Kanban de Tareas"
description: "Especificación del módulo de gestión de tareas del consorcio: estados, flujos de trabajo, comunicación integrada, notificaciones y reportes operativos."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [kanban, tareas, workflow, comunicacion, portal, consorcIA, fase2]
outcomes:
  - "Definir estados y transiciones del workflow de tareas"
  - "Especificar roles y permisos en el kanban"
  - "Diseñar interfaz de comunicación integrada solicitante↔admin"
  - "Establecer sistema de notificaciones y alertas SLA"
  - "Documentar reportes operativos automáticos"
---

# PRD-04-06: Kanban de Tareas

> **El Kanban de Tareas reemplaza el caos de WhatsApp con un sistema de trazabilidad completa. Cada solicitud tiene un número, un estado, un responsable, un historial de comunicación y un SLA. Nada se pierde, todo se puede auditar.**

---

## 1. Visión General

### 1.1 Problema que resuelve

```
ANTES (WhatsApp):
  "Hola, se rompió la canilla del 3B"
  → Mensaje perdido en un grupo de 45 personas
  → Nadie sabe si se arregló
  → El vecino del 3B reclama 3 semanas después
  → No hay registro de cuánto costó ni quién lo hizo

DESPUÉS (Kanban ConsorcIA):
  Ticket #234: "Canilla rota en UF 3B"
  → Estado: NUEVO → ASIGNADO → EN PROGRESO → RESUELTO → CERRADO
  → Asignado a: Plomero García (proveedor registrado)
  → Costo: $12.500 (aprobado vía Approval Inbox)
  → Comunicación: historial completo solicitante↔admin↔proveedor
  → SLA: resuelto en 18h (meta: 48h) ✅
```

### 1.2 Diferenciador clave

| Feature | ConsorcIA | Competidores |
|---------|-----------|--------------|
| Kanban con estados | ✅ | Adminia (parcial) |
| Comunicación integrada | ✅ | ❌ |
| Clasificación automática (IA) | ✅ | ❌ |
| SLA tracking | ✅ | ❌ |
| Aprobación de gastos integrada | ✅ | ❌ |
| Historial auditable | ✅ | ❌ |

---

## 2. Estados y Workflow

### 2.1 Estados del sistema

| Estado | Color | Descripción | Quién puede crear |
|--------|-------|-------------|-------------------|
| **NUEVO** | 🔵 Gris | Ticket recién creado, sin clasificar | Sistema (auto) o Admin |
| **TRIAGE** | 🟡 Amarillo | En clasificación por el Agente Kanban | Sistema (auto) |
| **ASIGNADO** | 🟠 Naranja | Tiene responsable asignado | Admin |
| **EN PROGRESO** | 🔵 Azul | Alguien está trabajando en ello | Responsable asignado |
| **PENDIENTE APROBACIÓN** | 🟣 Púrpura | Requiere aprobación de gasto | Responsable |
| **RESUELTO** | 🟢 Verde | Tarea completada, esperando validación | Responsable |
| **CERRADO** | ⚫ Negro | Validado y archivado | Admin o Solicitante |
| **RECHAZADO** | 🔴 Rojo | No se ejecutará | Admin |
| **CANCELADO** | ⚪ Blanco | Duplicado o inválido | Admin |

### 2.2 Diagrama de transiciones

```
                    ┌─────────────┐
         ┌─────────▶│  CANCELADO  │
         │          └─────────────┘
         │
┌─────┐  │    ┌────────┐    ┌──────────┐    ┌─────────────┐
│NUEVO│──┴───▶│ TRIAGE │───▶│ ASIGNADO │───▶│EN PROGRESO  │
└─────┘       └────────┘    └──────────┘    └──────┬──────┘
   ▲                                               │
   │                                               ▼
   │                                        ┌─────────────┐
   │                                        │PENDIENTE    │
   │                                        │APROBACIÓN   │
   │                                        └──────┬──────┘
   │                                               │
   │          ┌─────────────┐    ┌────────┐       │
   └──────────│   CERRADO   │◀───│RESUELTO│◀──────┘
              └─────────────┘    └───┬────┘
                                     │
                              ┌──────┴──────┐
                              │  RECHAZADO  │
                              └─────────────┘
```

### 2.3 Reglas de negocio

- **Auto-cierre:** Un ticket en RESUELTO pasa a CERRADO automáticamente después de 48h si el solicitante no objeta.
- **Reapertura:** Un ticket CERRADO puede reabrirse dentro de 7 días. Después, se crea un ticket nuevo vinculado.
- **Vinculación:** Tickets relacionados se vinculan (ej: "Canilla rota 3B" vinculado a "Revisión general de plomería").

---

## 3. Estructura de un Ticket

### 3.1 Campos del ticket

```typescript
interface Ticket {
  id: string;                    // "TK-2026-07-0234"
  edificioId: string;
  solicitanteId: string;         // UF o usuario externo
  categoria: 'mantenimiento' | 'reclamo' | 'consulta' | 'mejora' | 'emergencia' | 'pago' | 'denuncia';
  subcategoria?: string;         // "plomería", "electricidad", etc.
  prioridad: 'critica' | 'alta' | 'media' | 'baja';
  estado: EstadoTicket;
  titulo: string;
  descripcion: string;
  adjuntos: string[];            // URLs en MinIO/S3
  asignadoA?: string;            // ID de usuario o proveedor
  gastoAprobado?: {
    monto: Decimal;
    concepto: string;
    aprobadoPor: string;
    fechaAprobacion: Date;
  };
  sla: {
    metaHoras: number;
    creadoEn: Date;
    venceEn: Date;
    resueltoEn?: Date;
    cumplido: boolean;
  };
  comunicaciones: Comunicacion[];
  historial: CambioEstado[];
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 Comunicaciones integradas

```typescript
interface Comunicacion {
  id: string;
  ticketId: string;
  autorId: string;
  autorTipo: 'solicitante' | 'admin' | 'encargado' | 'proveedor' | 'sistema';
  canal: 'email' | 'whatsapp' | 'portal' | 'sistema';
  contenido: string;
  adjuntos: string[];
  visiblePara: ('solicitante' | 'admin' | 'encargado' | 'proveedor')[];
  createdAt: Date;
}
```

> **Regla:** Las comunicaciones entre admin y proveedor pueden ser privadas (no visibles para el solicitante) hasta que se resuelva el ticket.

---

## 4. Roles y Permisos

| Acción | Admin | Encargado | Propietario | Proveedor | Consejo |
|--------|-------|-----------|-------------|-----------|---------|
| Crear ticket | ✅ | ✅ | ✅ (solo su UF) | ❌ | ✅ |
| Ver todos los tickets | ✅ | ✅ (asignados) | ❌ (solo los suyos) | ❌ (solo asignados) | ✅ (resumido) |
| Cambiar estado | ✅ | ✅ (solo asignados) | ❌ | ✅ (solo a EN PROGRESO/RESUELTO) | ❌ |
| Asignar responsable | ✅ | ❌ | ❌ | ❌ | ❌ |
| Aprobar gasto | ✅ | ❌ | ❌ | ❌ | ✅ (si >ARS 50.000) |
| Comunicar en ticket | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver comunicaciones privadas | ✅ | ✅ | ❌ | ✅ | ✅ |
| Cerrar ticket | ✅ | ❌ | ✅ (solo los suyos) | ❌ | ❌ |
| Reabrir ticket | ✅ | ❌ | ✅ (7 días) | ❌ | ❌ |

---

## 5. Notificaciones y SLA

### 5.1 Matriz de notificaciones

| Evento | Notificación | Destinatarios |
|--------|--------------|---------------|
| Ticket creado | Email + Push | Admin + Solicitante |
| Ticket asignado | Email | Responsable asignado |
| Estado cambiado | Email + Push | Solicitante + Responsable |
| SLA al 50% | Email | Responsable |
| SLA al 80% | Email + Push | Admin + Responsable |
| SLA vencido | Email + Push + Dashboard | Admin |
| Gasto requiere aprobación | Email + Approval Inbox | Admin |
| Ticket resuelto | Email + Push | Solicitante |
| Ticket cerrado | Email | Solicitante (con encuesta NPS) |

### 5.2 Configuración de SLA por edificio

```typescript
interface SlaConfig {
  edificioId: string;
  slas: {
    categoria: string;
    prioridad: string;
    metaHoras: number;
    diasHabiles: boolean;
    horarioAtencion: { inicio: string; fin: string }; // "09:00", "18:00"
  }[];
}

// Default:
// Crítica: 4h | Alta: 24h | Media: 72h | Baja: 7 días
```

---

## 6. Reportes Operativos

### 6.1 Reporte semanal (automático)

```
📋 Reporte Semanal de Tareas — Semana 30/2026

RESUMEN
• Tickets creados: 12
• Tickets resueltos: 10
• Tickets pendientes: 8
• SLA cumplido: 83% (10/12)

POR CATEGORÍA
• Mantenimiento: 6 (50%)
• Consultas: 3 (25%)
• Reclamos: 2 (17%)
• Emergencias: 1 (8%)

ALERTAS
⚠️ 2 tickets con SLA vencido:
  - TK-0230: Pérdida de agua en cochera (venció hace 6h)
  - TK-0228: Ascensor atascado (venció hace 2h)

PROVEEDORES
• Plomero García: 3 tickets, promedio 14h de resolución ✅
• Electricista López: 2 tickets, 1 vencido ⚠️
```

### 6.2 Reporte mensual (integrado con Dashboard)

- Incluido en el reporte mensual generado por el Agente Dashboard.
- Sección dedicada a tareas: creadas, resueltas, pendientes, SLA, satisfacción.

---

## 7. Interfaz de Usuario

### 7.1 Vista del administrador

```
┌─────────────────────────────────────────────────────────────────┐
│  KANBAN — Edificio Corrientes 1234          [+ Nuevo Ticket]   │
├─────────────────────────────────────────────────────────────────┤
│  NUEVO(3)  │  ASIGNADO(4)  │  EN PROGRESO(5)  │  RESUELTO(8) │
├────────────┼───────────────┼──────────────────┼───────────────┤
│ • TK-0234  │ • TK-0228     │ • TK-0225        │ • TK-0219    │
│   Canilla  │   Ascensor    │   Pintura hall   │   Luz coch.  │
│   3B       │   (⚠️ SLA)    │   (Juan)         │   ✅ 12h     │
│   [Ver]    │   [Ver]       │   [Ver]          │   [Ver]      │
│ • TK-0233  │ • TK-0227     │ • TK-0224        │ • TK-0218    │
│   Pérdida  │   Portero     │   Jardín         │   Cerradura  │
│   agua     │   eléctrico   │   (García)       │   ✅ 8h      │
│   [Ver]    │   [Ver]       │   [Ver]          │   [Ver]      │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Vista del solicitante (portal)

```
┌─────────────────────────────────────────────────────────────┐
│  MIS SOLICITUDES — UF 3B                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Ticket #234 — Canilla rota en baño                         │
│  Estado: 🟢 RESUELTO                                        │
│  Creado: 15/07/2026 10:30                                   │
│  Resuelto: 16/07/2026 04:15 (17h 45m)                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Historial de comunicación:                          │   │
│  │                                                     │   │
│  │ [Tú] 15/07 10:30: "Se rompió la canilla del baño"   │   │
│  │ [Sistema] 15/07 10:31: Ticket creado #234           │   │
│  │ [Admin] 15/07 11:00: Asignado a Plomero García      │   │
│  │ [García] 15/07 14:20: "Visito mañana a las 9"       │   │
│  │ [García] 16/07 04:15: "Reparado. Costo: $12.500"    │   │
│  │ [Admin] 16/07 09:00: Gasto aprobado y registrado    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [✅ Confirmar cierre]  [🔄 Reabrir]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Workflow** | 9 estados con transiciones definidas | Suficiente para cubrir todos los casos sin ser excesivo |
| **Comunicación** | Threaded por ticket | WhatsApp no tiene threads. Esto es el diferenciador. |
| **Privacidad** | Comunicaciones admin↔proveedor pueden ser privadas | El solicitante no necesita ver negociaciones de precio |
| **Auto-cierre** | 48h después de RESUELTO | Evita tickets abiertos eternamente |
| **SLA** | Configurable por edificio | Cada consorcio tiene dinámicas diferentes |
| **NPS** | Encuesta post-cierre | Mide satisfacción y alimenta métricas de calidad |
| **Vinculación** | Tickets relacionados | Permite gestionar proyectos grandes (ej: "renovación integral") |

---

*Documento relacionado:* [[PRD-03-07 Agente Kanban]]  
*Documento relacionado:* [[PRD-04-05 Portal del Residente]]  
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]  
*Documento relacionado:* [[PRD-05-01 AgentMail]]  
*Documento relacionado:* [[PRD-05-03 WhatsApp Business API]]