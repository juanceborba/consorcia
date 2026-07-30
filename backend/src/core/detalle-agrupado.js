// src/core/detalle-agrupado.js — El detalle de una UF, agrupado (S3-09)
// Spec: PRD-04-03 §4.1 (preview) · PRD-06-01 §3.2 (Ley 941: el recibo separa
// ordinarias de extraordinarias y detalla los conceptos).
//
// UNA SOLA DEFINICIÓN DEL ÁRBOL, TRES CONSUMIDORES: la preview de la
// liquidación, el PDF del recibo y (cuando exista) la vista del propietario.
// El árbol es siempre el mismo:
//
//   Ordinarias / Extraordinarias  →  Rubro  →  Subrubro  →  ítems
//
// DECISIONES:
//
// 1. **EL AGRUPADO ES DEL BACKEND, NO DE CADA PANTALLA.** La primera versión de
//    S3-09 lo armaba en el frontend y el generador del PDF tenía su propia lista
//    plana: dos definiciones de "cómo se agrupa una expensa" que iban a divergir
//    en cuanto una de las dos cambiara. Un propietario que ve un detalle en la
//    preview y otro en su PDF tiene razón en desconfiar del número, así que la
//    agrupación se calcula acá y las dos salidas renderizan el mismo objeto.
//
// 2. **LA SEPARACIÓN ORDINARIAS / EXTRAORDINARIAS ES EL PRIMER CORTE.** La Ley
//    941 obliga a mostrarlas separadas; el rubro es el corte de adentro, el que
//    responde "¿en qué se me fue la expensa?". Un mismo rubro puede aparecer en
//    las dos secciones (limpieza habitual y una limpieza extraordinaria
//    post-obra) y se muestra dos veces: son conceptos distintos.
//
// 3. **UN GASTO IMPUTADO A UN RUBRO DE NIVEL 1 NO INVENTA SUBRUBRO.** El árbol
//    de rubros tiene dos niveles y el gasto se imputa a una hoja (ver `model
//    Rubro`): con `parent` la hoja es un subrubro, sin `parent` la hoja YA es el
//    rubro y el subrubro queda en `null`. Meter un "General" ficticio le mentiría
//    al propietario sobre cómo está cargado el gasto.
//
// 4. **EL ORDEN ES DETERMINÍSTICO Y CON DESEMPATE POR ID.** El PDF del recibo
//    tiene que dar los mismos bytes ante el mismo input (su sha256 es la
//    verificación de integridad del comprobante), así que ningún nivel puede
//    quedar ordenado por algo que empate. Rubros y subrubros van por nombre y
//    desempatan por id; los ítems van por fecha del gasto, después gastoId y
//    después número de cuota — el mismo orden que ya usaba el generador.
//
// 5. **LOS SUBTOTALES SE SUMAN CON decimal.js Y SALEN COMO STRING**, igual que
//    todos los montos del sistema. Son los números que el propietario chequea
//    contra su total: tienen que cerrar al centavo con la fila de la tabla y con
//    el TOTAL A PAGAR del PDF.

import Decimal from 'decimal.js';

// Fragmento de `select` de Prisma para `liquidacionDetalle.findMany`. Lo comparten
// la preview y la emisión de recibos: si mañana el árbol necesita un campo más,
// se agrega una vez y las dos salidas lo tienen (decisión 1).
export const SELECT_DETALLE = {
  unidadId: true,
  gastoId: true,
  // S3-21: `FONDO_RESERVA` es una línea sin gasto detrás (el aporte del período),
  // así que todo lo que se lea de `gasto` tiene que ser null-safe.
  tipo: true,
  // S3-19: el rótulo "cuota k/N" sale del SNAPSHOT del detalle, no del plan
  // vigente: si el plan se editó después, el recibo emitido sigue diciendo lo
  // que decía cuando se emitió.
  cuotaNumero: true,
  cuotasTotal: true,
  // S3-20: con qué esquema se calculó este peso, también del snapshot.
  esquemaNombre: true,
  coeficienteAplicado: true,
  montoAsignado: true,
  unidad: { select: { id: true, numero: true, tipo: true, m2: true, coeficiente: true } },
  gasto: {
    select: {
      id: true,
      esOrdinario: true,
      concepto: true,
      categoria: true,
      fechaGasto: true,
      proveedor: { select: { id: true, razonSocial: true } },
      rubro: {
        select: { id: true, nombre: true, parent: { select: { id: true, nombre: true } } },
      },
    },
  },
};

// El concepto tal como se imprime. S3-19: el ítem de una cuota se rotula
// "Concepto (cuota k/N)" y no en una columna aparte porque el Modelo Único de la
// Ley 941 tiene una columna de concepto y una de importe, nada más.
export function conceptoImpreso(gastoConcepto, cuotaNumero, cuotasTotal) {
  return cuotasTotal ? `${gastoConcepto} (cuota ${cuotaNumero}/${cuotasTotal})` : gastoConcepto;
}

// Un `LiquidacionDetalle` (leído con `SELECT_DETALLE`) → el ítem plano que
// consumen el agrupador, la preview y el PDF.
export function itemDeDetalle(d) {
  // S3-21: el aporte al fondo no tiene gasto, ni rubro, ni proveedor: es una
  // contribución patrimonial (CCyC art. 2046 inc. d) y va en su propia sección.
  if (d.tipo === 'FONDO_RESERVA') {
    return {
      tipo: 'FONDO_RESERVA',
      gastoId: null,
      concepto: 'Fondo de reserva',
      conceptoImpreso: 'Fondo de reserva',
      esOrdinario: null,
      categoria: null,
      fechaGasto: null,
      proveedorNombre: null,
      rubroId: null,
      rubroNombre: null,
      subrubroId: null,
      subrubroNombre: null,
      pesoAplicado: new Decimal(d.coeficienteAplicado).toFixed(6),
      esquemaNombre: d.esquemaNombre,
      cuotaNumero: null,
      cuotasTotal: null,
      monto: new Decimal(d.montoAsignado).toFixed(2),
    };
  }

  // Decisión 3: la hoja puede ser un subrubro (tiene `parent`) o el rubro mismo.
  const hoja = d.gasto.rubro ?? null;
  const padre = hoja?.parent ?? null;
  return {
    tipo: 'GASTO',
    gastoId: d.gastoId,
    concepto: d.gasto.concepto,
    conceptoImpreso: conceptoImpreso(d.gasto.concepto, d.cuotaNumero, d.cuotasTotal),
    // Lo que separa las dos secciones es del gasto, no del detalle.
    esOrdinario: d.gasto.esOrdinario,
    categoria: d.gasto.categoria,
    fechaGasto: d.gasto.fechaGasto,
    proveedorNombre: d.gasto.proveedor?.razonSocial ?? null,
    rubroId: padre ? padre.id : (hoja?.id ?? null),
    rubroNombre: padre ? padre.nombre : (hoja?.nombre ?? null),
    subrubroId: padre ? hoja.id : null,
    subrubroNombre: padre ? hoja.nombre : null,
    // Decisión 2 de la preview: es la PARTICIPACIÓN normalizada en ese gasto
    // (`peso ÷ Σpesos`), no el coeficiente de la UF. Seis decimales, el mismo
    // formato con el que la API expone cualquier coeficiente.
    pesoAplicado: new Decimal(d.coeficienteAplicado).toFixed(6),
    esquemaNombre: d.esquemaNombre,
    cuotaNumero: d.cuotaNumero,
    cuotasTotal: d.cuotasTotal,
    monto: new Decimal(d.montoAsignado).toFixed(2),
  };
}

// S3-21: el fondo es la TERCERA sección y no una fila dentro de las ordinarias.
// La Ley 941 obliga a separar ordinarias de extraordinarias y el fondo no es
// ninguna de las dos; además, sumarlo a las ordinarias haría que el subtotal de
// la sección dejara de coincidir con `totalOrdinarias` de la liquidación.
const SECCIONES = [
  { id: 'ordinarias', titulo: 'Expensas ordinarias', clave: 'ordinarias' },
  { id: 'extraordinarias', titulo: 'Expensas extraordinarias', clave: 'extraordinarias' },
  { id: 'fondoReserva', titulo: 'Fondo de reserva', clave: 'fondoReserva' },
];

// A qué sección va un ítem. El fondo se distingue por `tipo`; los gastos, por
// `esOrdinario`, como antes.
const claveDeSeccion = (item) =>
  item.tipo === 'FONDO_RESERVA'
    ? 'fondoReserva'
    : item.esOrdinario
      ? 'ordinarias'
      : 'extraordinarias';

// Decisión 4: nombre y después id, para que nunca haya un empate.
const porNombre = (a, b) =>
  (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es') || String(a.id).localeCompare(String(b.id));

const porImputacion = (a, b) =>
  new Date(a.fechaGasto ?? 0) - new Date(b.fechaGasto ?? 0) ||
  String(a.gastoId ?? '').localeCompare(String(b.gastoId ?? '')) ||
  (a.cuotaNumero ?? 0) - (b.cuotaNumero ?? 0);

/**
 * Agrupa los ítems de UNA unidad funcional en el árbol que se muestra e imprime.
 *
 * @param {object[]} items ítems planos (ver `itemDeDetalle`)
 * @returns {{id: string, titulo: string, total: string, rubros: object[]}[]}
 *   Las secciones sin ningún ítem no se devuelven: una sección vacía en el
 *   recibo de un propietario es ruido, no información.
 */
export function agruparItems(items) {
  const secciones = SECCIONES.map((s) => ({ ...s, total: new Decimal(0), rubros: new Map() }));

  for (const item of items ?? []) {
    const seccion = secciones.find((s) => s.clave === claveDeSeccion(item));
    if (!seccion) continue;

    const monto = new Decimal(item.monto);
    seccion.total = seccion.total.plus(monto);

    const rubroKey = item.rubroId ?? '__sin_rubro__';
    if (!seccion.rubros.has(rubroKey)) {
      seccion.rubros.set(rubroKey, {
        id: rubroKey,
        // El aporte al fondo no tiene rubro y no debe inventarse uno: su
        // "rubro" es el concepto mismo.
        nombre: item.rubroNombre ?? (item.tipo === 'FONDO_RESERVA' ? 'Aporte del período' : 'Sin rubro'),
        total: new Decimal(0),
        subrubros: new Map(),
      });
    }
    const rubro = seccion.rubros.get(rubroKey);
    rubro.total = rubro.total.plus(monto);

    // Decisión 3: `null` es una clave de subgrupo válida — la de los gastos
    // imputados directo al rubro.
    const subKey = item.subrubroId ?? '__directo__';
    if (!rubro.subrubros.has(subKey)) {
      rubro.subrubros.set(subKey, {
        id: subKey,
        nombre: item.subrubroNombre ?? null,
        total: new Decimal(0),
        items: [],
      });
    }
    const sub = rubro.subrubros.get(subKey);
    sub.total = sub.total.plus(monto);
    sub.items.push(item);
  }

  // Decisión 5: los Decimal se cierran a string recién acá.
  return secciones
    .filter((s) => s.rubros.size > 0)
    .map((s) => ({
      id: s.id,
      titulo: s.titulo,
      total: s.total.toFixed(2),
      rubros: [...s.rubros.values()].sort(porNombre).map((r) => ({
        id: r.id,
        nombre: r.nombre,
        total: r.total.toFixed(2),
        subrubros: [...r.subrubros.values()].sort(porNombre).map((sub) => ({
          id: sub.id,
          nombre: sub.nombre,
          total: sub.total.toFixed(2),
          items: [...sub.items].sort(porImputacion),
        })),
      })),
    }));
}

export default { SELECT_DETALLE, itemDeDetalle, agruparItems, conceptoImpreso };
