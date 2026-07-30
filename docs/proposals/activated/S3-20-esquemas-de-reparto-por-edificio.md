# S3-20: Esquemas de reparto configurables por edificio

- **Fuente:** PRD-02-05 / PRD-04-01 — [[PRD-02-05 Motor Contable]]
- **Estado:** propuesta
- **Alcance:** El setup de liquidación por edificio: modelos `EsquemaReparto` + `EsquemaRepartoUnidad` + `ConfiguracionLiquidacion`, resolución en el motor (esquema del gasto → esquema del edificio → default actual), endpoints CRUD, UI en el tab de configuración del edificio y selector/override en el form de gasto, seed y E2E. Resuelve exención parcial, coeficiente propio por sector, partes iguales y cargo particular a una UF. Diseño y escenarios: `docs/investigacion/esquemas-de-reparto.md`.
- **Criterios de aceptación:**
  - Un edificio sin esquemas configurados liquida exactamente igual que hoy (retrocompatible).
  - Se puede expresar: exención parcial por porcentaje, coeficiente propio de un sector, partes iguales y cargo a una sola UF.
  - Un gasto puede adoptar el esquema del edificio o traer el suyo (override).
  - El esquema guarda la cláusula del reglamento que lo habilita (art. 2049 CCyC) y opcionalmente el documento.
  - Cambiar un esquema no altera ninguna liquidación ya emitida.
  - El motor sigue siendo determinístico: base cerrada (COEFICIENTE / PARTES_IGUALES / PESOS_PROPIOS), sin fórmulas ni condiciones configurables.
- **Depende de:** S3-18
- **Lote sugerido:** G
- **Sprint sugerido:** S3
- **Firma:** `8d5231ce`
