# S3-19: Cuotas de gastos extraordinarios

- **Fuente:** PRD-04-02 / PRD-06-01 — [[PRD-04-02 Gestor de Gastos]]
- **Estado:** propuesta
- **Alcance:** Un gasto extraordinario se puede imputar en N cuotas: modelo de plan de cuotas + imputación por período, selección de gastos del motor por período (una cuota, no el gasto entero), UI en el form de gasto y en la lista, y en el recibo el rótulo "(cuota 3/6)" que ya dibuja el mockup de PRD-06-01 §3.2. Brecha 1 del research `docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.
- **Criterios de aceptación:**
  - Un gasto extraordinario de $X en N cuotas imputa X/N por período, con el ajuste de centavos en la última cuota (Σcuotas = X exacto).
  - El motor de liquidación de un período toma la cuota que corresponde a ese período, no el gasto completo.
  - El recibo y la lista muestran "cuota k/N".
  - Editar o eliminar un gasto con cuotas ya liquidadas responde 409 (mismo candado que hoy).
  - El total del listado de gastos sigue reconciliando (se define y documenta si muestra el monto del gasto o el imputado al período).
- **Depende de:** S3-02
- **Lote sugerido:** D
- **Sprint sugerido:** S3
- **Firma:** `fb7272ef`
