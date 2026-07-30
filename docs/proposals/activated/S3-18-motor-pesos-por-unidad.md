# S3-18: Motor de reparto por pesos por unidad (seam)

- **Fuente:** PRD-02-05 — [[PRD-02-05 Motor Contable]]
- **Estado:** propuesta
- **Alcance:** Refactor interno de `calcularDistribucion` a `distribuir(monto, pesos)` con `pesosDe(gasto, unidades)` derivando los pesos de la categoría A/B/C exactamente como hoy (cero cambio funcional). La preview de liquidación pasa a exponer el peso normalizado aplicado a cada UF. Habilita las fases siguientes sin migrar liquidaciones ya emitidas. Diseño: `docs/investigacion/esquemas-de-reparto.md`.
- **Criterios de aceptación:**
  - Los tests unitarios de S3-03 pasan sin modificarse (mismo resultado al centavo).
  - `distribuir(monto, pesos)` normaliza por Σpesos y mantiene el ajuste de centavos en la última UF alcanzada, con revalidación de la suma.
  - Un peso 0 excluye a la UF; Σpesos = 0 sigue tirando `DESBALANCE_LIQUIDACION`.
  - El detalle de liquidación guarda el peso normalizado usado (`coeficienteAplicado`) — un recibo emitido no cambia si después cambia el reparto.
  - La respuesta del cálculo/preview incluye el peso o porcentaje por UF.
- **Depende de:** nada (S3-03 y S3-04 ya están)
- **Lote sugerido:** D
- **Sprint sugerido:** S3
- **Firma:** `cc72b0a6`
