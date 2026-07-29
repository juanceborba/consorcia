// frontend/src/lib/gasto-schema.js — ConsorcIA
// Espejo del schema Zod del backend (`backend/src/schemas/gasto.schema.js`,
// S3-02) para el form de carga de gastos (S3-08, PRD-04-02 §1.1/§4.2). Las
// reglas tienen que coincidir: si divergen, el usuario ve un 422 genérico en un
// toast en vez del error inline en el campo que lo causó.
//
// DECISIONES de S3-08:
//
// 1. EL MONTO SE ESCRIBE EN es-AR Y VIAJA CANÓNICO. El backend solo entiende el
//    punto decimal (`"1500.50"`), pero un administrador argentino tipea
//    "1.500,50" — el formato que la propia app le muestra en la tabla. En vez de
//    rechazarlo, `normalizarMonto` lo traduce antes de validar (ver su doc para
//    las reglas de desambiguación) y lo que se manda ya es canónico. Se valida
//    con decimal.js, igual que el backend: ningún float toca el monto.
//
// 2. EL PERÍODO ES UN SELECT, NO UN TEXTO. El mockup de §4.2 dibuja un input
//    libre "2026-07", pero el formato es un contrato (`^\d{4}-\d{2}$`) y
//    escribirlo a mano es una fuente gratuita de 422. Se ofrecen los últimos 12
//    períodos (el mismo conjunto que el filtro de la lista) y, en edición, el
//    período propio del gasto si cayera fuera de esa ventana.
//
// 3. SERVICIO (B) Y SECTOR (C) SON CERRADOS, NO TEXTO LIBRE. Los valores salen
//    de las unidades del edificio (`categoriaB` / `categoriaC`). El motor de
//    liquidación (S3-03) tira `DESBALANCE_LIQUIDACION` si NINGUNA unidad queda
//    alcanzada por el gasto: un servicio tipeado a mano ("Ascensor" con
//    mayúscula, donde las unidades dicen "ascensor") no rompe el alta del gasto,
//    rompe la liquidación de todo el mes. Un desplegable con lo que el edificio
//    realmente declara vuelve ese error imposible.
//
// 4. EL COMPROBANTE ES UNA URL, NO UN UPLOAD. Diferido con motivo: el backend
//    tiene el campo `comprobanteUrl` y un servicio de storage (S3-05,
//    `services/almacenamiento.js`, driver filesystem) pero NO tiene endpoint de
//    upload (ni multipart, ni bucket de MinIO, ni bootstrap). Construirlo es
//    infraestructura nueva completa, fuera del alcance de un formulario. El
//    campo acepta el link al comprobante ya subido a donde la administración lo
//    tenga; el upload propio entra cuando exista el endpoint.

import { z } from 'zod';
import Decimal from 'decimal.js';
import { SERVICIOS_B } from '@/lib/unidad-schema';
import { periodoActual } from '@/lib/formato';

// Tope de la columna `Decimal(12, 2)` del backend.
export const MONTO_MAX = new Decimal('9999999999.99');

export const MONEDAS = [
  { value: 'ARS', label: 'ARS — Pesos' },
  { value: 'USD', label: 'USD — Dólares' },
];

export const CATEGORIAS = [
  { value: 'A', label: 'A — Gastos generales', ayuda: 'Lo pagan todas las unidades, según su coeficiente.' },
  { value: 'B', label: 'B — Servicio específico', ayuda: 'Lo pagan solo las unidades que tienen ese servicio.' },
  { value: 'C', label: 'C — Sector específico', ayuda: 'Lo pagan solo las unidades de ese sector.' },
];

// Decisión 1: "1.500,50" (es-AR) → "1500.50" (canónico).
//
// Reglas de desambiguación del punto, en orden:
//   - Si hay coma, la coma es el decimal y los puntos son miles: "1.500,50" →
//     "1500.50".
//   - Si no hay coma y el texto es una agrupación de miles perfecta
//     (`1.500`, `12.345.678`), los puntos son miles: "1.500" → "1500".
//   - Si no, el punto es el decimal: "1500.50" y "12.50" quedan igual.
// El caso ambiguo real es "1.500": se resuelve como mil quinientos, que es lo
// que significa en es-AR. Quien quiera un peso con cincuenta escribe "1,50".
const AGRUPACION_DE_MILES = /^\d{1,3}(\.\d{3})+$/;

export function normalizarMonto(texto) {
  const limpio = String(texto ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^\$/, '');
  if (limpio.includes(',')) return limpio.replace(/\./g, '').replace(',', '.');
  if (AGRUPACION_DE_MILES.test(limpio)) return limpio.replace(/\./g, '');
  return limpio;
}

// Opcional en el form = string vacío permitido; con contenido, valida.
const opcional = (schema) => z.union([z.literal(''), schema]);

// Hoy en hora local, en formato del input date. El backend corta al fin del día
// UTC (decisión 2 de su schema), así que "hoy local" siempre le entra.
export const hoyISO = () => {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
};

const montoSchema = z
  .string()
  .trim()
  .min(1, 'Ingresá el monto del gasto')
  .superRefine((valor, ctx) => {
    const normalizado = normalizarMonto(valor);
    let monto;
    try {
      monto = new Decimal(normalizado);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Monto inválido: usá números (ej. 1.500,50)' });
      return;
    }
    if (!monto.isFinite()) {
      ctx.addIssue({ code: 'custom', message: 'Monto inválido: usá números (ej. 1.500,50)' });
      return;
    }
    if (monto.lte(0)) {
      ctx.addIssue({ code: 'custom', message: 'El monto tiene que ser mayor a 0' });
      return;
    }
    if (monto.decimalPlaces() > 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'Máximo 2 decimales: la moneda se guarda al centavo',
      });
      return;
    }
    if (monto.gt(MONTO_MAX)) {
      ctx.addIssue({ code: 'custom', message: `Máximo ${MONTO_MAX.toFixed(2)}` });
    }
  });

export const gastoSchema = z
  .object({
    proveedorId: z.string().min(1, 'Elegí el proveedor del gasto'),
    // El selector no fija el valor hasta llegar a una hoja del árbol (S3-14), así
    // que "vacío" también cubre "eligió el rubro pero no el subrubro".
    rubroId: z.string().min(1, 'Elegí el rubro y, si tiene, el subrubro'),
    concepto: z
      .string()
      .trim()
      .min(3, 'El concepto necesita al menos 3 caracteres')
      .max(100, 'Máximo 100 caracteres'),
    descripcion: opcional(z.string().trim().max(500, 'Máximo 500 caracteres')),
    monto: montoSchema,
    moneda: z.enum(['ARS', 'USD']),
    categoria: z.enum(['A', 'B', 'C'], { message: 'Elegí la categoría del gasto' }),
    servicioEspecifico: z.string(),
    sectorEspecifico: z.string(),
    tipo: z.enum(['ordinario', 'extraordinario']),
    fechaGasto: z
      .string()
      .min(1, 'Ingresá la fecha del gasto')
      .refine((f) => f <= hoyISO(), 'La fecha no puede ser futura'),
    periodo: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Elegí el período de la liquidación'),
    comprobanteUrl: opcional(
      z.url('Link inválido: tiene que empezar con http:// o https://').max(500),
    ),
  })
  // Espejo de `incoherenciaCategoria` del backend: el campo específico va con su
  // categoría y con ninguna otra. El form ya oculta el que no corresponde; esto
  // cubre el residuo de haber cambiado de categoría con un valor cargado.
  .superRefine((data, ctx) => {
    if (data.categoria === 'B' && !data.servicioEspecifico) {
      ctx.addIssue({
        code: 'custom',
        path: ['servicioEspecifico'],
        message: 'Elegí el servicio que se reparte',
      });
    }
    if (data.categoria === 'C' && !data.sectorEspecifico) {
      ctx.addIssue({
        code: 'custom',
        path: ['sectorEspecifico'],
        message: 'Elegí el sector que se reparte',
      });
    }
  });

export const GASTO_VACIO = {
  proveedorId: '',
  rubroId: '',
  concepto: '',
  descripcion: '',
  monto: '',
  moneda: 'ARS',
  categoria: 'A',
  servicioEspecifico: '',
  sectorEspecifico: '',
  tipo: 'ordinario',
  fechaGasto: hoyISO(),
  periodo: periodoActual(),
  comprobanteUrl: '',
};

// Valores del form → body de la API. El servicio y el sector se mandan según la
// categoría FINAL (el backend rechaza un gasto A que arrastre un servicio), y el
// monto va canónico (decisión 1).
export function aPayload(valores) {
  return {
    proveedorId: valores.proveedorId,
    rubroId: valores.rubroId,
    concepto: valores.concepto.trim(),
    descripcion: valores.descripcion.trim() || null,
    monto: normalizarMonto(valores.monto),
    moneda: valores.moneda,
    categoria: valores.categoria,
    servicioEspecifico:
      valores.categoria === 'B' ? valores.servicioEspecifico : null,
    sectorEspecifico: valores.categoria === 'C' ? valores.sectorEspecifico : null,
    esOrdinario: valores.tipo === 'ordinario',
    fechaGasto: valores.fechaGasto,
    periodo: valores.periodo,
    comprobanteUrl: valores.comprobanteUrl.trim() || null,
  };
}

// Gasto de la API → valores del form (null → '' para inputs controlados).
export function aFormulario(gasto) {
  return {
    ...GASTO_VACIO,
    proveedorId: gasto.proveedorId ?? '',
    rubroId: gasto.rubroId ?? '',
    concepto: gasto.concepto ?? '',
    descripcion: gasto.descripcion ?? '',
    // El monto llega canónico de la API: se muestra tal cual (el usuario puede
    // reescribirlo en es-AR si quiere, `normalizarMonto` acepta las dos formas).
    monto: gasto.monto ?? '',
    moneda: gasto.moneda ?? 'ARS',
    categoria: gasto.categoria ?? 'A',
    servicioEspecifico: gasto.servicioEspecifico ?? '',
    sectorEspecifico: gasto.sectorEspecifico ?? '',
    tipo: gasto.esOrdinario === false ? 'extraordinario' : 'ordinario',
    // `fechaGasto` viene ISO completo (`2026-07-15T00:00:00.000Z`); el input
    // date quiere solo la parte de fecha, y se toma la UTC porque es la que el
    // backend guardó (convertirla a local la correría un día en Argentina).
    fechaGasto: (gasto.fechaGasto ?? '').slice(0, 10) || hoyISO(),
    periodo: gasto.periodo ?? periodoActual(),
    comprobanteUrl: gasto.comprobanteUrl ?? '',
  };
}

// Decisión 3: el vocabulario de las categorías B y C sale de las unidades del
// edificio, no de una lista fija. `SERVICIOS_B` solo aporta la etiqueta legible
// de los canónicos ("agua_caliente" → "Agua caliente"); un servicio cargado a
// mano en las unidades se muestra tal cual.
const ETIQUETAS_SERVICIO = new Map(SERVICIOS_B.map((s) => [s.value, s.label]));

export const etiquetaDeServicio = (valor) => ETIQUETAS_SERVICIO.get(valor) ?? valor;

export function serviciosDeEdificio(unidades = []) {
  const valores = new Set();
  for (const unidad of unidades) {
    for (const servicio of unidad.categoriaB ?? []) {
      if (servicio) valores.add(servicio);
    }
  }
  return [...valores].sort((a, b) =>
    etiquetaDeServicio(a).localeCompare(etiquetaDeServicio(b), 'es-AR'),
  );
}

export function sectoresDeEdificio(unidades = []) {
  const valores = new Set();
  for (const unidad of unidades) {
    if (unidad.categoriaC) valores.add(unidad.categoriaC);
  }
  return [...valores].sort((a, b) => a.localeCompare(b, 'es-AR'));
}
