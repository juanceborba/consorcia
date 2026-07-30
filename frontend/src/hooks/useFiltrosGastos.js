// frontend/src/hooks/useFiltrosGastos.js — ConsorcIA
// Los filtros del módulo de gastos, en la URL, para las DOS vistas que los
// comparten (S3-16): el dashboard (PRD-04-02 §3.2) y el listado (§4.1).
//
// POR QUÉ UN HOOK Y NO EL ESTADO SUELTO EN CADA PANTALLA: desde S3-16 los mismos
// search params alimentan dos requests con contratos distintos — el listado
// (`listarGastosSchema`) y el dashboard (`dashboardGastosSchema`) —, y los dos
// tienen que leer EXACTAMENTE el mismo filtro o la pantalla se contradice a sí
// misma (los KPIs de un período y la tabla de otro). Acá se traduce una sola vez
// la URL a las dos queries. La misma traducción la usan el tab del edificio y el
// reporte consolidado de la organización.
//
// DECISIONES:
//
// 1. LOS TRES MODOS DE PERÍODO SON EXCLUYENTES, Y LA UI LOS MANTIENE ASÍ.
//    `dashboardGastosSchema` responde `422 VALIDACION_FALLIDA` si llegan
//    combinados (precisión 2 de PRD-04-02 §3.4), mientras que el listado sí los
//    acepta juntos: hasta S3-08b el rango de fechas era un filtro más del panel
//    y convivía con el período. Sin este hook, elegir un rango con el período
//    puesto rompía el dashboard con un 422 mientras la tabla seguía andando.
//    Por eso `setFiltro` es el que garantiza la exclusión: fijar un período
//    borra el rango y fijar un rango borra el período. Un solo lugar donde vive
//    la invariante, en vez de cada control acordándose de limpiar al otro.
//
// 2. `periodo=todos` ES EL CENTINELA DE "TODO EL PERÍODO" (viene de S3-07): la
//    AUSENCIA del param significa "el default" (el mes corriente), no "todos",
//    así que hacían falta dos valores distinguibles. Se traduce a `?todo=1` para
//    el dashboard y a la ausencia de `periodo` para el listado.
//
// 3. EL TIPO (ordinario/extraordinario) NO VIAJA AL DASHBOARD. Es deliberado del
//    contrato (precisión 3 de §3.4): el KPI ordinarias/extraordinarias ES el
//    corte por ese eje, y filtrarlo dejaría el otro subtotal en cero. La
//    consecuencia visible es que con el tipo activo los KPIs no coinciden con la
//    fila TOTAL de la tabla, y eso lo avisa la UI (`GastosKpis`), no se esconde.
//
// 4. `page` NO ES UN FILTRO: es paginación del listado y no existe en el
//    dashboard. Cualquier cambio de filtro la resetea, porque quedarse en la
//    página 3 después de filtrar deja la tabla vacía sin motivo aparente.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { periodoActual, ultimosPeriodos } from '@/lib/formato';

// Centinela de "sin filtro de período" (decisión 2).
export const TODOS_LOS_PERIODOS = 'todos';

// Página del contrato de `listarGastosSchema` (default 50, máx 100).
export const LIMIT_LISTA = 50;

// Los params que son filtro (todo lo que no es paginación). El orden es el que
// usan los chips.
const CLAVES_DE_FILTRO = [
  'q',
  'periodo',
  'desde',
  'hasta',
  'categoria',
  'tipo',
  'proveedorId',
  'rubroId',
  'createdBy',
];

export function useFiltrosGastos() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Los períodos ofrecidos son los últimos 12 (§3.2) y el default es el mes
  // corriente (§4.1). Se memoiza para que un re-render no genere una lista nueva
  // —y una key de query nueva— a medianoche o en cada paginación.
  const periodos = useMemo(() => ultimosPeriodos(12), []);
  const periodoDefault = periodos[0] ?? periodoActual();

  const valores = {
    periodo: searchParams.get('periodo') ?? periodoDefault,
    desde: searchParams.get('desde') ?? '',
    hasta: searchParams.get('hasta') ?? '',
    categoria: searchParams.get('categoria') ?? '',
    tipo: searchParams.get('tipo') ?? '',
    proveedorId: searchParams.get('proveedorId') ?? '',
    rubroId: searchParams.get('rubroId') ?? '',
    createdBy: searchParams.get('createdBy') ?? '',
    q: searchParams.get('q') ?? '',
    page: Math.max(1, Number(searchParams.get('page')) || 1),
  };

  // Decisión 1: el modo sale de lo que hay en la URL. El rango gana si está
  // presente porque `setFiltro` ya garantiza que no convive con un período; un
  // link viejo con las dos cosas se lee como rango en vez de romper con un 422.
  const modoPeriodo =
    valores.desde || valores.hasta
      ? 'rango'
      : valores.periodo === TODOS_LOS_PERIODOS
        ? 'todo'
        : 'periodo';

  // Un período elegido a mano que no esté entre los últimos 12 (link viejo,
  // filtro compartido) tiene que seguir siendo seleccionable en el combo.
  const opcionesPeriodo =
    modoPeriodo !== 'periodo' || periodos.includes(valores.periodo)
      ? periodos
      : [valores.periodo, ...periodos];

  // Decisión 4: todo cambio de filtro vuelve a la página 1.
  const setFiltro = useCallback(
    (cambios) => {
      setSearchParams((previos) => {
        const next = new URLSearchParams(previos);
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor === '' || valor === undefined || valor === null) {
            next.delete(clave);
          } else {
            next.set(clave, String(valor));
          }
        }

        // Decisión 1: la exclusión de los modos vive acá.
        if (cambios.periodo) {
          next.delete('desde');
          next.delete('hasta');
        } else if (cambios.desde || cambios.hasta) {
          next.delete('periodo');
        }

        if (!('page' in cambios)) next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const limpiar = useCallback(() => setSearchParams(new URLSearchParams()), [
    setSearchParams,
  ]);

  // Lo común a las dos queries. Los vacíos NO viajan: cada contrato valida el
  // param si está presente, así que un `categoria=` vacío sería un 422.
  const comunes = {
    categoria: valores.categoria || undefined,
    proveedorId: valores.proveedorId || undefined,
    rubroId: valores.rubroId || undefined,
    createdBy: valores.createdBy || undefined,
    q: valores.q || undefined,
  };

  const filtrosLista = {
    ...comunes,
    // El listado no tiene modo `todo`: la ausencia de `periodo` ya es "todos".
    periodo: modoPeriodo === 'periodo' ? valores.periodo : undefined,
    desde: valores.desde || undefined,
    hasta: valores.hasta || undefined,
    esOrdinario: valores.tipo === '' ? undefined : valores.tipo === 'ordinario',
    page: valores.page,
    limit: LIMIT_LISTA,
  };

  // Decisión 3: sin `tipo`. Decisiones 1 y 2: un modo y uno solo.
  const filtrosDashboard = {
    ...comunes,
    ...(modoPeriodo === 'periodo'
      ? { periodo: valores.periodo }
      : modoPeriodo === 'rango'
        ? { desde: valores.desde || undefined, hasta: valores.hasta || undefined }
        : { todo: true }),
  };

  // "Con filtros" a los efectos de los empty states y de "Limpiar todo":
  // cualquier recorte por sobre el default (el mes corriente solo no cuenta como
  // filtro elegido).
  const hayFiltros = CLAVES_DE_FILTRO.some((clave) =>
    clave === 'periodo'
      ? valores.periodo !== periodoDefault
      : Boolean(valores[clave]),
  );

  return {
    valores,
    modoPeriodo,
    periodoDefault,
    opcionesPeriodo,
    filtrosLista,
    filtrosDashboard,
    hayFiltros,
    setFiltro,
    limpiar,
  };
}
