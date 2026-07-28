---
title: "PRD-04-01: Gestión de Edificios"
description: "Alta de edificios, tipologías de unidades, coeficientes de PH, categorías A/B/C, configuración inicial."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [modulo, core, edificio, unidades, coeficientes, ph, propiedad-horizontal, mvp]
outcomes:
  - "Crear un edificio completo con todas sus unidades en <10 minutos"
  - "Soportar todas las tipologías: deptos, locales, cocheras, bauleras, oficinas, subconsorcios"
  - "Calcular y validar coeficientes de participación con precisión de 6 decimales"
  - "Configurar categorías A/B/C de distribución de gastos"
  - "Importar reglamentos de PH desde PDF"
---

# PRD-04-01: Gestión de Edificios

> **La organización es el tenant. El edificio es la unidad operativa dentro de ella.**  
> Sin un edificio bien configurado, no hay liquidación. Sin liquidación, no hay producto.

---

## 1. Modelo de Datos

Ver [[PRD-02-04 Base de Datos]] para el schema Prisma completo.

### 1.1 Entidades Principales

| Entidad | Descripción | Cardinalidad |
|---------|-------------|--------------|
| **Organización** | Administración/estudio administrador de consorcios. Tenant raíz del SaaS (CUIT, plan, matrícula RPA del administrador responsable) | 1 (raíz) |
| **Edificio** | Consorcio/PH. Unidad operativa dentro de la organización | N por organización |
| **Unidad** | UF (depto, cochera, etc.) | N por edificio |
| **Usuario** | Staff de la organización (org_admin, gestor) o residente del edificio (propietario, inquilino, encargado, proveedor, consejo) | N |
| **UnidadUsuario** | Relación usuario-unidad (puede haber varios por UF) | N |

### 1.2 Tipos de Unidad

| Tipo | Descripción | Ejemplo de numeración |
|------|-------------|----------------------|
| `departamento` | Vivienda principal | `3A`, `12B` |
| `local` | Local comercial | `Loc-1`, `Loc-PB` |
| `cochera` | Estacionamiento | `Coch-5`, `Coch-PB-3` |
| `baulera` | Depósito | `Baul-2`, `Baul-SS-1` |
| `oficina` | Oficina | `Of-301` |
| `subconsorcio` | Sector independiente (art. 2068 CCyC) | `Torre-A`, `Sector-Pileta` |

### 1.3 Coeficientes de Participación

```
Fórmula: coeficiente = m² de la UF / m² total del edificio

Ejemplo:
- Edificio: 3.064 m² total
- Depto 3A: 85 m² → coef = 85/3064 = 0.027742
- Cochera 5: 15 m² → coef = 15/3064 = 0.004896
- Baulera 2: 8 m² → coef = 8/3064 = 0.002611

Validación: Σ coeficientes = 1.000000 (tolerancia: 0.000001)
```

### 1.4 Categorías A/B/C

| Categoría | Descripción | Quién paga | Ejemplos |
|-----------|-------------|------------|----------|
| **A** | Gastos generales | TODAS las UF | Sueldos, seguros, ABL, limpieza común |
| **B** | Servicios específicos | Solo quienes lo usan | Ascensor, calefacción, agua caliente |
| **C** | Sectores específicos | Solo quienes pertenecen | Pileta, torre A, sector comercial |

---

## 2. API Endpoints

```javascript
// routes/edificios.routes.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { z } = require('zod');

// ─── SCHEMAS ───
const crearEdificioSchema = z.object({
  nombre: z.string().min(3).max(100),
  direccion: z.string().min(5).max(200),
  ciudad: z.string().default('CABA'),
  provincia: z.string().default('Buenos Aires'),
  codigoPostal: z.string().regex(/^\d{4}$/),
  // La matrícula RPA NO va en el edificio: es del administrador responsable
  // de la organización (Ley 941, ver [[PRD-06-01 Ley 941 CABA]]).
  // Los recibos la heredan: edificio → organización.
  totalM2: z.number().positive(),
  unidades: z.array(z.object({
    numero: z.string(),
    tipo: z.enum(['departamento', 'local', 'cochera', 'baulera', 'oficina', 'subconsorcio']),
    m2: z.number().positive(),
    coeficiente: z.string().regex(/^0\.\d{6}$/), // 6 decimales
    categoriaA: z.boolean().default(true),
    categoriaB: z.array(z.string()).default([]),
    categoriaC: z.string().nullable().default(null)
  })).min(1)
});

// ─── ENDPOINTS ───

// POST /api/edificios - Crear edificio (org_admin, o gestor con permiso create).
// El edificio se crea dentro de la organización del JWT.
router.post('/',
  authenticate,
  authorize('edificio', 'create'),
  validate(crearEdificioSchema),
  async (req, res) => {
    const { unidades, ...edificioData } = req.body;

    // Validar suma de coeficientes
    const sumaCoef = unidades.reduce((s, u) => s + parseFloat(u.coeficiente), 0);
    if (Math.abs(sumaCoef - 1) > 0.000001) {
      return res.status(400).json({
        error: 'SUMA_COEFICIENTES_INVALIDA',
        message: `Suma de coeficientes: ${sumaCoef}. Debe ser 1.000000`,
        sumaActual: sumaCoef
      });
    }

    // Crear edificio y unidades en transacción
    const resultado = await prisma.$transaction(async (tx) => {
      const edificio = await tx.edificio.create({
        data: {
          ...edificioData,
          organizacionId: req.organizacionId,
          unidades: {
            create: unidades.map(u => ({
              ...u,
              organizacionId: req.organizacionId
            }))
          }
        },
        include: { unidades: true }
      });
      return edificio;
    });

    res.status(201).json(resultado);
  }
);

// GET /api/edificios/:id - Obtener edificio con unidades
router.get('/:id',
  authenticate,
  authorize('edificio', 'read'),
  async (req, res) => {
    const edificio = await prisma.edificio.findFirst({
      where: { id: req.params.id, organizacionId: req.organizacionId },
      include: {
        unidades: {
          orderBy: { numero: 'asc' }
        },
        administradores: {
          select: { id: true, nombre: true, email: true }
        }
      }
    });

    if (!edificio) {
      return res.status(404).json({ error: 'Edificio no encontrado' });
    }

    res.json(edificio);
  }
);

// PUT /api/edificios/:id - Actualizar edificio
router.put('/:id',
  authenticate,
  authorize('edificio', 'update'),
  async (req, res) => {
    // No permitir cambiar coeficientes si ya hay liquidaciones
    const tieneLiquidaciones = await prisma.liquidacion.count({
      where: { edificioId: req.params.id }
    }) > 0;

    if (tieneLiquidaciones && req.body.unidades) {
      return res.status(400).json({
        error: 'LIQUIDACIONES_EXISTENTES',
        message: 'No se pueden modificar unidades con liquidaciones existentes'
      });
    }

    const edificio = await prisma.edificio.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json(edificio);
  }
);

// DELETE /api/edificios/:id - Soft delete
router.delete('/:id',
  authenticate,
  authorize('edificio', 'delete'),
  async (req, res) => {
    await prisma.edificio.update({
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

### 3.1 Lista de Edificios

```
┌─────────────────────────────────────────────────────────────┐
│  Mis Edificios                                    [+ Nuevo] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏢 Av. Libertador 1234                              │   │
│  │    CABA | 36 unidades | 24 deptos, 10 cocheras, 2   │   │
│  │    bauleras                                         │   │
│  │    Desde: Ene 2024                                  │   │
│  │    [Ver] [Configurar] [Liquidar]                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏢 Calle Falsa 456                                    │   │
│  │    CABA | 12 unidades | 10 deptos, 2 locales        │   │
│  │    Desde: Mar 2024                                  │   │
│  │    [Ver] [Configurar] [Liquidar]                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Detalle de Edificio

```
┌─────────────────────────────────────────────────────────────┐
│  ← Av. Libertador 1234                              [Editar] │
├─────────────────────────────────────────────────────────────┤
│  📍 Dirección: Av. Libertador 1234, CABA, CP 1425          │
│  🆔 Matrícula RPA: 12345 (heredada de la organización)      │
│  📐 Total m²: 3.064                                       │
│  👥 Gestores asignados: María González, Juan Pérez         │
├─────────────────────────────────────────────────────────────┤
│  Unidades (36)                                    [+ Agregar]│
├─────────────────────────────────────────────────────────────┤
│  Número  │ Tipo       │ m²   │ Coeficiente │ Cat. A │ Cat. B    │
│  ────────┼────────────┼──────┼─────────────┼────────┼───────────│
│  1A      │ Departamento│ 85   │ 0.027742    │ ✓      │ ascensor  │
│  1B      │ Departamento│ 85   │ 0.027742    │ ✓      │ ascensor  │
│  ...     │ ...        │ ...  │ ...         │ ...    │ ...       │
│  Coch-1  │ Cochera    │ 15   │ 0.004896    │ ✓      │ -         │
│  Baul-1  │ Baulera    │ 8    │ 0.002611    │ ✓      │ -         │
│  ────────┼────────────┼──────┼─────────────┼────────┼───────────│
│  TOTAL   │            │ 3064 │ 1.000000    │        │           │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **Organización = Tenant** | Multi-tenancy | Cada organización (administración) es un tenant aislado con N edificios. Los datos nunca se mezclan entre organizaciones |
| **Coeficiente con 6 decimales** | Precisión PH | Suficiente para edificios de hasta 10.000 UF. Trigger valida suma = 1 |
| **Soft delete** | Datos históricos | Ley 941 exige conservación. `deletedAt` en vez de DELETE |
| **No modificar con liquidaciones** | Integridad | Cambiar coeficientes con liquidaciones existentes invalidaría recibos |
| **UnidadUsuario separada** | Múltiples roles | Una UF puede tener propietario + inquilino + usufructuario (art. 2050 CCyC) |
| **Subconsorcio como tipo** | Ley 2068 CCyC | Sectores independientes con administrador propio |

---

*Documento relacionado:* [[PRD-03-02 Agente Onboarding]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]  
*Documento relacionado:* [[PRD-04-02 Gestor de Gastos]]
