---
title: "PRD-04-05: Portal del Residente"
description: "Portal web para propietarios e inquilinos. Ver expensas, pagar, documentos, chat con admin, historial."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, portal, residente, propietario, expensas, pagos, documentos, mvp]
outcomes:
  - "Permitir a propietarios ver sus expensas actuales e históricas"
  - "Facilitar el pago vía MercadoPago o transferencia"
  - "Acceder a documentos del consorcio (actas, reglamento, seguros)"
  - "Consultar estado de cuenta y deuda histórica"
  - "Comunicarse con la administración (consultas, reclamos)"
---

# PRD-04-05: Portal del Residente

> **"Tu consorcio en el bolsillo."**  
> El portal donde el propietario entiende en qué se gastan sus expensas y paga en 2 clicks.

---

## 1. Roles en el Portal

| Rol | Acceso | Permisos |
|-----|--------|----------|
| **Propietario** | Full | Ver expensas, pagar, documentos, consultas, configurar notificaciones |
| **Inquilino** | Limitado | Ver expensas (solo informativo), consultas, no puede pagar |
| **Usufructuario** | Limitado | Similar a inquilino, según reglamento (art. 2050 CCyC) |

---

## 2. Pantallas del Portal

### 2.1 Dashboard del Residente

```
┌─────────────────────────────────────────────────────────────┐
│  🏠 ConsorcIA — Portal del Residente              [☰] [👤] │
├─────────────────────────────────────────────────────────────┤
│  Hola, María!                                               │
│  UF 3A — Av. Libertador 1234                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐     │
│  │  💰 Expensas Julio 2026                             │     │
│  │                                                     │     │
│  │  Total a pagar:              $39.567,89            │     │
│  │  Vencimiento:                10/08/2026              │     │
│  │  Estado:                     🔴 Vencido            │     │
│  │                                                     │     │
│  │  [💳 Pagar ahora]  [📄 Ver detalle]  [💬 Consultar] │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  📊 Tu historial                                    │     │
│  │                                                     │     │
│  │  [Gráfico de barras: últimos 6 meses]              │     │
│  │  Promedio mensual: $35.200                        │     │
│  │  Variación vs mes anterior: +12%                   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  📋 Últimas comunicaciones                          │     │
│  │  • Corte de agua programado — 15/08               │     │
│  │  • Asamblea ordinaria — 20/08                     │     │
│  │  • Nuevo reglamento de pileta                      │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Detalle de Expensas

```
┌─────────────────────────────────────────────────────────────┐
│  ← Expensas Julio 2026                                      │
├─────────────────────────────────────────────────────────────┤
│  UF 3A | Coeficiente: 0.027742 | m²: 85                   │
├─────────────────────────────────────────────────────────────┤
│  EXPENSAS ORDINARIAS                                        │
│  Concepto                    │ Tu parte    │ % del total   │
│  ────────────────────────────┼─────────────┼───────────────│
│  Sueldo encargado           │ $12.500,00  │ 2.78%         │
│  Seguro incendio             │ $2.361,11   │ 2.78%         │
│  ABL                         │ $889,00     │ 2.78%         │
│  Limpieza                   │ $1.944,44   │ 2.78%         │
│  ────────────────────────────┼─────────────┼───────────────│
│  Subtotal ordinarias         │ $34.567,89  │               │
├─────────────────────────────────────────────────────────────┤
│  EXPENSAS EXTRAORDINARIAS                                  │
│  Concepto                    │ Tu parte    │ % del total   │
│  ────────────────────────────┼─────────────┼───────────────│
│  Reparación ascensor         │ $5.000,00   │ 11.11%        │
│  (solo UF con ascensor)      │             │               │
│  ────────────────────────────┼─────────────┼───────────────│
│  Subtotal extraordinarias    │ $5.000,00   │               │
├─────────────────────────────────────────────────────────────┤
│  TOTAL A PAGAR: $39.567,89                                  │
│                                                             │
│  [💳 Pagar con MercadoPago]  [📥 Descargar recibo PDF]       │
│                                                             │
│  💡 ¿Por qué subieron las expensas este mes?               │
│     "Este mes hubo una reparación extraordinaria del        │
│      ascensor ($45.000 total). El mes que viene             │
│      volverían a la normalidad (~$34.000)."                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Documentos

```
┌─────────────────────────────────────────────────────────────┐
│  ← Documentos del consorcio                                 │
├─────────────────────────────────────────────────────────────┤
│  Categorías: [Todos ▼] [Actas] [Seguros] [Reglamento] [Otro]│
├─────────────────────────────────────────────────────────────┤
│  📄 Acta Asamblea Extraordinaria — 15/03/2026              │
│     [Ver] [Descargar]                                      │
│                                                             │
│  📄 Reglamento de Propiedad Horizontal                      │
│     [Ver] [Descargar]                                      │
│                                                             │
│  📄 Póliza Seguro Incendio 2026                            │
│     [Ver] [Descargar]                                      │
│                                                             │
│  📄 Acta Asamblea Ordinaria — 20/08/2025                  │
│     [Ver] [Descargar]                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Chat / Consultas

```
┌─────────────────────────────────────────────────────────────┐
│  ← Consultas                                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 ConsorcIA                                          │   │
│  │ "Hola María, ¿en qué puedo ayudarte?"               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Tú: "¿Por qué pagué $5.000 de ascensor?"                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 ConsorcIA                                          │   │
│  │ "El gasto de $45.000 por reparación del ascensor    │   │
│  │  fue distribuido entre las 9 unidades que usan el    │   │
│  │  ascensor. A tu UF (3A) le corresponden $5.000.    │   │
│  │  Este es un gasto extraordinario, no se repite       │   │
│  │  mensualmente."                                      │   │
│  │                                                      │   │
│  │  [¿Te quedó alguna duda?] [Crear ticket]             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Escribí tu consulta...                    ] [Enviar]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API Endpoints (Residente)

> **Autorización:** la autorización canónica es Cerbos (ver [[PRD-05-04 Cerbos RBAC]]). El middleware `verifyResident` de abajo queda como fast-path del vínculo usuario↔unidad: los roles de residente (propietario, inquilino, usufructuario) pertenecen al edificio, no a la organización.

```javascript
// routes/portal.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');

// Middleware: verificar que el usuario es residente del edificio
const verifyResident = async (req, res, next) => {
  const vinculo = await prisma.unidadUsuario.findFirst({
    where: {
      usuarioId: req.user.id,
      unidadId: req.params.unidadId || req.body.unidadId,
      organizacionId: req.organizacionId
    }
  });

  if (!vinculo) {
    return res.status(403).json({ error: 'No tenés acceso a esta unidad' });
  }

  req.vinculo = vinculo;
  next();
};

// GET /api/portal/expensas - Ver expensas del residente
router.get('/expensas',
  authenticate,
  async (req, res) => {
    const unidades = await prisma.unidadUsuario.findMany({
      where: { usuarioId: req.user.id, organizacionId: req.organizacionId },
      include: { unidad: true }
    });

    const expensas = await Promise.all(
      unidades.map(async (v) => {
        const cobros = await prisma.cobro.findMany({
          where: { unidadId: v.unidadId },
          include: { liquidacion: true },
          orderBy: { createdAt: 'desc' },
          take: 6
        });
        return { unidad: v.unidad, cobros };
      })
    );

    res.json(expensas);
  }
);

// GET /api/portal/expensas/:cobroId/recibo - Descargar recibo
router.get('/expensas/:cobroId/recibo',
  authenticate,
  verifyResident,
  async (req, res) => {
    const cobro = await prisma.cobro.findFirst({
      where: { id: req.params.cobroId, organizacionId: req.organizacionId },
      include: { liquidacion: true, unidad: true }
    });

    if (!cobro) return res.status(404).json({ error: 'Recibo no encontrado' });

    // Verificar que el cobro pertenece a una unidad del usuario
    const tieneAcceso = await prisma.unidadUsuario.findFirst({
      where: {
        usuarioId: req.user.id,
        unidadId: cobro.unidadId,
        organizacionId: req.organizacionId
      }
    });

    if (!tieneAcceso) {
      return res.status(403).json({ error: 'Sin acceso a este recibo' });
    }

    // Servir PDF
    const reciboPath = path.join(__dirname, '../uploads/recibos', `recibo_${cobro.liquidacion.periodo}_${cobro.unidad.numero}.pdf`);
    res.download(reciboPath);
  }
);

// GET /api/portal/documentos - Ver documentos del consorcio
router.get('/documentos',
  authenticate,
  async (req, res) => {
    const documentos = await prisma.documento.findMany({
      where: { organizacionId: req.organizacionId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipo: true,
        nombre: true,
        createdAt: true,
        uploadedBy: true
      }
    });

    res.json(documentos);
  }
);

// POST /api/portal/consultas - Enviar consulta
router.post('/consultas',
  authenticate,
  async (req, res) => {
    const { unidadId, mensaje } = req.body;

    // Verificar acceso
    const tieneAcceso = await prisma.unidadUsuario.findFirst({
      where: { usuarioId: req.user.id, unidadId, organizacionId: req.organizacionId }
    });

    if (!tieneAcceso) {
      return res.status(403).json({ error: 'Sin acceso a esta unidad' });
    }

    // Crear comunicación
    const comunicacion = await prisma.comunicacion.create({
      data: {
        organizacionId: req.organizacionId,
        edificioId: tieneAcceso.unidad.edificioId,
        tipo: 'EMAIL',
        asunto: `Consulta de ${req.user.nombre} - UF ${tieneAcceso.unidad.numero}`,
        contenido: mensaje,
        createdBy: req.user.id
      }
    });

    // Delegar a Agente Comunicador para respuesta automática
    // const respuesta = await agenteComunicador.responderConsulta(mensaje, unidadId, edificioId);

    res.status(201).json({
      comunicacion,
      mensaje: 'Tu consulta fue enviada. Te responderemos pronto.'
    });
  }
);

module.exports = router;
```

---

## 4. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **Portal web responsive** | MVP | App nativa en Fase 2. PWA como intermediario. Menor costo, mayor alcance |
| **Inquilino ve pero no paga** | Legal | Solo el propietario es obligado al pago (art. 2050 CCyC). Inquilino puede consultar |
| **Chat con IA primero** | Escalabilidad | 70% de consultas son repetitivas. IA responde, humano escala si es necesario |
| **Recibo descargable** | Ley 941 | Propietario debe poder acceder a su recibo en cualquier momento |
| **Documentos públicos** | Transparencia | Actas, reglamentos, seguros disponibles para todos los residentes |
| **Historial de 6 meses** | Performance | Carga inicial rápida. "Ver más" para histórico completo |

---

*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-03-05 Agente Comunicador]]  
*Documento relacionado:* [[PRD-07-01 Stack Frontend]]
