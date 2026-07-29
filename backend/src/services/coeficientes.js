// src/services/coeficientes.js — Coeficientes de PH (S2-02, revisado en #57)
// Spec: PRD-04-01 §1.3 — la suma de coeficientes de las unidades de un
// edificio debe ser 1.000000 (tolerancia 0.000001).
//
// Cambio de UX (#57): la invariante ya NO bloquea la escritura de unidades.
// El alta bulk, el PATCH y el DELETE guardan igual y devuelven el estado de la
// suma de forma INFORMATIVA (`estadoCoeficientes`), para que la UI muestre la
// alerta "faltan/sobran X" en vez de un 422. El gate DURO se movió a la
// liquidación (S3): `validarParaLiquidacion` es la función que ese módulo debe
// llamar antes de emitir expensas — un edificio con Σ≠1 no liquida.
//
// Los montos y coeficientes se calculan SIEMPRE con decimal.js (motor
// determinístico, PRD-02-05) y se serializan como strings de 6 decimales.

import Decimal from 'decimal.js';

export const OBJETIVO = new Decimal(1);
export const TOLERANCIA = new Decimal('0.000001');

// Suma exacta de coeficientes (acepta Decimal de Prisma, string o number).
export function sumarCoeficientes(valores) {
  return valores.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

// ¿La suma cierra en 1 dentro de la tolerancia del PRD?
export function cuadra(suma) {
  return suma.minus(OBJETIVO).abs().lte(TOLERANCIA);
}

// Estado informativo de la suma, tal como lo consumen las respuestas del API
// y la UI: `suma` es lo que hay hoy, `delta` es lo que falta para 1 (negativo
// = sobra) y `cuadra` es el veredicto de la invariante. Strings de 6 decimales
// (misma serialización que los Decimal de Prisma).
export function estadoCoeficientes(suma) {
  return {
    suma: suma.toFixed(6),
    delta: OBJETIVO.minus(suma).toFixed(6),
    cuadra: cuadra(suma),
  };
}

// Gate duro de la liquidación (S3): un edificio cuyos coeficientes no cierran
// en 1.000000 no puede liquidar (los porcentajes de reparto no sumarían el
// 100% del gasto). Recibe los coeficientes de TODAS las unidades del edificio
// y devuelve `{ ok }` + el estado; el llamador decide el código de error
// (`COEFICIENTES_NO_CUADRAN`, 422) con `mensajeCoeficientes` para el detalle.
export function validarParaLiquidacion(valores) {
  const suma = sumarCoeficientes(valores);
  const estado = estadoCoeficientes(suma);
  return { ok: estado.cuadra, ...estado };
}

// Mensaje humano de la invariante (usado por el 422 del gate de liquidación y
// por los mensajes informativos del slice de unidades).
export function mensajeCoeficientes(suma) {
  const delta = OBJETIVO.minus(suma);
  const verbo = delta.gte(0) ? 'falta' : 'sobra';
  return `La suma de coeficientes del edificio debe ser 1.000000. Suma actual: ${suma.toFixed(6)} (${verbo} ${delta.abs().toFixed(6)})`;
}

// Body del 422 del contrato para el gate de liquidación (S3):
// { error: { code, message } } + suma y delta.
export function errorCoeficientes(suma) {
  return {
    error: {
      code: 'COEFICIENTES_NO_CUADRAN',
      message: mensajeCoeficientes(suma),
      sumaActual: suma.toFixed(6),
      delta: OBJETIVO.minus(suma).toFixed(6),
    },
  };
}
