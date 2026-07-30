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

**Estado de la implementación (S3-09).** La pantalla vive en el tab `Liquidaciones` del detalle de edificio (`/edificios/:id/liquidaciones` la lista, `/edificios/:id/liquidaciones/:liquidacionId` la preview), siguiendo la convención "tabs como rutas hijas" de PRD-07-03 §2.2. Diferencias con el mockup de arriba, deliberadas:

- **Las acciones de estado están en la CABECERA, al lado del badge, no en un pie fijo** (S3-10). Es el mismo bloque que dice en qué estado está la liquidación, y con 40 UFs en la tabla un pie obligaría a scrollear hasta el final para aprobar algo que ya se verificó arriba.
- **El bloque `⚠️ Alertas` no se implementó.** Detectar que un gasto es "50% mayor que el promedio histórico" es análisis sobre la serie del edificio (agentes IA, S6). Lo que sí se sostiene hoy con datos ciertos es la comparación contra la liquidación vigente anterior, que está: como columna `Variación` por unidad y como badge en las tres tarjetas de resumen. Si no hay liquidación previa sin anular, la columna no se dibuja.
- **Cada fila de la tabla se expande** y muestra el desglose del reparto de esa UF: un renglón por gasto del período con la participación normalizada (`coeficienteAplicado`), el rótulo de cuota (S3-19) y el nombre del esquema de reparto que fijó el peso (S3-20) cuando no fue el coeficiente. Es lo que convierte la preview en una pantalla de verificación y no en un resumen.
- **La fila TOTAL se suma en el cliente con decimal.js** y se compara contra `totalGeneral`. Si difieren, la pantalla muestra una alerta y pide no aprobar: el DoD del sprint exige que cierre al centavo, así que un descuadre se denuncia en vez de esconderse.
- **El diálogo de generación** resuelve los `422` del §3 con la acción que los arregla, no con un toast: `SIN_GASTOS` linkea a los gastos de ese período, `GASTOS_SIN_CATEGORIA` también, y `COEFICIENTES_NO_CUADRAN` linkea a las unidades. Un período ya tomado se avisa **antes** del submit (el selector marca qué períodos tienen liquidación vigente).

### 4.2 Workflow de aprobación y recibos (S3-10)

Las transiciones del §1 se operan desde la preview. `frontend/src/lib/liquidacion.js` espeja `TRANSICIONES` del backend en `ACCIONES_LIQUIDACION`, y `accionesDeLiquidacion(estado)` devuelve las que ese estado habilita — la pantalla **dibuja solo esas**. Diferencias con el mockup del §4.1 y decisiones tomadas:

- **`[Rechazar]` no existe.** El mockup lo dibujaba como "vuelve a BORRADOR con comentarios" (§2 PASO 4), pero el backend no tiene ni la transición ni el campo de comentarios: el estado `PENDIENTE_APROBACION` está declarado y ninguna acción lleva a él. Sobre un borrador propio, "rechazar" es indistinguible de anular — que sí existe y libera el período. El approval inbox con rechazo y comentarios necesita el modelo de tareas (S6).
- **`[Aprobar y Enviar]` se partió en dos botones**, porque son dos actos con consecuencias distintas: aprobar congela el período (no se editan más sus gastos) y **generar recibos** emite documentos con valor legal. Fusionarlos le quitaría al administrador el único momento en que puede aprobar los importes y todavía revisar antes de emitir.
- **El botón de `APROBADA → ENVIADA` se rotula "Generar recibos", no "Enviar".** En el MVP la acción emite los PDFs y los deja disponibles para descargar; el envío por email es AgentMail (§2 PASO 6, post-beta). Un botón "Enviar" prometería que los propietarios recibieron algo. El **estado** sigue llamándose `ENVIADA` (es el nombre del backend y de la máquina de estados del §1); lo que cambia es el rótulo de la acción.
- **Las tres acciones pasan por `ConfirmDialog`** (PRD-07-02 §6.3), incluidas las no destructivas: el diálogo es el que explica qué deja de poder hacerse después.
- **Optimistic update con rollback en `aprobar` y `anular`; `enviar` espera la respuesta.** Emitir N PDFs con QR tarda, y pintar `ENVIADA` antes de tiempo dejaría una pantalla que promete recibos con la lista vacía debajo. El backend además reclama el estado *antes* de generar y lo revierte si falla (decisión 9 de las rutas), así que un optimismo ahí podría contradecir al servidor. La respuesta del `POST /enviar` ya trae los recibos emitidos: con eso se siembra la cache de la lista, sin refetch.
- **El `409 ESTADO_INVALIDO` se comunica como conflicto de concurrencia**, no como error de la persona ("alguien la modificó mientras la mirabas: ahora está en X"), y se refetchea el detalle.
- **Los recibos se listan en una card propia de la preview** (`components/liquidaciones/RecibosCard.jsx`), visible desde `APROBADA` — vacía y nombrando la acción que la llena — con un renglón por UF: número de recibo, ordinarias/extraordinarias/total y descarga del PDF. **La descarga es un `fetch` con Bearer que dispara un anchor sobre un blob** (`api.descargar`), no un `<a href>` al endpoint: el token vive en memoria, así que un link bajaría un 401 en un archivo. El nombre sale del `Content-Disposition` de la API.
- **Permisos:** aprobar, generar recibos y anular son del `org_admin` (`cerbos/policies/liquidacion.yaml`); el gestor no ve esos botones pero **sí descarga** los recibos de sus edificios asignados (`cerbos/policies/recibo.yaml`).
- E2E: `frontend/e2e/liquidacion-aprobacion.spec.js` (borrador → aprobar → generar recibos → descargar PDF → anular, y el caso del gestor).

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
