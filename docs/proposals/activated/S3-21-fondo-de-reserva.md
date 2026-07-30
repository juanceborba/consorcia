# S3-21: Fondo de reserva en la liquidación

- **Fuente:** PRD-06-04 — [[PRD-06-04 Código Civil y Comercial]]
- **Estado:** propuesta
- **Alcance:** PRD-06-04 §4.1 promete el fondo de reserva como cálculo automático de la liquidación y el motor no lo tiene. Alcance: porcentaje configurable por edificio, ítem propio en la liquidación y en el recibo, y uso del fondo para financiar una extraordinaria (total o parcial). Brecha 4 del research `docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.
- **Criterios de aceptación:**
  - El porcentaje se configura por edificio y el ítem aparece separado en la liquidación y el recibo.
  - El saldo del fondo se puede consultar y se afecta cuando financia una extraordinaria.
  - Si el edificio no lo configura, la liquidación no lo incluye y nada cambia respecto de hoy.
- **Depende de:** S3-04
- **Lote sugerido:** G
- **Sprint sugerido:** S3
- **Firma:** `b784810d`
