// src/core/liquidacion.engine.js — Motor de distribución de liquidación (S3-03)
// Spec: PRD-02-05 §3 (motor de distribución categorías A/B/C).
//
// 100% determinístico, 0% IA: mismo input = mismo output. TODOS los cálculos
// monetarios se hacen con decimal.js (cero floats nativos) y solo se redondea
// al resultado final (2 decimales, ROUND_HALF_UP).
//
// Desviaciones documentadas respecto al pseudocódigo del PRD (§3.1):
//
// 1. Nombres de campos alineados a prisma/schema.prisma:
//    - Unidad: `categoriaB` (string[]) y `categoriaC` (string) en lugar de
//      `servicios` / `sector` del pseudocódigo. Se aceptan ambos alias.
//    - Gasto: `servicioEspecifico` / `sectorEspecifico` en lugar de
//      `servicio` / `sector`. Se aceptan ambos alias.
//
// 2. Renormalización en categorías B y C: el gasto se distribuye entre las UF
//    alcanzadas en proporción a su coeficiente (coef / sumaCoefAlcanzadas).
//    El pseudocódigo del PRD aplica el coeficiente crudo y vuelca la
//    diferencia en la "última UF", lo que asignaría miles de pesos
//    arbitrariamente a una sola UF (la suma de coeficientes de las UF
//    alcanzadas es < 1 por definición). La renormalización es la única
//    lectura coherente con "distribuir el gasto entre las UF que usan el
//    servicio según su coeficiente".
//
// 3. Monto objetivo redondeado a 2 decimales: si gasto.monto llega con más
//    de 2 decimales, el objetivo de la distribución es monto redondeado
//    (ROUND_HALF_UP), porque los detalles se emiten al centavo y su suma
//    debe cerrar exacta (PRD §3.2: '12345.678901' → '12345.68'). En la
//    práctica Gasto.monto es Decimal(12,2) en DB, así que es un no-op.
//
// 4. El ajuste de centavos se aplica a la ÚLTIMA UF ALCANZADA (coeficiente
//    efectivo > 0), no a la última del array: ajustar una UF excluida por
//    categoría B/C le asignaría un monto que no le corresponde.

import Decimal from 'decimal.js';

// Configuración de precisión (PRD-02-05 §3.1): 20 dígitos, ROUND_HALF_UP.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const CATEGORIAS_VALIDAS = ['A', 'B', 'C'];

// ─── Resolución de campos (schema.prisma con alias del pseudocódigo PRD) ───
function servicioDelGasto(gasto) {
  return gasto.servicioEspecifico ?? gasto.servicio ?? null;
}

function sectorDelGasto(gasto) {
  return gasto.sectorEspecifico ?? gasto.sector ?? null;
}

function serviciosDeUnidad(unidad) {
  return unidad.categoriaB ?? unidad.servicios ?? [];
}

function sectorDeUnidad(unidad) {
  return unidad.categoriaC ?? unidad.sector ?? null;
}

// ¿La unidad está alcanzada por el gasto según su categoría A/B/C?
function unidadAlcanzada(gasto, unidad) {
  switch (gasto.categoria) {
    case 'A':
      // Gastos generales → TODAS las UF
      return true;
    case 'B':
      // Servicios específicos → SOLO UF que los usan (ej: ascensor)
      return serviciosDeUnidad(unidad).includes(servicioDelGasto(gasto));
    case 'C':
      // Sectores específicos → SOLO UF del sector (ej: torre_a)
      return sectorDeUnidad(unidad) === sectorDelGasto(gasto);
    default:
      return false;
  }
}

class LiquidacionEngine {
  /**
   * Calcula la distribución de un gasto entre las unidades de un edificio
   * según las categorías A/B/C del reglamento de PH.
   *
   * @param {Object} gasto - { monto: string|number, categoria: 'A'|'B'|'C',
   *   servicioEspecifico?: string, sectorEspecifico?: string, moneda?: string }
   * @param {Array} unidades - [{ id, coeficiente, categoriaB?: string[], categoriaC?: string }]
   * @returns {Array} - [{ unidadId, coeficiente, monto, moneda }] con monto
   *   exacto a 2 decimales; la suma de montos es EXACTAMENTE el total (cero
   *   tolerancia).
   * @throws {LiquidacionError} - SUMA_COEFICIENTES_INVALIDA, CATEGORIA_INVALIDA
   *   o DESBALANCE_LIQUIDACION.
   */
  static calcularDistribucion(gasto, unidades) {
    // Objetivo de la distribución: total al centavo (ver nota 3 del header).
    const montoTotal = new Decimal(gasto.monto).toDecimalPlaces(2);
    const distribucion = [];

    // ─── VALIDACIÓN 1: Suma de coeficientes = 1 ───
    const sumaCoef = unidades.reduce(
      (sum, u) => sum.plus(new Decimal(u.coeficiente)),
      new Decimal(0)
    );

    if (!sumaCoef.equals(1)) {
      throw new LiquidacionError(
        'SUMA_COEFICIENTES_INVALIDA',
        `Suma de coeficientes inválida: ${sumaCoef.toFixed(6)} (debe ser 1.000000)`,
        { sumaActual: sumaCoef.toString(), unidades: unidades.length }
      );
    }

    // ─── VALIDACIÓN 2: Categoría del gasto ───
    if (!CATEGORIAS_VALIDAS.includes(gasto.categoria)) {
      throw new LiquidacionError(
        'CATEGORIA_INVALIDA',
        `Categoría inválida: ${gasto.categoria}. Debe ser A, B o C.`,
        { categoria: gasto.categoria }
      );
    }

    // ─── CÁLCULO: coeficientes efectivos (renormalizados en B/C, nota 2) ───
    const sumaCoefAlcanzadas = unidades.reduce(
      (sum, u) => (unidadAlcanzada(gasto, u) ? sum.plus(new Decimal(u.coeficiente)) : sum),
      new Decimal(0)
    );

    if (sumaCoefAlcanzadas.isZero()) {
      throw new LiquidacionError(
        'DESBALANCE_LIQUIDACION',
        `No hay unidades alcanzadas por el gasto (categoría ${gasto.categoria}).`,
        {
          categoria: gasto.categoria,
          servicio: servicioDelGasto(gasto),
          sector: sectorDelGasto(gasto),
        }
      );
    }

    let ultimaAlcanzada = -1;

    unidades.forEach((unidad, i) => {
      // Coeficiente efectivo: crudo en A; renormalizado entre alcanzadas en B/C.
      const coefAplicable = unidadAlcanzada(gasto, unidad)
        ? new Decimal(unidad.coeficiente).div(sumaCoefAlcanzadas)
        : new Decimal(0);

      if (coefAplicable.gt(0)) ultimaAlcanzada = i;

      distribucion.push({
        unidadId: unidad.id,
        coeficiente: coefAplicable.toString(),
        monto: montoTotal.times(coefAplicable).toFixed(2), // EXACTO a 2 decimales
        moneda: gasto.moneda || 'ARS',
      });
    });

    // ─── VALIDACIÓN 3: Suma de montos = montoTotal (cero tolerancia) ───
    const sumaMontos = distribucion.reduce(
      (sum, d) => sum.plus(new Decimal(d.monto)),
      new Decimal(0)
    );

    if (!sumaMontos.equals(montoTotal)) {
      // Ajuste de centavos: la diferencia (siempre múltiplo de 0.01) se
      // imputa a la última UF alcanzada (nota 4 del header).
      const diferencia = montoTotal.minus(sumaMontos);
      const ultima = distribucion[ultimaAlcanzada];
      ultima.monto = new Decimal(ultima.monto).plus(diferencia).toFixed(2);

      // Revalidar
      const sumaAjustada = distribucion.reduce(
        (sum, d) => sum.plus(new Decimal(d.monto)),
        new Decimal(0)
      );

      if (!sumaAjustada.equals(montoTotal)) {
        throw new LiquidacionError(
          'DESBALANCE_LIQUIDACION',
          `Desbalance en liquidación después de ajuste: ${sumaAjustada} vs ${montoTotal}`,
          { sumaMontos: sumaAjustada.toString(), montoTotal: montoTotal.toString() }
        );
      }
    }

    return distribucion;
  }

  /**
   * Calcula una liquidación completa para un período: distribuye cada gasto
   * y acumula totales ordinarios/extraordinarios (separación obligatoria,
   * Ley 941 — PRD-02-05 §4.1). Los nombres de los detalles siguen el modelo
   * LiquidacionDetalle de schema.prisma.
   */
  static async calcularLiquidacion(edificioId, periodo, gastos, unidades) {
    const liquidacion = {
      edificioId,
      periodo,
      fechaLiquidacion: new Date(),
      estado: 'BORRADOR',
      totalOrdinarias: new Decimal(0),
      totalExtraordinarias: new Decimal(0),
      detalles: [],
    };

    for (const gasto of gastos) {
      const distribucion = this.calcularDistribucion(gasto, unidades);

      for (const detalle of distribucion) {
        liquidacion.detalles.push({
          unidadId: detalle.unidadId,
          gastoId: gasto.id,
          coeficienteAplicado: detalle.coeficiente,
          montoAsignado: detalle.monto,
        });
      }

      // Acumular totales
      if (gasto.esOrdinario) {
        liquidacion.totalOrdinarias = liquidacion.totalOrdinarias.plus(gasto.monto);
      } else {
        liquidacion.totalExtraordinarias = liquidacion.totalExtraordinarias.plus(gasto.monto);
      }
    }

    liquidacion.totalGeneral = liquidacion.totalOrdinarias.plus(liquidacion.totalExtraordinarias);

    return {
      ...liquidacion,
      totalOrdinarias: liquidacion.totalOrdinarias.toFixed(2),
      totalExtraordinarias: liquidacion.totalExtraordinarias.toFixed(2),
      totalGeneral: liquidacion.totalGeneral.toFixed(2),
    };
  }
}

// ─── Custom Error ───
class LiquidacionError extends Error {
  constructor(codigo, mensaje, metadata = {}) {
    super(mensaje);
    this.name = 'LiquidacionError';
    this.codigo = codigo;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
  }
}

export { LiquidacionEngine, LiquidacionError };
