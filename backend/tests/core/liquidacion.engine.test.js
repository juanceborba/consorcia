// tests/core/liquidacion.engine.test.js — Tests del motor de distribución (S3-03)
// Spec: PRD-02-05 §3.2 (casos obligatorios). Corre puro con node --test, sin
// DB ni servicios: el motor es 100% determinístico y los tests matemáticos
// son innegociables (cero tolerancia: la suma de detalles = total al centavo).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';

import { LiquidacionEngine, LiquidacionError } from '../../src/core/liquidacion.engine.js';

// Mismo fixture del PRD §3.2, con los nombres de campos de schema.prisma
// (categoriaB / categoriaC). Coeficientes suman exactamente 1.000000.
const unidades = [
  { id: 'u1', coeficiente: '0.076923', categoriaB: ['ascensor'], categoriaC: 'torre_a' },
  { id: 'u2', coeficiente: '0.076923', categoriaB: ['ascensor'], categoriaC: 'torre_a' },
  { id: 'u3', coeficiente: '0.153846', categoriaB: [], categoriaC: 'torre_b' },
  { id: 'u4', coeficiente: '0.692308', categoriaB: ['ascensor', 'calefaccion'], categoriaC: 'torre_a' },
];

// Suma exacta de los montos de una distribución (decimal.js, cero floats).
function sumarMontos(distribucion) {
  return distribucion.reduce((s, d) => s.plus(d.monto), new Decimal(0));
}

function montoDe(distribucion, unidadId) {
  return distribucion.find((d) => d.unidadId === unidadId).monto;
}

describe('LiquidacionEngine.calcularDistribucion', () => {
  it('distribuye gasto categoría A entre TODAS las UF y cierra exacto', () => {
    const gasto = { monto: '100000.00', categoria: 'A', moneda: 'ARS' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    // Todas las UF deben tener monto > 0
    assert.ok(resultado.every((r) => new Decimal(r.monto).gt(0)));

    // Montos exactos esperados (coeficientes crudos, suman 1)
    assert.equal(montoDe(resultado, 'u1'), '7692.30');
    assert.equal(montoDe(resultado, 'u2'), '7692.30');
    assert.equal(montoDe(resultado, 'u3'), '15384.60');
    assert.equal(montoDe(resultado, 'u4'), '69230.80');

    // Suma debe ser exactamente 100000.00 (cero tolerancia)
    assert.equal(sumarMontos(resultado).toFixed(2), '100000.00');
  });

  it('distribuye gasto categoría B solo a UF con el servicio, renormalizando coeficientes', () => {
    const gasto = { monto: '50000.00', categoria: 'B', servicioEspecifico: 'ascensor', moneda: 'ARS' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    // u3 no tiene ascensor → monto = 0
    assert.equal(montoDe(resultado, 'u3'), '0.00');

    // u1, u2, u4 tienen ascensor → monto > 0, en proporción a su coeficiente
    // (1/13, 1/13 y 9/13 de 1 → 1/11, 1/11 y 9/11 del gasto) con ajuste de
    // centavos en la última UF alcanzada (u4).
    assert.equal(montoDe(resultado, 'u1'), '4545.45');
    assert.equal(montoDe(resultado, 'u2'), '4545.45');
    assert.equal(montoDe(resultado, 'u4'), '40909.10');

    // Suma debe ser exactamente 50000.00
    assert.equal(sumarMontos(resultado).toFixed(2), '50000.00');
  });

  it('acepta el alias `servicio` del pseudocódigo del PRD para categoría B', () => {
    const conAlias = unidades.map(({ categoriaB, categoriaC, ...u }) => ({
      ...u,
      servicios: categoriaB,
      sector: categoriaC,
    }));
    const gasto = { monto: '50000.00', categoria: 'B', servicio: 'ascensor' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, conAlias);

    assert.equal(montoDe(resultado, 'u3'), '0.00');
    assert.equal(sumarMontos(resultado).toFixed(2), '50000.00');
  });

  it('distribuye gasto categoría C solo al sector del gasto', () => {
    const gasto = { monto: '30000.00', categoria: 'C', sectorEspecifico: 'torre_a', moneda: 'ARS' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    // u3 es torre_b → monto = 0
    assert.equal(montoDe(resultado, 'u3'), '0.00');

    // torre_a: u1, u2, u4 (misma proporción 1/11, 1/11, 9/11)
    assert.equal(montoDe(resultado, 'u1'), '2727.27');
    assert.equal(montoDe(resultado, 'u2'), '2727.27');
    assert.equal(montoDe(resultado, 'u4'), '24545.46');

    assert.equal(sumarMontos(resultado).toFixed(2), '30000.00');
  });

  it('rechaza si la suma de coeficientes != 1 con SUMA_COEFICIENTES_INVALIDA', () => {
    const unidadesInvalidas = [
      { id: 'u1', coeficiente: '0.5' },
      { id: 'u2', coeficiente: '0.4' }, // Suma = 0.9
    ];
    const gasto = { monto: '10000.00', categoria: 'A' };

    assert.throws(
      () => LiquidacionEngine.calcularDistribucion(gasto, unidadesInvalidas),
      (err) => {
        assert.ok(err instanceof LiquidacionError);
        assert.equal(err.name, 'LiquidacionError');
        assert.equal(err.codigo, 'SUMA_COEFICIENTES_INVALIDA');
        assert.equal(err.metadata.sumaActual, '0.9');
        assert.equal(err.metadata.unidades, 2);
        return true;
      }
    );
  });

  it('rechaza categorías desconocidas con CATEGORIA_INVALIDA', () => {
    const gasto = { monto: '10000.00', categoria: 'D' };

    assert.throws(
      () => LiquidacionEngine.calcularDistribucion(gasto, unidades),
      (err) => {
        assert.ok(err instanceof LiquidacionError);
        assert.equal(err.codigo, 'CATEGORIA_INVALIDA');
        assert.equal(err.metadata.categoria, 'D');
        return true;
      }
    );
  });

  it('maneja montos con muchos decimales sin perder precisión', () => {
    const gasto = { monto: '12345.678901', categoria: 'A', moneda: 'ARS' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    // Cada detalle queda exacto a 2 decimales
    assert.ok(resultado.every((r) => /^-?\d+\.\d{2}$/.test(r.monto)));

    // Redondeo a 2 decimales del total, cero tolerancia en la suma
    assert.equal(sumarMontos(resultado).toFixed(2), '12345.68');
  });

  it('ajusta centavos en la última UF y la suma cierra al centavo', () => {
    // Tercios: 100.00 no se divide exacto entre 3 UF
    const tercios = [
      { id: 't1', coeficiente: '0.333333' },
      { id: 't2', coeficiente: '0.333333' },
      { id: 't3', coeficiente: '0.333334' },
    ];
    const gasto = { monto: '100.00', categoria: 'A' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, tercios);

    assert.equal(montoDe(resultado, 't1'), '33.33');
    assert.equal(montoDe(resultado, 't2'), '33.33');
    assert.equal(montoDe(resultado, 't3'), '33.34'); // recibe el centavo de ajuste

    // Cero tolerancia: suma de detalles = total al centavo
    assert.equal(sumarMontos(resultado).toFixed(2), '100.00');
  });

  it('el ajuste de centavos nunca cae en una UF excluida por categoría B/C', () => {
    // La última UF del array NO usa el servicio: el ajuste debe ir a la
    // última UF alcanzada, no a la última del array.
    const ordenAdverso = [
      { id: 'u1', coeficiente: '0.333333', categoriaB: ['ascensor'] },
      { id: 'u2', coeficiente: '0.333333', categoriaB: ['ascensor'] },
      { id: 'u3', coeficiente: '0.333334', categoriaB: [] },
    ];
    const gasto = { monto: '100.01', categoria: 'B', servicioEspecifico: 'ascensor' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, ordenAdverso);

    assert.equal(montoDe(resultado, 'u3'), '0.00'); // excluida, no recibe ajuste
    assert.equal(montoDe(resultado, 'u1'), '50.01');
    assert.equal(montoDe(resultado, 'u2'), '50.00'); // última alcanzada: absorbe el -0.01
    assert.equal(sumarMontos(resultado).toFixed(2), '100.01');
  });

  it('rechaza con DESBALANCE_LIQUIDACION si ninguna UF está alcanzada por el gasto', () => {
    const gasto = { monto: '10000.00', categoria: 'B', servicioEspecifico: 'pileta' };

    assert.throws(
      () => LiquidacionEngine.calcularDistribucion(gasto, unidades),
      (err) => {
        assert.ok(err instanceof LiquidacionError);
        assert.equal(err.codigo, 'DESBALANCE_LIQUIDACION');
        return true;
      }
    );
  });

  it('es determinístico: mismo input produce exactamente el mismo output', () => {
    const gasto = { monto: '99999.99', categoria: 'B', servicioEspecifico: 'calefaccion' };
    const corrida1 = LiquidacionEngine.calcularDistribucion(gasto, unidades);
    const corrida2 = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    assert.deepEqual(corrida1, corrida2);
  });

  it('aplica moneda ARS por defecto', () => {
    const gasto = { monto: '1000.00', categoria: 'A' };
    const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

    assert.ok(resultado.every((r) => r.moneda === 'ARS'));
  });
});

describe('LiquidacionEngine.calcularLiquidacion', () => {
  it('liquida un período completo separando ordinarias y extraordinarias', async () => {
    const gastos = [
      { id: 'g1', monto: '100000.00', categoria: 'A', esOrdinario: true },
      { id: 'g2', monto: '50000.00', categoria: 'B', servicioEspecifico: 'ascensor', esOrdinario: false },
      { id: 'g3', monto: '30000.00', categoria: 'C', sectorEspecifico: 'torre_a', esOrdinario: true },
    ];

    const liq = await LiquidacionEngine.calcularLiquidacion('edificio-1', '2026-07', gastos, unidades);

    assert.equal(liq.edificioId, 'edificio-1');
    assert.equal(liq.periodo, '2026-07');
    assert.equal(liq.estado, 'BORRADOR');
    assert.equal(liq.totalOrdinarias, '130000.00');
    assert.equal(liq.totalExtraordinarias, '50000.00');
    assert.equal(liq.totalGeneral, '180000.00');

    // Un detalle por gasto × unidad, con los campos de LiquidacionDetalle
    assert.equal(liq.detalles.length, 12);
    for (const d of liq.detalles) {
      assert.ok(d.unidadId);
      assert.ok(d.gastoId);
      assert.equal(typeof d.coeficienteAplicado, 'string');
      assert.match(d.montoAsignado, /^-?\d+\.\d{2}$/);
    }

    // Cero tolerancia por gasto: la suma de detalles de cada gasto = su monto
    for (const gasto of gastos) {
      const suma = liq.detalles
        .filter((d) => d.gastoId === gasto.id)
        .reduce((s, d) => s.plus(d.montoAsignado), new Decimal(0));
      assert.equal(suma.toFixed(2), new Decimal(gasto.monto).toFixed(2));
    }
  });
});
