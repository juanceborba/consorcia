// src/services/gastos-dashboard.js — Agregados del dashboard de gastos (S3-15)
// Spec: PRD-04-02 §3.1 (KPIs), §3.2 (filtros), §3.3 (componentes), §3.4 (contrato).
//
// Un solo pasador de datos para los dos endpoints (edificio y consolidado de la
// organización): lo único que cambia entre ellos es el `alcance`.
//
// DECISIONES
//
// 1. LOS TRES MODOS DE PERÍODO Y QUÉ PLATA SUMA CADA UNO.
//
//    - `?periodo=P` → suma MONTOS IMPUTADOS a P: la cuota que le toca a P si el
//      gasto tiene plan (S3-19), o el gasto entero si no. Es el número que va a
//      repartir la liquidación de ese período, y es EXACTAMENTE el mismo que la
//      fila TOTAL de la lista con el mismo filtro (`totalesDelFiltro`).
//    - `?desde=&hasta=` → filtra por `fechaGasto` (igual que la lista) y suma el
//      monto de FACTURA. No hay un período único al que imputar un rango, y
//      sumar cuotas parciales daría un total que no es ni la factura ni la
//      imputación de nada.
//    - `?todo=1` → sin filtro de período, monto de factura.
//
//    La consecuencia buscada es que `kpis.total` y la fila TOTAL de la lista de
//    S3-07 sean siempre el mismo número: comparten el `where` (whereDeGastos) y
//    la regla de imputación.
//
// 2. AGREGACIÓN EN MEMORIA CON decimal.js, NO CON `groupBy` DE PRISMA.
//    El PRD §3.4 pedía `groupBy`, y para el modo rango/todo alcanzaría. No para
//    `?periodo=`: el monto imputado de un gasto en cuotas vive en `gasto_cuotas`
//    y no hay `groupBy` que agrupe por una columna del gasto sumando una columna
//    de la relación (la misma razón que ya obligó a `acumular` en S3-19). Antes
//    que mantener dos implementaciones de cinco agregados —donde la de `groupBy`
//    daría números distintos justo en los gastos en cuotas—, se trae UNA vez el
//    conjunto filtrado con las siete columnas que hacen falta y se acumula con
//    decimal.js. El conjunto es el de un consorcio (cientos de filas por año,
//    angostas, sobre índices existentes) y los cinco cortes salen del MISMO
//    recorrido, así que reconcilian por construcción. La divergencia está
//    anotada en el PRD.
//
// 3. LA EVOLUCIÓN MENSUAL NO USA LA VENTANA DEL FILTRO ACTIVO.
//    Con `?periodo=P`, la ventana del filtro es un mes: un gráfico de evolución
//    de un punto no es un gráfico. La evolución son los ÚLTIMOS 12 PERÍODOS que
//    terminan en P (§3.3 "evolución mensual", §3.2 "últimos 12 meses"), con los
//    demás filtros aplicados y una query propia. Su último punto es igual a
//    `kpis.total`, que es lo que hace que el chart y los KPIs se lean juntos.
//    En modo rango/todo no hace falta query aparte: la evolución sale de agrupar
//    las imputaciones del mismo conjunto por período, y su suma vuelve a dar
//    `kpis.total` (Σ cuotas = monto de la factura, invariante de `planDeCuotas`).
//
// 4. LA VARIACIÓN COMPARA CONTRA UNA VENTANA DE IGUAL LONGITUD (§3.1).
//    `?periodo=` compara contra el mes anterior; `?desde=&hasta=` contra el
//    rango de la misma cantidad de días inmediatamente anterior; `?todo=1` no
//    tiene contra qué comparar → `null`. También es `null` cuando la ventana
//    anterior no tiene gastos: un "+∞%" no es información. La UI lo oculta.
//
// 5. `porRubro` VIENE ROLLUP-EADO A RUBRO RAÍZ CON SUS SUBRUBROS ADENTRO.
//    El gasto apunta siempre a una hoja (S3-02), pero §3.3 pide "distribución por
//    rubro con drill-down a subrubros": si se devolvieran las hojas planas, la
//    UI tendría que reconstruir el árbol, y el drill-down necesitaría un segundo
//    request. Cada fila es un rubro raíz con su `total`, su `porcentaje` y su
//    array `subrubros` (mismo shape). Un rubro de nivel 1 usado directo aparece
//    como raíz con `subrubros: []`. Es un superset del shape del PRD.
//
// 6. `gastoPorUF` DIVIDE POR TODAS LAS UNIDADES DEL ALCANCE, SIN FILTRAR POR
//    `estado`. Es el mismo criterio que la liquidación (decisión 2 de
//    liquidaciones.routes.js: una UF en venta o alquilada paga expensas). Con
//    cero unidades es `null`, no una división por cero.

import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import {
  filtroDePeriodos,
  periodosEntre,
  ventanaDePeriodos,
  whereDeGastos,
} from './gastos-filtros.js';
import { sumarPeriodo } from '../core/liquidacion.engine.js';

export const MESES_DE_EVOLUCION = 12;
const TOP_PROVEEDORES = 10;

const CAMPOS_AGREGABLES = {
  monto: true,
  esOrdinario: true,
  categoria: true,
  periodo: true,
  proveedorId: true,
  rubroId: true,
  proveedor: { select: { id: true, razonSocial: true } },
  rubro: {
    select: {
      id: true,
      nombre: true,
      parentId: true,
      parent: { select: { id: true, nombre: true } },
    },
  },
  cuotas: { select: { periodo: true, monto: true } },
};

/** Decisión 1: qué modo pidió el cliente. */
export function modoDe({ periodo, desde, hasta, todo }) {
  if (periodo) return 'periodo';
  if (desde || hasta) return 'rango';
  if (todo) return 'todo';
  // Sin modo explícito, todo el histórico (decisión 2 del schema).
  return 'todo';
}

/**
 * Las imputaciones de un gasto: `[{ periodo, monto }]`. Un gasto con plan de
 * cuotas aporta una por cuota; uno de imputación única, una sola por su período.
 * Espejo de `imputacionDelPeriodo` del motor.
 */
const imputacionesDe = (gasto) =>
  gasto.cuotas.length > 0
    ? gasto.cuotas.map((c) => ({ periodo: c.periodo, monto: c.monto }))
    : [{ periodo: gasto.periodo, monto: gasto.monto }];

/** Decisión 1: lo que este gasto aporta al total, según el modo. */
function montoDelGasto(gasto, modo, periodo) {
  if (modo !== 'periodo') return new Decimal(gasto.monto);
  const cuota = gasto.cuotas.find((c) => c.periodo === periodo);
  return new Decimal(cuota ? cuota.monto : gasto.monto);
}

const cero = () => new Decimal(0);
const plata = (d) => d.toFixed(2);

/** Suma un valor en un mapa de acumuladores `{ total: Decimal, cantidad }`. */
function acumularEn(mapa, clave, monto, extra = {}) {
  const celda = mapa.get(clave) ?? { total: cero(), cantidad: 0, ...extra };
  celda.total = celda.total.plus(monto);
  celda.cantidad += 1;
  mapa.set(clave, celda);
  return celda;
}

/** Porcentaje de `parte` sobre `total`, con un decimal (§3.4: "18.2"). */
const porcentajeDe = (parte, total) =>
  total.isZero() ? '0.0' : parte.div(total).times(100).toFixed(1);

// ─── Cortes ───

function topProveedores(porProveedor, total) {
  return [...porProveedor.values()]
    .sort(
      (a, b) =>
        b.total.comparedTo(a.total) || a.razonSocial.localeCompare(b.razonSocial, 'es')
    )
    .slice(0, TOP_PROVEEDORES)
    .map((p) => ({
      proveedorId: p.proveedorId,
      razonSocial: p.razonSocial,
      total: plata(p.total),
      cantidad: p.cantidad,
      porcentaje: porcentajeDe(p.total, total),
    }));
}

// Decisión 5: hojas → raíces, con los subrubros adentro.
function porRubroConDrillDown(porHoja, total) {
  const raices = new Map();

  for (const hoja of porHoja.values()) {
    const raizId = hoja.parent?.id ?? hoja.rubroId;
    const raizNombre = hoja.parent?.nombre ?? hoja.nombre;
    const raiz =
      raices.get(raizId) ??
      { rubroId: raizId, nombre: raizNombre, total: cero(), cantidad: 0, subrubros: [] };
    raiz.total = raiz.total.plus(hoja.total);
    raiz.cantidad += hoja.cantidad;
    // Un rubro de nivel 1 usado directo NO se lista como subrubro de sí mismo.
    if (hoja.parent) {
      raiz.subrubros.push(hoja);
    }
    raices.set(raizId, raiz);
  }

  const salida = (fila) => ({
    rubroId: fila.rubroId,
    nombre: fila.nombre,
    total: plata(fila.total),
    cantidad: fila.cantidad,
    porcentaje: porcentajeDe(fila.total, total),
  });

  return [...raices.values()]
    .sort((a, b) => b.total.comparedTo(a.total) || a.nombre.localeCompare(b.nombre, 'es'))
    .map((raiz) => ({
      ...salida(raiz),
      subrubros: raiz.subrubros
        .sort((a, b) => b.total.comparedTo(a.total) || a.nombre.localeCompare(b.nombre, 'es'))
        .map(salida),
    }));
}

/**
 * Decisión 3: `[{ periodo, total }]` a partir de imputaciones, sin huecos.
 *
 * `periodos` fija la ventana (modo período: sus 12 puntos, incluidos los vacíos —
 * un mes sin gastos es un cero en el chart, no un hueco). Sin ventana fija, se
 * densifica de la imputación más vieja a la más nueva: así la serie no clipea
 * nada y Σ evolución = `kpis.total` (que es lo que hace que el chart y los KPIs
 * se puedan leer juntos).
 */
function evolucionDeImputaciones(imputaciones, periodos) {
  const porPeriodo = new Map();
  for (const { periodo, monto } of imputaciones) {
    porPeriodo.set(periodo, (porPeriodo.get(periodo) ?? cero()).plus(monto));
  }

  const presentes = [...porPeriodo.keys()].sort();
  const claves =
    periodos ??
    (presentes.length > 0 ? periodosEntre(presentes[0], presentes[presentes.length - 1]) : []);

  return claves.map((periodo) => ({
    periodo,
    total: plata(porPeriodo.get(periodo) ?? cero()),
  }));
}

// ─── Variación vs ventana anterior (decisión 4) ───

/** El total imputado de un período, con los mismos filtros de contexto. */
async function totalDelPeriodo(filtros, alcance, periodo) {
  const filas = await prisma.gasto.findMany({
    where: whereDeGastos({ ...filtros, periodo }, alcance),
    select: { monto: true, cuotas: { where: { periodo }, select: { monto: true } } },
  });
  return filas.reduce(
    (acc, g) => acc.plus(g.cuotas.length > 0 ? g.cuotas[0].monto : g.monto),
    cero()
  );
}

/** El total facturado de un rango de fechas, con los mismos filtros de contexto. */
async function totalDelRango(filtros, alcance, desde, hasta) {
  const agregado = await prisma.gasto.aggregate({
    where: whereDeGastos({ ...filtros, desde, hasta }, alcance),
    _sum: { monto: true },
  });
  return new Decimal(agregado._sum.monto ?? 0);
}

/**
 * Decisión 4: la variación % contra la ventana anterior comparable, o `null`.
 * El string va firmado ("+12.4%" / "-8.0%") porque el signo ES el dato.
 */
async function variacion(filtros, alcance, modo, total) {
  let anterior = null;

  if (modo === 'periodo') {
    anterior = await totalDelPeriodo(filtros, alcance, sumarPeriodo(filtros.periodo, -1));
  } else if (modo === 'rango' && filtros.desde && filtros.hasta) {
    // Ventana inmediatamente anterior, de la misma longitud en días.
    const dia = 24 * 60 * 60 * 1000;
    const largo = filtros.hasta.getTime() - filtros.desde.getTime();
    const hasta = new Date(filtros.desde.getTime() - dia);
    const desde = new Date(hasta.getTime() - largo);
    anterior = await totalDelRango(filtros, alcance, desde, hasta);
  }

  // `todo=1`, un rango abierto, o una ventana anterior vacía: no hay comparable.
  if (anterior === null || anterior.isZero()) return null;

  const delta = total.minus(anterior).div(anterior).times(100);
  return `${delta.isNegative() ? '' : '+'}${delta.toFixed(1)}%`;
}

// ─── Evolución mensual ───

/**
 * Decisión 3: en modo período la evolución tiene su propia query (los 12 meses
 * que terminan en el filtro); en los otros modos sale de las filas que ya se
 * trajeron, con la ventana densificada por las imputaciones encontradas — fijarla
 * al rango de `fechaGasto` clipearía las cuotas que caen después y la serie
 * dejaría de sumar `kpis.total`.
 */
async function evolucionMensual(filtros, alcance, modo, filas) {
  if (modo !== 'periodo') {
    return evolucionDeImputaciones(filas.flatMap(imputacionesDe), null);
  }

  const ventana = ventanaDePeriodos(filtros.periodo, MESES_DE_EVOLUCION);

  const deLaVentana = await prisma.gasto.findMany({
    where: {
      ...whereDeGastos(filtros, alcance, { sinPeriodo: true }),
      ...filtroDePeriodos(ventana),
    },
    select: { monto: true, periodo: true, cuotas: { select: { periodo: true, monto: true } } },
  });

  // Solo las imputaciones que caen DENTRO de la ventana: un gasto entra a la
  // query por una cuota de julio y puede tener otras en 2027.
  const enVentana = new Set(ventana);
  const imputaciones = deLaVentana
    .flatMap(imputacionesDe)
    .filter((i) => enVentana.has(i.periodo));

  return evolucionDeImputaciones(imputaciones, ventana);
}

// ─── Entrada pública ───

/**
 * El dashboard completo (§3.4) para un alcance ya autorizado.
 *
 * @param {object} filtros  query ya validada por `dashboardGastosSchema`
 * @param {object} alcance  `{ organizacionId, edificioId }` o `{ organizacionId, edificioIds }`
 */
export async function dashboardDeGastos(filtros, alcance) {
  const modo = modoDe(filtros);
  const where = whereDeGastos(filtros, alcance);

  const [filas, unidades] = await Promise.all([
    prisma.gasto.findMany({ where, select: CAMPOS_AGREGABLES }),
    prisma.unidad.count({
      where: {
        organizacionId: alcance.organizacionId,
        ...(alcance.edificioId ? { edificioId: alcance.edificioId } : {}),
        ...(alcance.edificioIds ? { edificioId: { in: alcance.edificioIds } } : {}),
      },
    }),
  ]);

  // Decisión 2: los cinco cortes, en un solo recorrido.
  let total = cero();
  let ordinarias = cero();
  let extraordinarias = cero();
  const porCategoria = { A: cero(), B: cero(), C: cero() };
  const porProveedor = new Map();
  const porHoja = new Map();

  for (const gasto of filas) {
    const monto = montoDelGasto(gasto, modo, filtros.periodo);
    total = total.plus(monto);
    if (gasto.esOrdinario) ordinarias = ordinarias.plus(monto);
    else extraordinarias = extraordinarias.plus(monto);
    porCategoria[gasto.categoria] = porCategoria[gasto.categoria].plus(monto);

    acumularEn(porProveedor, gasto.proveedorId, monto, {
      proveedorId: gasto.proveedorId,
      razonSocial: gasto.proveedor?.razonSocial ?? '(sin proveedor)',
    });
    acumularEn(porHoja, gasto.rubroId, monto, {
      rubroId: gasto.rubroId,
      nombre: gasto.rubro?.nombre ?? '(sin rubro)',
      parent: gasto.rubro?.parent ?? null,
    });
  }

  const [variacionVsPeriodoAnterior, evolucion] = await Promise.all([
    variacion(filtros, alcance, modo, total),
    evolucionMensual(filtros, alcance, modo, filas),
  ]);

  return {
    filtro: {
      modo,
      periodo: filtros.periodo ?? null,
      desde: filtros.desde ?? null,
      hasta: filtros.hasta ?? null,
      edificios: alcance.edificioIds ?? [alcance.edificioId],
      unidades,
    },
    kpis: {
      total: plata(total),
      totalOrdinarias: plata(ordinarias),
      totalExtraordinarias: plata(extraordinarias),
      cantidadGastos: filas.length,
      // Decisión 6: sin unidades no hay gasto por UF.
      gastoPorUF: unidades > 0 ? plata(total.div(unidades)) : null,
      variacionVsPeriodoAnterior,
    },
    topProveedores: topProveedores(porProveedor, total),
    porRubro: porRubroConDrillDown(porHoja, total),
    porCategoria: {
      A: plata(porCategoria.A),
      B: plata(porCategoria.B),
      C: plata(porCategoria.C),
    },
    evolucionMensual: evolucion,
  };
}
