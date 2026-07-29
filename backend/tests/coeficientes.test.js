// tests/coeficientes.test.js — services/coeficientes.js (unit, sin DB)
// Contrato de #57: la invariante de PRD-04-01 §1.3 dejó de bloquear la
// escritura de unidades y quedó en dos piezas:
//   · `estadoCoeficientes` → estado INFORMATIVO que devuelve el API de unidades
//   · `validarParaLiquidacion` → gate DURO que debe llamar la liquidación (S3)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {
  cuadra,
  errorCoeficientes,
  estadoCoeficientes,
  mensajeCoeficientes,
  sumarCoeficientes,
  validarParaLiquidacion,
} from '../src/services/coeficientes.js';

describe('coeficientes (servicio)', () => {
  it('suma con decimal.js sin error de float (0.1 × 10 = 1.000000)', () => {
    const suma = sumarCoeficientes(Array.from({ length: 10 }, () => '0.100000'));
    assert.equal(suma.toFixed(6), '1.000000');
    assert.equal(cuadra(suma), true);
  });

  it('estadoCoeficientes informa suma, delta y veredicto (falta)', () => {
    const estado = estadoCoeficientes(sumarCoeficientes(['0.500000', '0.380000']));
    assert.deepEqual(estado, { suma: '0.880000', delta: '0.120000', cuadra: false });
  });

  it('estadoCoeficientes con delta negativo cuando la suma pasa de 1 (sobra)', () => {
    const estado = estadoCoeficientes(sumarCoeficientes(['0.700000', '0.420000']));
    assert.deepEqual(estado, { suma: '1.120000', delta: '-0.120000', cuadra: false });
  });

  it('estadoCoeficientes de un edificio sin unidades: suma 0, falta todo', () => {
    assert.deepEqual(estadoCoeficientes(sumarCoeficientes([])), {
      suma: '0.000000',
      delta: '1.000000',
      cuadra: false,
    });
  });

  it('respeta la tolerancia de 0.000001 del PRD', () => {
    assert.equal(cuadra(new Decimal('0.999999')), true);
    assert.equal(cuadra(new Decimal('1.000001')), true);
    assert.equal(cuadra(new Decimal('0.999998')), false);
  });

  // Gate duro de S3: un edificio con Σ≠1 no liquida.
  it('validarParaLiquidacion habilita el edificio cuadrado', () => {
    const r = validarParaLiquidacion(['0.200000', '0.250000', '0.250000', '0.300000']);
    assert.equal(r.ok, true);
    assert.equal(r.suma, '1.000000');
    assert.equal(r.delta, '0.000000');
  });

  it('validarParaLiquidacion bloquea el edificio descuadrado e informa el delta', () => {
    const r = validarParaLiquidacion(['0.200000', '0.250000']);
    assert.equal(r.ok, false);
    assert.equal(r.suma, '0.450000');
    assert.equal(r.delta, '0.550000');
  });

  it('el body de error del gate mantiene el contrato { error: { code, message } }', () => {
    const body = errorCoeficientes(sumarCoeficientes(['0.880000']));
    assert.equal(body.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(body.error.sumaActual, '0.880000');
    assert.equal(body.error.delta, '0.120000');
    assert.match(body.error.message, /falta 0\.120000/);
    assert.match(mensajeCoeficientes(new Decimal('1.120000')), /sobra 0\.120000/);
  });
});
