// frontend/src/lib/formato.js — ConsorcIA
// Formateo es-AR compartido (S3-07). Copy y números en es-AR sin i18n
// (PRD-07-02 §6.5); moneda con `Intl.NumberFormat` (§1.1 del stack de diseño).
//
// DECISIÓN: los montos se muestran SIEMPRE con 2 decimales, aunque los mockups
// de PRD-04-02 §4.1 los dibujen redondeados (`$450.000`). El modelo guarda
// `Decimal(12,2)` y el DoD del sprint exige que la liquidación cierre "al
// centavo": si la tabla escondiera los centavos, la fila TOTAL no reconciliaría
// visualmente con sus filas. El redondeo del mockup es un ejemplo, no un
// requisito de presentación.
//
// Los montos llegan de la API como STRING (`"12345.67"`) para no pasar por
// float; acá se convierten a número solo en el borde de presentación, donde ya
// no se hace aritmética con ellos.

const formateadores = new Map();

function formateadorDeMoneda(moneda) {
  if (!formateadores.has(moneda)) {
    formateadores.set(
      moneda,
      new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: moneda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  }
  return formateadores.get(moneda);
}

// `monto` viene como string desde la API; `moneda` es 'ARS' | 'USD'.
export function formatearMonto(monto, moneda = 'ARS') {
  return formateadorDeMoneda(moneda).format(Number(monto));
}

// "2026-07" → "julio 2026". El período es un String 'YYYY-MM' en la DB
// (PRD-02-04), así que se parsea a mano en vez de pasarlo por `new Date()`,
// que lo interpretaría como UTC y podría correrlo un mes según el huso.
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function formatearPeriodo(periodo) {
  const [anio, mes] = periodo.split('-');
  const nombre = MESES[Number(mes) - 1];
  return nombre ? `${nombre} ${anio}` : periodo;
}

// Período corriente en hora local (es el mes que el usuario está viviendo, no
// el UTC): default de los filtros de gastos.
export function periodoActual(referencia = new Date()) {
  const mes = String(referencia.getMonth() + 1).padStart(2, '0');
  return `${referencia.getFullYear()}-${mes}`;
}

// Los N períodos hacia atrás desde `referencia`, del más nuevo al más viejo.
// Alimenta el select de período (PRD-04-02 §3.2: "últimos 12 meses").
export function ultimosPeriodos(cantidad = 12, referencia = new Date()) {
  const periodos = [];
  const cursor = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  for (let i = 0; i < cantidad; i += 1) {
    periodos.push(periodoActual(cursor));
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return periodos;
}
