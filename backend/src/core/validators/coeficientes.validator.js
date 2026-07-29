// src/core/validators/coeficientes.validator.js — Validador de coeficientes (S3-03)
// Spec: PRD-02-05 §5.1. Valida el conjunto de unidades de un edificio antes
// de liquidar: coeficientes no negativos, suma exacta = 1.000000 y números
// de unidad sin duplicados. No lanza excepciones: devuelve { valido, errores }.
//
// Contexto: la carga de unidades es permisiva (la suma puede no cerrar durante
// el data entry, ver #57); el gate EXACTO se exige recién al liquidar. El gate
// del endpoint HTTP vive en src/services/coeficientes.js
// (`validarParaLiquidacion`); este validador es el chequeo del core puro.

import Decimal from 'decimal.js';

class CoeficientesValidator {
  static validar(unidades) {
    const errores = [];

    // 1. Todos los coeficientes >= 0
    for (const u of unidades) {
      if (new Decimal(u.coeficiente).lt(0)) {
        errores.push({
          campo: `unidades[${u.id}].coeficiente`,
          mensaje: 'El coeficiente no puede ser negativo',
          valor: u.coeficiente,
        });
      }
    }

    // 2. Suma = 1.000000 (exacta, con decimal.js — cero floats nativos)
    const suma = unidades.reduce((s, u) => s.plus(u.coeficiente), new Decimal(0));
    if (!suma.equals(1)) {
      errores.push({
        campo: 'coeficientes.suma',
        mensaje: `La suma de coeficientes debe ser 1.000000. Actual: ${suma.toFixed(6)}`,
        valor: suma.toString(),
      });
    }

    // 3. No hay duplicados de número de unidad
    const numeros = unidades.map((u) => u.numero);
    const duplicados = numeros.filter((n, i) => numeros.indexOf(n) !== i);
    if (duplicados.length > 0) {
      errores.push({
        campo: 'unidades.numero',
        mensaje: `Números de unidad duplicados: ${duplicados.join(', ')}`,
        valor: duplicados,
      });
    }

    return {
      valido: errores.length === 0,
      errores,
    };
  }
}

export { CoeficientesValidator };
