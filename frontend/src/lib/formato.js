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

// Monto abreviado para los EJES de los charts (S3-16): "$ 1,5 M", "$ 450 k".
// Un eje con "$ 1.450.000,00" en cada tick se lleva un tercio del ancho del
// gráfico y obliga a rotar las etiquetas. El número exacto está en el tooltip y
// en los KPIs, que es donde se lo va a buscar: el eje es una referencia de
// escala, no un dato que se lea al centavo.
export function formatearMontoCorto(monto) {
  const valor = Number(monto);
  if (!Number.isFinite(valor)) return '—';
  const abs = Math.abs(valor);
  const signo = valor < 0 ? '-' : '';
  const compacto = (n, sufijo) =>
    `${signo}$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}${sufijo}`;
  if (abs >= 1_000_000) return compacto(abs / 1_000_000, ' M');
  if (abs >= 1_000) return compacto(abs / 1_000, ' k');
  return compacto(abs, '');
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

// "2026-07" → "jul 26", para los ejes de 12 puntos de la evolución mensual
// (S3-16): el mes completo con el año ("septiembre 2026") no entra en un tick.
export function formatearPeriodoCorto(periodo) {
  const [anio, mes] = String(periodo).split('-');
  const nombre = MESES[Number(mes) - 1];
  return nombre ? `${nombre.slice(0, 3)} ${anio.slice(2)}` : periodo;
}

// Fecha corta "dd-mm" para las tablas donde el año ya está implícito en el
// filtro de período (columna "Fecha" del listado de gastos). Se lee la parte
// UTC del ISO que devuelve la API: `new Date(...).getDate()` en Argentina
// (UTC-3) devolvería el día anterior para una fecha guardada a medianoche UTC.
export function formatearFechaCorta(iso) {
  if (!iso) return '—';
  const [, mes, dia] = String(iso).slice(0, 10).split('-');
  return mes && dia ? `${dia}-${mes}` : '—';
}

// Nombre legible de quien cargó un registro (`creadoPor` de la API). Devuelve
// "—" cuando el autor ya no existe: el gasto es el dato, el autor es metadata.
export function nombreDeAutor(autor) {
  if (!autor) return '—';
  return [autor.nombre, autor.apellido].filter(Boolean).join(' ') || '—';
}

// "María Fernanda Ruiz" → "María F." Para columnas de tabla, donde el nombre
// completo se lleva el ancho de una columna de datos: el completo va en el
// `title` y en el combo del filtro, que sí tienen lugar.
export function nombreDeAutorCorto(autor) {
  if (!autor?.nombre) return nombreDeAutor(autor);
  const inicial = autor.apellido ? ` ${autor.apellido[0]}.` : '';
  return `${autor.nombre.split(' ')[0]}${inicial}`;
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
