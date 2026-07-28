---
title: "PRD-04-02: Gestor de Gastos"
description: "Carga, categorización y asignación de gastos. Categorías A/B/C, ordinarias vs extraordinarias, comprobantes adjuntos."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, gastos, categoria, ordinarias, extraordinarias, comprobantes, mvp]
outcomes:
  - "Cargar gastos individuales o en batch con validación completa"
  - "Categorizar automáticamente con sugerencias del Agente Contable"
  - "Asignar categorías A/B/C con preview de distribución"
  - "Distinguir entre gastos ordinarios y extraordinarios"
  - "Adjuntar comprobantes (facturas, recibos) a cada gasto"
---

# PRD-04-02: Gestor de Gastos

> **"Cada peso cuenta. Cada gasto debe estar justificado."**  
> El gestor de gastos es el input del motor contable. Sin gastos bien categorizados, no hay liquidación precisa.

---

## 1. Modelo de Datos

Ver [[PRD-02-04 Base de Datos]] para el schema Prisma completo.

### 1.1 Entidad Gasto

| Campo | Tipo | Descripción | Validación |
|-------|------|-------------|------------|
| `id` | UUID | PK | — |
| `organizacionId` | UUID | Organización (tenant raíz) | FK → organizaciones |
| `edificioId` | UUID | Edificio | FK → edificios |
| `concepto` | String | Nombre del gasto | Min 3, max 100 chars |
| `descripcion` | String? | Detalle opcional | Max 500 chars |
| `monto` | Decimal(12,2) | Monto en ARS | > 0 |
| `moneda` | String | ARS/USD | Default ARS |
| `categoria` | Enum | A/B/C | Obligatorio |
| `servicioEspecifico` | String? | Solo si B | Ej: "ascensor" |
| `sectorEspecifico` | String? | Solo si C | Ej: "torre_a" |
| `esOrdinario` | Boolean | true=ordinario | Default true |
| `comprobanteUrl` | String? | URL en MinIO/S3 | — |
| `fechaGasto` | DateTime | Fecha real del gasto | No futuro |
| `periodo` | String | "YYYY-MM" | Regex `^\d{4}-\d{2}$` |
| `createdBy` | UUID | Admin que cargó | FK → usuarios |

### 1.2 Categorías de Gasto

```
┌─────────────────────────────────────────────────────────────┐
│  CATEGORÍA A — GASTOS GENERALES                              │
│  Todas las UF pagan proporcionalmente                        │
│  Ejemplos:                                                   │
│  • Sueldo encargado                                          │
│  • Seguros (incendio, RC)                                    │
│  • ABL / Tasa municipal                                      │
│  • Limpieza común                                            │
│  • Mantenimiento general                                     │
│  • Honorarios administración                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  CATEGORÍA B — SERVICIOS ESPECÍFICOS                         │
│  Solo pagan las UF que usan el servicio                      │
│  Ejemplos:                                                   │
│  • Ascensor → solo UF con acceso a ascensor                 │
│  • Calefacción central → solo UF con radiadores             │
│  • Agua caliente → solo UF con termotanque central         │
│  • Aire acondicionado central → solo UF con ductos        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  CATEGORÍA C — SECTORES ESPECÍFICOS                          │
│  Solo pagan las UF del sector                                │
│  Ejemplos:                                                   │
│  • Pileta → solo UF del sector pileta                       │
│  • Torre A → solo UF de torre A                             │
│  • Sector comercial → solo locales                           │
│  • Cocheras subterráneas → solo UF con cochera allí        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. API Endpoints

```javascript
// routes/gastos.routes.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { z } = require('zod');

const gastoSchema = z.object({
  concepto: z.string().min(3).max(100),
  descripcion: z.string().max(500).optional(),
  monto: z.number().positive(),
  moneda: z.enum(['ARS', 'USD']).default('ARS'),
  categoria: z.enum(['A', 'B', 'C']),
  servicioEspecifico: z.string().optional().refine(
    val => !val || val.length > 0,
    { message: 'Servicio específico requerido para categoría B' }
  ),
  sectorEspecifico: z.string().optional(),
  esOrdinario: z.boolean().default(true),
  fechaGasto: z.string().datetime(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  comprobanteUrl: z.string().url().optional()
});

// POST /api/gastos - Crear gasto
router.post('/',
  authenticate,
  authorize('gasto', 'create'),
  validate(gastoSchema),
  async (req, res) => {
    const gasto = await prisma.gasto.create({
      data: {
        ...req.body,
        organizacionId: req.organizacionId,
        edificioId: req.body.edificioId,
        createdBy: req.user.id
      }
    });
    res.status(201).json(gasto);
  }
);

// GET /api/gastos - Listar gastos (con filtros)
router.get('/',
  authenticate,
  authorize('gasto', 'read'),
  async (req, res) => {
    const { periodo, categoria, esOrdinario, page = 1, limit = 50 } = req.query;

    const where = { organizacionId: req.organizacionId };
    if (periodo) where.periodo = periodo;
    if (categoria) where.categoria = categoria;
    if (esOrdinario !== undefined) where.esOrdinario = esOrdinario === 'true';

    const [gastos, total] = await Promise.all([
      prisma.gasto.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        orderBy: { fechaGasto: 'desc' },
        include: {
          createdByUser: { select: { nombre: true, apellido: true } }
        }
      }),
      prisma.gasto.count({ where })
    ]);

    res.json({
      data: gastos,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  }
);

// GET /api/gastos/:id - Obtener gasto
router.get('/:id',
  authenticate,
  authorize('gasto', 'read'),
  async (req, res) => {
    const gasto = await prisma.gasto.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId },
      include: {
        createdByUser: { select: { nombre: true, apellido: true } },
        liquidaciones: { select: { id: true, periodo: true, estado: true } }
      }
    });

    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(gasto);
  }
);

// PUT /api/gastos/:id - Actualizar gasto (solo si no está en liquidación aprobada)
router.put('/:id',
  authenticate,
  authorize('gasto', 'update'),
  async (req, res) => {
    const gasto = await prisma.gasto.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId },
      include: { liquidaciones: true }
    });

    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

    // No permitir modificar si está en liquidación aprobada
    const tieneLiquidacionAprobada = gasto.liquidaciones.some(
      l => l.estado === 'APROBADA' || l.estado === 'ENVIADA'
    );

    if (tieneLiquidacionAprobada) {
      return res.status(400).json({
        error: 'LIQUIDACION_APROBADA',
        message: 'No se puede modificar un gasto que ya fue liquidado'
      });
    }

    const actualizado = await prisma.gasto.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json(actualizado);
  }
);

// DELETE /api/gastos/:id - Soft delete
router.delete('/:id',
  authenticate,
  authorize('gasto', 'delete'),
  async (req, res) => {
    await prisma.gasto.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() }
    });
    res.status(204).send();
  }
);

module.exports = router;
```

---

## 3. Frontend: Pantallas

### 3.1 Lista de Gastos

```
┌─────────────────────────────────────────────────────────────┐
│  Gastos de Av. Libertador 1234                    [+ Nuevo] │
├─────────────────────────────────────────────────────────────┤
│  Filtros: [Período: 2026-07 ▼] [Cat: Todas ▼] [Ord: Todas ▼]│
├─────────────────────────────────────────────────────────────┤
│  Concepto              │ Monto    │ Cat. │ Tipo      │ Período │
│  ──────────────────────┼──────────┼──────┼───────────┼─────────│
│  Sueldo encargado      │ $450.000 │  A   │ Ordinario │ 2026-07 │
│  Seguro incendio       │ $85.000  │  A   │ Ordinario │ 2026-07 │
│  Reparación ascensor   │ $45.000  │  B   │ Extraord. │ 2026-07 │
│  ABL                   │ $32.000  │  A   │ Ordinario │ 2026-07 │
│  ──────────────────────┼──────────┼──────┼───────────┼─────────│
│  TOTAL: $612.000       │          │      │           │         │
├─────────────────────────────────────────────────────────────┤
│  [Anterior] Página 1 de 3 [Siguiente]                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Formulario de Carga

```
┌─────────────────────────────────────────────────────────────┐
│  Nuevo Gasto                                                │
├─────────────────────────────────────────────────────────────┤
│  Concepto *                                                 │
│  [Sueldo encargado                                    ]     │
│                                                             │
│  Descripción                                                │
│  [Pago mensual según CCT 589/10 SUTERH               ]     │
│                                                             │
│  Monto *          Moneda                                    │
│  [$450.000      ] [ARS ▼]                                  │
│                                                             │
│  Categoría *      [A - General ▼]                          │
│                                                             │
│  Tipo             [Ordinario ●] [Extraordinario ○]         │
│                                                             │
│  Fecha del gasto *                                          │
│  [01/07/2026    ]                                          │
│                                                             │
│  Período *                                                  │
│  [2026-07       ]                                          │
│                                                             │
│  Comprobante                                                │
│  [📎 Adjuntar archivo]                                      │
│                                                             │
│  [💡 Sugerencia IA: "Este gasto parece ser ordinario      │
│     de categoría A. ¿Querés que lo cargue?"                 │
│     [Sí, usar sugerencia] [No, editar manualmente]        │
│                                                             │
│                    [Cancelar]  [Guardar Gasto]              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Integración con Agente Contable

```javascript
// Al cargar un gasto, el Agente Contable puede:

// 1. Sugerir categoría automáticamente
const sugerencia = await agenteContable.sugerirCategoria(concepto, edificioId);
// → { categoria: 'A', esOrdinario: true, confianza: 0.94 }

// 2. Preview de distribución
const preview = await agenteContable.previewDistribucion(gasto, unidades);
// → [{ unidadId: 'u1', monto: '1234.56' }, ...]

// 3. Validar con motor contable
const valido = LiquidacionEngine.validarGasto(gasto);
// → { valido: true } o { valido: false, errores: [...] }
```

---

## 5. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **No modificar gastos liquidados** | Integridad | Una vez aprobada la liquidación, los gastos son "congelados" para auditoría |
| **Soft delete** | Conservación | Ley 941 exige conservar registros. `deletedAt` en vez de DELETE |
| **Periodo como String "YYYY-MM"** | Sorting | Fácil de ordenar, agrupar, filtrar. Compatible con SQL |
| **Comprobante URL** | Storage | MinIO/S3 para archivos. URL referenciada en DB |
| **Categoría obligatoria** | Liquidación | Sin categoría no se puede calcular distribución |
| **Sugerencia IA en formulario** | UX | Reduce errores de categorización. Admin siempre confirma |

---

*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-03-03 Agente Contable]]
