// frontend/src/lib/esquema-reparto-schema.js — ConsorcIA
// Espejo del schema Zod del backend (`backend/src/schemas/esquema-reparto.schema.js`,
// S3-20) para el formulario de esquemas de reparto. Mismo criterio que
// `gasto-schema.js`: si las reglas divergen, el usuario ve un 422 genérico en un
// toast en vez del error inline en el campo que lo causó.
//
// LO QUE ESTE ARCHIVO TIENE QUE MANTENER FIEL ES LA SEMÁNTICA DEL PESO, porque
// es lo único de S3-20 que no se puede deducir mirando la pantalla. Está definida
// en el comentario de `EsquemaReparto` en schema.prisma y se repite acá porque es
// el copy que el formulario le muestra al administrador:
//
//   COEFICIENTE     → el peso es un FACTOR sobre el coeficiente. Fila ausente = 1.
//   PARTES_IGUALES  → el peso es un FACTOR sobre 1. Fila ausente = 1.
//   PESOS_PROPIOS   → el peso es ABSOLUTO. Fila ausente = 0 (la UF no participa).
//
// Y el alcance se aplica ANTES que la base: fuera del alcance el peso es 0.
//
// DECISIONES:
//
// 1. LA TABLA DE PESOS ES UN MAPA unidadId → texto, NO un array. El formulario
//    dibuja una fila por UF del edificio y deja vacías las que van con el default
//    de la base; un array obligaría a sincronizar índices con altas y bajas de
//    unidades. `aPayload` filtra las vacías, que es exactamente la semántica de
//    "fila ausente" del backend: un esquema "todas al 100% menos PB al 50%" viaja
//    como UNA fila, no como N.
//
// 2. EL PESO VIAJA COMO STRING. El backend lo recibe con decimal.js y lo guarda
//    en un Decimal(12,6): convertirlo a número acá reintroduciría el float en el
//    borde de salida, igual que pasaría con el monto del gasto.

import { z } from 'zod';
import Decimal from 'decimal.js';

// Tope de la columna `Decimal(12, 6)` del backend (PESO_MAX de su schema).
export const PESO_MAX = new Decimal('9999.999999');

export const BASES = [
  {
    value: 'COEFICIENTE',
    label: 'Coeficiente — factor sobre el coeficiente de cada UF',
    ayuda:
      'El reparto sigue el coeficiente del reglamento y la tabla lo corrige: 0,5 hace que esa UF pague la mitad, 0 la exime. Una UF sin fila paga el 100% de lo que le toca por coeficiente.',
    ausente: 'paga el 100% de su coeficiente',
  },
  {
    value: 'PARTES_IGUALES',
    label: 'Partes iguales — factor sobre 1, por UF',
    ayuda:
      'Todas las UF alcanzadas pagan lo mismo, sin mirar el coeficiente, y la tabla lo corrige: 0,5 paga media parte, 0 no paga. Una UF sin fila paga una parte entera.',
    ausente: 'paga una parte entera',
  },
  {
    value: 'PESOS_PROPIOS',
    label: 'Pesos propios — la segunda tabla del reglamento',
    ayuda:
      'El peso es el valor absoluto que trae el reglamento (el "coeficiente de Torre A", que no es proporcional al general). Una UF sin fila NO participa del reparto.',
    ausente: 'no participa del reparto',
  },
];

export const ALCANCES = [
  {
    value: 'TODAS',
    label: 'Todas las unidades del edificio',
    ayuda: 'Alcanza a todas las UF. Es el alcance del esquema general del edificio.',
  },
  {
    value: 'SERVICIO',
    label: 'Las unidades que tienen un servicio (categoría B)',
    ayuda:
      'Se aplica solo a las UF que declaran ese servicio, y los gastos de categoría B de ese servicio lo toman automáticamente.',
  },
  {
    value: 'SECTOR',
    label: 'Las unidades de un sector (categoría C)',
    ayuda:
      'Se aplica solo a las UF de ese sector, y los gastos de categoría C de ese sector lo toman automáticamente.',
  },
  {
    value: 'SELECCION',
    label: 'Solo las unidades de la tabla',
    ayuda:
      'Alcanza únicamente a las UF que cargues abajo. Ningún gasto lo toma solo: hay que elegirlo a mano en el gasto (es el caso del cargo por una rotura puntual).',
  },
];

export const baseDe = (valor) => BASES.find((b) => b.value === valor) ?? BASES[0];
export const alcanceDe = (valor) => ALCANCES.find((a) => a.value === valor) ?? ALCANCES[0];

// El alcance necesita valor solo en SERVICIO y SECTOR (espejo de
// `incoherenciaAlcance` del backend, y del CHECK de la migración).
export const alcanceNecesitaValor = (alcance) =>
  alcance === 'SERVICIO' || alcance === 'SECTOR';

// Opcional en el form = string vacío permitido; con contenido, valida.
const opcional = (schema) => z.union([z.literal(''), schema]);

// Un peso escrito a mano. Vacío = fila ausente (decisión 1), así que este parser
// solo corre sobre lo que el usuario efectivamente cargó. Acepta la coma decimal:
// un administrador argentino escribe "0,5", no "0.5".
export function normalizarPeso(texto) {
  return String(texto ?? '').trim().replace(',', '.');
}

// null = el texto no es un peso válido. El mensaje del motivo lo arma el schema.
export function pesoInvalido(texto) {
  const normalizado = normalizarPeso(texto);
  let peso;
  try {
    peso = new Decimal(normalizado);
  } catch {
    return 'usá números (ej. 0,5)';
  }
  if (!peso.isFinite()) return 'usá números (ej. 0,5)';
  if (peso.lt(0)) return 'no puede ser negativo: le devolvería plata a esa unidad';
  if (peso.decimalPlaces() > 6) return 'máximo 6 decimales';
  if (peso.gt(PESO_MAX)) return `máximo ${PESO_MAX.toString()}`;
  return null;
}

const esPositivo = (texto) => {
  if (!String(texto ?? '').trim()) return false;
  try {
    return new Decimal(normalizarPeso(texto)).gt(0);
  } catch {
    return false;
  }
};

export const esquemaRepartoSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(3, 'El nombre necesita al menos 3 caracteres')
      .max(100, 'Máximo 100 caracteres'),
    base: z.enum(['COEFICIENTE', 'PARTES_IGUALES', 'PESOS_PROPIOS']),
    alcance: z.enum(['TODAS', 'SERVICIO', 'SECTOR', 'SELECCION']),
    alcanceValor: z.string(),
    clausulaReglamento: opcional(z.string().trim().max(200, 'Máximo 200 caracteres')),
    documentoUrl: opcional(
      z.url('Link inválido: tiene que empezar con http:// o https://').max(500),
    ),
    activo: z.boolean(),
    // Decisión 1: unidadId → peso tipeado ('' = fila ausente).
    pesos: z.record(z.string(), z.string()),
  })
  .superRefine((data, ctx) => {
    // Espejo de `incoherenciaAlcance`: el form ya esconde el campo cuando no
    // corresponde, pero un cambio de alcance puede dejar el valor viejo cargado.
    if (alcanceNecesitaValor(data.alcance) && !data.alcanceValor) {
      ctx.addIssue({
        code: 'custom',
        path: ['alcanceValor'],
        message:
          data.alcance === 'SERVICIO'
            ? 'Elegí el servicio que se reparte'
            : 'Elegí el sector que se reparte',
      });
    }

    // Cada peso cargado, con su motivo. El error va al campo de esa UF.
    for (const [unidadId, texto] of Object.entries(data.pesos ?? {})) {
      if (!String(texto ?? '').trim()) continue;
      const motivo = pesoInvalido(texto);
      if (motivo) {
        ctx.addIssue({ code: 'custom', path: ['pesos', unidadId], message: motivo });
      }
    }

    // Espejo de `incoherenciaPesos`: las dos combinaciones que sin tabla
    // repartirían 0 a todas las UF y harían fallar la liquidación entera. El
    // error se cuelga del campo que lo causa (el alcance o la base) y no de
    // `pesos`: es donde el usuario puede corregirlo, y evita chocar con los
    // errores por UF, que viven dentro del mismo objeto `pesos`.
    const conPeso = Object.values(data.pesos ?? {}).filter(esPositivo);
    if (conPeso.length === 0) {
      if (data.alcance === 'SELECCION') {
        ctx.addIssue({
          code: 'custom',
          path: ['alcance'],
          message:
            'Este alcance reparte solo entre las unidades de la tabla: cargá al menos una con peso mayor a 0',
        });
      } else if (data.base === 'PESOS_PROPIOS') {
        ctx.addIssue({
          code: 'custom',
          path: ['base'],
          message:
            'Con pesos propios, una unidad sin fila no participa: cargá al menos una con peso mayor a 0',
        });
      }
    }
  });

export const ESQUEMA_VACIO = {
  nombre: '',
  base: 'COEFICIENTE',
  alcance: 'TODAS',
  alcanceValor: '',
  clausulaReglamento: '',
  documentoUrl: '',
  activo: true,
  pesos: {},
};

// Valores del form → body de la API. `alcanceValor` viaja según el alcance FINAL
// (el backend rechaza un TODAS que arrastre un valor) y la tabla se manda COMPLETA:
// el PUT la reemplaza entera, así que las filas que el usuario borró desaparecen.
export function aPayload(valores) {
  return {
    nombre: valores.nombre.trim(),
    base: valores.base,
    alcance: valores.alcance,
    alcanceValor: alcanceNecesitaValor(valores.alcance)
      ? valores.alcanceValor
      : null,
    clausulaReglamento: valores.clausulaReglamento.trim() || null,
    documentoUrl: valores.documentoUrl.trim() || null,
    activo: valores.activo,
    pesos: Object.entries(valores.pesos ?? {})
      .filter(([, texto]) => String(texto ?? '').trim() !== '')
      .map(([unidadId, texto]) => ({ unidadId, peso: normalizarPeso(texto) })),
  };
}

// Esquema de la API → valores del form. Los pesos llegan con 6 decimales fijos
// ("0.500000"); se muestran sin los ceros de relleno para que la tabla se lea.
export function aFormulario(esquema) {
  const pesos = {};
  for (const fila of esquema.pesos ?? []) {
    pesos[fila.unidadId] = new Decimal(fila.peso).toString();
  }
  return {
    ...ESQUEMA_VACIO,
    nombre: esquema.nombre ?? '',
    base: esquema.base ?? 'COEFICIENTE',
    alcance: esquema.alcance ?? 'TODAS',
    alcanceValor: esquema.alcanceValor ?? '',
    clausulaReglamento: esquema.clausulaReglamento ?? '',
    documentoUrl: esquema.documentoUrl ?? '',
    activo: esquema.activo ?? true,
    pesos,
  };
}

// Resumen de una línea para la lista: con qué reparte y a quiénes alcanza.
export function resumenDeEsquema(esquema, etiquetaServicio = (v) => v) {
  const base = baseDe(esquema.base).label.split(' — ')[0];
  const alcance =
    esquema.alcance === 'SERVICIO'
      ? `servicio "${etiquetaServicio(esquema.alcanceValor)}"`
      : esquema.alcance === 'SECTOR'
        ? `sector "${esquema.alcanceValor}"`
        : esquema.alcance === 'SELECCION'
          ? 'unidades elegidas'
          : 'todas las unidades';
  return `${base} · ${alcance}`;
}
