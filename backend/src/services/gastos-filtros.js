// src/services/gastos-filtros.js — El `where` de gastos, compartido (S3-15)
// Spec: PRD-04-02 §2 (filtros de la lista) y §3.2 (filtros del dashboard).
//
// POR QUÉ EXISTE. S3-16 pone el dashboard y el listado en la MISMA pantalla,
// compartiendo los filtros vía search params: la fila TOTAL de la lista y el KPI
// "Total del período" del dashboard tienen que ser el mismo número o la pantalla
// se contradice sola. Con dos constructores de `where` (uno por endpoint) eso se
// mantiene por disciplina; con uno, por construcción. De ahí que `whereDeGastos`
// salga de `gastos.routes.js` a un módulo que los dos importan.
//
// Decisión: `desde`/`hasta` son fechas sobre `fechaGasto`, también en el
// dashboard. El PRD §3.4 escribe el modo como `?desde=&hasta=` con los mismos
// nombres que la lista (§2), y la lista ya los definió sobre `fechaGasto`. Leer
// los mismos parámetros de la misma URL con dos semánticas distintas es
// exactamente el bug que este módulo evita.

import { sumarPeriodo } from '../core/liquidacion.engine.js';

// ─── Períodos ───

// Un gasto "pertenece" a un período si se imputa entero ahí (sin plan de cuotas)
// o si alguna de sus cuotas cae en ese período (S3-19). Va en `AND` y no en `OR`
// para no pisar el `OR` del buscador `q`.
export const filtroDePeriodo = (periodo) => ({
  AND: [{ OR: [{ periodo, cuotas: { none: {} } }, { cuotas: { some: { periodo } } }] }],
});

// La misma idea para una VENTANA de períodos (la evolución mensual del
// dashboard): el gasto entra si su período de imputación está en la ventana, o
// si tiene alguna cuota en ella.
export const filtroDePeriodos = (periodos) => ({
  AND: [
    {
      OR: [
        { periodo: { in: periodos }, cuotas: { none: {} } },
        { cuotas: { some: { periodo: { in: periodos } } } },
      ],
    },
  ],
});

// La aritmética de períodos es la del motor (`sumarPeriodo`): un solo lugar
// decide qué es "el mes anterior", así que la comparación del dashboard y la
// generación de un plan de cuotas nunca discrepan en un borde de año.

/** Los `cantidad` períodos que terminan en `periodo`, del más viejo al más nuevo. */
export function ventanaDePeriodos(periodo, cantidad) {
  return Array.from({ length: cantidad }, (_, i) => sumarPeriodo(periodo, i - (cantidad - 1)));
}

/** Cuántos meses hay de `desde` a `hasta` inclusive (0 si el rango está dado vuelta). */
export function mesesEntre(desde, hasta) {
  let total = 0;
  let cursor = desde;
  while (cursor <= hasta && total <= 240) {
    total += 1;
    cursor = sumarPeriodo(cursor, 1);
  }
  return total;
}

/** Los períodos entre dos extremos inclusive (tope defensivo para no explotar). */
export function periodosEntre(desde, hasta, maximo = 240) {
  const total = Math.min(mesesEntre(desde, hasta), maximo);
  return Array.from({ length: total }, (_, i) => sumarPeriodo(desde, i));
}

// ─── El `where` ───

/**
 * Traduce los filtros ya validados por Zod al `where` de Prisma.
 *
 * `alcance` es el scope obligatorio: `{ organizacionId }` más `edificioId` (un
 * edificio) o `edificioIds` (el consolidado de la organización). Nunca sale de
 * acá un `where` sin `organizacionId`: el aislamiento del tenant no es opcional.
 *
 * `periodo` se omite cuando el llamador ya resolvió la ventana por su cuenta
 * (`opciones.sinPeriodo`), que es lo que hace la evolución mensual del
 * dashboard: su ventana son 12 meses, no el mes del filtro activo.
 */
export function whereDeGastos(filtros = {}, alcance = {}, opciones = {}) {
  const { organizacionId, edificioId, edificioIds } = alcance;
  const { periodo, categoria, esOrdinario, proveedorId, rubroId, createdBy, desde, hasta, q } =
    filtros;

  return {
    organizacionId,
    ...(edificioId ? { edificioId } : {}),
    ...(edificioIds ? { edificioId: { in: edificioIds } } : {}),
    // Los soft-deleted no se listan nunca (siguen en la DB por Ley 941).
    deletedAt: null,
    ...(periodo && !opciones.sinPeriodo ? filtroDePeriodo(periodo) : {}),
    ...(categoria ? { categoria } : {}),
    ...(esOrdinario !== undefined ? { esOrdinario } : {}),
    ...(proveedorId ? { proveedorId } : {}),
    ...(rubroId ? { rubroId } : {}),
    ...(createdBy ? { createdBy } : {}),
    ...(desde || hasta
      ? {
          fechaGasto: {
            ...(desde ? { gte: desde } : {}),
            ...(hasta ? { lte: hasta } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { concepto: { contains: q, mode: 'insensitive' } },
            { descripcion: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
