---
title: "PRD-03-06: Agente Cobranzas"
description: "Recordatorios automáticos, links de pago MercadoPago, conciliación manual (MVP) y automática (Fase 2), planes de pago."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [agente, cobranzas, mercadopago, recordatorios, conciliacion, pagos, mvp]
outcomes:
  - "Generar recordatorios automáticos de pago con tono apropiado"
  - "Crear links de pago MercadoPago por cada recibo"
  - "Registrar pagos manuales (transferencia, efectivo) en MVP"
  - "Conciliar pagos automáticamente en Fase 2 (webhooks MP)"
  - "Sugerir planes de pago para morosos crónicos"
---

# PRD-03-06: Agente Cobranzas

> **"Cobrar sin ser pesado. Recordar sin ser invasivo."**  
> Risk Tier: `external` (enviar email) / `write_local` (registrar cobro) | Modelo: Nemotron Nano 9B

---

## 1. Flujo de Cobranzas

```
┌─────────────────────────────────────────────────────────────────┐
│  DÍA 1: Liquidación aprobada → recibos enviados                │
│  ├─ Agente Cobranzas crea links de pago MP por cada recibo     │
│  └─ Links incluidos en el email del recibo                     │
├─────────────────────────────────────────────────────────────────┤
│  DÍA 5: Primer recordatorio (si no pagó)                       │
│  ├─ Email amable: "Recordá que vence el 10"                  │
│  └─ Incluye link de pago + opciones de pago                    │
├─────────────────────────────────────────────────────────────────┤
│  DÍA 10: Segundo recordatorio (si venció)                      │
│  ├─ Email: "Tu expensa venció. Evitá recargos."              │
│  └─ Incluye monto con recargo + link de pago                   │
├─────────────────────────────────────────────────────────────────┤
│  DÍA 20: Tercer recordatorio (moroso)                          │
│  ├─ Email más formal + WhatsApp (si disponible)               │
│  └─ Ofrece plan de pagos                                       │
├─────────────────────────────────────────────────────────────────┤
│  DÍA 30: Alerta admin (moroso crónico)                         │
│  ├─ Dashboard admin: "UF 3A: 2 meses adeudados"                │
│  └─ Sugiere: carta documento, mediación, etc.                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Tools del Agente

| Tool | Descripción | Risk Tier |
|------|-------------|-----------|
| `crearLinkPago` | Genera link MercadoPago | external |
| `generarRecordatorio` | Crea email de recordatorio | external |
| `registrarPagoManual` | Registra pago no-MP | write_local |
| `conciliarPagoMP` | Procesa webhook de MP | write_local |
| `sugerirPlanPagos` | Genera plan para moroso | read |
| `alertarAdmin` | Notifica morosidad crónica | external |
| `generarQR` | Crea QR de pago (Ley 941) | read |

---

## 3. Implementación

```javascript
// src/agents/cobranzas.agent.js
const { BaseAgent } = require('./base.agent');
const { MercadoPagoService } = require('../services/mercadopago.service');
const { CobroService } = require('../services/cobro.service');
const { AgenteComunicador } = require('./comunicador.agent');

class AgenteCobranzas extends BaseAgent {
  constructor() {
    super();
    this.nombre = 'Cobranzas';
    this.tier = 'external';
    this.modelo = 'nvidia/nemotron-nano-9b-v2';
  }

  /**
   * Crea links de pago para una liquidación
   */
  async crearLinksPago(liquidacionId) {
    const cobros = await CobroService.obtenerPorLiquidacion(liquidacionId);
    const resultados = [];

    for (const cobro of cobros) {
      const link = await MercadoPagoService.crearPreferencia({
        title: `Expensas ${cobro.periodo} - UF ${cobro.unidadNumero}`,
        quantity: 1,
        unit_price: parseFloat(cobro.montoTotal),
        external_reference: cobro.id,
        notification_url: `${process.env.API_URL}/webhooks/mercadopago`
      });

      await CobroService.actualizarLinkPago(cobro.id, link.init_point);

      resultados.push({
        cobroId: cobro.id,
        unidadNumero: cobro.unidadNumero,
        linkPago: link.init_point,
        qrCode: link.qr_code // Para recibo con QR
      });
    }

    return resultados;
  }

  /**
   * Genera recordatorio de pago
   */
  async generarRecordatorio(cobroId, tipo = 'vencimiento') {
    const cobro = await CobroService.obtener(cobroId);
    const propietario = await CobroService.obtenerPropietario(cobro.unidadId);

    const diasVencido = this._calcularDiasVencido(cobro.fechaVencimiento);
    const tono = diasVencido < 0 ? 'amable' : diasVencido < 15 ? 'firme' : 'formal';

    const prompt = `
      Genera un email de recordatorio de pago de expensas.

      Datos:
      - Propietario: ${propietario.nombre}
      - Unidad: ${cobro.unidadNumero}
      - Período: ${cobro.periodo}
      - Monto: $${cobro.montoTotal}
      - Días vencido: ${diasVencido}
      - Tono: ${tono}

      Reglas por tono:
      - amable: "Recordá que vence pronto", ofrecer ayuda
      - firme: "Venció hace X días", incluir recargo
      - formal: "Adeudo pendiente", mencionar consecuencias legales

      Incluir siempre:
      - Link de pago
      - Métodos alternativos (transferencia, efectivo)
      - Contacto para dudas
      - Máximo 150 palabras
    `;

    const response = await this.router.route({
      task: 'generar_recordatorio_pago',
      prompt,
      complexity: 'low',
      maxCostPer1M: 0.06
    });

    return {
      asunto: `Recordatorio de pago - Expensas ${cobro.periodo}`,
      cuerpo: response.result,
      destinatario: propietario.email,
      tono,
      diasVencido
    };
  }

  /**
   * Registra pago manual (transferencia, efectivo)
 */
  async registrarPagoManual(cobroId, datosPago, adminId) {
    const validacion = this._validarPagoManual(datosPago);
    if (!validacion.valido) {
      throw new Error(`Pago inválido: ${validacion.errores.join(', ')}`);
    }

    return this.ejecutarConAprobacion('write_local',
      async () => CobroService.registrarPago(cobroId, {
        montoPagado: datosPago.monto,
        metodoPago: datosPago.metodo, // 'transferencia', 'efectivo'
        referenciaPago: datosPago.referencia,
        fechaPago: datosPago.fecha,
        registradoPor: adminId
      }),
      { adminId }
    );
  }

  /**
   * Procesa webhook de MercadoPago
   */
  async procesarWebhookMP(webhookData) {
    const { external_reference, payment_id, status } = webhookData;

    if (status === 'approved') {
      const cobro = await CobroService.obtenerPorReferencia(external_reference);

      await CobroService.registrarPago(cobro.id, {
        montoPagado: cobro.montoTotal,
        metodoPago: 'mercadopago',
        referenciaPago: payment_id,
        fechaPago: new Date(),
        estado: 'PAGADO'
      });

      // Notificar al propietario
      const comunicador = new AgenteComunicador();
      await comunicador.enviarConfirmacionPago(cobro);

      return { exito: true, cobroId: cobro.id };
    }

    return { exito: false, estado: status };
  }

  /**
   * Sugiere plan de pagos para moroso
   */
  async sugerirPlanPagos(cobroId) {
    const cobro = await CobroService.obtener(cobroId);
    const historial = await CobroService.obtenerHistorialMorosidad(cobro.unidadId);

    const prompt = `
      Analiza la situación de morosidad y sugiere un plan de pagos.

      Deuda actual: $${cobro.montoTotal}
      Período: ${cobro.periodo}
      Días vencido: ${this._calcularDiasVencido(cobro.fechaVencimiento)}
      Historial de morosidad: ${historial.length} períodos adeudados

      Sugiere:
      1. Cantidad de cuotas
      2. Monto de cada cuota
      3. Fechas de vencimiento
      4. Intereses (si aplica)

      Devolver JSON:
      {
        "cuotas": number,
        "montoCuota": number,
        "interes": number,
        "totalConInteres": number,
        "fechasVencimiento": ["YYYY-MM-DD"],
        "justificacion": "string"
      }
    `;

    const response = await this.router.route({
      task: 'sugerir_plan_pagos',
      prompt,
      complexity: 'medium',
      maxCostPer1M: 0.15
    });

    return JSON.parse(response.result);
  }

  _calcularDiasVencido(fechaVencimiento) {
    const hoy = new Date();
    const vencimiento = new Date(fechaVencimiento);
    const diff = hoy - vencimiento;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  _validarPagoManual(datos) {
    const errores = [];
    if (!datos.monto || datos.monto <= 0) errores.push('Monto inválido');
    if (!datos.metodo) errores.push('Método de pago requerido');
    if (!datos.fecha) errores.push('Fecha de pago requerida');
    return { valido: errores.length === 0, errores };
  }
}

module.exports = { AgenteCobranzas };
```

---

## 4. Métricas de Éxito

| Métrica | Meta |
|---------|------|
| Links de pago generados sin error | > 99% |
| Pagos vía MercadoPago | > 60% del total |
| Tiempo de conciliación (MP webhook) | < 5 segundos |
| Morosidad promedio | < 15% |
| Satisfacción con recordatorios (NPS) | > 7 |

---

*Documento relacionado:* [[PRD-03-01 Arquitectura de Agentes]]  
*Documento relacionado:* [[PRD-05-02 MercadoPago]]  
*Documento relacionado:* [[PRD-04-04 Cobranzas]]
