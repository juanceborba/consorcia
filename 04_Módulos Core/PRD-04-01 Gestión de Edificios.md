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

> Refleja lo implementado en `backend/src/routes/edificios.routes.js` y
> `backend/src/routes/unidades.routes.js` (sprints S1 y S2). Autenticación:
> JWT (`requireAuth`); tenant: `organizacionId` del JWT en TODAS las queries;
> autorización: Cerbos (`rbac.middleware`, fail-closed). Contrato de error:
> `{ error: { code, message } }`.

### 2.1 Edificios

| Método y ruta | Rol | Descripción |
|---|---|---|
| `GET /api/edificios` | org_admin, gestor | Lista de edificios **activos** de la org (el gestor solo los asignados) |
| `POST /api/edificios` | org_admin | Alta del edificio (solo datos; las unidades se cargan por bulk, §2.2) → 201 |
| `GET /api/edificios/:id` | org_admin, gestor asignado | Detalle + unidades |
| `PATCH /api/edificios/:id` | org_admin, gestor asignado | Edición parcial de datos |
| `DELETE /api/edificios/:id` | org_admin | **Soft delete** (`activo=false`) → 204. El edificio deja de listarse y se comporta como inexistente (404) |

```javascript
// Schemas Zod (backend/src/routes/edificios.routes.js)
const TIPOS_EDIFICIO = ['ph', 'barrio_privado', 'centro_comercial', 'otro'];

const crearEdificioSchema = z.object({
  nombre: z.string().trim().min(3).max(100),
  direccion: z.string().trim().min(5).max(200),
  ciudad: z.string().trim().min(2).max(100).default('CABA'),
  provincia: z.string().trim().min(2).max(100).default('Buenos Aires'),
  // Acepta CP numérico ("1425") o CPA argentino ("C1425BGW")
  codigoPostal: z.string().trim().regex(/^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/),
  tipo: z.enum(TIPOS_EDIFICIO).default('ph'),
  totalM2: z.number().positive(),
  fechaInicioAdmin: z.coerce.date().optional(),
  antiguedad: z.number().int().min(0).optional(),
  amenities: z.array(z.string()).default([]),
  reglamentoPH: z.string().url().optional(),
  // La matrícula RPA NO va en el edificio: es del administrador responsable
  // de la organización (Ley 941, ver [[PRD-06-01 Ley 941 CABA]]).
});
// PATCH: mismo schema con .partial() y al menos un campo.
```

### 2.2 Unidades

| Método y ruta | Rol | Descripción |
|---|---|---|
| `GET /api/edificios/:id/unidades` | org_admin, gestor asignado | Lista paginada `?page=&limit=` (default 1/50, máx 100) → `{ data, pagination: { page, limit, total, totalPages } }` |
| `POST /api/edificios/:id/unidades` | org_admin, gestor asignado | Alta **bulk** (body: array de UFs, transacción) → 201 |
| `PATCH /api/unidades/:id` | org_admin, gestor asignado | Edición parcial de la UF |
| `DELETE /api/unidades/:id` | org_admin, gestor asignado | Baja física de la UF → 204 |

```javascript
// Schema Zod (backend/src/schemas/unidad.schema.js)
const TIPOS_UNIDAD = ['departamento', 'local', 'cochera', 'baulera', 'oficina', 'subconsorcio'];

const unidadSchema = z.object({
  numero: z.string().trim().min(1).max(20),
  tipo: z.enum(TIPOS_UNIDAD),
  m2: z.number().positive(),
  coeficiente: z.string().regex(/^(0\.\d{6}|1\.000000)$/), // 6 decimales; "1.000000" = edificio de una sola UF
  categoriaA: z.boolean().default(true),
  categoriaB: z.array(z.string()).default([]),
  categoriaC: z.string().nullable().default(null)
});
```

**Invariante de coeficientes (§1.3) — validada en CADA operación de escritura
con decimal.js** (`backend/src/services/coeficientes.js`): la suma RESULTANTE
de coeficientes del edificio debe cerrar en 1.000000 (tolerancia 0.000001).
Si no cuadra → `422 COEFICIENTES_NO_CUADRAN` con `sumaActual` y `delta`
dentro de `error`. Consecuencias deliberadas:

- El **bulk inicial** de un edificio nuevo debe ser el set completo de UFs
  (existentes + lote = 1); no hay carga incremental parcial.
- En un edificio ya cuadrado, un **PATCH de coeficiente** o un **DELETE** de
  UF siempre descuadran → 422. La redistribución atómica de coeficientes es
  una operación futura; mientras tanto los coeficientes quedan cerrados tras
  el alta (coherente con "no modificar con liquidaciones", §4).

**Códigos de error del slice:** `VALIDACION_FALLIDA` (422, Zod),
`COEFICIENTES_NO_CUADRAN` (422), `UNIDAD_DUPLICADA` (409, unique
org+edificio+numero), `UNIDAD_EN_USO` (409, FK: UnidadUsuario/cobros/
liquidaciones), `EDIFICIO_NO_ENCONTRADO` (404), `UNIDAD_NO_ENCONTRADA` (404),
`FUERA_DE_ORGANIZACION` (403), `EDIFICIO_NO_ASIGNADO` (403, gestor),
`ACCESO_DENEGADO` (403, Cerbos).

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
| **Coeficiente con 6 decimales** | Precisión PH | Suficiente para edificios de hasta 10.000 UF. La API valida la suma = 1.000000 (tolerancia 0.000001) con decimal.js en cada operación de escritura (`COEFICIENTES_NO_CUADRAN`) |
| **Soft delete** | Datos históricos | Ley 941 exige conservación. `activo=false` en Edificio (las queries filtran activos y el edificio dado de baja se comporta como inexistente). Las UF usan baja física con guarda de FK (`UNIDAD_EN_USO`) mientras no existan liquidaciones |
| **No modificar con liquidaciones** | Integridad | Cambiar coeficientes con liquidaciones existentes invalidaría recibos |
| **UnidadUsuario separada** | Múltiples roles | Una UF puede tener propietario + inquilino + usufructuario (art. 2050 CCyC) |
| **Subconsorcio como tipo** | Ley 2068 CCyC | Sectores independientes con administrador propio |

---

*Documento relacionado:* [[PRD-03-02 Agente Onboarding]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]  
*Documento relacionado:* [[PRD-04-02 Gestor de Gastos]]
