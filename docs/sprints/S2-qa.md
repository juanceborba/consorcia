# S2 — Reporte de QA

> **Fecha:** 2026-07-28 · **Modo:** standard (report-only: sin fixes por regla del sprint) · **Alcance:** slice S2 edificios + unidades (DoD de `S2-edificios-unidades.md`)
> **Entorno:** stack dockerizado local (`make up`), seed demo. Nada de código fuente modificado; working tree sin cambios propios.

**Resumen:** 62 chequeos automatizados (23 backend + 31 smoke + 2 E2E repo + 6 specs visuales) + 12 verificaciones manuales de API. **Todo el DoD pasa. 2 bugs should_fix (ambos de UI), 3 observaciones menores.** WTF: 0% (0 fixes aplicados, por regla del sprint).

## Qué se corrió

| Suite | Comando | Resultado |
|---|---|---|
| Health del stack | `make health` | ✅ 9/9 servicios |
| Tests backend (S1+S2) | `docker exec consorcIA-backend npm test` | ✅ 23/23 (3 suites) |
| Smoke E2E curl | `make smoke` | ✅ 31/31 pasos |
| E2E Playwright del repo | `npx playwright test` (host, `frontend/`) | ✅ 2/2 (`edificio-unidades.spec.js`, `smoke.spec.js`) |
| Specs visuales ad-hoc | Playwright contra `localhost:5173` (spec scratch en `/tmp/qa-s2`, fuera del repo) | ✅ 6/6 |
| Error states de API | curl manual contra `localhost:3000` | ✅ 12/12 comportamientos esperados |

## Definition of Done — verificación punto por punto

1. **Login admin → "Nuevo edificio" → alta con 5 unidades bulk → tabla con Σcoeficiente = 1.000000 en verde.** ✅ Cubierto por `edificio-unidades.spec.js` (verde) y verificado visualmente: fila TOTAL con `1.000000` y clase `text-success`, badges de categorías A/B, sort por columnas. Screenshot: `/tmp/qa-s2/02-detalle-unidades.png`.
2. **Guardar coeficientes que suman 0.9 → 422 con delta (API) y botón deshabilitado (UI).** ✅ API: `422 COEFICIENTES_NO_CUADRAN` con body `{"sumaActual":"0.900000","delta":"0.100000"}` y mensaje "falta 0.100000". UI: feedback inline "Suma actual: 0.900000 — falta 0.100000" y botón "Guardar 5 unidades" deshabilitado (assert del spec E2E).
3. **Gestor no puede crear edificio ni tocar edificio no asignado.** ✅ A nivel API: smoke (`403`) + tests backend (crear/eliminar edificio 403, unidad en edificio no asignado 403, aislamiento org B). **Pero ver Bug 1:** la UI no refleja la restricción.
4. **Breadcrumbs Inicio / Edificios / {nombre} / Unidades.** ✅ Assert del spec E2E (`aria-current="page"` = Unidades) + verificación visual. Matiz menor: ver Observación 1.

## Error states verificados (API, curl manual)

- POST edificio sin campos requeridos → `422 VALIDACION_FALLIDA` con detalle por campo ✅
- Bulk con body no-array / coeficiente numérico (no string) / coeficiente sin 6 decimales → `422 VALIDACION_FALLIDA` con mensajes claros ✅
- PATCH unidad que descuadra (0.6→0.7) → `422 COEFICIENTES_NO_CUADRAN` ("sobra 0.100000", `delta:"-0.100000"`) ✅
- DELETE unidad que rompe la invariante → `422 COEFICIENTES_NO_CUADRAN` (la invariante se valida también en bajas) ✅
- PATCH edificio inexistente → `404`; GET unidades de edificio vacío → `200 {data:[], total:0}`; paginación `?page=&limit=` respetada ✅
- Login con password incorrecta → `401`; sin token → `401`; refresh reusado → `401` (smoke) ✅
- Todos los edificios/unidades creados en las pruebas fueron eliminados (soft delete verificado con `204` + listado limpio).

## Bugs encontrados

### Bug 1 — should_fix · El gestor ve "Nuevo edificio" y puede abrir el form de alta
- **Repro:** login `gestor@demo.com` → `/edificios` muestra el botón **"Nuevo edificio"** (screenshot `/tmp/qa-s2/08-gestor-edificios.png`); navegar a `/edificios/nuevo` renderiza el form completo sin guard ni redirect (`/tmp/qa-s2/09-gestor-nuevo-edificio.png`).
- **Impacto:** bajo en seguridad (el backend rechaza con 403, fail-closed, verificado), pero es una acción visible que siempre falla al submit → mala UX y ruido de soporte. El modelo del sprint dice "org_admin: CRUD completo; gestor: solo lectura + unidades" — la UI debería ocultar el CTA y guardar la ruta por rol.
- **Fix sugerido:** condicionar el botón y la ruta `/edificios/nuevo` al rol `org_admin` (el claim `roles` ya está en el JWT).

### Bug 2 — should_fix · Indicador visual del tab activo no sigue a la ruta
- **Repro:** detalle de edificio → click en tab **"Resumen"** → URL `/overview`, contenido de overview y `aria-selected="true"` en "Resumen" (correcto), pero el pill visual de tab activo queda en **"Unidades"** (screenshot `/tmp/qa-s2/12-overview-tab-settled.png`). Mismo comportamiento en "Configuración".
- **Impacto:** el usuario no sabe en qué tab está; la accesibilidad (aria) está bien, el estilo visual está desincronizado (probablemente el estilo está bindeado a un estado default y no al tab seleccionado de Base UI).
- **Fix sugerido:** revisar el binding de la variante activa en el componente de tabs del detalle (`frontend/src/.../edificio` — tabs Resumen/Unidades/Configuración).

## Observaciones menores (no bloquean)

1. **Breadcrumb en inglés:** en `/overview` el crumb muestra "Overview" mientras el tab se llama "Resumen" (resto de la UI en español). Inconsistencia de i18n.
2. **Mobile 375px roto:** el sidebar no colapsa (~40% del ancho), la tabla de unidades queda aplastada a una columna visible y el header clipea el nombre ("Torre Paler…"). Screenshot `/tmp/qa-s2/11-mobile-detalle.png`. Aceptable si el backoffice es desktop-first, pero conviene declararlo explícitamente.
3. **Placeholders del bulk confusos:** las filas de "Carga rápida" muestran placeholders `3A` / `85` / `0.027742` mientras la suma dice `0.000000` — parecen valores cargados pero no lo son (screenshot `/tmp/qa-s2/07-bulk-dialog.png`). Considerar placeholder gris más tenue o filas vacías.
4. **Diseño (no bug):** la baja individual de una unidad es imposible mientras rompa la invariante (422) — consistente con "validar en cada operación", pero implica que eliminar una unidad exige re-cuadrar coeficientes en la misma transacción. Verificar que el PRD-04-01 contemple este flujo.

## Qué funciona bien

- La invariante Σ=1.000000 está blindada en las tres operaciones (bulk, PATCH, DELETE) con decimal.js y mensajes que informan suma y delta exactos — API y UI dicen lo mismo.
- El flujo E2E completo (alta → bulk con feedback inline → tabla con TOTAL verde → baja con ConfirmDialog requireText) pasa en ~1.4s y el spec se auto-limpia (re-ejecutable).
- Empty state guiado ("Cargá las unidades funcionales…"), validación onBlur con mensajes en español y submit deshabilitado hasta form válido.

## Evidencia

- Screenshots: `/tmp/qa-s2/*.png` (12 capturas, efímeras en /tmp por la regla "solo se escribe el reporte en el repo").
- Specs ad-hoc: `/tmp/qa-s2/visual.spec.js`, `tabs.spec.js`, `tabs2.spec.js` (corridos con config `/tmp/qa-s2/playwright.config.js`).
- Nota de proceso: el `save-artifact.sh` de la skill qa se omitió a propósito — la regla del sprint limita los archivos escritos a este reporte, que queda registrado vía `sprint.sh complete qa --artifact`.
