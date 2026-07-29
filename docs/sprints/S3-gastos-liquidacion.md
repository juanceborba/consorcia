# S3 — Gastos + motor contable (backlog)

> **Objetivo:** cargar gastos categorizados (A/B/C, ordinarios/extraordinarios), liquidar un período con distribución exacta por coeficientes, aprobar y generar recibos PDF con QR y matrícula RPA (Ley 941).
> **Specs:** `PRD-04-02 Gestor de Gastos` (entidad Gasto, endpoints, pantallas), `PRD-04-03 Liquidación de Expensas` (workflow de estados, preview), `PRD-02-05 Motor Contable` (engine determinístico, validadores, recibo PDF/QR), `PRD-02-04 Base de Datos` (schema ya migrado en S1 — ver S3-01 por ajustes), `PRD-07-02/03/04` (patrones de UI ya adoptados en S2).
> **Modelo:** org es el tenant; todo endpoint scopea `{ organizacionId, edificioId }`. org_admin: CRUD completo + liquidar + aprobar; gestor: lectura de gastos/liquidaciones de sus edificios (NO liquida ni aprueba). Motor 100% determinístico con decimal.js — los LLMs jamás calculan.
> **Fuera de scope S3 (post-beta/Fase 2):** sugerencia de categoría por IA (Agente Contable), envío de recibos por email (AgentMail), links de pago MercadoPago (S5), conciliación bancaria, detección de anomalías en preview.

## Backend

- [ ] **S3-01 Ajustes de schema + policies Cerbos.** Migración: agregar `deletedAt DateTime?` a `Gasto` (soft delete exigido por PRD-04-02 §5, hoy ausente); revisar la constraint `@@unique([organizacionId, edificioId, periodo])` de `Liquidacion` contra el flujo anular→regenerar (decisión documentada: ¿unique parcial sobre estados activos o unique compuesto con correlativo?). Policies `cerbos/policies/gasto.yaml` y `liquidacion.yaml`: org_admin CRUD completo; gestor read de sus edificios asignados (fail-closed).
  - _Depende de: nada (S2 cerrado)._
- [ ] **S3-02 CRUD gastos.** `POST /api/edificios/:id/gastos`, `GET` (lista con filtros `?periodo=&categoria=&esOrdinario=&page=&limit=`, orden `fechaGasto` desc), `GET /api/gastos/:id`, `PUT /api/gastos/:id` (rechazar 409 `LIQUIDACION_APROBADA` si el gasto está en una liquidación APROBADA/ENVIADA), `DELETE /api/gastos/:id` (soft delete vía `deletedAt`). Validación Zod según PRD-04-02 §1.1: concepto 3-100, monto > 0, periodo regex `^\d{4}-\d{2}$`, fechaGasto no futura, `servicioEspecifico` obligatorio si categoría B, `sectorEspecifico` obligatorio si C. Montos con decimal.js. Errores del contrato `{ error: { code, message } }`.
  - _Depende de: S3-01._
- [x] **S3-03 Motor de distribución (core puro).** `src/core/liquidacion.engine.js` + `src/core/validators/` según PRD-02-05 §3 y §5: `calcularDistribucion(gasto, unidades)` por categoría (A → todas las UF; B → `categoriaB` incluye servicio; C → `categoriaC` == sector), ajuste de centavos en la última UF con revalidación, `LiquidacionError` con códigos (`SUMA_COEFICIENTES_INVALIDA`, `CATEGORIA_INVALIDA`, `DESBALANCE_LIQUIDACION`), cero floats, determinístico. Tests unitarios exhaustivos cubriendo §3.2 del PRD (A/B/C, rechazo por coeficientes ≠ 1, precisión con muchos decimales, ajuste de centavos).
  - _Depende de: nada (función pura; shape de unidad ya existe)._
- [ ] **S3-04 Endpoints de liquidación.** `POST /api/edificios/:id/liquidaciones` (calcular: valida `SIN_GASTOS` / `GASTOS_SIN_CATEGORIA` → 422, corre el engine, persiste BORRADOR con detalles), `GET /api/edificios/:id/liquidaciones` (lista) y `GET /api/liquidaciones/:id` (preview: totales ord/ext/general + detalle por UF), `POST /api/liquidaciones/:id/aprobar` (BORRADOR→APROBADA, registra `approvedBy/approvedAt`; transición inválida → 409 `ESTADO_INVALIDO`), `POST /api/liquidaciones/:id/anular` (→ANULADA). `matriculaRPA` heredada edificio→organización al crear. Máquina de estados estricta (PRD-04-03 §1).
  - _Depende de: S3-02, S3-03._
- [ ] **S3-05 Recibos PDF + QR (Ley 941).** `src/core/recibos.generator.js` con pdfkit + qrcode según PRD-02-05 §4: header con consorcio/dirección/matrícula RPA, datos de la UF (número, coeficiente, m²), separación ordinarias/extraordinarias con detalle por gasto, total, QR (JSON con matrícula, período, UF, totales, fecha emisión), footer Ley 941. `recibo.validator.js` (§5.2). `POST /api/liquidaciones/:id/enviar` (APROBADA→ENVIADA: genera un PDF por UF, sube a MinIO, persiste referencia), `GET /api/liquidaciones/:id/recibos/:unidadId` (descarga del PDF). Sin envío por email (post-beta).
  - _Depende de: S3-04._
- [ ] **S3-06 Tests de API del slice.** CRUD gastos feliz + validaciones (B sin servicio → 422, fecha futura → 422); PUT sobre gasto liquidado → 409; calcular → suma de detalles = totalGeneral al centavo (verificación contra cálculo manual con decimal.js en el test); aprobar 2 veces → 409; enviar sin aprobar → 409; gestor crea liquidación → 403; org B no toca gastos/liquidaciones de org A; PDF generado existe y el QR contiene matrícula RPA. Limpiar datos creados.
  - _Depende de: S3-05._

## Frontend — features

- [ ] **S3-07 Lista de gastos + filtros.** Ruta según PRD-07-03 (tab `gastos` del detalle de edificio). DataTable (patrones S2): concepto, monto (formato es-AR), categoría (badges A/B/C), tipo (ordinario/extraordinario), período; fila TOTAL del filtro activo; filtros por período (default: mes actual), categoría y tipo; paginación del backend; empty state + skeleton.
  - _Depende de: S3-02._
- [ ] **S3-08 Form nuevo gasto.** RHF + Zod patrones §6.1: concepto, descripción, monto + moneda, categoría (select que condiciona: B → select de servicios del edificio, C → select de sectores), radio ordinario/extraordinario, fechaGasto (default hoy), período (default mes actual). Edición inline o modal para gastos no liquidados; delete con ConfirmDialog. Comprobante: campo opcional (upload a MinIO si hay endpoint disponible; si no, queda diferido — documentar en el issue).
  - _Depende de: S3-02, S3-07._
- [ ] **S3-09 Liquidación: generar + preview.** Botón "Generar liquidación" (selector de período) → POST calcular → vista preview según PRD-04-03 §4.1: cards de resumen (ordinarias, extraordinarias, total, cantidad de gastos/UFs), tabla por UF (ordinarias, extraordinarias, total), comparación % vs período anterior si existe liquidación previa. Manejo de 422 `SIN_GASTOS` con CTA a cargar gastos.
  - _Depende de: S3-04._
- [ ] **S3-10 Workflow aprobación + recibos.** Acciones según estado: BORRADOR → Aprobar (ConfirmDialog) / Anular; APROBADA → "Generar recibos" (ConfirmDialog, es la acción "oficial"); ENVIADA → lista de recibos por UF con descarga de PDF. Badge de estado en la lista de liquidaciones (tokens S2-05). Optimistic update con rollback en las transiciones.
  - _Depende de: S3-05, S3-09._

## Cierre

- [ ] **S3-11 Tests E2E + smoke + docs.** Extender `scripts/smoke.sh`: cargar 3 gastos (A ordinario, B, extraordinario) → calcular → verificar suma al centavo → aprobar → enviar → PDF descargable. Playwright: spec "cargar gastos y liquidar" (flujo del DoD). README, ROADMAP y checkboxes. `npm test` backend en verde (S1+S2+S3).
  - _Depende de: S3-06, S3-08, S3-10._

## Dependencias entre tareas

```
S3-01 ──► S3-02 ──┬─► S3-04 ──► S3-05 ──► S3-06 ──┐
S3-03 ────────────┘         │                      │
                  S3-02 ──► S3-07 ──► S3-08 ───────┤
                  S3-04 ──► S3-09 ──┐              │
                  S3-05 ────────────┴─► S3-10 ────► S3-11
```

**Lotes paralelos sugeridos:** Lote A (S3-01→02), Lote B (S3-03, en paralelo con A), Lote C (S3-04→05→06), Lote D (S3-07+08), Lote E (S3-09→10), Lote F (S3-11).

## Definition of done del sprint

- Login admin → tab gastos → cargar 4 gastos (A ordinario, B con servicio, C con sector, extraordinario) → "Generar liquidación" → preview con totales exactos por UF → Aprobar → Generar recibos → descargar PDF con QR escaneable y matrícula RPA.
- La suma de los detalles de toda liquidación = `totalGeneral` al centavo (test automático, cero tolerancia).
- Editar un gasto de una liquidación aprobada → 409 (API) y acción deshabilitada (UI).
- Gestor no puede liquidar ni aprobar (403, test automático); solo lee gastos de sus edificios.
- Anular una liquidación permite regenerar el mismo período (decisión de S3-01 aplicada).
