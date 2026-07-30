// backend/src/services/fondo-reserva.js — ConsorcIA
// Fondo de reserva (S3-21): resolución de la regla vigente para un período y
// cálculo del aporte. Diseño y alcance en
// `docs/investigacion/ledger-y-fondo-de-reserva.md` (capa A).
//
// DECISIONES:
//
// 1. LA REGLA SE RESUELVE POR PERÍODO, NO POR "LA ACTUAL". Las reglas viven
//    versionadas (`ReglaFondoReserva.vigenciaDesde`) y liquidar 2026-05 usa la
//    regla que regía en 2026-05, aunque hoy haya otra. Es la diferencia entre un
//    porcentaje configurable y un porcentaje que reescribe el pasado: el
//    porcentaje lo fija una asamblea con fecha, y una liquidación emitida no
//    puede cambiar de importe porque alguien tocó la configuración después.
//    Comparar strings `YYYY-MM` alcanza y es exacto (orden lexicográfico =
//    orden cronológico), igual que en el resto del módulo.
//
// 2. SIN REGLA VIGENTE NO HAY APORTE, y no es un error. Un edificio que nunca
//    configuró fondo liquida como antes de S3-21; y uno que lo configuró desde
//    2026-08 no debe aportar en 2026-07 (regla que todavía no regía).
//
// 3. EL APORTE NO ES UN GASTO. No sale de una factura ni tiene proveedor: es una
//    contribución patrimonial de cada propietario (CCyC art. 2046 inc. d). Por
//    eso el motor lo trata como un tercer subtotal y no como un gasto sintético
//    —que habría sido más corto de escribir y habría contaminado el listado de
//    gastos, los rubros y el dashboard con una fila que nadie cargó.
//
// 4. LA BASE `ORDINARIAS` ES EL DEFAULT porque es la práctica del mercado
//    (5-10% de la expensa ordinaria) y la que respeta la separación de Ley 941:
//    con base TOTAL, una obra extraordinaria grande dispara un aporte
//    desproporcionado en un solo período.
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';

export const BASES = ['ORDINARIAS', 'TOTAL', 'MONTO_FIJO'];

export const SELECT_REGLA = {
  id: true,
  edificioId: true,
  vigenciaDesde: true,
  base: true,
  porcentaje: true,
  montoFijo: true,
  esquemaRepartoId: true,
  motivo: true,
  createdAt: true,
  esquemaReparto: { select: { id: true, nombre: true } },
};

/**
 * La regla que rige en `periodo`: la de mayor `vigenciaDesde` que sea <= al
 * período (decisión 1). `null` si el edificio no tenía ninguna vigente todavía.
 *
 * @param {string} organizacionId
 * @param {string} edificioId
 * @param {string} periodo  "2026-07"
 */
export async function reglaVigente(organizacionId, edificioId, periodo) {
  return prisma.reglaFondoReserva.findFirst({
    where: { organizacionId, edificioId, vigenciaDesde: { lte: periodo } },
    orderBy: { vigenciaDesde: 'desc' },
    select: SELECT_REGLA,
  });
}

/**
 * El aporte al fondo para una liquidación, según la regla.
 *
 * @param {Object|null} regla
 * @param {Object} totales  { totalOrdinarias, totalExtraordinarias } como Decimal|string
 * @returns {Decimal} el aporte, a 2 decimales. Cero si no hay regla (decisión 2).
 */
export function calcularAporte(regla, { totalOrdinarias, totalExtraordinarias }) {
  if (!regla) return new Decimal(0);

  if (regla.base === 'MONTO_FIJO') {
    return new Decimal(regla.montoFijo ?? 0).toDecimalPlaces(2);
  }

  const base =
    regla.base === 'TOTAL'
      ? new Decimal(totalOrdinarias).plus(totalExtraordinarias)
      : new Decimal(totalOrdinarias);

  return base
    .times(new Decimal(regla.porcentaje ?? 0))
    .dividedBy(100)
    .toDecimalPlaces(2);
}

/**
 * Cómo se lee el aporte en la UI y en el recibo: "5,00% de las ordinarias".
 * Vive acá y no en el frontend porque el recibo PDF lo imprime desde el backend
 * y las dos vistas tienen que decir lo mismo.
 */
export function explicarRegla(regla) {
  if (!regla) return null;
  if (regla.base === 'MONTO_FIJO') return 'Monto fijo del período';
  const porcentaje = new Decimal(regla.porcentaje ?? 0).toFixed(2).replace('.', ',');
  return regla.base === 'TOTAL'
    ? `${porcentaje}% del total del período`
    : `${porcentaje}% de las expensas ordinarias`;
}

/**
 * El valor guardado como snapshot en la liquidación: el porcentaje o el monto
 * fijo, según la base. Lo que hace explicable el número emitido sin depender de
 * que la regla siga existiendo igual.
 */
export function valorDeLaRegla(regla) {
  if (!regla) return null;
  return regla.base === 'MONTO_FIJO' ? regla.montoFijo : regla.porcentaje;
}
