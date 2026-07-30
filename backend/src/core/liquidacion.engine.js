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
//
// 5. REFACTOR DE S3-18 (sin cambio de comportamiento): el reparto se expresa con
//    una sola primitiva —`distribuir(monto, pesos)` sobre los pesos que devuelve
//    `pesosDe(gasto, unidades)`—, en vez de tener la categoría A/B/C metida en el
//    cálculo. Hoy los pesos se derivan de A/B/C exactamente como antes, así que
//    los resultados son idénticos al centavo; lo que queda abierto es el punto
//    donde S3-20 va a resolver el esquema de reparto configurado por el edificio
//    (exención parcial, coeficiente propio de un sector, partes iguales, cargo a
//    una sola UF). Diseño: `docs/investigacion/esquemas-de-reparto.md`.

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

// ─── La primitiva del reparto (S3-18) ───
//
// `pesosDe` traduce la clasificación del gasto a un PESO por unidad funcional, y
// `distribuir` reparte la plata en proporción a esos pesos. Todo el reparto del
// dominio se expresa así (ver `docs/investigacion/esquemas-de-reparto.md`):
//
//   A                        → peso = coeficiente de cada UF
//   B / C                    → peso = coeficiente en las alcanzadas, 0 en el resto
//   exención parcial         → peso = coeficiente × 0.5 (S3-20)
//   coeficiente propio       → peso = el del reglamento para ese sector (S3-20)
//   partes iguales           → peso = 1 en las alcanzadas (S3-20)
//   cargo a una sola UF      → peso = 1 en esa UF (S3-20)
//
// Los pesos son CRUDOS: `distribuir` normaliza por Σpesos. Eso reproduce
// exactamente el comportamiento anterior — en A la suma de coeficientes es 1 y
// normalizar es un no-op; en B/C la suma es la de las alcanzadas, que es la
// "renormalización" de la nota 2. Un solo camino de código para los dos casos.

// Pesos derivados de la categoría A/B/C, que es lo único que hay hoy. Cuando
// exista `EsquemaReparto` (S3-20) este es el único punto que cambia: la
// resolución pasa a ser esquema del gasto → esquema del edificio → esta función
// como default.
function pesosDe(gasto, unidades) {
  const pesos = new Map();
  for (const unidad of unidades) {
    pesos.set(
      unidad.id,
      unidadAlcanzada(gasto, unidad) ? new Decimal(unidad.coeficiente) : new Decimal(0)
    );
  }
  return pesos;
}

// Reparte `montoTotal` en proporción a `pesos` (Map<unidadId, Decimal>), al
// centavo y con suma exacta. El orden del Map define el orden del resultado y,
// con él, cuál es la "última UF alcanzada" que absorbe el ajuste de centavos.
function distribuir(montoTotal, pesos, { moneda = 'ARS', contexto = {} } = {}) {
  const total = new Decimal(montoTotal).toDecimalPlaces(2);
  const sumaPesos = [...pesos.values()].reduce((sum, p) => sum.plus(p), new Decimal(0));

  if (sumaPesos.lte(0)) {
    throw new LiquidacionError(
      'DESBALANCE_LIQUIDACION',
      contexto.categoria
        ? `No hay unidades alcanzadas por el gasto (categoría ${contexto.categoria}).`
        : 'No hay unidades alcanzadas por el gasto.',
      contexto
    );
  }

  const distribucion = [];
  let ultimaAlcanzada = -1;

  for (const [unidadId, peso] of pesos) {
    // Peso normalizado: es el "coeficiente aplicado" que se persiste en el
    // detalle y que la preview muestra. Es la única defensa de auditoría, así
    // que se guarda como se usó, no recalculado después.
    const pesoNormalizado = peso.div(sumaPesos);
    if (pesoNormalizado.gt(0)) ultimaAlcanzada = distribucion.length;

    distribucion.push({
      unidadId,
      coeficiente: pesoNormalizado.toString(),
      monto: total.times(pesoNormalizado).toFixed(2), // EXACTO a 2 decimales
      moneda,
    });
  }

  // ─── VALIDACIÓN: Suma de montos = montoTotal (cero tolerancia) ───
  const sumaMontos = distribucion.reduce(
    (sum, d) => sum.plus(new Decimal(d.monto)),
    new Decimal(0)
  );

  if (!sumaMontos.equals(total)) {
    // Ajuste de centavos: la diferencia (siempre múltiplo de 0.01) se imputa a
    // la última UF alcanzada (nota 4 del header).
    const diferencia = total.minus(sumaMontos);
    const ultima = distribucion[ultimaAlcanzada];
    ultima.monto = new Decimal(ultima.monto).plus(diferencia).toFixed(2);

    // Revalidar
    const sumaAjustada = distribucion.reduce(
      (sum, d) => sum.plus(new Decimal(d.monto)),
      new Decimal(0)
    );

    if (!sumaAjustada.equals(total)) {
      throw new LiquidacionError(
        'DESBALANCE_LIQUIDACION',
        `Desbalance en liquidación después de ajuste: ${sumaAjustada} vs ${total}`,
        { sumaMontos: sumaAjustada.toString(), montoTotal: total.toString() }
      );
    }
  }

  return distribucion;
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

    return distribuir(montoTotal, pesosDe(gasto, unidades), {
      moneda: gasto.moneda || 'ARS',
      // Contexto para el error de "nadie alcanzado", que sin esto sería un
      // desbalance sin explicación.
      contexto: {
        categoria: gasto.categoria,
        servicio: servicioDelGasto(gasto),
        sector: sectorDelGasto(gasto),
      },
    });
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

export { LiquidacionEngine, LiquidacionError, distribuir, pesosDe };
