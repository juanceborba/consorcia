# S2 — Reporte de code review

> **Scope:** diff completo del sprint (`git diff origin/main...main`, 20 commits, ~3.600 líneas, 50 archivos).
> **Modo:** `--standard` (dos pasadas: estructural + adversarial). Revisado contra `AGENTS.md`, `docs/sprints/S2-edificios-unidades.md` y los PRDs referenciados.
> **Veredicto: APROBADO** — 0 hallazgos blocking. 3 should-fix, 8 nits. El sprint cumple las 12 tareas del backlog y la definition of done.

## Verificación ejecutada

- `docker exec consorcIA-backend npm test` → **23/23 pass** (auth + edificios + unidades S2).
- `make smoke` → **31/31 pasos en verde** (incluye el slice S2: alta, bulk 422 con delta, bulk 201, paginación, PATCH, soft delete).
- Inspección de DB: los edificios de prueba de smoke/E2E quedan dados de baja (`activo=false`), sin basura activa.
- No se corrió el spec de Playwright desde el host (queda para la fase QA); se revisó estáticamente y cubre el DoD completo.

## Hallazgos

### Should Fix

1. **Test frágil ante actividad paralela sobre la org demo.** `backend/tests/edificios.test.js:50` afirma `data.length === 2` sobre la lista de edificios del admin. Es falso positivo de falla cuando otro proceso (smoke.sh, spec E2E, un agente en paralelo) tiene un edificio de prueba activo en ese instante — lo verifiqué en vivo: 2 corridas fallaron con `3 !== 2` mientras quedaba un edificio E2E activo; la tercera pasó 23/23. El propio archivo ya reconoce el problema en el test CRUD (línea 199-200: "no se afirma un total exacto") pero el test de S1 sigue con la cuenta exacta. Sugerencia: filtrar por los nombres del seed o afirmar `>= 2` + presencia de Torre Palermo y San Martín. Con el workflow de agentes en paralelo (conductor) esto va a seguir rompiendo el gate de CI intermitentemente.

2. **TOCTOU en la invariante de coeficientes.** Las tres operaciones validan la suma leyendo las unidades y escriben después, fuera de una transacción con lock: bulk create (`backend/src/routes/edificios.routes.js:208-226`), PATCH (`backend/src/routes/unidades.routes.js:101-111`), DELETE (`backend/src/routes/unidades.routes.js:136-142`). Dos requests concurrentes sobre el mismo edificio pueden pasar ambos la validación y dejar la suma descuadrada (la invariante es la pieza central del sprint). Probabilidad baja en el MVP (un solo admin por org), pero el fix es barato: envolver check+write en una transacción con `SELECT ... FOR UPDATE` sobre la fila del edificio (o revalidar la suma dentro de la transacción).

3. **`mutations.retry: 1` global puede duplicar escrituras no idempotentes.** `frontend/src/lib/query-client.js:17-19`. Un POST `/api/edificios` reintentado tras un error de red/5xx crea el edificio dos veces (no hay unique sobre nombre; el bulk de unidades sí está protegido por el unique de número → 409). Sugerencia: `retry: 0` en mutations (default de TanStack) salvo que se diseñe idempotencia.

### Nits

- **nit:** `sumaActual` y `delta` viajan **dentro** del objeto `error` (`backend/src/services/coeficientes.js:27-33`), cuando el contrato de AGENTS.md define `{ error: { code, message } }`. Funciona y los tests lo fijan, pero conviene documentar la extensión del contrato (o moverlos al nivel raíz del body).
- **nit:** Breadcrumbs muestra "Overview" (`frontend/src/components/layout/Breadcrumbs.jsx:14`) pero el tab se llama "Resumen" (`frontend/src/pages/EdificioDetallePage.jsx:24`). Label inconsistente para la misma ruta.
- **nit:** El botón "Nuevo edificio" se muestra también al gestor (`frontend/src/pages/EdificiosPage.jsx:44-49`), que siempre va a recibir 403 al submit. La zona de peligro del tab Configuración sí se oculta por rol; aplicar el mismo criterio acá.
- **nit:** Duplicado de número de UF: el frontend compara case-insensitive (`frontend/src/lib/unidad-schema.js:58-59`) y el backend case-sensitive (`edificios.routes.js:201-206` + unique de DB). "1A"/"1a" se bloquea en cliente pero el servidor lo permitiría. Alinear un criterio.
- **nit:** `UnidadAltaDialog`: tras un guardado exitoso `mutation.isSuccess` queda `true` mientras el componente sigue montado; si se reabre el modal y se cargan nuevos cambios, `cerrar` no pide confirmación (`frontend/src/pages/edificio/UnidadAltaDialog.jsx:216-225`). Edge case menor; `mutation.reset()` al reabrir lo resuelve.
- **nit:** La fila TOTAL de la DataTable suma coeficientes con `Number` (float) (`frontend/src/pages/edificio/EdificioUnidadesTab.jsx:228-236`) mientras el dialog usa decimal.js. Inofensivo a 6 decimales, pero rompe la regla de "montos siempre con decimal.js" si se reutiliza el patrón.
- **nit:** El regex de coeficiente admite `0.000000` (`backend/src/schemas/unidad.schema.js:21`) — una UF con coeficiente cero es legal según el schema. Confirmar que el PRD lo contempla (cocheras/bauleras con coef. 0 existen en la práctica, así que probablemente OK).
- **nit:** El `afterEach` del spec E2E hace login para el barrido sin logout (`frontend/e2e/edificio-unidades.spec.js:19-31`) → acumula refresh tokens en Redis por corrida.

### Observación (fuera del diff, preexistente)

- El header del doc S2 dice "gestor: solo edificios asignados (**lectura** + unidades)", pero Cerbos le concede `update` de edificio al gestor (`cerbos/policies/edificio.yaml:28`, regla de S1 no tocada por este sprint) y `EdificioConfiguracionTab.jsx:89-91` lo habilita en UI. El backlog S2-01 no lo restringe y hay test que lo ejerce. Vale alinear el doc con la policy (o recortar la policy) para que el PRD refleje lo que existe.

## Qué está bien

- **Invariante impecable:** decimal.js en backend con tolerancia 0.000001, espejada en cliente con los mismos OBJETIVO/TOLERANCIA; el 422 informa suma y delta exactos y está verificado en tests (bulk feliz, bulk 0.9, edificio ya cuadrado, PATCH que descuadra, DELETE en edificio cuadrado). La decisión de no permitir altas parciales una vez cuadrado el edificio está documentada en el código.
- **Defensa en profundidad multi-tenant real:** scope `{organizacionId}` en las queries + `validarEdificio`/`validarUnidad` + Cerbos con scope doble. Tests de aislamiento org B y gestor no asignado para cada operación de escritura.
- **Soft delete bien cerrado:** índice `(organizacionId, activo)`, `validarEdificio` trata al dado de baja como inexistente, el selector del header se limpia al eliminar, y el smoke tiene limpieza de seguridad anti-basura.
- **Patrones de formulario consistentes** en las 3 superficies (alta edificio, alta unidades, edición): onBlur + revalidate onChange, submit deshabilitado hasta válido, useBlocker + beforeunload, optimistic update con rollback en PATCH, ConfirmDialog con `requireText` para el flujo destructivo.
- **E2E honesto:** el spec de Playwright ejerce el DoD literal (0.9 → botón deshabilitado y delta visible; 1.000000 → TOTAL en verde) y limpia por UI y por API.
- **Documentación sincronizada:** AGENTS.md, README (31 chequeos, Playwright desde host), ROADMAP y checkboxes del backlog actualizados en el mismo sprint.

## Conflicto con findings de /security

No hay artefacto de `/security` previo para S2 (el hook de la skill no está instalado en este entorno; se verificó manualmente). Nada que cruzar. Se sugiere correr `/security` antes de `/ship` (el sprint toca auth-adjacent: policies de Cerbos y aislamiento de tenants).
