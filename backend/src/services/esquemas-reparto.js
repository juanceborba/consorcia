// src/services/esquemas-reparto.js — Resolución de esquemas de reparto (S3-20)
// Spec: PRD-02-05 Motor Contable · CCyC art. 2049, último párrafo
// Diseño: docs/investigacion/esquemas-de-reparto.md
//
// Este módulo responde UNA pregunta: con qué esquema se reparte este gasto.
// Está separado del motor a propósito — la resolución pega a la DB y el motor
// (`core/liquidacion.engine.js`) tiene que seguir siendo una función pura que se
// testea sin base de datos. El motor recibe el esquema ya resuelto, igual que
// recibe la imputación ya elegida en el caso de las cuotas (S3-19).
//
// LA CADENA, en orden y sin ambigüedad:
//
//   1. `gasto.esquemaRepartoId` → ese esquema. Es el override explícito: el
//      administrador eligió a mano, y su elección gana siempre.
//   2. Categoría B con servicio S → el esquema ACTIVO del edificio con
//      `alcance = SERVICIO` y `alcanceValor = S`.
//      Categoría C con sector T → ídem con `alcance = SECTOR`.
//      Un índice único parcial garantiza que hay a lo sumo UNO, así que el
//      matcheo es determinístico y no "alguno de los que matchean".
//   3. Categoría A → `ConfiguracionLiquidacion.esquemaGeneralId`, si está.
//   4. Ninguno → `null`, y el motor reparte por coeficiente según la categoría:
//      exactamente lo que hacía antes de S3-20.
//
// DOS DECISIONES QUE NO SON OBVIAS:
//
// a. El esquema general (paso 3) aplica SOLO a la categoría A. Un gasto de
//    categoría B sin esquema propio NO cae al general: si el general fuera
//    "partes iguales entre todas", aplicarlo a un gasto de ascensor haría pagar
//    el ascensor a las UF que el reglamento eximió. Sin esquema específico, un
//    B/C se reparte por coeficiente entre las alcanzadas — el default correcto.
//
// b. El override del paso 1 se respeta AUNQUE el esquema esté inactivo. Un
//    esquema desactivado deja de ofrecerse y deja de matchear automáticamente,
//    pero cambiarle el reparto por debajo a los gastos que ya lo eligieron sería
//    modificar plata sin que nadie lo pida. Para cambiarlos hay que editar el
//    gasto.

import prisma from '../db/prisma.js';

// El esquema tal como lo consume el motor. `peso` viaja como STRING: el motor usa
// SU propio decimal.js y el string es el puente seguro con el Decimal de Prisma
// (mismo criterio que `filasDeCuotas` en gastos.routes.js).
export const SELECT_ESQUEMA = {
  id: true,
  nombre: true,
  base: true,
  alcance: true,
  alcanceValor: true,
  activo: true,
  clausulaReglamento: true,
  documentoUrl: true,
  pesos: { select: { unidadId: true, peso: true } },
};

export function paraElMotor(esquema) {
  if (!esquema) return null;
  return {
    id: esquema.id,
    nombre: esquema.nombre,
    base: esquema.base,
    alcance: esquema.alcance,
    alcanceValor: esquema.alcanceValor,
    pesos: (esquema.pesos ?? []).map((p) => ({
      unidadId: p.unidadId,
      peso: String(p.peso),
    })),
  };
}

/**
 * El matcheo del paso 2/3, puro: se testea sin DB.
 *
 * @param {Object} gasto - { categoria, servicioEspecifico, sectorEspecifico, esquemaRepartoId }
 * @param {Array} esquemas - todos los esquemas del edificio (activos e inactivos)
 * @param {String|null} esquemaGeneralId - de ConfiguracionLiquidacion
 */
export function esquemaAplicable(gasto, esquemas, esquemaGeneralId = null) {
  const porId = (id) => esquemas.find((e) => e.id === id) ?? null;

  // Paso 1: el override manda, activo o no (decisión b).
  if (gasto.esquemaRepartoId) return porId(gasto.esquemaRepartoId);

  // Paso 2: el esquema del edificio para ESE servicio o ESE sector.
  const alcance = gasto.categoria === 'B' ? 'SERVICIO' : gasto.categoria === 'C' ? 'SECTOR' : null;
  const valor =
    gasto.categoria === 'B'
      ? (gasto.servicioEspecifico ?? null)
      : gasto.categoria === 'C'
        ? (gasto.sectorEspecifico ?? null)
        : null;

  if (alcance && valor) {
    const match = esquemas.find(
      (e) => e.activo && e.alcance === alcance && e.alcanceValor === valor
    );
    if (match) return match;
    // Sin esquema específico, un B/C se reparte por coeficiente entre las
    // alcanzadas: NO cae al general (decisión a).
    return null;
  }

  // Paso 3: el general, solo para la categoría A.
  if (gasto.categoria === 'A' && esquemaGeneralId) return porId(esquemaGeneralId);

  // Paso 4.
  return null;
}

/**
 * Un resolutor para todo un período: carga los esquemas del edificio y su
 * configuración UNA vez y devuelve la función que resuelve gasto por gasto.
 *
 * Es una carga sola y no una query por gasto: los esquemas de un edificio son
 * unidades, no miles, y la liquidación de un período resuelve N gastos. Además
 * garantiza que todos los gastos de la MISMA liquidación se resuelvan contra la
 * misma foto de la configuración.
 *
 * @returns {Promise<(gasto: Object) => Object|null>} esquema listo para el motor
 */
export async function resolutorDeEsquemas(organizacionId, edificioId) {
  const [esquemas, configuracion] = await Promise.all([
    prisma.esquemaReparto.findMany({
      where: { organizacionId, edificioId },
      select: SELECT_ESQUEMA,
      // Orden estable: el matcheo del paso 2 es único por índice, pero un orden
      // definido hace reproducible cualquier diagnóstico.
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    }),
    prisma.configuracionLiquidacion.findUnique({
      where: { edificioId },
      select: { esquemaGeneralId: true },
    }),
  ]);

  if (esquemas.length === 0) return () => null; // el edificio no configuró nada

  const generalId = configuracion?.esquemaGeneralId ?? null;
  return (gasto) => paraElMotor(esquemaAplicable(gasto, esquemas, generalId));
}
