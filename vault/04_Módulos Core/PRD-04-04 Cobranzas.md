---
title: "PRD-04-04: Cobranzas"
description: "MercadoPago integration, links de pago, QR, conciliación manual (MVP) y automática (Fase 2), estados de cobro."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, cobranzas, mercadopago, pagos, qr, conciliacion, mvp]
outcomes:
  - "Generar links de pago MercadoPago para cada recibo de expensas"
  - "Procesar webhooks de MercadoPago para conciliación automática"
  - "Registrar pagos manuales (transferencia, efectivo) en MVP"
  - "Trackear estados de cobro: pendiente, pagado, parcial, moroso"
  - "Generar reportes de morosidad por edificio"
---

# PRD-04-04: Cobranzas

> **"Que pagar las expensas sea tan fácil como comprar en MercadoLibre."**  
> Links de pago, QR, conciliación automática. Sin excusas para no pagar.

---

## 1. Estados de Cobro

| Estado | Descripción | Transiciones |
|--------|-------------|--------------|
| **PENDIENTE** | Recibo enviado, sin pago | → PAGADO, PARCIAL, MOROSO |
| **PAGADO** | Pago completo recibido | → (final) |
| **PARCIAL** | Pago parcial recibido | → PAGADO, MOROSO |
| **MOROSO** | Vencido sin pago | → PAGADO, PARCIAL, PERDONADO |
| **PERDONADO** | Deuda condonada (asamblea) | → (final) |

---

## 2. Flujo de Cobro

```
Liquidación aprobada → recibos enviados
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  DÍA 1: Links de pago generados                              │
│  • MercadoPago: preferencia por cada recibo                  │
│  • QR incluido en el PDF del recibo                          │
│  • Link incluido en el email                                 │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  DÍA 5-10: Recordatorios (si no pagó)                       │
│  • Email amable con link de pago                             │
│  • WhatsApp (Fase 2)                                        │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  DÍA 10: Vencimiento                                         │
│  • Estado → MOROSO (si no pagó)                            │
│  • Email firme con recargo                                 │
│  • Alerta en dashboard del admin                            │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PAGO RECIBIDO (webhook MP o manual)                        │
│  • Webhook MercadoPago → conciliación automática           │
│  • O admin registra pago manual                             │
│  • Estado → PAGADO o PARCIAL                                │
│  • Notificación al propietario                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API Endpoints

```javascript
// routes/cobros.routes.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');

// GET /api/cobros - Listar cobros con filtros
router.get('/',
  authenticate,
  authorize('cobro', 'read'),
  async (req, res) => {
    const { estado, periodo, unidadId, page = 1, limit = 50 } = req.query;

    const where = { organizacionId: req.organizacionId };
    if (estado) where.estado = estado;
    if (periodo) where.liquidacion = { periodo };
    if (unidadId) where.unidadId = unidadId;

    const [cobros, total] = await Promise.all([
      prisma.cobro.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          unidad: { select: { numero: true } },
          liquidacion: { select: { periodo: true } }
        }
      }),
      prisma.cobro.count({ where })
    ]);

    res.json({ data: cobros, pagination: { page, limit, total } });
  }
);

// POST /api/cobros/:id/pago-manual - Registrar pago manual
router.post('/:id/pago-manual',
  authenticate,
  authorize('cobro', 'update'),
  async (req, res) => {
    const { monto, metodo, referencia, fecha } = req.body;

    const cobro = await prisma.cobro.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId }
    });

    if (!cobro) return res.status(404).json({ error: 'Cobro no encontrado' });

    const nuevoMontoPagado = parseFloat(cobro.montoPagado) + parseFloat(monto);
    const nuevoEstado = nuevoMontoPagado >= parseFloat(cobro.montoTotal) 
      ? 'PAGADO' 
      : nuevoMontoPagado > 0 ? 'PARCIAL' : 'PENDIENTE';

    const actualizado = await prisma.cobro.update({
      where: { id: req.params.id },
      data: {
        montoPagado: nuevoMontoPagado,
        montoPendiente: parseFloat(cobro.montoTotal) - nuevoMontoPagado,
        estado: nuevoEstado,
        metodoPago: metodo,
        referenciaPago: referencia,
        fechaPago: new Date(fecha)
      }
    });

    res.json(actualizado);
  }
);

// POST /api/webhooks/mercadopago - Webhook de MercadoPago
router.post('/webhooks/mercadopago',
  async (req, res) => {
    // Validar firma del webhook
    const signature = req.headers['x-signature'];
    if (!validarFirmaMP(req.body, signature)) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const { data } = req.body;

    if (data.status === 'approved') {
      const cobro = await prisma.cobro.findFirst({
        where: { 
          referenciaPago: data.external_reference,
          organizacionId: data.external_reference.split('_')[0] // extraer organización
        }
      });

      if (cobro) {
        await prisma.cobro.update({
          where: { id: cobro.id },
          data: {
            montoPagado: parseFloat(cobro.montoTotal),
            montoPendiente: 0,
            estado: 'PAGADO',
            metodoPago: 'mercadopago',
            referenciaPago: data.payment_id,
            fechaPago: new Date()
          }
        });

        // Notificar al propietario
        // await agenteComunicador.enviarConfirmacionPago(cobro);
      }
    }

    res.status(200).send('OK');
  }
);

// GET /api/cobros/morosidad - Reporte de morosidad
router.get('/morosidad',
  authenticate,
  authorize('cobro', 'read'),
  async (req, res) => {
    const { edificioId } = req.query;

    const morosos = await prisma.cobro.findMany({
      where: {
        organizacionId: req.organizacionId,
        edificioId,
        estado: { in: ['MOROSO', 'PARCIAL'] }
      },
      include: {
        unidad: { select: { numero: true } },
        liquidacion: { select: { periodo: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const resumen = {
      totalMorosos: morosos.length,
      montoAdeudado: morosos.reduce((s, c) => s + parseFloat(c.montoPendiente), 0),
      porUnidad: morosos.reduce((acc, c) => {
        const key = c.unidad.numero;
        if (!acc[key]) acc[key] = { unidad: key, adeudado: 0, periodos: 0 };
        acc[key].adeudado += parseFloat(c.montoPendiente);
        acc[key].periodos++;
        return acc;
      }, {})
    };

    res.json({ morosos, resumen });
  }
);

module.exports = router;
```

---

## 4. Frontend: Pantallas

### 4.1 Lista de Cobros

```
┌─────────────────────────────────────────────────────────────┐
│  Cobros — Av. Libertador 1234                     [Filtros ▼]│
├─────────────────────────────────────────────────────────────┤
│  UF    │ Período  │ Monto      │ Pagado    │ Estado   │ Acción │
│  ──────┼──────────┼───────────┼───────────┼──────────┼────────│
│  1A    │ 2026-07  │ $39.567,89│ $39.567,89│ ✅ Pagado│ Ver   │
│  1B    │ 2026-07  │ $39.567,89│ $0,00     │ ⏳ Pend. │ Recordar│
│  3A    │ 2026-07  │ $39.567,89│ $20.000,00│ ⚠️ Parcial│ Registrar│
│  5B    │ 2026-07  │ $39.567,89│ $0,00     │ 🔴 Moroso│ Plan   │
│  ──────┼───────────┼───────────┼───────────┼──────────┼────────│
│  TOTAL │          │ $1.425.000│ $980.000  │ 68% cob. │        │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Registrar Pago Manual

```
┌─────────────────────────────────────────────────────────────┐
│  Registrar Pago — UF 3A, Julio 2026                        │
├─────────────────────────────────────────────────────────────┤
│  Monto total: $39.567,89                                    │
│  Pagado: $20.000,00                                         │
│  Pendiente: $19.567,89                                      │
├─────────────────────────────────────────────────────────────┤
│  Monto recibido *                                           │
│  [$19.567,89   ]                                           │
│                                                             │
│  Método de pago *                                           │
│  [Transferencia bancaria ▼]                                │
│                                                             │
│  Referencia / N° comprobante *                              │
│  [TR-20260725-001234        ]                              │
│                                                             │
│  Fecha de pago *                                            │
│  [25/07/2026    ]                                          │
│                                                             │
│  Notas                                                      │
│  [Pago completo, saldado                                  ]│
│                                                             │
│                    [Cancelar]  [Confirmar Pago]             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **MercadoPago como gateway principal** | Mercado argentino | Más del 70% de los argentinos tiene cuenta MP. QR es estándar |
| **Webhook para conciliación** | Automatización | Pago en MP → estado actualizado en < 5 segundos |
| **Pago manual en MVP** | Fallback | No todos pagan por MP. Transferencia y efectivo siguen siendo comunes |
| **Estado PARCIAL** | Realidad | Algunos propietarios pagan en cuotas o dejan "a cuenta" |
| **Soft delete en cobros** | Auditoría | Nunca eliminar un cobro. Anular con estado especial |
| **Reporte de morosidad** | Gestión | Admin necesita ver quién debe y cuánto, rápidamente |

---

*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-05-02 MercadoPago]]  
*Documento relacionado:* [[PRD-03-06 Agente Cobranzas]]
