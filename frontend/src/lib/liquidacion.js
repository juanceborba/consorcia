// frontend/src/lib/liquidacion.js — ConsorcIA
// Vocabulario de la liquidación en el frontend (S3-09): rótulos de estado,
// qué estados ocupan un período y el cálculo de la variación contra la
// liquidación anterior. Espejo de la máquina de estados del backend
// (`ESTADOS_VIGENTES` / `TRANSICIONES` en src/routes/liquidaciones.routes.js),
// igual que los schemas de zod del frontend espejan a los del backend.
//
// DECISIONES:
//
// 1. LOS ESTADOS SE DESCRIBEN, NO SOLO SE NOMBRAN. "BORRADOR" no le dice a un
//    administrador si eso ya lo vio un propietario. Cada estado lleva su
//    `descripcion`, que es lo que la pantalla muestra debajo del badge: el
//    estado de una liquidación es un hecho legal (Ley 941: qué se emitió y
//    cuándo), no una etiqueta de workflow.
//
// 2. LA VARIACIÓN SE CALCULA CON decimal.js aunque sea presentación. Los montos
//    llegan como string justamente para no pasar por float; convertirlos a
//    Number para dividirlos reintroduciría el problema en el único número de la
//    pantalla que el administrador va a mirar para decidir si aprueba. El
//    redondeo a un decimal se hace al final, sobre el porcentaje ya calculado.
//
// 3. SIN BASE NO HAY PORCENTAJE. Si la unidad no pagaba nada el período
//    anterior (UF nueva, o no alcanzada por ningún gasto), la variación es
//    `null` y la tabla muestra "—". Un "+∞%" o un "+100%" serían ruido: lo
//    informativo ahí es el monto, no la proporción.
import Decimal from 'decimal.js';

// Rótulos y semáforo por estado. Los `variant` son los tokens de estado de
// S2-05, los mismos que usan los badges del resto del backoffice.
export const ESTADOS_LIQUIDACION = {
  BORRADOR: {
    label: 'Borrador',
    variant: 'secondary',
    descripcion:
      'Calculada pero todavía no aprobada. Nadie la vio fuera de la administración y se puede anular para volver a generarla.',
  },
  PENDIENTE_APROBACION: {
    label: 'Pendiente de aprobación',
    variant: 'warning',
    descripcion: 'Esperando la aprobación del administrador.',
  },
  APROBADA: {
    label: 'Aprobada',
    variant: 'info',
    descripcion:
      'Aprobada por la administración. Todavía no se emitieron los recibos.',
  },
  ENVIADA: {
    label: 'Enviada',
    variant: 'success',
    descripcion: 'Con los recibos emitidos y disponibles para las unidades.',
  },
  COBRADA: {
    label: 'Cobrada',
    variant: 'success',
    descripcion: 'Con los cobros imputados.',
  },
  ANULADA: {
    label: 'Anulada',
    variant: 'outline',
    descripcion:
      'Sin efecto. Su período volvió a quedar libre para generar una liquidación nueva.',
  },
};

export function estadoDeLiquidacion(estado) {
  return (
    ESTADOS_LIQUIDACION[estado] ?? {
      label: estado ?? '—',
      variant: 'outline',
      descripcion: '',
    }
  );
}

// Estados que mantienen "tomado" el período (índice único parcial de S3-01):
// mientras haya una liquidación en alguno de ellos, ese período no se puede
// volver a generar. Anular es lo único que lo libera.
export const ESTADOS_VIGENTES = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'ENVIADA',
  'COBRADA',
];

export const estaVigente = (liquidacion) =>
  ESTADOS_VIGENTES.includes(liquidacion?.estado);

// ---------------------------------------------------------------------------
// Acciones del workflow (S3-10)
// ---------------------------------------------------------------------------
//
// Espejo de `TRANSICIONES` del backend. Cada acción declara desde qué estados
// se puede ejecutar y cómo se le habla al administrador: `label` es el botón,
// `confirmacion` es lo que el ConfirmDialog tiene que dejar claro ANTES de
// apretar (PRD-07-02 §6.3) y `variante` es el peso visual.
//
// DECISIÓN: "enviar" se rotula "Generar recibos" y no "Enviar". En el MVP la
// acción emite los PDFs y los deja disponibles para descargar; el envío por
// email es AgentMail (post-beta, PRD-04-03 §2 PASO 6). Un botón "Enviar" le
// prometería al administrador que los propietarios recibieron algo, y no es así.
// El ESTADO sigue llamándose ENVIADA porque es el nombre del backend y de la
// máquina de estados del PRD; el rótulo del botón describe lo que el botón hace.
export const ACCIONES_LIQUIDACION = {
  aprobar: {
    label: 'Aprobar',
    desde: ['BORRADOR', 'PENDIENTE_APROBACION'],
    hacia: 'APROBADA',
    variante: 'info',
    titulo: '¿Aprobar esta liquidación?',
    confirmacion:
      'Aprobar es el acto por el que la administración da por buenos estos importes. Después de aprobar no se pueden editar los gastos del período: si aparece un error hay que anular la liquidación y volver a generarla.',
    confirmText: 'Aprobar liquidación',
  },
  enviar: {
    label: 'Generar recibos',
    desde: ['APROBADA'],
    hacia: 'ENVIADA',
    variante: 'info',
    titulo: '¿Generar los recibos?',
    confirmacion:
      'Se emite un recibo PDF por unidad, con el QR de verificación y la matrícula RPA del administrador (Ley 941). Los recibos emitidos quedan como documentación del consorcio: para corregirlos hay que anular la liquidación y volver a liquidar el período.',
    confirmText: 'Generar recibos',
  },
  anular: {
    label: 'Anular',
    desde: ['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA'],
    hacia: 'ANULADA',
    variante: 'danger',
    titulo: '¿Anular esta liquidación?',
    confirmacion:
      'La liquidación queda sin efecto y su período vuelve a estar libre para generar una nueva. Los recibos que ya se hayan emitido no se borran (es documentación del consorcio) pero dejan de corresponder a una liquidación vigente.',
    confirmText: 'Anular liquidación',
  },
};

// Las acciones ofrecibles sobre un estado, en el orden en que se muestran: la
// que hace avanzar el workflow primero, anular al final. Un estado sin
// transiciones (COBRADA, ANULADA) devuelve lista vacía.
export function accionesDeLiquidacion(estado) {
  return Object.entries(ACCIONES_LIQUIDACION)
    .filter(([, accion]) => accion.desde.includes(estado))
    .map(([id, accion]) => ({ id, ...accion }));
}

// La liquidación con la que comparar: la vigente más reciente ANTERIOR al
// período que se está viendo. No se exige que sea el mes inmediato anterior —
// un consorcio puede haber liquidado en marzo y recién en junio, y comparar
// contra "la anterior de verdad" es más útil que no comparar contra nada. Las
// anuladas se descartan: no son un antecedente, son un cálculo sin efecto.
export function liquidacionAnterior(liquidaciones, periodo) {
  return (
    (liquidaciones ?? [])
      .filter((l) => estaVigente(l) && l.periodo < periodo)
      .sort((a, b) => b.periodo.localeCompare(a.periodo))[0] ?? null
  );
}

// Rótulo de la imputación de un ítem: "Cuota 3/12" o "Imputación única" (S3-19).
//
// DECISIÓN: EL AGRUPADO DEL DETALLE NO ESTÁ ACÁ. El árbol ordinarias /
// extraordinarias → rubro → subrubro con sus subtotales lo arma el backend
// (`core/detalle-agrupado.js`) y llega servido en `unidades[].secciones`. Esta
// pantalla lo tuvo un tiempo y fue un error: el PDF del recibo tiene que
// imprimir exactamente el mismo detalle, y dos implementaciones del mismo
// agrupado divergen en cuanto una de las dos cambia. Acá solo quedan los
// rótulos, que sí son vocabulario de la interfaz.
export function rotuloDeImputacion(item) {
  return item?.cuotaNumero
    ? `Cuota ${item.cuotaNumero}/${item.cuotasTotal}`
    : 'Imputación única';
}

// Variación porcentual de `actual` contra `anterior`, ambos strings de la API.
// Devuelve un Number redondeado a un decimal, o null si no hay base (decisión 3).
export function variacionPorcentual(actual, anterior) {
  if (actual === undefined || actual === null) return null;
  if (anterior === undefined || anterior === null) return null;
  const base = new Decimal(anterior);
  if (base.isZero()) return null;
  return new Decimal(actual)
    .minus(base)
    .div(base)
    .times(100)
    .toDecimalPlaces(1)
    .toNumber();
}

// "+12,3%" / "-4%" / "=" (sin cambios) / "—" (sin base). El separador decimal
// es la coma: es la pantalla de un administrador argentino, no un dashboard.
export function formatearVariacion(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct === 0) return '=';
  const signo = pct > 0 ? '+' : '−';
  return `${signo}${Math.abs(pct).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
}

// Color de la variación. Subir NO es "malo" en rojo ni bajar "bueno" en verde:
// una expensa que sube puede ser una obra aprobada por asamblea. Se usa el
// tono neutro/atención — el semáforo se reserva para los estados, que sí
// significan algo unívoco.
export function variantDeVariacion(pct) {
  if (pct === null || pct === undefined || pct === 0) return 'outline';
  return Math.abs(pct) >= 20 ? 'warning' : 'secondary';
}
