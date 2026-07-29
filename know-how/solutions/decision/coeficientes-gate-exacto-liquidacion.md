---
type: decision
title: "Coeficientes: carga permisiva, gate EXACTO al liquidar"
tags: [coeficientes, liquidacion, invariante, decimal-js, gate, s3]
severity: high
files:
  - backend/src/services/coeficientes.js
  - backend/src/core/validators/coeficientes.validator.js
  - backend/src/core/liquidacion.engine.js
  - backend/tests/coeficientes.test.js
date: 2026-07-29
sprint: S3
---

# Decisión de producto: la suma de coeficientes se exige EXACTA = 1.000000 solo al liquidar

## Problem

PRD-04-01 §1.3 exige que los coeficientes de PH de un edificio sumen 1.000000 (con tolerancia ±0.000001). Durante el alta de unidades esa invariante bloqueaba el data entry: los porcentajes reales no están definidos hasta terminar de cargar el 100% del edificio, y un 422 en cada alta no aportaba nada. A su vez, PRD-02-05 §5.1 pedía suma "exacta" sin aclarar cuándo aplica.

## Solution

Dos regímenes, un solo lugar cada uno:

1. **Carga (S2, #57): permisiva.** Alta bulk, PATCH y DELETE de unidades guardan igual y devuelven `estadoCoeficientes` INFORMATIVO (suma, delta, `cuadra` con tolerancia ±0.000001). La UI muestra la alerta "faltan/sobran X".
2. **Liquidación (S3): gate DURO y EXACTO.** `validarParaLiquidacion` en `backend/src/services/coeficientes.js` devuelve `ok: true` solo si la suma es **exactamente** 1.000000 (`suma.eq(OBJETIVO)`, sin tolerancia). El endpoint de liquidación (S3-04) debe llamarlo antes de calcular y devolver 422 `COEFICIENTES_NO_CUADRAN` si no cierra. El core puro (`core/validators/coeficientes.validator.js`, PRD-02-05 §5.1) también valida exacto — mismo criterio, dos capas.

Justificación del "exacto" en el gate: los porcentajes de reparto deben sumar el 100% del gasto al centavo; una liquidación emitida con Σ≠1 reparte de más o de menos sin que ningún test de balance lo detecte después.

## What didn't work

- Bloquear la escritura de unidades con la invariante (fase inicial de S2): fricción de data entry sin beneficio, revertido en #57.
- Usar la tolerancia ±0.000001 también en el gate: permitiría liquidar un edificio cuyo reparto no suma el 100%.

## Prevention

- No agregar una tercera validación de la misma invariante: gate HTTP = `services/coeficientes.js#validarParaLiquidacion`; validación del core = `core/validators/coeficientes.validator.js`.
- El campo `cuadra` que devuelve `validarParaLiquidacion` sigue siendo el veredicto INFORMATIVO con tolerancia (lo usa la UI); el veredicto del gate es `ok`. No mezclarlos.
- Test que fija la decisión: `tests/coeficientes.test.js` → "validarParaLiquidacion es exacta: dentro de la tolerancia informativa NO alcanza" (0.999999 y 1.000001 → `ok: false` con `cuadra: true`).
