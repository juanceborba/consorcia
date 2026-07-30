---
title: "PRD-04-02: Gestor de Gastos"
description: "Carga, categorización y asignación de gastos. Categorías A/B/C, ordinarias vs extraordinarias, comprobantes adjuntos."
author: "ConsorcIA Team"
date: 2026-07-29
status: "vigente"
priority: "P0"
tags: [modulo, core, gastos, categoria, ordinarias, extraordinarias, comprobantes, proveedores, rubros, dashboard, mvp]
outcomes:
  - "Cargar gastos individuales o en batch con validación completa"
  - "Categorizar automáticamente con sugerencias del Agente Contable"
  - "Asignar categorías A/B/C con preview de distribución"
  - "Distinguir entre gastos ordinarios y extraordinarios"
  - "Adjuntar comprobantes (facturas, recibos) a cada gasto"
  - "Asociar cada gasto a un proveedor obligatorio (directorio híbrido global + propio)"
  - "Segmentar gastos por rubro/subrubro con árbol maestro de 2 niveles"
  - "Analizar gastos en un dashboard interactivo con KPIs y filtros reactivos"
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
| `proveedorId` | UUID | Proveedor del gasto | FK → proveedores. **Obligatorio** |
| `rubroId` | UUID | Rubro de segmentación | FK → rubros. **Obligatorio** — siempre un subrubro o rubro hoja |
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
| `periodo` | String | "YYYY-MM" | Regex `^\d{4}-\d{2}$`. Con plan de cuotas, es el período de la **primera** cuota |
| `createdBy` | UUID | Admin que cargó | FK → usuarios |

### 1.1.b Plan de cuotas (S3-19, implementado)

Un gasto **extraordinario** puede imputarse en N cuotas mensuales en vez de caer
entero en un período (brecha 1 del research
`docs/investigacion/ordinarias-extraordinarias-y-categorias.md`; el mockup de
[[PRD-06-01 Ley 941 CABA]] §3.2 ya dibuja "Pintura fachada (cuota 3/6)").

El `Gasto` sigue siendo **la factura**: su `monto` es el total del comprobante.
Las **imputaciones** son filas de `GastoCuota`:

| Campo | Tipo | Descripción |
|---|---|---|
| `gastoId` | UUID | FK → gastos, `ON DELETE CASCADE` |
| `numero` / `cuotasTotal` | Int | La cuota k de N (CHECK `1 ≤ numero ≤ cuotasTotal`, `cuotasTotal ≥ 2`) |
| `periodo` | String | "YYYY-MM" al que se imputa **esta** cuota |
| `monto` | Decimal(12,2) | Lo que se reparte en ese período |

Únicos: `(organizacionId, gastoId, numero)` y `(organizacionId, gastoId, periodo)`
— dos cuotas del mismo gasto en el mismo período romperían la unicidad de
`LiquidacionDetalle`.

**Reglas (todas con test automático):**

1. **Σ cuotas = `gasto.monto` exacto.** La cuota base se trunca al centavo y el
   resto va en la última cuota. Cero tolerancia, igual que el reparto por UF.
2. **La API recibe solo `cuotasTotal`**; los períodos y los montos los deriva
   `planDeCuotas(monto, cuotasTotal, periodo)` en el motor. El cliente no puede
   mandar un plan que no sume el total.
3. **Solo extraordinarios.** `cuotasTotal` en un gasto ordinario → `422
   VALIDACION_FALLIDA`: una ordinaria es el gasto corriente del período.
4. **Un gasto en cuotas pertenece a los N períodos de su plan.** `?periodo=P`
   devuelve los gastos de imputación única de P **más** los que tienen una cuota
   en P; la fila trae `montoImputado` + `cuota: { numero, cuotasTotal }` y los
   `totales` suman **imputados** (así el total del filtro es el mismo número que
   va a repartir la liquidación de P). Sin `?periodo=`, la fila es la factura.
5. **Editar `monto`, `periodo` o `cuotasTotal` regenera el plan completo**;
   `cuotasTotal: null` lo borra (vuelve a imputación única). Un gasto con
   cualquier cuota en una liquidación congelante sigue dando `409
   LIQUIDACION_APROBADA`.
6. **El rótulo "cuota k/N" es un snapshot** en `LiquidacionDetalle`
   (`gastoCuotaId`, `cuotaNumero`, `cuotasTotal`): editar el plan después no
   reescribe un recibo ya emitido.

Un gasto **sin** cuotas se comporta exactamente como antes de S3-19: es el
default y no hay nada que configurar para liquidar.

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

### 1.3 Proveedores

**Regla de oro: ningún gasto se carga sin proveedor asociado.** El directorio de proveedores es **híbrido**: combina un catálogo global de plataforma con proveedores propios de cada organización.

- `organizacionId = null` → proveedor **global** de la plataforma (lo ven todas las organizaciones).
- `organizacionId = org` → proveedor **propio** de esa organización.
- Una organización ve y puede usar: **globales + propios activos**.

| Campo | Tipo | Descripción | Validación |
|-------|------|-------------|------------|
| `id` | UUID | PK | — |
| `organizacionId` | UUID? | null = global plataforma | FK → organizaciones |
| `razonSocial` | String | Nombre del proveedor | Obligatorio |
| `cuit` | String? | CUIT del proveedor | Dedup por org (índice único parcial SQL) |
| `email` | String? | Contacto | — |
| `telefono` | String? | Contacto | — |
| `direccion` | String? | — | — |
| `rubroHabitualId` | UUID? | Rubro sugerido al cargar gastos | FK → rubros, opcional |
| `notas` | String? | Observaciones internas | — |
| `activo` | Boolean | Baja lógica | Default true |

**Endpoints:**

```
GET    /api/proveedores           → globales + propios de la org (filtro ?q= por razón social/CUIT)
POST   /api/proveedores           → crea propio de la org (409 CUIT_DUPLICADO si ya existe el CUIT en la org)
GET    /api/proveedores/:id       → detalle
PUT    /api/proveedores/:id       → edita propios (los globales solo los edita SUPERADMIN)
DELETE /api/proveedores/:id       → si tiene gastos asociados: soft delete vía activo=false
```

**Dedup por CUIT:** un solo proveedor por CUIT dentro de cada organización. Se implementa con un **índice único parcial SQL** `ON proveedores (organizacion_id, cuit) WHERE cuit IS NOT NULL` (Prisma no soporta índices parciales → migration SQL manual). Los globales (`organizacion_id` null) quedan fuera del dedup por org y los gestiona la plataforma.

**Promoción a global (flujo futuro):** un SUPERADMIN podrá promover un proveedor propio a global de plataforma (`organizacionId → null`), resolviendo duplicados. Fuera del scope actual.

### 1.4 Rubros (segmentación de gastos)

Los rubros segmentan los gastos para análisis (son **independientes de la categoría A/B/C**, que gobierna la distribución a UF). Es un **árbol maestro de 2 niveles fijos**: rubro (nivel 1) → subrubro (nivel 2, hoja). El gasto siempre apunta a un subrubro o rubro hoja.

- `Rubro.organizacionId = null` → ítem del **maestro plataforma** (compartido por todas las orgs).
- `Rubro.parentId = null` → rubro (nivel 1); `parentId` set → subrubro (nivel 2).
- `RubroVisibilidad` (`organizacionId + rubroId → visible`) → permite a una org **ocultar** ítems del maestro.

**Merge del árbol para una organización** (`GET /api/rubros`):

1. Base: ítems maestro activos, aplicando los overrides de `rubro_visibilidad` (`visible=false` oculta el ítem; **ocultar un rubro oculta también sus subrubros**).
2. Sumar: ítems propios activos de la org. Un subrubro propio puede colgar de un **rubro maestro visible** o de un **rubro propio**.
3. Nunca se borra un ítem con gastos asociados → se desactiva (`activo=false`).

**Endpoints:**

```
GET    /api/rubros                     → árbol mergeado para la org del usuario
POST   /api/rubros                     → crea ítem propio (rubro o subrubro con parentId)
PUT    /api/rubros/:id                 → edita ítem propio
PUT    /api/rubros/:id/visibilidad     → toggle de override sobre ítem maestro (visible true/false)
DELETE /api/rubros/:id                 → solo propios sin gastos asociados
```

**Árbol maestro propuesto (seed):**

- **Administración**: Honorarios administración · Asesoría contable · Asesoría legal · Seguros (incendio/RC) · Gastos bancarios · Papelería y gestiones · Asambleas
- **Personal**: Sueldos y cargas sociales (CCT 589/10) · Suplencias · Horas extras · Uniformes e indumentaria · Indemnizaciones
- **Limpieza**: Limpieza general · Insumos de limpieza · Control de plagas · Higiene y desinfección · Manejo de residuos
- **Mantenimiento**: Plomería · Electricidad · Albañilería · Pintura · Herrería · Techos e impermeabilización · Carpintería
- **Seguridad**: Vigilancia física · Cámaras y monitoreo · Alarmas · Control de accesos · Portero eléctrico
- **Servicios públicos**: Energía eléctrica · Agua · Gas · ABL y tasas municipales · Telecomunicaciones
- **Ascensores**: Mantenimiento preventivo · Reparaciones · Inspecciones y certificaciones
- **Climatización**: Calderas y calefacción central · Aire acondicionado · Ventilación
- **Espacios comunes**: Pileta · SUM y parrilla · Gimnasio · Jardines y espacios verdes · Cocheras
- **Otros**: Varios (subrubro comodín siempre visible)

---

## 2. API Endpoints

```javascript
// routes/gastos.routes.js (resumen del contrato)
// Todas las rutas van autenticadas y autorizadas vía Cerbos (resource 'gasto'),
// y scopeadas a { organizacionId, edificioId } del tenant middleware.

const gastoSchema = z.object({
  concepto: z.string().min(3).max(100),
  descripcion: z.string().max(500).optional(),
  proveedorId: z.string().uuid(),   // obligatorio: ningún gasto sin proveedor
  rubroId: z.string().uuid(),       // obligatorio: subrubro/rubro hoja visible para la org
  monto: z.number().positive(),
  moneda: z.enum(['ARS', 'USD']).default('ARS'),
  categoria: z.enum(['A', 'B', 'C']),
  servicioEspecifico: z.string().optional(), // requerido si categoria = 'B'
  sectorEspecifico: z.string().optional(),   // requerido si categoria = 'C'
  esOrdinario: z.boolean().default(true),
  fechaGasto: z.string().datetime(),  // no futura
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  comprobanteUrl: z.string().url().optional()
});

// POST /api/edificios/:edificioId/gastos — Crear gasto → 201
//   Valida gastoSchema + validaciones cruzadas (proveedor visible para la org,
//   rubro hoja activo y visible); 422 si falta proveedorId/rubroId.

// GET /api/edificios/:edificioId/gastos — Listar gastos (paginado, orden fechaGasto desc)
//   Filtros: ?periodo=&categoria=&esOrdinario=&proveedorId=&rubroId=&createdBy=
//            &desde=&hasta=&q=&page=&limit=
//   Respuesta: { data: [...], pagination: { page, limit, total, totalPages },
//                totales: { cantidad, monto,
//                           ordinarios:      { cantidad, monto },
//                           extraordinarios: { cantidad, monto } } }
//                ← todo del filtro completo, no de la página (S3-02 / S3-08b)
//   Cada fila trae `editable` (false si el gasto está en una liquidación
//   APROBADA/ENVIADA/COBRADA): la UI apaga sus acciones sin pedir el detalle (S3-08).
//   Cada fila trae `creadoPor: { id, nombre, apellido } | null` — resuelto en una
//   query por página, porque `createdBy` es un String sin relación Prisma (S3-08b).

// GET /api/gastos/:id — Detalle (incluye liquidaciones asociadas) → 404 si no existe

// PUT /api/gastos/:id — Actualizar (solo si NO está en liquidación APROBADA/ENVIADA)
//   Si está liquidado → 409 { error: 'LIQUIDACION_APROBADA' }

// DELETE /api/gastos/:id — Soft delete (deletedAt) → 204

// GET /api/edificios/:edificioId/gastos/dashboard — Agregados del edificio (§3.4, S3-15)
//   Mismo permiso que la lista (gasto:read) y el MISMO constructor de `where`
//   (services/gastos-filtros.js): el KPI "Total del período" y la fila TOTAL de la
//   lista son el mismo número por construcción, no por disciplina.
```

---

## 3. Dashboard de Gastos

El dashboard es la **entrada al módulo** (el tab `gastos` del detalle de edificio): un reporte interactivo construido de forma **incremental**, posterior al CRUD. Debajo de los componentes analíticos vive el listado de gastos (§4.1), alimentado por los mismos filtros.

### 3.1 KPIs

- **Total del período** (suma de gastos del filtro activo).
- **Ordinarias vs extraordinarias**.
- **Variación % vs período anterior comparable** de igual longitud (mes previo, o rango equivalente corrido). Si no hay datos previos → `null` y la UI lo oculta.
- **Gasto por UF** (total / UF del edificio).
- **Cantidad de gastos**.

### 3.2 Filtros (todo reactivo)

- **Selector de edificio.** La opción **"Todos los edificios"** (consolidado a nivel organización) está disponible **solo en plan Business+** (ver [[PRD-04-08 Dashboard Administrador]]).
- **Selector de período:** últimos 12 meses / fecha desde-hasta / todo el período.
- Cada cambio de filtro actualiza KPIs, charts y el listado sin recargar.

### 3.3 Componentes

- **Top 10 proveedores** por monto.
- **Distribución por rubro** con drill-down a subrubros.
- **Distribución por categoría** A/B/C.
- **Evolución mensual** del gasto.
- **Listado de gastos** (§4.1) debajo, compartiendo los filtros.

### 3.4 Endpoints

```
GET /api/edificios/:edificioId/gastos/dashboard
GET /api/organizaciones/:organizacionId/gastos/dashboard   → consolidado; 403 PLAN_INSUFICIENTE si plan < business
```

Query: `?periodo=YYYY-MM` | `?desde=&hasta=` | `?todo=1`, más los filtros de la lista (§2: `categoria`, `proveedorId`, `rubroId`, `createdBy`, `q`). Los montos salen **siempre como string** (cero floats en el borde de salida). Respuesta única:

```json
{
  "filtro": { "modo": "periodo", "periodo": "2026-02", "desde": null, "hasta": null,
              "edificios": ["..."], "unidades": 20 },
  "kpis": { "total": "...", "totalOrdinarias": "...", "totalExtraordinarias": "...",
            "cantidadGastos": 42, "gastoPorUF": "...", "variacionVsPeriodoAnterior": "+12.4%" },
  "topProveedores": [{ "proveedorId": "...", "razonSocial": "...", "total": "...",
                       "cantidad": 5, "porcentaje": "42.1" }],
  "porRubro": [{ "rubroId": "...", "nombre": "Limpieza", "total": "...", "porcentaje": "18.2",
                 "cantidad": 4, "subrubros": [{ "rubroId": "...", "nombre": "Insumos", "total": "...",
                                                "porcentaje": "6.0", "cantidad": 1 }] }],
  "porCategoria": { "A": "...", "B": "...", "C": "..." },
  "evolucionMensual": [{ "periodo": "2026-02", "total": "..." }]
}
```

> **Fuera de scope:** exportación PDF/Excel y narrativa IA sobre este dashboard (eso es [[PRD-04-08 Dashboard Administrador]], Fase 2).

#### Implementado en S3-15 — precisiones sobre el diseño original

1. **Qué plata suma cada modo.** `?periodo=P` suma **montos imputados a P**: la cuota que le toca al período si el gasto tiene plan de cuotas (§1.1.b), o el gasto entero si no. `?desde=&hasta=` filtra por `fechaGasto` —los mismos nombres y la misma semántica que la lista (§2)— y suma el **monto de factura**; `?todo=1` también. La consecuencia buscada: `kpis.total` es **el mismo número** que la fila TOTAL del listado con el mismo filtro, porque los dos endpoints comparten el constructor del `where` (`backend/src/services/gastos-filtros.js`). En §3 el dashboard y el listado viven en la misma pantalla leyendo la misma URL: dos semánticas para `desde` se verían como una pantalla que se contradice.
2. **Los tres modos son excluyentes** y combinarlos responde `422 VALIDACION_FALLIDA` en vez de aplicar una precedencia. Sin ningún modo, el default es `todo`.
3. **`esOrdinario` no es filtro del dashboard**, aunque sí de la lista: el KPI ordinarias/extraordinarias (§3.1) *es* el corte por ese eje, y filtrarlo dejaría el otro subtotal en cero.
4. **La agregación es con decimal.js sobre el conjunto filtrado, no con `groupBy` de Prisma.** Para `?periodo=` no hay `groupBy` posible: el monto imputado de un gasto en cuotas vive en `gasto_cuotas` y ningún `groupBy` agrupa por una columna del gasto sumando una columna de la relación (la misma razón que ya obligó a sumar en memoria los `totales` de la lista en S3-19). Antes que mantener dos implementaciones de cinco agregados —donde la de `groupBy` daría números distintos justo en los gastos en cuotas—, se trae UNA vez el conjunto con las columnas necesarias y los cinco cortes salen del mismo recorrido, así que reconcilian por construcción: `total = ordinarias + extraordinarias = A + B + C = Σ porRubro`.
5. **La evolución mensual no usa la ventana del filtro activo.** Con `?periodo=P` son los **12 períodos que terminan en P** (§3.2 "últimos 12 meses"), con una query propia y los demás filtros aplicados: un chart de un punto no es un chart. Su último punto es igual a `kpis.total`. En `?desde=&hasta=` y `?todo=1` la serie se densifica de la imputación más vieja a la más nueva y **suma `kpis.total`** (las cuotas se ven en sus períodos). Un mes sin gastos es un `0.00`, no un hueco.
6. **`porRubro` viene rollup-eado a rubro raíz con sus `subrubros` adentro.** El gasto siempre apunta a una hoja (§1.1), y el drill-down de §3.3 necesitaba el árbol: devolver las hojas planas obligaría a la UI a reconstruirlo y a pedir un segundo request para bajar un nivel. Un rubro de nivel 1 usado directo aparece como raíz con `subrubros: []`.
7. **`gastoPorUF` divide por todas las unidades del alcance, sin filtrar por `estado`** — el mismo criterio que la liquidación ([[PRD-04-03 Motor de Liquidación]]: una UF en venta o alquilada paga expensas). Con cero unidades es `null`.
8. **La variación compara contra una ventana de igual longitud:** el mes anterior en `?periodo=`, el rango de la misma cantidad de días inmediatamente anterior en `?desde=&hasta=`, y `null` en `?todo=1` o cuando la ventana anterior no tiene gastos (un "+∞%" no es información; la UI lo oculta).
9. **El consolidado es de `org_admin`, no de `gestor`.** Se autoriza contra el recurso `gasto` con `edificio_id: null`: la regla de `org_admin` de `gasto.yaml` sólo compara la organización y matchea, la de `gestor` exige `edificio_id in edificios_asignados` y no, así que un gestor recibe `403 ACCESO_DENEGADO` **sin tocar la policy**. Es el resultado correcto: "todos los edificios de la organización" es justamente la vista que un gestor con edificios asignados no debe ver. El gate de plan corre **después** de Cerbos: a quien no tiene permiso no se le informa qué plan le falta comprar.
10. **`:organizacionId` acepta el id de la organización activa o el alias `me`**; cualquier otro responde `403 FUERA_DE_ORGANIZACION`. El tenant sale del JWT y nunca del cliente, así que el id de la URL es una aserción que se verifica, no una fuente. El alcance son los **edificios activos** de la organización: uno dado de baja se comporta como inexistente en toda la API, y si sus gastos entraran al consolidado el total no coincidiría con la suma de los tabs visibles.
11. **La jerarquía de planes** (`starter < pro < business < enterprise`, la de [[PRD-07-03 Rutas y Navegacion]]) se lee de la **DB y no del JWT**: el plan cambia con una suscripción y el access token vive 15 minutos. El error trae `planActual` y `planRequerido` además de `code`/`message`. En el seed, Org A quedó en `business` (para que "Todos los edificios" sea ejercitable en demo) y Org B en `starter` (el caso 403).

---

#### Implementado en S3-16 — la UI del dashboard

| Ruta / componente | Guard | Archivo | Notas |
|---|---|---|---|
| `/edificios/:id/gastos` | `RequireStaff` | `pages/edificio/EdificioGastosTab.jsx` | El tab pasa a **dashboard + listado en la misma pantalla**: toolbar arriba, KPIs, cuatro paneles y la tabla de §4.1 abajo, todos sobre el mismo filtro. Los KPI cards **reemplazan** al totalizador segmentado y a las tarjetas por categoría de S3-08b (eran sus antecesores anunciados) |
| `/reportes` | `RequireStaff` + `RequireRole org_admin` | `pages/reportes/ReportesPage.jsx` | **Hub del módulo Reportes** ([[PRD-07-03 Rutas y Navegacion]] §2.1): grilla de reportes del negocio. Hoy una sola tarjeta, "Gastos consolidados" |
| `/reportes/gastos` | idem | `pages/reportes/ReporteGastosPage.jsx` | El consolidado de la organización (§3.4, Business+). **Sin listado debajo**: los gastos se listan por edificio y no existe endpoint consolidado; el selector de edificio es el drill-down |
| `components/gastos/dashboard/GastosDashboard.jsx` | — | idem | Monta el dashboard completo para los dos alcances (`{ edificioId }` o `{ organizacion: true }`): la respuesta del endpoint tiene la misma forma, así que los componentes son los mismos. Traduce `PLAN_INSUFICIENTE` y `ACCESO_DENEGADO` a copy propio con `planActual`/`planRequerido` |
| `GastosKpis.jsx` | — | idem | Los cinco KPIs de §3.1. Las tarjetas de ordinarias/extraordinarias **son el control del filtro de tipo** |
| `EvolucionMensualChart.jsx` · `PorRubroChart.jsx` · `PorCategoriaChart.jsx` | — | idem | Recharts 3 (line / bar horizontal con drill-down / pie). Colores de los tokens (`--color-cat-a\|b\|c` para las categorías, los mismos de sus badges; monocromático `--chart-*` para el resto) |
| `TopProveedores.jsx` | — | idem | Ranking con barra proporcional en HTML, **no un chart**: diez razones sociales largas con tres números por fila no entran en un eje |
| `hooks/useFiltrosGastos.js` | — | idem | Traduce los search params a los DOS contratos (lista y dashboard) y garantiza la exclusión de los tres modos de período |
| `lib/planes.js` | — | idem | Jerarquía de planes en el cliente, solo para habilitar/deshabilitar la opción — el gate es del backend |

Divergencias y decisiones de S3-16:

1. **El consolidado NO vive en el tab del edificio, sino en un módulo Reportes nuevo.** §3.2 pone "Todos los edificios" en el selector del dashboard, pero la pantalla del tab tiene un listado debajo que **solo existe por edificio** (`GET /api/edificios/:id/gastos`), y la URL y el breadcrumb dirían un edificio mientras el contenido muestra la organización entera. El selector conserva la opción y **navega** a `/reportes/gastos`, la ruta que [[PRD-07-03 Rutas y Navegacion]] §2.1 ya tenía prevista con su entrada de sidebar. El hub `/reportes` es la casa de los reportes que vienen (morosidad, liquidaciones, [[PRD-04-10 Benchmarking]]): sin él, el primer reporte se quedaría con la URL del módulo.
2. **Los tres modos de período son un solo control con tres modos, y el rango salió del panel de filtros.** El contrato los rechaza combinados (§3.4, precisión 2) y hasta S3-08b el rango era un filtro más del panel, que convivía con el período: el listado lo toleraba y el dashboard habría respondido 422. Al entrar en modo rango se precarga el mes corriente y el `periodo` se borra solo (la invariante vive en `useFiltrosGastos`, un solo lugar).
3. **El filtro de tipo mueve la lista y no el dashboard, y la UI lo dice.** Es la consecuencia visible de la precisión 3 de §3.4. Sin el aviso, el KPI total y la fila TOTAL del listado dejan de coincidir sin explicación, que es el reporte de bug fantasma clásico. En el reporte consolidado —que no tiene listado— el filtro directamente no se ofrece.
4. **Todo lo clickeable de los charts filtra por la URL**, no por estado local: gajo del pie → categoría, fila del ranking → proveedor, barra de rubro → `rubroId` (filtro nuevo en la lista, que ya lo aceptaba en el contrato). La única excepción es el drill-down rubro → subrubros, que es navegación dentro del chart y no un recorte de la pantalla; no pide nada al servidor porque §3.4 ya devuelve el árbol.
5. **Cada chart es usable sin ver el SVG.** El de rubros y el de categorías llevan su leyenda como lista de botones (que además es la única forma de usar el drill-down con teclado: las barras de un SVG no son focusables) y la evolución publica su serie como tabla `sr-only`. Efecto lateral a tener en cuenta al escribir specs: un `getByRole('row')` de la página entera ahora trae también esas filas, así que las aserciones sobre el listado se acotan a su tabla.
6. **El gate de plan se muestra, no se esconde.** La opción "Todos los edificios" y la tarjeta del hub aparecen deshabilitadas con el badge "Business" y el motivo: ocultarlas dejaría al plan starter sin saber que la vista existe, y ofrecerlas sin señal sería mandar a un 403.
7. **`/reportes` va detrás de `RequireRole org_admin`.** Su único reporte es de la administración (§3.4, precisión 9: a un gestor Cerbos le responde 403 sin mirar el plan), así que el gestor vería un hub con una tarjeta que no puede abrir. Se revisa cuando exista un reporte de alcance gestor.
8. **La ayuda contextual** agrega `gastos/dashboard` (qué plata suma cada modo, por qué la evolución muestra 12 meses, por qué el tipo no mueve los KPIs, rubro ≠ categoría, gasto por UF ≠ expensa) y `reportes/gastos-consolidados` (alcance y por qué no hay listado). El acceso al topic `gastos/carga` se mudó del título del tab —que ahora habla de indicadores— al formulario de carga, que es de lo que ese topic habla.
9. **recharts entra como dependencia nueva** (~400 kB al bundle, que ya excedía el warning de 500 kB de Vite). El code-splitting del bundle es una tarea propia y no de este slice.

---

## 4. Frontend: Pantallas

> **Implementado (S3-14):** administración del directorio de proveedores (§1.3) y del árbol de rubros (§1.4), más los dos selectores que el formulario de carga (§4.2) va a consumir en S3-08.
>
> | Ruta / componente | Guard | Archivo | Notas |
> |---|---|---|---|
> | `/configuracion/proveedores` | `RequireStaff` | `pages/configuracion/ProveedoresPage.jsx` | DataTable con badge **Global/Propio**, buscador `?q=` contra el backend (razón social y CUIT, debounce 300 ms), toggle "Mostrar desactivados", paginación de 25. Alta/edición en `ProveedorFormDialog.jsx` (reusado por el alta inline del selector). El `409 CUIT_DUPLICADO` y el `422 RUBRO_INVALIDO` se muestran **inline en su campo**, no en un toast |
> | `/configuracion/rubros` | `RequireStaff` | `pages/configuracion/RubrosPage.jsx` | Árbol de 2 niveles (no DataTable: la jerarquía es el dato). Un solo control de visibilidad por fila con **dos endpoints detrás** — `PUT /:id/visibilidad` para el maestro, `PUT /:id { activo }` para los propios: para el usuario el efecto es el mismo ("aparece al cargar un gasto") y exponer la diferencia filtraría la implementación. Alta/edición en `RubroFormDialog.jsx` |
> | `components/gastos/ProveedorSelect.jsx` | — | idem | Combobox con búsqueda **del servidor** (`filter={null}`: el `?q=` ya filtró por CUIT y volver a filtrar en el cliente esconde coincidencias) + **alta inline** que deja el proveedor nuevo seleccionado. Controlado por `value`/`onChange`, apto para `Controller` de RHF |
> | `components/gastos/RubroSelect.jsx` | — | idem | Cascada rubro → subrubro con dos `<select>` nativos. Elegir un rubro **con** subrubros no fija el `rubroId` (el gasto apunta siempre a una hoja, §1.1); un rubro sin hijos lo fija directo y el segundo select no se muestra |
> | `components/ui/combobox.jsx` | — | idem | Primer combobox de la app: wrapper de estilos sobre `Combobox` de Base UI |
>
> Divergencias con este PRD, decididas en S3-14:
>
> - **Rutas nuevas, no previstas en [[PRD-07-03 Rutas y Navegacion]] §2.1.** Proveedores y rubros son configuración de la **organización**, no de un edificio, así que no cuelgan del detalle de edificio. Entran al sidebar como módulos de primer nivel (mismo criterio que "Usuarios" en S4-07) y se reacomodan cuando exista una pantalla `/configuracion` con tabs.
> - **No van detrás de `RequireRole org_admin`,** a diferencia de `/configuracion/usuarios`: las policies `proveedor.yaml` y `rubro.yaml` le dan **read** al gestor, que lo necesita para cargar gastos. El guard es `RequireStaff` y lo que se oculta al gestor son las acciones de escritura.
> - **La baja se comunica como "dar de baja", no como "eliminar".** El backend decide: sin gastos borra, con gastos degrada a `activo=false` (Ley 941). El copy del `ConfirmDialog` lo anticipa y el toast dice qué pasó realmente, en vez de prometer un borrado que puede no ocurrir.
> - **La ayuda contextual** (§6.5 de [[PRD-07-02 Diseño de Componentes]]) agrega los topics `gastos/proveedores` y `gastos/rubros`; el segundo insiste en la distinción rubro ≠ categoría A/B/C, que es el malentendido esperable del módulo.
> **Implementado (S3-08):** el formulario de carga de §4.2, que es el que monta los dos selectores de S3-14.
>
> | Ruta / componente | Guard | Archivo | Notas |
> |---|---|---|---|
> | `components/gastos/GastoFormDialog.jsx` | — | idem | Alta y edición en un solo diálogo (POST `/api/edificios/:id/gastos` vs PUT `/api/gastos/:id`), RHF + Zod con el espejo del schema del backend en `lib/gasto-schema.js`. `ProveedorSelect` y `RubroSelect` entran por `Controller`. El `422 PROVEEDOR_INVALIDO` / `RUBRO_INVALIDO` se muestra **inline en su selector**, y el `VALIDACION_FALLIDA` se rutea al campo cuando el mensaje del backend viene prefijado (`"monto: …"`) |
> | `pages/edificio/EdificioGastosTab.jsx` | `RequireStaff` | idem | El tab de S3-07 suma botón "Nuevo gasto", acciones de fila (editar / eliminar con `ConfirmDialog`) y el acceso a ayuda del topic `gastos/carga`. Solo para org_admin: `gasto.yaml` le da al gestor únicamente `read` |
>
> **Mejoras del listado (S3-08b), sobre el mockup de §4.1:**
>
> - **Columnas:** concepto · proveedor · monto · categoría · tipo · **fecha (dd-mm)** · **cargado por** · período. La fecha se muestra sin año (el filtro de período ya lo fija) con la fecha completa en el `title`; "cargado por" abrevia el nombre ("María R.") con el completo en el `title`.
> - **Filtros en una toolbar (`components/gastos/GastosFiltros.jsx`), no dentro de la tabla:** buscador de concepto (`?q=` con debounce de 300 ms) y período siempre a la vista; proveedor (reusa el combobox `ProveedorSelect`, sin alta inline), categoría, tipo, rango de fecha (`?desde=&hasta=`) y cargado por (`?createdBy=`) dentro de un popover **"Filtros"** con contador; y **chips** de lo activo, cada uno con su ✕, más "Limpiar todo". Todo sigue viviendo en la URL (decisión 2 del archivo). El monto no tiene filtro: el endpoint no lo soporta.
>   - **Descartado:** el primer intento puso un control debajo de cada título de columna. Con siete filtros hay que angostar cada uno hasta que deja de leerse ("Todo⌄"), la tabla se va a scroll horizontal y la cabecera compite visualmente con los datos. Los chips cubren el riesgo del panel colapsado: un filtro activo nunca queda escondido sin señal.
> - **La tabla usa `useReactTable`** (@tanstack/react-table, headless) con los componentes de tabla de shadcn, igual que `ProveedoresPage`: las columnas se declaran una vez en vez de repetirse entre `<TableHead>` y `<TableCell>` (el pie TOTAL contaba celdas vacías a mano). El modelo de **filtrado** de react-table no se usa: filtra y pagina el backend, y duplicar ese estado sería una segunda fuente de verdad capaz de contradecir a la URL.
> - **`components/ui/popover.jsx`** — wrapper nuevo sobre `Popover` de Base UI. El panel de filtros no puede ser un `DropdownMenu`: sus ítems son `menuitem` y navegan con flechas, así que un `<select>` o un input adentro rompen ese contrato de accesibilidad.
> - **Totalizador arriba de la lista, segmentado en total / ordinarios / extraordinarios** (`totales` del backend sobre el mismo filtro, así que siempre reconcilian). La distinción es del dominio: ordinarias y extraordinarias se liquidan y se leen por separado ([[PRD-04-03 Liquidación de Expensas]]). Es el antecesor de los KPI cards de S3-16, que reemplazan este bloque cuando el tab pase a dashboard.
> - **El filtro "Cargado por" solo lo ve el org_admin** (su combo sale de `/api/organizaciones/me/usuarios`, que al gestor le responde 403); la **columna** la ve todo el staff.
> - **La columna de acciones queda fija al borde derecho** (`sticky right-0`): con nueve columnas y la fila de filtros, la tabla scrollea horizontalmente en pantallas de ~1280 px y el menú de la fila era lo primero que quedaba fuera de vista.
> - **Fix de S3-14 encontrado acá:** `RubroSelect` deshacía la cascada cuando el `rubroId` llegaba precargado (rubro habitual del proveedor o edición de un gasto) — elegir un rubro con subrubros emitía `''` y el efecto de sincronización reseteaba el primer select. Ahora ignora los cambios que emitió el propio control.
>
> Divergencias con este PRD, decididas en S3-08:
>
> - **El comprobante es un LINK, no un upload.** El backend tiene el campo `comprobanteUrl` y un servicio de storage (`services/almacenamiento.js`, driver filesystem, S3-05), pero **no** hay endpoint de subida (ni multipart, ni bucket de MinIO, ni bootstrap): construirlo es infraestructura nueva completa y queda fuera del alcance de un formulario. El campo acepta la URL del comprobante ya digitalizado; el upload propio entra cuando exista el endpoint.
> - **El período es un desplegable de los últimos 12, no el input libre del mockup.** El formato es un contrato (`^\d{4}-\d{2}$`) y tipearlo a mano es una fuente gratuita de 422. En edición se agrega el período propio del gasto si cae fuera de la ventana.
> - **El servicio (B) y el sector (C) son desplegables cerrados**, alimentados por lo que declaran las unidades del edificio (`categoriaB` / `categoriaC`). Es más que una comodidad: el motor de S3-03 tira `DESBALANCE_LIQUIDACION` si ninguna unidad queda alcanzada, así que un servicio tipeado a mano no rompe el alta del gasto — rompe la liquidación de todo el mes. Si el edificio no declara ninguno, la categoría queda **deshabilitada** con el motivo y un link a las unidades.
> - **El monto se escribe en es-AR y viaja canónico.** El backend solo entiende el punto decimal, pero la app muestra "$ 1.500,50" y el usuario tipea eso: `normalizarMonto` traduce antes de validar (coma → decimal, puntos → miles) y valida con decimal.js, igual que el backend.
> - **Sin sugerencia de categoría por IA** (el bloque "💡 Sugerencia IA" del mockup de §4.2 y §5): está declarado fuera del alcance de S3 en el backlog del sprint (Agente Contable, Fase 2).
> - **La lista devuelve `editable` por fila** (agregado al endpoint de S3-02): el DoD del sprint pide que la acción de editar un gasto liquidado esté deshabilitada en la UI, y sin el flag por fila el frontend tendría que pedir el detalle de cada gasto de la página. Se resuelve con una query por página.
> - **La ayuda contextual** agrega el topic `gastos/carga` (período vs fecha, rubro ≠ categoría, por qué el servicio es cerrado, gasto congelado) y le da al tab de gastos el acceso a ayuda que S3-07 no tenía.

### 4.1 Lista de Gastos

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

### 4.2 Formulario de Carga

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

## 5. Integración con Agente Contable

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

## 6. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **No modificar gastos liquidados** | Integridad | Una vez aprobada la liquidación, los gastos son "congelados" para auditoría (rechazo 409 `LIQUIDACION_APROBADA`) |
| **Soft delete** | Conservación | Ley 941 exige conservar registros. `deletedAt` en vez de DELETE |
| **Periodo como String "YYYY-MM"** | Sorting | Fácil de ordenar, agrupar, filtrar. Compatible con SQL |
| **Comprobante URL** | Storage | MinIO/S3 para archivos. URL referenciada en DB |
| **Categoría obligatoria** | Liquidación | Sin categoría no se puede calcular distribución |
| **Sugerencia IA en formulario** | UX | Reduce errores de categorización. Admin siempre confirma |
| **Proveedor obligatorio** | Trazabilidad | Ningún gasto se carga sin proveedor asociado: habilita trazabilidad de pagos y el top-10 del dashboard |
| **Rubro obligatorio** | Análisis | Permite segmentar gastos para el dashboard; es distinto de la categoría A/B/C, que gobierna la distribución a UF |
| **Árbol de rubros de 2 niveles fijos** | Simplicidad | Rubro → subrubro alcanza para expensas; simplifica la UI y las agregaciones |
| **Proveedores híbridos** | Compartir datos | Globales de plataforma + propios por org: los consorcios comparten el directorio sin fricción; dedup por CUIT |
| **Unique parcial en Liquidación** | Anular → regenerar | Índice único parcial SQL `WHERE estado != 'ANULADA'` (Prisma no soporta parciales → migration SQL manual): permite anular una liquidación y regenerar el mismo período |

---

*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-04-08 Dashboard Administrador]]  
*Documento relacionado:* [[PRD-03-03 Agente Contable]]
