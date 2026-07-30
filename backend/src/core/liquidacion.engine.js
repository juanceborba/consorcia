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
//
// 6. S3-20 — ESQUEMAS DE REPARTO. El seam de la nota 5 ya está usado: si el gasto
//    llega con un `esquema` resuelto, los pesos salen de él (`pesosDeEsquema`) y
//    no de la categoría. Tres cosas que NO cambiaron y son deliberadas:
//
//    a. El motor no resuelve NADA: recibe el esquema ya elegido, igual que recibe
//       la imputación ya elegida en las cuotas. La resolución (esquema del gasto →
//       del edificio → ninguno) pega a la DB y vive en
//       `services/esquemas-reparto.js`. Así el motor sigue siendo una función
//       pura y testeable sin base de datos.
//    b. Sin esquema, el resultado es idéntico al centavo al de S3-03. La
//       retrocompatibilidad no es una promesa: es el mismo código de siempre.
//    c. No hay condiciones ni fórmulas configurables. Dos enums cerrados
//       (`BaseReparto`, `AlcanceReparto`) y una tabla de pesos, porque un motor de
//       reglas sería intesteable y rompería la auditabilidad del cálculo.
//
// 6. S3-19 — CUOTAS: lo que el motor distribuye es una IMPUTACIÓN, no
//    necesariamente un gasto entero. Un gasto de imputación única es su propia
//    imputación (el caso por default, idéntico a antes); un gasto con plan de
//    cuotas aporta al período la cuota que le toca, con el monto de la cuota y el
//    reparto (categoría / servicio / sector) del gasto padre. El eje de las
//    cuotas es TEMPORAL —en qué períodos se imputa y cuánto— y por eso no toca
//    los pesos: son dos ejes ortogonales (`docs/investigacion/
//    ordinarias-extraordinarias-y-categorias.md`, brecha 1).

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

// ─── El eje temporal: plan de cuotas (S3-19) ───
//
// Ortogonal al reparto: las cuotas deciden EN QUÉ PERÍODOS y CUÁNTO se imputa;
// los pesos deciden entre QUÉ UF se reparte cada imputación. Un gasto sin plan
// se imputa entero en su propio período (el default).

const PERIODO_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Suma `meses` a un período "YYYY-MM". Aritmética entera sobre el mes absoluto:
 * cero dependencia de `Date`, cero zonas horarias.
 */
function sumarPeriodo(periodo, meses) {
  const match = PERIODO_RE.exec(periodo);
  if (!match) {
    throw new LiquidacionError('PERIODO_INVALIDO', `Período inválido: ${periodo} (se espera YYYY-MM)`, {
      periodo,
    });
  }
  const absoluto = Number(match[1]) * 12 + (Number(match[2]) - 1) + meses;
  const anio = Math.floor(absoluto / 12);
  const mes = absoluto - anio * 12 + 1;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
}

/**
 * Divide un monto en N cuotas mensuales consecutivas desde `primerPeriodo`.
 *
 * El monto de cada cuota se trunca al centavo hacia abajo y **el resto acumulado
 * se vuelca en la última cuota**, misma política que el ajuste de centavos del
 * reparto (nota 4). Garantía dura: Σ cuotas = monto EXACTO, sin tolerancia.
 *
 * @returns {Array} [{ numero, cuotasTotal, periodo, monto }] con monto a 2 dec.
 * @throws {LiquidacionError} CUOTAS_INVALIDAS | PERIODO_INVALIDO
 */
function planDeCuotas(montoTotal, cuotasTotal, primerPeriodo) {
  if (!Number.isInteger(cuotasTotal) || cuotasTotal < 2) {
    throw new LiquidacionError(
      'CUOTAS_INVALIDAS',
      `La cantidad de cuotas debe ser un entero ≥ 2 (recibido: ${cuotasTotal})`,
      { cuotasTotal }
    );
  }

  const total = new Decimal(montoTotal).toDecimalPlaces(2);
  // Truncar (no redondear) evita que la suma de las N-1 primeras supere el total
  // y deje la última cuota en negativo.
  const base = total.div(cuotasTotal).toDecimalPlaces(2, Decimal.ROUND_DOWN);

  const cuotas = [];
  let acumulado = new Decimal(0);

  for (let numero = 1; numero <= cuotasTotal; numero += 1) {
    const esUltima = numero === cuotasTotal;
    const monto = esUltima ? total.minus(acumulado) : base;
    acumulado = acumulado.plus(monto);

    cuotas.push({
      numero,
      cuotasTotal,
      periodo: sumarPeriodo(primerPeriodo, numero - 1),
      monto: monto.toFixed(2),
    });
  }

  if (!acumulado.equals(total)) {
    throw new LiquidacionError(
      'CUOTAS_INVALIDAS',
      `Desbalance en el plan de cuotas: ${acumulado} vs ${total}`,
      { suma: acumulado.toString(), montoTotal: total.toString() }
    );
  }

  return cuotas;
}

/**
 * La imputación de un gasto a un período, o `null` si no le toca nada.
 *
 * - Gasto sin plan de cuotas → se imputa entero si `gasto.periodo` es el período.
 * - Gasto con plan → se imputa la cuota de ese período, por el monto de la cuota
 *   y con el reparto (categoría / servicio / sector) del gasto padre.
 *
 * El resultado es lo que consume `calcularLiquidacion`: un gasto de imputación
 * única ES su propia imputación, así que el camino viejo queda intacto.
 */
function imputacionDelPeriodo(gasto, periodo) {
  const cuotas = gasto.cuotas ?? [];

  if (cuotas.length === 0) {
    return gasto.periodo === periodo ? { ...gasto, montoImputado: gasto.monto, cuota: null } : null;
  }

  const cuota = cuotas.find((c) => c.periodo === periodo);
  if (!cuota) return null;

  return {
    ...gasto,
    montoImputado: cuota.monto,
    cuota: { id: cuota.id ?? null, numero: cuota.numero, cuotasTotal: cuota.cuotasTotal },
  };
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
const BASES_VALIDAS = ['COEFICIENTE', 'PARTES_IGUALES', 'PESOS_PROPIOS'];
const ALCANCES_VALIDOS = ['TODAS', 'SERVICIO', 'SECTOR', 'SELECCION'];

/**
 * ¿Alcanza el esquema a esta UF? Se evalúa ANTES que la base: fuera del alcance
 * el peso es 0, cualquiera sea la base y cualquiera sea la fila de la tabla.
 *
 * `tienePesoPropio` es lo único que define el alcance SELECCION: la UF participa
 * si el administrador la puso en la tabla. Es el caso del cargo particular a una
 * sola UF (una rotura), donde no hay servicio ni sector que la describa.
 */
function unidadEnAlcance(esquema, unidad, tienePesoPropio) {
  switch (esquema.alcance) {
    case 'TODAS':
      return true;
    case 'SERVICIO':
      return serviciosDeUnidad(unidad).includes(esquema.alcanceValor);
    case 'SECTOR':
      return sectorDeUnidad(unidad) === esquema.alcanceValor;
    case 'SELECCION':
      return tienePesoPropio;
    default:
      throw new LiquidacionError(
        'ESQUEMA_INVALIDO',
        `Alcance de reparto inválido: ${esquema.alcance}. Debe ser ${ALCANCES_VALIDOS.join(', ')}.`,
        { esquemaId: esquema.id ?? null, alcance: esquema.alcance }
      );
  }
}

/**
 * Los pesos de un ESQUEMA DE REPARTO (S3-20), la primitiva configurable.
 *
 * La tabla de pesos (`esquema.pesos`) se lee según la base, y una UF sin fila NO
 * es una UF con peso 0: es una UF con el default de su base. Es lo que hace que
 * "todas por coeficiente menos PB al 50%" sea UNA fila y no N.
 *
 *   COEFICIENTE    → coeficiente de la UF × factor (fila ausente = factor 1)
 *   PARTES_IGUALES → factor (fila ausente = 1): por UF, no por coeficiente
 *   PESOS_PROPIOS  → el peso de la fila (ausente = 0): la segunda tabla de
 *                    coeficientes del reglamento, que no es proporcional al
 *                    coeficiente general
 *
 * Determinístico y sin fórmulas: dos enums cerrados y una multiplicación.
 */
function pesosDeEsquema(esquema, unidades) {
  if (!BASES_VALIDAS.includes(esquema.base)) {
    throw new LiquidacionError(
      'ESQUEMA_INVALIDO',
      `Base de reparto inválida: ${esquema.base}. Debe ser ${BASES_VALIDAS.join(', ')}.`,
      { esquemaId: esquema.id ?? null, base: esquema.base }
    );
  }

  const propios = new Map(
    (esquema.pesos ?? []).map((p) => [p.unidadId, new Decimal(p.peso)])
  );

  const pesos = new Map();
  for (const unidad of unidades) {
    const propio = propios.get(unidad.id);

    if (!unidadEnAlcance(esquema, unidad, propio !== undefined)) {
      pesos.set(unidad.id, new Decimal(0));
      continue;
    }

    switch (esquema.base) {
      case 'COEFICIENTE':
        pesos.set(unidad.id, new Decimal(unidad.coeficiente).times(propio ?? 1));
        break;
      case 'PARTES_IGUALES':
        pesos.set(unidad.id, propio ?? new Decimal(1));
        break;
      case 'PESOS_PROPIOS':
        pesos.set(unidad.id, propio ?? new Decimal(0));
        break;
      // BASES_VALIDAS ya cubrió el default.
    }
  }
  return pesos;
}

/**
 * Los pesos con los que se reparte un gasto.
 *
 * S3-20: si el gasto llega con un esquema RESUELTO (`gasto.esquema`), manda el
 * esquema. Si no, el peso es el coeficiente de las UF alcanzadas por la
 * categoría A/B/C — el comportamiento previo a S3-20, exacto al centavo.
 *
 * La resolución (esquema del gasto → del edificio → ninguno) NO vive acá: pega a
 * la DB y el motor no la toca. Está en `services/esquemas-reparto.js`; el motor
 * recibe el esquema ya resuelto, igual que recibe la imputación ya elegida en el
 * caso de las cuotas.
 */
function pesosDe(gasto, unidades) {
  if (gasto.esquema) return pesosDeEsquema(gasto.esquema, unidades);

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
    // S3-20: con un esquema configurado el motivo casi nunca es la categoría —
    // es un alcance que no matchea ninguna UF o una tabla de pesos todos en 0.
    // Nombrar el esquema es la diferencia entre un error accionable y uno mudo.
    const motivo = contexto.esquema
      ? `No hay unidades con peso en el esquema de reparto "${contexto.esquema}".`
      : contexto.categoria
        ? `No hay unidades alcanzadas por el gasto (categoría ${contexto.categoria}).`
        : 'No hay unidades alcanzadas por el gasto.';
    throw new LiquidacionError('DESBALANCE_LIQUIDACION', motivo, contexto);
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
   *   servicioEspecifico?: string, sectorEspecifico?: string, moneda?: string,
   *   montoImputado?: string|number }
   *   `montoImputado` (S3-19) es lo que se reparte cuando el gasto se imputa por
   *   cuotas: el reparto es el del gasto padre, el monto es el de la cuota. Si no
   *   viene, se reparte `monto` (imputación única, el caso por default).
   *   `esquema` (S3-20) es el esquema de reparto YA RESUELTO —
   *   `{ id, nombre, base, alcance, alcanceValor, pesos: [{ unidadId, peso }] }`—
   *   y cuando viene manda sobre la categoría para el CÁLCULO (la categoría sigue
   *   clasificando el gasto). Sin `esquema`, el reparto es el de siempre.
   * @param {Array} unidades - [{ id, coeficiente, categoriaB?: string[], categoriaC?: string }]
   * @returns {Array} - [{ unidadId, coeficiente, monto, moneda }] con monto
   *   exacto a 2 decimales; la suma de montos es EXACTAMENTE el total (cero
   *   tolerancia).
   * @throws {LiquidacionError} - SUMA_COEFICIENTES_INVALIDA, CATEGORIA_INVALIDA
   *   o DESBALANCE_LIQUIDACION.
   */
  static calcularDistribucion(gasto, unidades) {
    // Objetivo de la distribución: total al centavo (ver nota 3 del header).
    const montoTotal = new Decimal(gasto.montoImputado ?? gasto.monto).toDecimalPlaces(2);

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
        // S3-20: null cuando el reparto sale de la categoría (el default).
        esquema: gasto.esquema?.nombre ?? null,
      },
    });
  }

  /**
   * Calcula una liquidación completa para un período: distribuye cada
   * imputación y acumula totales ordinarios/extraordinarios (separación
   * obligatoria, Ley 941 — PRD-02-05 §4.1). Los nombres de los detalles siguen
   * el modelo LiquidacionDetalle de schema.prisma.
   *
   * @param {Array} gastos - las IMPUTACIONES del período (S3-19). Un gasto de
   *   imputación única es su propia imputación; uno con plan de cuotas llega con
   *   `montoImputado` = el monto de la cuota y `cuota` = { id, numero,
   *   cuotasTotal }. Lo que suma a los totales y lo que se reparte es SIEMPRE el
   *   monto imputado al período, nunca el total de la factura.
   */
  static async calcularLiquidacion(edificioId, periodo, gastos, unidades, opciones = {}) {
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
      const cuota = gasto.cuota ?? null;
      // S3-20: el esquema que produjo estos pesos, ya resuelto por la ruta.
      const esquema = gasto.esquema ?? null;

      for (const detalle of distribucion) {
        liquidacion.detalles.push({
          tipo: 'GASTO',
          unidadId: detalle.unidadId,
          gastoId: gasto.id,
          // Snapshot del rótulo "cuota k/N": lo que se emitió no cambia si
          // después se edita el plan.
          gastoCuotaId: cuota?.id ?? null,
          cuotaNumero: cuota?.numero ?? null,
          cuotasTotal: cuota?.cuotasTotal ?? null,
          // Snapshot del esquema aplicado, por la misma razón: renombrarlo o
          // desactivarlo no puede reescribir un recibo emitido. NULL = reparto
          // por coeficiente según la categoría.
          esquemaRepartoId: esquema?.id ?? null,
          esquemaNombre: esquema?.nombre ?? null,
          coeficienteAplicado: detalle.coeficiente,
          montoAsignado: detalle.monto,
        });
      }

      // Acumular totales sobre el monto IMPUTADO al período (en un gasto en
      // cuotas, sumar `monto` metería la obra entera en un solo mes).
      const imputado = new Decimal(gasto.montoImputado ?? gasto.monto);
      if (gasto.esOrdinario) {
        liquidacion.totalOrdinarias = liquidacion.totalOrdinarias.plus(imputado);
      } else {
        liquidacion.totalExtraordinarias = liquidacion.totalExtraordinarias.plus(imputado);
      }
    }

    // S3-21: el aporte al fondo se reparte DESPUÉS de conocer los totales —su
    // base es el total de ordinarias del período— y con el esquema de la regla
    // (o el general del edificio, o el coeficiente). Va como un reparto más,
    // así que hereda el ajuste de centavos y la garantía de suma exacta.
    const aporte = new Decimal(opciones.fondoReserva?.aporte ?? 0).toDecimalPlaces(2);
    liquidacion.totalFondoReserva = aporte;

    if (aporte.greaterThan(0)) {
      const esquema = opciones.fondoReserva?.esquema ?? null;
      // Sin esquema, todas las UF por coeficiente: contribuir al fondo es
      // obligación de todo propietario (CCyC art. 2046 inc. d) y no admite las
      // exenciones de las categorías B y C, así que se comporta como una A.
      const gastoDelFondo = { monto: aporte.toFixed(2), categoria: 'A', esquema };
      for (const detalle of this.calcularDistribucion(gastoDelFondo, unidades)) {
        liquidacion.detalles.push({
          tipo: 'FONDO_RESERVA',
          unidadId: detalle.unidadId,
          gastoId: null,
          gastoCuotaId: null,
          cuotaNumero: null,
          cuotasTotal: null,
          esquemaRepartoId: esquema?.id ?? null,
          esquemaNombre: esquema?.nombre ?? null,
          coeficienteAplicado: detalle.coeficiente,
          montoAsignado: detalle.monto,
        });
      }
    }

    liquidacion.totalGeneral = liquidacion.totalOrdinarias
      .plus(liquidacion.totalExtraordinarias)
      .plus(liquidacion.totalFondoReserva);

    return {
      ...liquidacion,
      totalOrdinarias: liquidacion.totalOrdinarias.toFixed(2),
      totalExtraordinarias: liquidacion.totalExtraordinarias.toFixed(2),
      totalFondoReserva: liquidacion.totalFondoReserva.toFixed(2),
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

export {
  LiquidacionEngine,
  LiquidacionError,
  distribuir,
  pesosDe,
  pesosDeEsquema,
  BASES_VALIDAS,
  ALCANCES_VALIDOS,
  planDeCuotas,
  imputacionDelPeriodo,
  sumarPeriodo,
};
