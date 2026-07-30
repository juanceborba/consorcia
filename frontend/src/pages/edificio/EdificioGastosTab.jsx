// frontend/src/pages/edificio/EdificioGastosTab.jsx — ConsorcIA
// Tab "Gastos" del detalle de edificio (S3-07), según el mockup de
// PRD-04-02 §4.1: totalizador segmentado, barra de filtros, tabla (concepto /
// proveedor / monto / categoría / tipo / fecha / cargado por / período) y
// paginación server-side. Sigue los patrones de tabla de S2-08
// (EdificioUnidadesTab) y S3-14 (ProveedoresPage) y las reglas de listados de
// PRD-07-02 §6.2 (empty state y skeleton siempre).
//
// DECISIONES de S3-07:
//
// 1. RUTA: el tab vive en `/edificios/:id/gastos`, no en la sección top-level
//    `/gastos` que dibuja el árbol de rutas de PRD-07-03 §2.1. PRD-04-02 §3 es
//    explícito ("el tab `gastos` del detalle de edificio"), el endpoint está
//    scopeado por edificio (`/api/edificios/:id/gastos`) y el DoD del sprint
//    arranca en "login admin → tab gastos". Se aplica la convención "tabs como
//    rutas hijas" de PRD-07-03 §2.2; el árbol de §2.1 queda desactualizado y se
//    anota en el PRD como los casos de S2-07/S4-07. La vista consolidada de
//    `/gastos` a nivel organización es Business+ y llega con el dashboard
//    (S3-15/S3-16).
//
// 2. FILTROS EN LA URL (`useSearchParams`), no en estado local: PRD-07-03 §2.2
//    lo pide para los filtros de lista (`/gastos?periodo=2026-07&categoria=A`),
//    hace compartible/recargable la vista, y es el punto de enganche de S3-16,
//    que va a colgar el dashboard arriba de esta lista "compartiendo filtros vía
//    URL/search params". El default de período es el mes corriente (§4.1).
//    `periodo=todos` es el centinela de "sin filtro de período": la ausencia del
//    param significa "el default", no "todos", así que hacía falta distinguirlos.
//
// 3. SIN SORT POR COLUMNA. El backend fija el orden (`fechaGasto desc`, decisión
//    de S3-02) y pagina del lado del servidor: un sort client-side reordenaría
//    solo las 50 filas de la página en curso y mentiría sobre el conjunto. Es la
//    diferencia con la tabla de unidades de S2-08, que trae todo en una página y
//    por eso sí ordena en el cliente. El sort real es trabajo de backend
//    (`orderBy` en el contrato) y no está en el alcance de esta tarea.
//
// 4. La fila TOTAL usa `totales.monto` del backend (suma del filtro COMPLETO,
//    decisión 5 de S3-02), no la suma de la página. Por eso el pie no necesita
//    el disclaimer de "totales parciales" que sí tiene la tabla de unidades.
//
// 5. Moneda mixta: `totales.monto` suma sin discriminar `moneda` (el schema
//    admite ARS y USD y el agregado del backend no agrupa por moneda). Mientras
//    el filtro no tenga `moneda`, la fila TOTAL se rotula en ARS y, si la página
//    trae algún gasto en otra moneda, se muestra una nota advirtiendo que el
//    total mezcla monedas. Es lo honesto que se puede hacer sin tocar el
//    endpoint; el fix de fondo (agregado por moneda) es del dashboard, S3-15.
//
// 6. AGREGADO EN S3-08: la escritura. El botón "Nuevo gasto" y las acciones de
//    fila (editar / eliminar) solo aparecen para el org_admin: la policy
//    `gasto.yaml` le da al gestor únicamente `read` (decisión 1 de S3-02), así
//    que mostrarle los botones sería ofrecerle un 403. Las acciones de un gasto
//    ya liquidado van DESHABILITADAS con el motivo en el `title`, usando el
//    `editable` que trae cada fila (decisión 7 de S3-02): el DoD del sprint pide
//    que la UI lo impida, no que el usuario descubra el 409 recién después de
//    completar el formulario.
//
// DECISIONES de S3-08b (mejoras del listado):
//
// 7. LA TABLA PASA A `useReactTable` (@tanstack/react-table, headless) con los
//    componentes de tabla de shadcn, igual que ProveedoresPage: las columnas se
//    declaran en un solo lugar en vez de repetirse entre `<TableHead>` y
//    `<TableCell>`, que con ocho columnas ya se desincronizaba (el pie TOTAL
//    contaba celdas vacías a mano). El modelo de FILTRADO de react-table NO se
//    usa: filtra y pagina el backend (decisión 3), y duplicar ese estado en el
//    cliente sería una segunda fuente de verdad capaz de contradecir a la URL.
//
// 8. LOS FILTROS VIVEN EN UNA TOOLBAR, NO EN LA CABECERA DE LA TABLA. El primer
//    intento de S3-08b puso un control debajo de cada título de columna: con
//    siete filtros hay que angostar cada control hasta que deja de leerse
//    ("Todo⌄"), la tabla se va a scroll horizontal y la cabecera compite
//    visualmente con los datos, que son lo que la pantalla vino a mostrar. La
//    toolbar (`GastosFiltros`) invierte la relación — buscador y período a la
//    vista, el resto en un panel con contador, y chips de lo activo — y deja la
//    tabla limpia. El mecanismo no cambia: todo sigue en la URL (decisión 2).
//
// 9. EL TOTALIZADOR ESTÁ SEGMENTADO en total / ordinarios / extraordinarios, con
//    los tres números del backend (decisión 8 de S3-02) sobre el MISMO filtro,
//    así que siempre reconcilian. La distinción es del dominio: las expensas
//    ordinarias y las extraordinarias se liquidan y se leen por separado
//    (PRD-04-03), y "cuánto de este período es extraordinario" es la pregunta
//    que un administrador hace antes de liquidar. Es el antecesor de los KPI
//    cards de S3-16, que reemplazan este bloque cuando el tab pase a dashboard.
//
// 11. TRES TARJETAS MÁS, POR CATEGORÍA A/B/C, debajo del totalizador por tipo:
//     es la MISMA plata partida por el otro eje del dominio, y los dos ejes son
//     independientes (la categoría decide QUIÉNES pagan; ordinario/extraordinario
//     decide en qué subtotal cae y quién lo absorbe entre propietario e
//     inquilino). Cada tarjeta es además el atajo para filtrar la lista por esa
//     categoría, que es lo que uno quiere hacer justo después de leer el número.
//     El "quién paga" de cada tarjeta viene del reparto real del motor (S3-03) y
//     de la base legal del art. 2049 CCyC. Fundamentos y huecos abiertos en
//     `docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.
//
// 10. LA COLUMNA "CARGADO POR" ES TRAZABILIDAD, no adorno: varios gestores
//     cargan gastos del mismo edificio y "quién cargó esto" es la primera
//     pregunta cuando un monto no cierra. Se muestra abreviada ("María R.") con
//     el nombre completo en el `title`, porque el nombre entero se lleva el
//     ancho de una columna de datos.
import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useGastos } from '@/hooks/useGastos';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import GastoFormDialog from '@/components/gastos/GastoFormDialog';
import GastosFiltros from '@/components/gastos/GastosFiltros';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  formatearFechaCorta,
  formatearMonto,
  formatearPeriodo,
  nombreDeAutor,
  nombreDeAutorCorto,
  periodoActual,
  ultimosPeriodos,
} from '@/lib/formato';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Página del contrato de `listarGastosSchema` (default 50, máx 100).
const LIMIT = 50;

// Centinela de "sin filtro de período" (decisión 2).
const TODOS_LOS_PERIODOS = 'todos';

// Decisión 11: las tres categorías del dominio, con el reparto que implica cada
// una (PRD-04-02 §1.2 y art. 2049 CCyC último párrafo). El copy de "quién paga"
// es lo que hace que la tarjeta se entienda sin ir a la ayuda: el eje A/B/C
// decide QUIÉNES pagan, no si el gasto es ordinario o extraordinario.
const CATEGORIAS_DOMINIO = [
  { value: 'A', titulo: 'Generales', quienPaga: 'las pagan todas las UF' },
  { value: 'B', titulo: 'Servicios', quienPaga: 'solo las UF con el servicio' },
  { value: 'C', titulo: 'Sectores', quienPaga: 'solo las UF del sector' },
];

const columnHelper = createColumnHelper();

// Badge de la categoría con su detalle: A se reparte a todas las UF, B lleva el
// servicio y C el sector (invariantes de `incoherenciaCategoria` en el backend).
// Mismos tokens de dominio que las categorías de unidades (S2-05).
function CategoriaGasto({ gasto }) {
  const detalle =
    gasto.categoria === 'B'
      ? gasto.servicioEspecifico
      : gasto.categoria === 'C'
        ? gasto.sectorEspecifico
        : null;
  return (
    <Badge variant={`categoria${gasto.categoria}`}>
      {detalle ? `${gasto.categoria}: ${detalle}` : gasto.categoria}
    </Badge>
  );
}

// Skeleton de carga inicial (PRD-07-02 §6.2/§6.4): replica la estructura de la
// pantalla — totalizador, filtros y tabla —, igual que el de unidades.
function GastosSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-9 w-96 rounded bg-muted" />
        <div className="h-10 rounded bg-muted" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

// Decisión 11: las tres categorías, con el filtro que las aísla en la lista. El
// `onFiltro` hace que la tarjeta sea también el atajo para ver esos gastos, que
// es lo que uno quiere hacer justo después de leer el número.
function TarjetasPorCategoria({ totales, categoriaActiva, onFiltro }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CATEGORIAS_DOMINIO.map((categoria) => {
        const segmento = totales?.porCategoria?.[categoria.value];
        const activa = categoriaActiva === categoria.value;
        return (
          <button
            key={categoria.value}
            type="button"
            aria-pressed={activa}
            // El nombre accesible por defecto sería todo el contenido de la
            // tarjeta ("B SERVICIOS $ 45.000,00 1 gasto · …"): se declara qué
            // hace el control, que es filtrar.
            aria-label={`Filtrar por categoría ${categoria.value}`}
            className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50 ${
              activa ? 'border-ring ring-3 ring-ring/30' : ''
            }`}
            onClick={() =>
              onFiltro({ categoria: activa ? '' : categoria.value })
            }
          >
            <span className="flex items-center gap-2">
              <Badge variant={`categoria${categoria.value}`}>
                {categoria.value}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground uppercase">
                {categoria.titulo}
              </span>
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatearMonto(segmento?.monto ?? '0.00')}
            </span>
            <span className="text-xs text-muted-foreground">
              {segmento?.cantidad === 1
                ? '1 gasto'
                : `${segmento?.cantidad ?? 0} gastos`}
              {' · '}
              {categoria.quienPaga}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Decisión 9: total del filtro, partido en ordinarios y extraordinarios. Los
// tres números son del backend sobre el mismo `where`, así que la suma cierra.
function Totalizador({ totales }) {
  const segmentos = [
    {
      clave: 'total',
      titulo: 'Total del filtro',
      monto: totales?.monto ?? '0.00',
      cantidad: totales?.cantidad ?? 0,
      detalle: 'Ordinarios + extraordinarios',
    },
    {
      clave: 'ordinarios',
      titulo: 'Ordinarios',
      monto: totales?.ordinarios?.monto ?? '0.00',
      cantidad: totales?.ordinarios?.cantidad ?? 0,
      detalle: 'Expensas del mes a mes',
    },
    {
      clave: 'extraordinarios',
      titulo: 'Extraordinarios',
      monto: totales?.extraordinarios?.monto ?? '0.00',
      cantidad: totales?.extraordinarios?.cantidad ?? 0,
      detalle: 'Se liquidan aparte',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {segmentos.map((segmento) => (
        <div
          key={segmento.clave}
          className={`flex flex-col gap-1 rounded-lg border p-4 ${
            segmento.clave === 'total' ? 'bg-muted/40' : ''
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground uppercase">
            {segmento.titulo}
          </p>
          <p className="text-xl font-semibold tabular-nums">
            {formatearMonto(segmento.monto)}
          </p>
          <p className="text-xs text-muted-foreground">
            {segmento.cantidad === 1 ? '1 gasto' : `${segmento.cantidad} gastos`}
            {' · '}
            {segmento.detalle}
          </p>
        </div>
      ))}
    </div>
  );
}

// Empty state (§6.2): nunca tabla vacía sin mensaje. El copy distingue "no hay
// gastos todavía" de "los filtros no matchean", que son dos problemas distintos.
function EmptyState({ hayFiltros, onLimpiar, puedeEscribir, onNuevo }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Receipt className="size-8 text-muted-foreground" />
      <p className="font-medium">
        {hayFiltros
          ? 'Ningún gasto coincide con los filtros'
          : 'Este edificio todavía no tiene gastos'}
      </p>
      <p className="text-sm text-muted-foreground">
        {hayFiltros
          ? 'Revisá los filtros activos de arriba: se quitan de a uno o todos juntos.'
          : 'Cargá los gastos del período para poder liquidar las expensas.'}
      </p>
      {hayFiltros ? (
        <Button variant="outline" size="sm" onClick={onLimpiar}>
          Limpiar filtros
        </Button>
      ) : (
        puedeEscribir && (
          // El copy es distinto del botón del header a propósito: los dos están
          // en pantalla cuando el edificio no tiene gastos, y dos controles con
          // la misma etiqueta son ambiguos para un lector de pantalla (y para un
          // spec de Playwright).
          <Button className="mt-2" onClick={onNuevo}>
            <Plus className="size-4" />
            Cargar el primer gasto
          </Button>
        )
      )}
    </div>
  );
}

// Acciones de fila (decisión 6). Un gasto ya liquidado (`editable === false`)
// las tiene deshabilitadas con el motivo en el `title`: el backend responde 409
// y no hay forma de editarlo sin anular la liquidación primero.
function AccionesGasto({ gasto, onEditar, onEliminar }) {
  const congelado = gasto.editable === false;
  const motivo = congelado
    ? 'El gasto forma parte de una liquidación aprobada: para modificarlo hay que anularla'
    : undefined;
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Acciones de ${gasto.concepto}`}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={congelado}
              title={motivo}
              onClick={onEditar}
            >
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={congelado}
              title={motivo}
              onClick={onEliminar}
            >
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EstadoError() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Receipt className="size-8 text-muted-foreground" />
      <p className="font-medium">No se pudieron cargar los gastos</p>
      <p className="text-sm text-muted-foreground">Intentá de nuevo más tarde.</p>
    </div>
  );
}

export default function EdificioGastosTab() {
  const { edificio } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Decisión 6: el gestor solo lee (policy `gasto.yaml`).
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const puedeEscribir = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  const [altaOpen, setAltaOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [borrando, setBorrando] = useState(null);

  // El DELETE es un soft delete (`deletedAt`, Ley 941): el gasto desaparece de
  // la lista y de las liquidaciones futuras, pero sigue en la DB. El copy del
  // ConfirmDialog lo dice para no prometer un borrado que no ocurre.
  const bajaMutation = useMutation({
    mutationFn: (gasto) => api.del(`/api/gastos/${gasto.id}`),
    onSuccess: (_respuesta, gasto) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gastos.all });
      setBorrando(null);
      toast.success('Gasto eliminado', { description: gasto.concepto });
    },
    onError: (err) => {
      // El 409 llega si el gasto se liquidó mientras el diálogo estaba abierto.
      toast.error('No se pudo eliminar el gasto', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // El default del período es el mes corriente; los períodos ofrecidos son los
  // últimos 12 (PRD-04-02 §3.2). Se memoiza para que un re-render no genere una
  // lista nueva (y una key de query nueva) a medianoche o en cada paginación.
  const periodos = useMemo(() => ultimosPeriodos(12), []);
  const periodoDefault = periodos[0] ?? periodoActual();

  const periodo = searchParams.get('periodo') ?? periodoDefault;
  const categoria = searchParams.get('categoria') ?? '';
  const tipo = searchParams.get('tipo') ?? '';
  const proveedorId = searchParams.get('proveedorId') ?? '';
  const createdBy = searchParams.get('createdBy') ?? '';
  const desde = searchParams.get('desde') ?? '';
  const hasta = searchParams.get('hasta') ?? '';
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  // Un período elegido a mano que no esté entre los últimos 12 (link viejo,
  // filtro compartido) tiene que seguir siendo seleccionable en el combo.
  const opcionesPeriodo =
    periodo === TODOS_LOS_PERIODOS || periodos.includes(periodo)
      ? periodos
      : [periodo, ...periodos];

  const filtros = {
    periodo: periodo === TODOS_LOS_PERIODOS ? undefined : periodo,
    categoria: categoria || undefined,
    esOrdinario: tipo === '' ? undefined : tipo === 'ordinario',
    proveedorId: proveedorId || undefined,
    createdBy: createdBy || undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
    q: q || undefined,
    page,
    limit: LIMIT,
  };

  const { gastos, pagination, totales, cargando, refrescando, error } = useGastos(
    edificio.id,
    filtros,
  );

  // Todo cambio de filtro vuelve a la página 1: quedarse en la 3 tras filtrar
  // deja la tabla vacía sin que el usuario entienda por qué.
  function setFiltro(cambios) {
    setSearchParams((previos) => {
      const next = new URLSearchParams(previos);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === '' || valor === undefined) next.delete(clave);
        else next.set(clave, String(valor));
      }
      if (!('page' in cambios)) next.delete('page');
      return next;
    });
  }

  function limpiarFiltros() {
    setSearchParams(new URLSearchParams());
  }

  // Decisión 7: las columnas se declaran una vez. `meta.className` viaja a la
  // celda, a su cabecera y al pie, así la alineación no se repite en tres lugares.
  const columns = useMemo(() => {
    const definiciones = [
      columnHelper.accessor((g) => g, {
        id: 'concepto',
        header: 'Concepto',
        // S3-19: el rótulo "cuota k/N" va junto al concepto, igual que en el
        // recibo (PRD-06-01 §3.2). Solo aparece con un período filtrado, que es
        // cuando existe una cuota imputada de la que hablar.
        cell: (info) => {
          const gasto = info.getValue();
          return (
            <span className="flex max-w-56 flex-col" title={gasto.concepto}>
              <span className="truncate font-medium">{gasto.concepto}</span>
              {gasto.cuota && (
                <span className="text-xs text-muted-foreground">
                  cuota {gasto.cuota.numero}/{gasto.cuota.cuotasTotal}
                </span>
              )}
            </span>
          );
        },
      }),
      columnHelper.accessor((g) => g.proveedor?.razonSocial ?? '—', {
        id: 'proveedor',
        header: 'Proveedor',
        cell: (info) => (
          <span className="flex max-w-40 flex-col" title={info.getValue()}>
            <span className="truncate">{info.getValue()}</span>
            {info.row.original.proveedor?.activo === false && (
              <span className="text-xs text-muted-foreground">dado de baja</span>
            )}
          </span>
        ),
      }),
      columnHelper.accessor((g) => g, {
        id: 'monto',
        header: 'Monto',
        meta: { className: 'text-right tabular-nums' },
        // S3-19: con un período filtrado, el monto de la fila es el IMPUTADO a
        // ese período — el número que la liquidación va a repartir y el que suma
        // el total del filtro. En un gasto en cuotas el total de la factura queda
        // debajo, porque los dos importan: uno es lo que se cobra este mes, el
        // otro es lo que se le debe al proveedor.
        cell: (info) => {
          const gasto = info.getValue();
          const imputado = gasto.montoImputado ?? gasto.monto;
          return (
            <span className="flex flex-col">
              <span>{formatearMonto(imputado, gasto.moneda)}</span>
              {gasto.cuota && (
                <span className="text-xs font-normal text-muted-foreground">
                  de {formatearMonto(gasto.monto, gasto.moneda)}
                </span>
              )}
            </span>
          );
        },
      }),
      columnHelper.accessor((g) => g, {
        id: 'categoria',
        header: 'Categoría',
        cell: (info) => <CategoriaGasto gasto={info.getValue()} />,
      }),
      columnHelper.accessor('esOrdinario', {
        header: 'Tipo',
        cell: (info) => (info.getValue() ? 'Ordinario' : 'Extraordinario'),
      }),
      // dd-mm: el año ya lo fija el filtro de período. El `title` trae la fecha
      // completa para el caso raro en que el gasto sea de otro año que el período.
      columnHelper.accessor('fechaGasto', {
        header: 'Fecha',
        meta: { className: 'tabular-nums' },
        cell: (info) => (
          <span title={(info.getValue() ?? '').slice(0, 10)}>
            {formatearFechaCorta(info.getValue())}
          </span>
        ),
      }),
      // Decisión 10: nombre abreviado, completo en el `title`.
      columnHelper.accessor('creadoPor', {
        header: 'Cargado por',
        meta: { className: 'text-muted-foreground' },
        cell: (info) => (
          <span title={nombreDeAutor(info.getValue())}>
            {nombreDeAutorCorto(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('periodo', {
        header: 'Período',
        meta: { className: 'tabular-nums' },
      }),
    ];

    if (puedeEscribir) {
      definiciones.push(
        columnHelper.display({
          id: 'acciones',
          header: () => <span className="sr-only">Acciones</span>,
          // La columna de acciones queda PEGADA al borde derecho: si la tabla
          // scrollea horizontalmente en una pantalla chica (el contenedor de
          // `Table` ya tiene `overflow-x-auto`), el menú de la fila es lo primero
          // que quedaría fuera de vista.
          meta: { className: 'sticky right-0 bg-background' },
          cell: (info) => (
            <AccionesGasto
              gasto={info.row.original}
              onEditar={() => setEditando(info.row.original)}
              onEliminar={() => setBorrando(info.row.original)}
            />
          ),
        }),
      );
    }

    return definiciones;
  }, [puedeEscribir]);

  const table = useReactTable({
    data: gastos,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (cargando) return <GastosSkeleton />;
  if (error) return <EstadoError />;

  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  // "Con filtros" a los efectos del empty state: cualquier recorte por sobre el
  // default (el período corriente solo no cuenta como filtro elegido).
  const hayFiltros =
    categoria !== '' ||
    tipo !== '' ||
    proveedorId !== '' ||
    createdBy !== '' ||
    desde !== '' ||
    hasta !== '' ||
    q !== '' ||
    periodo !== periodoDefault;
  const hayMonedaExtranjera = gastos.some((g) => g.moneda !== 'ARS');
  // El nombre del proveedor filtrado sale de las filas en pantalla; el chip cae
  // a "elegido" cuando el filtro combinado deja la lista vacía.
  const proveedorNombre = gastos.find((g) => g.proveedorId === proveedorId)
    ?.proveedor?.razonSocial;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Gastos ({total})
          <AyudaLink variant="icon" topic="gastos/carga" />
        </CardTitle>
        <CardDescription>
          {periodo === TODOS_LOS_PERIODOS
            ? 'Todos los períodos'
            : formatearPeriodo(periodo)}
          {' · '}
          {total === 1 ? '1 gasto' : `${total} gastos`}
        </CardDescription>
        {puedeEscribir && (
          <CardAction>
            <Button onClick={() => setAltaOpen(true)}>
              <Plus className="size-4" />
              Nuevo gasto
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Decisión 9: el totalizador del filtro activo, segmentado por tipo. */}
        <Totalizador totales={totales} />

        {/* Decisión 11: el MISMO total partido por el otro eje (A/B/C). Cada
            tarjeta filtra la lista por su categoría. */}
        <TarjetasPorCategoria
          totales={totales}
          categoriaActiva={categoria}
          onFiltro={setFiltro}
        />

        {/* Decisión 8: toolbar, no filtros dentro de la tabla. */}
        <GastosFiltros
          filtros={{
            periodo,
            categoria,
            tipo,
            proveedorId,
            proveedorNombre,
            createdBy,
            desde,
            hasta,
            q,
          }}
          periodos={opcionesPeriodo}
          todosLosPeriodos={TODOS_LOS_PERIODOS}
          puedeVerAutores={puedeEscribir}
          onFiltro={setFiltro}
          onLimpiar={limpiarFiltros}
        />

        {gastos.length === 0 ? (
          <EmptyState
            hayFiltros={hayFiltros}
            onLimpiar={limpiarFiltros}
            puedeEscribir={puedeEscribir}
            onNuevo={() => setAltaOpen(true)}
          />
        ) : (
          <>
            {/* `refrescando` = está trayendo otra página o el resultado de un
                filtro nuevo con el anterior en pantalla (keepPreviousData): se
                atenúa para que el cambio se note. */}
            <div className={refrescando ? 'opacity-60 transition-opacity' : undefined}>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((grupo) => (
                    <TableRow key={grupo.id}>
                      {grupo.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className={header.column.columnDef.meta?.className}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>

                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cell.column.columnDef.meta?.className}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>

                {/* Decisión 4: el TOTAL es del filtro completo (backend). Las
                    celdas del pie se generan de las columnas visibles, así que
                    agregar una columna no lo descoloca. */}
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    {table.getVisibleLeafColumns().map((columna, indice) => (
                      <TableCell
                        key={columna.id}
                        className={`font-semibold ${
                          columna.columnDef.meta?.className ?? ''
                        }`}
                      >
                        {indice === 0 ? 'TOTAL' : null}
                        {columna.id === 'monto'
                          ? formatearMonto(totales?.monto ?? '0.00')
                          : null}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {/* Decisión 5: el agregado del backend no discrimina moneda. */}
            {hayMonedaExtranjera && (
              <p className="text-xs text-warning-hover">
                Hay gastos en más de una moneda: el TOTAL las suma sin convertir.
              </p>
            )}

            {/* Paginación server-side (§4.1) */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Página {page} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setFiltro({ page: page - 1 })}
                  >
                    <ChevronLeft className="size-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setFiltro({ page: page + 1 })}
                  >
                    Siguiente
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Alta y edición comparten el diálogo; se montan por separado para que
          `gasto` no cambie de null a un objeto sobre el mismo form abierto. */}
      {puedeEscribir && (
        <>
          <GastoFormDialog
            edificio={edificio}
            isOpen={altaOpen}
            onClose={() => setAltaOpen(false)}
          />

          <GastoFormDialog
            edificio={edificio}
            gasto={editando}
            isOpen={editando !== null}
            onClose={() => setEditando(null)}
          />

          <ConfirmDialog
            isOpen={borrando !== null}
            onClose={() => setBorrando(null)}
            onConfirm={() => bajaMutation.mutate(borrando)}
            loading={bajaMutation.isPending}
            title="Eliminar el gasto"
            variant="danger"
            confirmText="Eliminar"
            description={
              borrando
                ? `"${borrando.concepto}" (${formatearMonto(borrando.monto, borrando.moneda)}) deja de contarse en la liquidación del período. El registro se conserva en el sistema porque los gastos son documentación del consorcio (Ley 941).`
                : ''
            }
          />
        </>
      )}
    </Card>
  );
}
