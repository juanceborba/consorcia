// tests/core/coeficientes.validator.test.js — Tests del validador de coeficientes (S3-03)
// Spec: PRD-02-05 §5.1.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CoeficientesValidator } from '../../src/core/validators/coeficientes.validator.js';

const LOTE_OK = [
  { id: 'u1', numero: 'PB', coeficiente: '0.200000' },
  { id: 'u2', numero: '1A', coeficiente: '0.250000' },
  { id: 'u3', numero: '1B', coeficiente: '0.250000' },
  { id: 'u4', numero: '2A', coeficiente: '0.300000' },
];

describe('CoeficientesValidator', () => {
  it('acepta un lote válido (suma exacta 1.000000, sin negativos ni duplicados)', () => {
    const { valido, errores } = CoeficientesValidator.validar(LOTE_OK);

    assert.equal(valido, true);
    assert.deepEqual(errores, []);
  });

  it('rechaza coeficientes negativos', () => {
    const lote = [
      { id: 'u1', numero: 'PB', coeficiente: '1.500000' },
      { id: 'u2', numero: '1A', coeficiente: '-0.500000' },
    ];
    const { valido, errores } = CoeficientesValidator.validar(lote);

    assert.equal(valido, false);
    assert.ok(errores.some((e) => e.campo === 'unidades[u2].coeficiente'));
  });

  it('rechaza cuando la suma de coeficientes != 1', () => {
    const lote = [
      { id: 'u1', numero: 'PB', coeficiente: '0.500000' },
      { id: 'u2', numero: '1A', coeficiente: '0.400000' },
    ];
    const { valido, errores } = CoeficientesValidator.validar(lote);

    assert.equal(valido, false);
    const errorSuma = errores.find((e) => e.campo === 'coeficientes.suma');
    assert.ok(errorSuma);
    assert.equal(errorSuma.valor, '0.9');
  });

  it('rechaza números de unidad duplicados', () => {
    const lote = [
      { id: 'u1', numero: '1A', coeficiente: '0.500000' },
      { id: 'u2', numero: '1A', coeficiente: '0.500000' },
    ];
    const { valido, errores } = CoeficientesValidator.validar(lote);

    assert.equal(valido, false);
    const errorDup = errores.find((e) => e.campo === 'unidades.numero');
    assert.ok(errorDup);
    assert.deepEqual(errorDup.valor, ['1A']);
  });

  it('acumula varios errores en una sola validación', () => {
    const lote = [
      { id: 'u1', numero: '1A', coeficiente: '-0.100000' },
      { id: 'u2', numero: '1A', coeficiente: '0.500000' },
    ];
    const { valido, errores } = CoeficientesValidator.validar(lote);

    assert.equal(valido, false);
    assert.equal(errores.length, 3); // negativo + suma + duplicado
  });
});
