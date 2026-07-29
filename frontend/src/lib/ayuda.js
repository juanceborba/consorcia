// frontend/src/lib/ayuda.js — ConsorcIA
// Registro estático de topics de ayuda contextual (S2 refinamiento #57, patrón
// nuevo de PRD-07-02). Es el núcleo del "módulo de FAQ": un mapa de topics que
// cualquier pantalla abre con `AyudaLink topic="..."` o el store de ayuda,
// y un único drawer global (AyudaDrawer, montado en AppLayout) que lo muestra.
//
// CÓMO AGREGAR UN TOPIC NUEVO:
//   1. Elegí un ID estable con formato de path (segmentos con slash, p. ej.
//      'gastos/categorias' o 'edificios/unidades/coeficientes'). El ID es el
//      contrato con los consumidores: no se renombra una vez publicado.
//   2. Agregá una entrada en AYUDA_TOPICS con:
//        ruta: breadcrumb legible (array, se muestra con ›),
//        titulo: título del drawer,
//        secciones: [{ titulo, cuerpo, items? }] — items es una lista opcional
//        de viñetas.
//   3. En la pantalla, renderizá <AyudaLink topic="tu/id" /> (o llamá
//      abrirAyuda('tu/id') del store).
// Un topic inexistente NUNCA rompe la UI: el drawer muestra un fallback.
//
// El contenido vive estático en el frontend (todo el copy es es-AR
// hardcodeado, no hay infra de contenido ni i18n). La evolución a FAQ
// completo (hub /ayuda, búsqueda, deep links, markdown) es aditiva: cambia
// los internals de este registro, no la API que consumen los componentes.

export const AYUDA_TOPICS = {
  // Primer topic: categorías A/B/C del alta de unidad (Ley 941,
  // PRD-04-01 §1.4). El reparto que describe es el del motor de liquidación
  // de S3 (S3-03: A → todas las UF, B → UF con ese servicio, C → UF del sector).
  'edificios/unidades/categorias-gastos': {
    ruta: ['Edificios', 'Unidades', 'Categorías de gastos'],
    titulo: 'Categorías de gastos',
    secciones: [
      {
        titulo: '¿Qué son las categorías de gastos?',
        cuerpo:
          'Cada unidad funcional se clasifica en tres categorías (A, B y C) que determinan qué gastos del consorcio le corresponde pagar. Se define una sola vez, al dar de alta la unidad, y el motor de liquidación la usa todos los meses para repartir los gastos del período.',
      },
      {
        titulo: 'Categoría A — Gastos generales',
        cuerpo:
          'Son los gastos que afectan a todo el consorcio, sin importar la ubicación o el uso de la unidad. Al liquidar se reparten entre TODAS las unidades, cada una en proporción a su coeficiente. Casi siempre todas las unidades tienen la categoría A marcada.',
        items: [
          'Sueldos y cargas sociales del encargado',
          'Seguros del edificio',
          'ABL y tasas municipales',
          'Limpieza y mantenimiento de espacios comunes',
        ],
      },
      {
        titulo: 'Categoría B — Servicios específicos',
        cuerpo:
          'Son servicios que solo usan algunas unidades. Se marca servicio por servicio y la unidad paga únicamente los que tiene tildados. Al liquidar, un gasto de categoría B se reparte solo entre las unidades que tienen ese servicio, en proporción a su coeficiente.',
        items: [
          'Ascensor (el reglamento suele exceptuar a planta baja y locales)',
          'Calefacción central',
          'Agua caliente central',
        ],
      },
      {
        titulo: 'Categoría C — Sectores',
        cuerpo:
          'Agrupa unidades que comparten un gasto propio de su sector. Se escribe el nombre del sector (por ejemplo "pileta" o "torre-a") y todas las unidades con el mismo nombre pagan juntas esos gastos. Al liquidar, un gasto de categoría C se reparte solo entre las unidades de ese sector, en proporción a su coeficiente.',
        items: ['Pileta', 'Torre A / Torre B', 'Sector comercial'],
      },
      {
        titulo: 'Cómo se reparten los gastos al liquidar',
        cuerpo:
          'Al liquidar las expensas del mes, el motor de liquidación toma cada gasto cargado y lo distribuye según su categoría: los de A entre todas las unidades, los de B solo entre las que tienen ese servicio y los de C solo entre las del sector — siempre en proporción al coeficiente de cada unidad. Por eso conviene clasificar bien desde el alta: una categoría mal puesta hace que una unidad pague de más o de menos todos los meses.',
      },
      {
        titulo: '¿Cuándo conviene cada una?',
        items: [
          'Dejá la categoría A marcada salvo que el reglamento exceptúe a la unidad de los gastos generales (poco frecuente).',
          'Usá B cuando un servicio no llega a todas las unidades: el caso típico es el ascensor, que planta baja y locales no usan.',
          'Usá C cuando el edificio tiene sectores con gastos propios (torres, pileta, sector comercial). Escribí el nombre del sector igual en todas las unidades que lo comparten.',
        ],
      },
    ],
  },
};

// Devuelve el topic o null si no existe (el drawer muestra el fallback).
export function getAyudaTopic(path) {
  return AYUDA_TOPICS[path] ?? null;
}
