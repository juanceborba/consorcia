// src/services/coeficientes.js — Invariante de coeficientes de PH (S2-02)
// Spec: PRD-04-01 §1.3 — la suma de coeficientes de las unidades de un
// edificio debe ser 1.000000 (tolerancia 0.000001). Toda operación que toca
// unidades (bulk create, PATCH, DELETE) valida la suma RESULTANTE con
// decimal.js (motor determinístico, PRD-02-05) y rechaza con 422
// COEFICIENTES_NO_CUADRAN informando suma actual y delta si no cuadra.

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

// Body del 422 del contrato: { error: { code, message } } + suma y delta.
export function errorCoeficientes(suma) {
  const delta = OBJETIVO.minus(suma);
  const verbo = delta.gte(0) ? 'falta' : 'sobra';
  return {
    error: {
      code: 'COEFICIENTES_NO_CUADRAN',
      message: `La suma de coeficientes del edificio debe ser 1.000000. Suma resultante: ${suma.toFixed(6)} (${verbo} ${delta.abs().toFixed(6)})`,
      sumaActual: suma.toFixed(6),
      delta: delta.toFixed(6),
    },
  };
}
