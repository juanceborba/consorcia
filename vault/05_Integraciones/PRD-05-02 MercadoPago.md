---
title: "PRD-05-02: MercadoPago"
description: "Especificación de la integración con MercadoPago para cobros online: links de pago, QR, suscripciones, webhooks de confirmación y conciliación automática."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [mercadopago, cobranzas, pagos, qr, webhooks, integracion, consorcIA]
outcomes:
  - "Definir flujos de pago soportados (link, QR, suscripción)"
  - "Especificar manejo de webhooks de confirmación y rechazo"
  - "Diseñar conciliación automática de pagos"
  - "Establecer manejo de errores y reintentos"
  - "Documentar compliance fiscal argentino (facturación)"
---

# PRD-05-02: MercadoPago

> **La integración con MercadoPago es el corazón del módulo de cobranzas. Permite a los propietarios pagar sus expensas con un click, genera QR para pagos presenciales, y automatiza la conciliación bancaria mediante webhooks en tiempo real.**

---

## 1. Alcance de la Integración

### 1.1 Productos de MercadoPago utilizados

| Producto | Uso | Fase |
|----------|-----|------|
| **Checkout Pro** | Links de pago para expensas | MVP |
| **QR estático** | Pagos en administración / encargado | MVP |
| **QR dinámico** | Pagos con monto variable por UF | Fase 2 |
| **Suscripciones** | Débito automático mensual de expensas | Fase 2 |
| **Point (POS)** | Terminal de cobro para encargado | Fase 3 |
| **MercadoPago Connect** | Split de pagos (consorcio + plataforma) | Fase 3 |

### 1.2 Flujos soportados

```
FLUJO 1: Link de pago (MVP)
  Admin genera liquidación
    → Sistema crea preferencia de pago en MP
    → Agente Comunicador envía link por email
    → Propietario paga con tarjeta / transferencia / efectivo
    → MP notifica vía webhook
    → Agente Cobranzas registra pago automáticamente

FLUJO 2: QR estático (MVP)
  Admin imprime QR y lo pega en portería
    → Propietario escanea con app de MP
    → Ingresa monto manualmente
    → Paga
    → MP notifica vía webhook
    → Agente Cobranzas registra pago

FLUJO 3: Suscripción automática (Fase 2)
  Propietario autoriza débito automático
    → MP crea plan de suscripción
    → Cada mes, MP debita automáticamente
    → Webhook confirma el pago
    → Agente Cobranzas registra + notifica

FLUJO 4: QR dinámico por UF (Fase 2)
  Cada UF tiene su QR con monto pre-cargado
    → Propietario escanea
    → Monto de su expensa ya está cargado
    → Solo confirma y paga
    → Webhook + registro automático
```

---

## 2. Arquitectura de Integración

### 2.1 Diagrama de secuencia — Link de pago

```
Admin/Agente          Backend           MercadoPago         Propietario
  │                      │                     │                   │
  │── Generar liquidación│                     │                   │
  │─────────────────────▶│                     │                   │
  │                      │                     │                   │
  │                      │── Crear preferencia─▶│                   │
  │                      │   (amount, desc,    │                   │
  │                      │    external_ref)    │                   │
  │                      │◀── preference_id ───│                   │
  │                      │   + init_point URL  │                   │
  │                      │                     │                   │
  │◀── Liquidación lista─│                     │                   │
  │                      │                     │                   │
  │                      │── Enviar link ──────────────────────────▶│
  │                      │   (AgentMail)       │                   │
  │                      │                     │                   │
  │                      │                     │◀── Paga ──────────│
  │                      │                     │   (tarjeta/efect.)│
  │                      │                     │                   │
  │                      │◀── Webhook ─────────│                   │
  │                      │   payment.updated   │                   │
  │                      │   (status: approved)│                   │
  │                      │                     │                   │
  │                      │── Registrar pago ──▶│                   │
  │                      │   en DB             │                   │
  │                      │                     │                   │
  │                      │── Notificar ────────────────────────────▶│
  │                      │   (pago confirmado) │                   │
```

### 2.2 Configuración de MercadoPago

```typescript
interface MercadoPagoConfig {
  // Credenciales (almacenadas encriptadas en DB)
  accessToken: string;        // Token de cuenta MP del consorcio
  publicKey: string;          // Para frontend (Checkout Pro)

  // Configuración por edificio
  edificioId: string;
  cuentaMpId?: string;        // Si usa MP Connect (Fase 3)

  // Preferencias de pago
  metodosPago: ('credit_card' | 'debit_card' | 'ticket' | 'bank_transfer' | 'account_money')[];
  cuotasMaximas: number;      // Ej: 3 cuotas sin interés

  // Webhooks
  webhookSecret: string;      // Para validar firma de webhooks
  webhookUrl: string;         // https://api.consorcia.com/webhooks/mercadopago
}
```

---

## 3. Webhooks

### 3.1 Eventos manejados

| Evento | Tipo | Acción |
|--------|------|--------|
| `payment.created` | Notificación | Log, esperar confirmación |
| `payment.updated` | Crítico | Si `status=approved` → registrar pago |
| `payment.updated` | Crítico | Si `status=rejected` → notificar propietario, sugerir reintento |
| `payment.updated` | Crítico | Si `status=in_process` → esperar (efectivo, transferencia) |
| `payment.updated` | Crítico | Si `status=cancelled` → liberar deuda, notificar |
| `subscription.authorized` | Fase 2 | Activar débito automático |
| `subscription.cancelled` | Fase 2 | Desactivar débito automático |
| `subscription.payment` | Fase 2 | Registrar pago automático |
| `chargeback.created` | Crítico | Alerta admin, registrar contracargo |

### 3.2 Validación de webhooks

```typescript
// Validar firma HMAC-SHA256 de MercadoPago
function validarWebhook(
  headers: Record<string, string>,
  body: string,
  secret: string
): boolean {
  const signature = headers['x-signature'];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// Idempotencia: cada webhook tiene un x-request-id
// Si ya fue procesado, ignorar silenciosamente
```

### 3.3 Manejo de idempotencia

```
Webhook recibido
        │
        ▼
┌─────────────────┐
│ Extraer         │ → payment_id + x-request-id
│ payment_id      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ¿Ya procesado?  │ → Buscar en Redis por x-request-id (TTL: 24h)
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌──────────┐
│ SÍ    │  │ NO       │
│ Ignorar│  │ Procesar │
└───────┘  │ + guardar│
           │   en Redis│
           └──────────┘
```

---

## 4. Conciliación Automática

### 4.1 Registro de pago

```typescript
interface PagoRegistrado {
  id: string;
  edificioId: string;
  unidadFuncionalId: string;
  liquidacionId: string;

  // Datos de MercadoPago
  mpPaymentId: string;
  mpPreferenceId: string;
  monto: Decimal;
  moneda: 'ARS';
  metodoPago: 'credit_card' | 'debit_card' | 'ticket' | 'bank_transfer' | 'account_money';
  cuotas?: number;
  estado: 'approved' | 'pending' | 'in_process' | 'rejected' | 'cancelled' | 'refunded';
  fechaPago: Date;

  // Metadata interna
  registradoPor: 'webhook' | 'manual';
  conciliado: boolean;        // Match con liquidación
  notificado: boolean;        // Email de confirmación enviado

  createdAt: Date;
}
```

### 4.2 Algoritmo de conciliación

```
Pago recibido por webhook
        │
        ▼
┌─────────────────────────────┐
│ Paso 1: Match por           │ → external_reference contiene
│ external_reference          │   edificioId + liquidacionId + ufId
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 2: Validar monto       │ → |monto_pago - monto_liquidacion| < $1
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 3: Actualizar deuda    │ → Marcar liquidación como pagada
│ de la UF                    │   o parcialmente pagada
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Paso 4: Notificar           │ → Email al propietario (confirmación)
│                             │   Email al admin (resumen diario)
└─────────────────────────────┘
```

### 4.3 Pagos parciales

- Si el pago es menor al monto de la liquidación: se registra como "pago parcial".
- La UF sigue con deuda por la diferencia.
- El Agente Cobranzas puede sugerir un plan de pagos.

---

## 5. Manejo de Errores

### 5.1 Estrategia de reintentos

| Escenario | Reintento | Backoff | Alerta |
|-----------|-----------|---------|--------|
| Webhook no procesado | 3 veces | Exponencial (1s, 5s, 25s) | Admin si fallan los 3 |
| API MP no responde | 3 veces | Exponencial | Admin si fallan los 3 |
| Pago rechazado | No reintentar | — | Notificar propietario |
| Pago en proceso (efectivo) | Polling cada 1h | — | Auto-resuelve en 3 días |

### 5.2 Fallbacks

- **Si MP cae:** Los pagos manuales (transferencia, efectivo) se registran por el admin.
- **Si webhook no llega:** Polling diario de estado de pagos pendientes.
- **Si pago duplicado:** Idempotencia por payment_id. Segundo pago se marca como "a devolver".

---

## 6. Compliance Fiscal

### 6.1 Facturación

- MercadoPago emite factura electrónica por cada pago (si el consorcio está inscripto en AFIP).
- El backend almacena el número de factura y CAE para auditoría.
- El recibo de expensas de ConsorcIA incluye referencia al pago de MP.

### 6.2 Retenciones

- MercadoPago retiene IVA e Ingresos Brutos según corresponda.
- El admin ve el desglose de retenciones en el dashboard.

---

## 7. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Proveedor de pagos** | MercadoPago | Dominante en Argentina. Los propietarios ya lo tienen instalado. |
| **Checkout** | Checkout Pro (redirect) | Más simple que API integrada. Menos PCI compliance. |
| **Webhooks** | Validación HMAC + idempotencia | Seguridad y prevención de duplicados. |
| **Moneda** | ARS | Mercado local. Futuro: USD para contratos. |
| **Cuotas** | Hasta 3 sin interés | Estándar del mercado. Más cuotas = costo para el consorcio. |
| **Suscripciones** | Fase 2 | Requiere onboarding más complejo del propietario. |
| **Conciliación** | Automática por webhook | Reduce trabajo del admin. Zero manual para pagos online. |

---

*Documento relacionado:* [[PRD-04-04 Cobranzas]]  
*Documento relacionado:* [[PRD-03-06 Agente Cobranzas]]  
*Documento relacionado:* [[PRD-05-01 AgentMail]]  
*Documento relacionado:* [[PRD-06-01 Ley 941 CABA]]