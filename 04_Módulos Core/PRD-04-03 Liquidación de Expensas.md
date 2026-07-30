---
title: "PRD-04-03: Liquidación de Expensas"
description: "Motor contable, generación de recibos con QR (Ley 941), separación ord/ext, aprobación workflow."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, liquidacion, expensas, recibos, qr, ley-941, aprobacion, mvp]
outcomes:
  - "Generar liquidaciones mensuales con distribución exacta por coeficientes"
  - "Crear recibos PDF con QR válido según Ley 941 CABA"
  - "Separar expensas ordinarias de extraordinarias"
  - "Implementar workflow de aprobación con Approval Inbox"
  - "Garantizar cero errores matemáticos en distribución"
---

# PRD-04-03: Liquidación de Expensas

> **El corazón del producto. Sin esto, no hay ConsorcIA.**  
> Motor contable determinístico + recibos con QR Ley 941 + workflow de aprobación.

---

## 1. Estados de Liquidación

```
BORRADOR → PENDIENTE_APROBACION → APROBADA → ENVIADA → COBRADA → ANULADA
    │              │                  │          │         │
    │              │                  │          │         └─ Si hay error grave
    │              │                  │          └─ Recibos enviados
    │              │                  └─ Admin aprueba
    │              └─ Preview generado, esperando aprobación
    └─ Calculada, puede editarse
```

---

## 2. Flujo de Liquidación

```
Admin: "Generar liquidación julio 2026"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 1: VALIDAR GASTOS                                      │
│  • ¿Hay gastos para el período?                             │
│  • ¿Todos tienen categoría asignada?                        │
│  • ¿Hay gastos sin comprobante? (warning, no bloqueante)    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 2: CALCULAR DISTRIBUCIÓN                               │
│  • Para cada gasto:                                          │
│    - Categoría A → todas las UF                              │
│    - Categoría B → UF con el servicio específico             │
│    - Categoría C → UF del sector específico                  │
│  • Motor contable (decimal.js) calcula montos exactos        │
│  • Validación: suma de montos = montoTotal (al centavo)      │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 3: GENERAR PREVIEW                                     │
│  • Tabla por UF: ordinarias, extraordinarias, total          │
│  • Resumen de gastos por categoría                            │
│  • Comparación con período anterior                           │
│  • Detección de anomalías (gasto inusualmente alto)          │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 4: APPROVAL INBOX                                      │
│  • Tarea creada: "Aprobar liquidación Julio 2026"           │
│  • Admin revisa preview → [Aprobar] [Rechazar] [Editar]      │
│  • Si rechaza → vuelve a BORRADOR con comentarios           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 5: GENERAR RECIBOS (post-aprobación)                   │
│  • Para cada UF:                                             │
│    - PDF con datos del consorcio (Ley 941)                  │
│    - QR escaneable con datos de liquidación                 │
│    - Matrícula RPA del administrador                        │
│    - Separación ord/ext clara                                │
│    - Datos de la UF: nombre, coeficiente, m²                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PASO 6: ENVÍO                                               │
│  • Agente Comunicador envía recibos vía AgentMail            │
│  • Links de pago MercadoPago incluidos                      │
│  • Tracking: enviado, abierto, click                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API Endpoints

```javascript
// routes/liquidaciones.routes.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { LiquidacionEngine } = require('../core/liquidacion.engine');
const { RecibosGenerator } = require('../core/recibos.generator');

// POST /api/liquidaciones/calcular - Calcular liquidación (preview)
router.post('/calcular',
  authenticate,
  authorize('liquidacion', 'create'),
  async (req, res) => {
    const { edificioId, periodo } = req.body;

    // Validar que existan gastos
    const gastos = await prisma.gasto.findMany({
      where: { edificioId, periodo, organizacionId: req.organizacionId }
    });

    if (gastos.length === 0) {
      return res.status(400).json({
        error: 'SIN_GASTOS',
        message: `No hay gastos cargados para el período ${periodo}`
      });
    }

    // Validar categorización
    const sinCategoria = gastos.filter(g => !g.categoria);
    if (sinCategoria.length > 0) {
      return res.status(400).json({
        error: 'GASTOS_SIN_CATEGORIA',
        message: `${sinCategoria.length} gastos sin categoría`,
        gastos: sinCategoria
      });
    }

    // Obtener unidades
    const unidades = await prisma.unidad.findMany({
      where: { edificioId, organizacionId: req.organizacionId }
    });

    // Calcular liquidación
    const liquidacion = await LiquidacionEngine.calcularLiquidacion(
      edificioId, periodo, gastos, unidades
    );

    // Guardar como borrador
    const borrador = await prisma.liquidacion.create({
      data: {
        organizacionId: req.organizacionId,
        edificioId,
        periodo,
        estado: 'BORRADOR',
        totalOrdinarias: liquidacion.totalOrdinarias,
        totalExtraordinarias: liquidacion.totalExtraordinarias,
        totalGeneral: liquidacion.totalGeneral,
        detalles: {
          create: liquidacion.detalles.map(d => ({
            organizacionId: req.organizacionId,
            unidadId: d.unidadId,
            gastoId: d.gastoId,
            coeficienteAplicado: d.coeficiente,
            montoAsignado: d.monto
          }))
        }
      },
      include: { detalles: { include: { unidad: true, gasto: true } } }
    });

    res.status(201).json(borrador);
  }
);

// POST /api/liquidaciones/:id/aprobar - Aprobar liquidación
router.post('/:id/aprobar',
  authenticate,
  authorize('liquidacion', 'update'),
  async (req, res) => {
    const liquidacion = await prisma.liquidacion.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId }
    });

    if (!liquidacion) return res.status(404).json({ error: 'No encontrada' });
    if (liquidacion.estado !== 'BORRADOR') {
      return res.status(400).json({ error: 'ESTADO_INVALIDO', estadoActual: liquidacion.estado });
    }

    const aprobada = await prisma.liquidacion.update({
      where: { id: req.params.id },
      data: {
        estado: 'APROBADA',
        approvedBy: req.user.id,
        approvedAt: new Date()
      }
    });

    res.json(aprobada);
  }
);

// POST /api/liquidaciones/:id/enviar - Generar y enviar recibos
router.post('/:id/enviar',
  authenticate,
  authorize('liquidacion', 'update'),
  async (req, res) => {
    const liquidacion = await prisma.liquidacion.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId },
      include: {
        edificio: true,
        detalles: { include: { unidad: true } }
      }
    });

    if (!liquidacion) return res.status(404).json({ error: 'No encontrada' });
    if (liquidacion.estado !== 'APROBADA') {
      return res.status(400).json({ error: 'NO_APROBADA' });
    }

    // Generar recibos
    const recibos = [];
    for (const detalle of liquidacion.detalles) {
      const recibo = await RecibosGenerator.generarRecibo(
        liquidacion,
        detalle.unidad,
        { matriculaRPA: liquidacion.edificio.organizacion.matriculaRPA }
      );
      recibos.push(recibo);
    }

    // Actualizar estado
    await prisma.liquidacion.update({
      where: { id: req.params.id },
      data: { estado: 'ENVIADA' }
    });

    // Enviar (delegar a Agente Comunicador)
    // await agenteComunicador.enviarRecibos(liquidacion.id);

    res.json({ enviados: recibos.length, recibos });
  }
);

module.exports = router;
```

---

## 4. Frontend: Pantallas

### 4.1 Preview de Liquidación

```
┌─────────────────────────────────────────────────────────────┐
│  Liquidación Julio 2026 — Preview                    [Editar]│
├─────────────────────────────────────────────────────────────┤
│  📊 Resumen                                                  │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Expensas Ordinarias:     $1.245.000,00             │     │
│  │ Expensas Extraordinarias:  $180.000,00             │     │
│  │ TOTAL GENERAL:           $1.425.000,00             │     │
│  │                                                     │     │
│  │ Gastos: 23 | Unidades: 36 | Período: 2026-07      │     │
│  └─────────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────────┤
│  📋 Detalle por Unidad                                       │
│  UF    │ Ordinarias │ Extraord. │ Total     │ % Variación │
│  ──────┼────────────┼───────────┼───────────┼─────────────│
│  1A    │ $34.567,89 │ $5.000,00 │ $39.567,89│ +12%        │
│  1B    │ $34.567,89 │ $5.000,00 │ $39.567,89│ +12%        │
│  ...   │ ...        │ ...       │ ...       │ ...         │
├─────────────────────────────────────────────────────────────┤
│  ⚠️ Alertas                                                  │
│  • Gasto "Reparación ascensor" ($45.000) es 50% mayor       │
│    que el promedio histórico. Verificar.                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [Rechazar]                              [Aprobar y Enviar] │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Decisiones de Diseño

> **Research previo a S3-09 (2026-07-29):** antes de implementar el generador se investigó cómo se
> cruzan los dos ejes de clasificación de un gasto (ordinaria/extraordinaria × categoría A/B/C),
> cómo se imputan y quién paga. Conclusión: **son ejes independientes y el modelo actual no
> contradice la ley**, pero faltan cuatro piezas para liquidar con certeza —**cuotas** de una
> extraordinaria, **exención parcial** por porcentaje (CCyC art. 2049 admite "eximir
> parcialmente", nuestro motor es binario), **respaldo documental** (cláusula del reglamento /
> acta de asamblea) y **fondo de reserva** (prometido en PRD-06-04 §4.1, ausente del motor).
>
> **Bloqueante para esta tarea:** el plan de **cuotas**. Si no se modela antes, cambia después la
> selección de gastos por período que hace el motor. La segunda decisión a tomar por escrito es
> si el **fondo de reserva** entra en S3 o no.
>
> Detalle, matriz de las 6 combinaciones, brechas por riesgo y fuentes legales:
> `app/docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **Borrador antes de aprobar** | Seguridad | Admin siempre revisa antes de enviar. Cero envíos automáticos |
| **No editar liquidación aprobada** | Integridad | Una vez aprobada, es "oficial". Error → anular y regenerar |
| **Recibo PDF con QR** | Ley 941 | Obligatorio. QR contiene datos verificables |
| **Separación ord/ext** | Ley 941 | Obligatorio. No pueden financiarse extraordinarias con ordinarias |
| **Approval Inbox** | Control | Admin ve exactamente qué se va a enviar antes de confirmar |
| **Anomalías en preview** | Prevención | Detectar gastos inusuales antes de aprobar |

---

*Documento relacionado:* [[PRD-02-05 Motor Contable]]  
*Documento relacionado:* [[PRD-04-02 Gestor de Gastos]]  
*Documento relacionado:* [[PRD-06-01 Ley 941 CABA]]
