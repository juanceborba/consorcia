// frontend/src/pages/edificio/EdificioGastosTab.jsx — ConsorcIA
// Tab "Gastos" del detalle de edificio (S3-07), según el mockup de
// PRD-04-02 §4.1: columnas concepto / proveedor / monto / categoría / tipo /
// fecha / cargado por / período, totalizador segmentado arriba, filtros por
// columna y paginación server-side. Sigue los patrones de tabla de S2-08
// (EdificioUnidadesTab) y las reglas de listados de PRD-07-02 §6.2 (empty state
// y skeleton siempre).
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
// 7. LOS FILTROS VIVEN EN LA CABECERA DE SU COLUMNA, no en una barra suelta
//    arriba. Con ocho columnas, una barra deja de decir QUÉ filtra cada control
//    (el usuario tiene que adivinar si "Todas" es categoría o tipo); debajo del
//    título de la columna, el control se explica solo. El mecanismo no cambia:
//    cada uno sigue escribiéndose en la URL (decisión 2). Las columnas sin
//    filtro posible (monto) quedan con la celda vacía a propósito, para no
//    prometer un filtro que el endpoint no tiene.
//
// 8. EL BUSCADOR DE CONCEPTO TIENE DEBOUNCE (300 ms), como el de proveedores de
//    S3-14: sin él cada tecla dispara una query paginada al backend. El estado
//    tipeado es local y solo llega a la URL cuando se calma, así que el historial
//    del browser no se llena de una entrada por letra.
//
// 9. EL TOTALIZADOR ESTÁ SEGMENTADO en total / ordinarios / extraordinarios, con
//    los tres números del backend (decisión 8 de S3-02) sobre el MISMO filtro,
//    así que siempre reconcilian. La distinción es del dominio: las expensas
//    ordinarias y las extraordinarias se liquidan y se leen por separado
//    (PRD-04-03), y "cuánto de este período es extraordinario" es la pregunta
//    que un administrador hace antes de liquidar. Es el antecesor de los KPI
//    cards de S3-16, que reemplazan este bloque cuando el tab pase a dashboard.
//
// 10. LA COLUMNA "CARGADO POR" Y SU FILTRO SON TRAZABILIDAD, no adorno: varios
//     gestores cargan gastos del mismo edificio y "quién cargó esto" es la
//     primera pregunta cuando un monto no cierra. El filtro se ofrece solo al
//     org_admin porque su combo se alimenta de la nómina de staff
//     (`/api/organizaciones/me/usuarios`), que al gestor le responde 403 — la
//     COLUMNA, en cambio, la ve todo el staff.
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Receipt, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useGastos } from '@/hooks/useGastos';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import GastoFormDialog from '@/components/gastos/GastoFormDialog';
import ProveedorSelect from '@/components/gastos/ProveedorSelect';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

// Decisión 11: la columna de acciones queda PEGADA al borde derecho. Con nueve
// columnas y una fila de filtros, la tabla scrollea horizontalmente en pantallas
// de ~1280px (el contenedor de `Table` ya tiene `overflow-x-auto`), y el menú de
// la fila es lo último que puede quedar fuera de vista: sin esto, editar un
// gasto exige scrollear a la derecha en cada fila.
const CELDA_ACCIONES = 'sticky right-0 bg-background';

// Centinela de "sin filtro de período" (decisión 2).
const TODOS_LOS_PERIODOS = 'todos';

// Etiquetas CORTAS a propósito (decisión 7): el filtro vive debajo del título de
// su columna, que ya dice "Categoría" y "Tipo", y ocho controles con etiquetas
// largas mandan la tabla a scroll horizontal. El significado completo de A/B/C
// está en el badge de cada fila y en la ayuda contextual.
const CATEGORIAS = [
  { value: '', label: 'Todas' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
];

const TIPOS = [
  { value: '', label: 'Todos' },
  { value: 'ordinario', label: 'Ordinario' },
  { value: 'extraordinario', label: 'Extraord.' },
];

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
// pantalla — el totalizador y la tabla —, igual que el de unidades.
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
        <div className="h-10 rounded bg-muted" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
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
          ? 'Probá con otro período o quitá los filtros de las columnas.'
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

  // Decisión 8: lo tipeado es estado local y llega a la URL con debounce.
  const [busqueda, setBusqueda] = useState(q);
  useEffect(() => {
    if (busqueda === q) return undefined;
    const timer = setTimeout(() => setFiltro({ q: busqueda }), 300);
    return () => clearTimeout(timer);
    // `setFiltro` es estable (solo usa el setter de searchParams) y `q` entra
    // para no reescribir la URL con lo que ya dice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, q]);

  // Decisión 10: la nómina de staff alimenta el filtro "Cargado por" y solo el
  // org_admin puede leerla.
  const { data: staff } = useQuery({
    queryKey: queryKeys.organizaciones.staff(),
    queryFn: () => api.get('/api/organizaciones/me/usuarios'),
    enabled: puedeEscribir,
  });
  const autores = staff ?? [];

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
    setBusqueda('');
    setSearchParams(new URLSearchParams());
  }

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
        {/* Decisión 9: el totalizador del filtro activo, segmentado. */}
        <Totalizador totales={totales} />

        {hayFiltros && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
              Limpiar filtros
            </Button>
          </div>
        )}

        {gastos.length === 0 && !hayFiltros ? (
          <EmptyState
            hayFiltros={false}
            onLimpiar={limpiarFiltros}
            puedeEscribir={puedeEscribir}
            onNuevo={() => setAltaOpen(true)}
          />
        ) : (
          <>
            {/* `refrescando` = está trayendo otra página o el resultado de un
                filtro nuevo con el anterior en pantalla (keepPreviousData): se
                atenúa para que el cambio se note. La tabla se renderiza incluso
                sin filas cuando hay filtros, porque sus cabeceras SON los
                filtros (decisión 7) y esconderlas dejaría al usuario sin forma
                de corregir el filtro que vació la lista. */}
            <div className={refrescando ? 'opacity-60 transition-opacity' : undefined}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cargado por</TableHead>
                    <TableHead>Período</TableHead>
                    {puedeEscribir && (
                      <TableHead className={CELDA_ACCIONES}>
                        <span className="sr-only">Acciones</span>
                      </TableHead>
                    )}
                  </TableRow>

                  {/* Decisión 7: un filtro por columna, debajo de su título. */}
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="align-top">
                      <div className="relative w-full min-w-36">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="filtro-concepto"
                          className="h-9 w-full min-w-0 pl-8"
                          placeholder="Buscar concepto"
                          autoComplete="off"
                          aria-label="Filtrar por concepto"
                          value={busqueda}
                          onChange={(e) => setBusqueda(e.target.value)}
                        />
                      </div>
                    </TableHead>

                    <TableHead className="align-top">
                      {/* Reusa el combobox del form de gasto (S3-14): el
                          directorio se pagina y no cabe en un <select>. Sin
                          alta inline — crear un proveedor desde un filtro no
                          tiene sentido. */}
                      <div className="w-full min-w-40 font-normal">
                        <ProveedorSelect
                          id="filtro-proveedor"
                          value={proveedorId}
                          permitirAlta={false}
                          onChange={(valor) => setFiltro({ proveedorId: valor })}
                        />
                      </div>
                    </TableHead>

                    {/* El endpoint no filtra por monto: la celda queda vacía en
                        vez de prometer un control que no existe. */}
                    <TableHead />

                    <TableHead className="align-top">
                      <Select
                        id="filtro-categoria"
                        className="h-9 w-20 font-normal"
                        aria-label="Filtrar por categoría"
                        value={categoria}
                        onChange={(e) => setFiltro({ categoria: e.target.value })}
                      >
                        {CATEGORIAS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    </TableHead>

                    <TableHead className="align-top">
                      <Select
                        id="filtro-tipo"
                        className="h-9 w-28 font-normal"
                        aria-label="Filtrar por tipo"
                        value={tipo}
                        onChange={(e) => setFiltro({ tipo: e.target.value })}
                      >
                        {TIPOS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </TableHead>

                    {/* La fecha filtra por rango (`desde`/`hasta` del endpoint):
                        un solo día casi nunca es lo que se busca. */}
                    <TableHead className="align-top">
                      <div className="flex w-30 flex-col gap-1 font-normal">
                        <Label htmlFor="filtro-desde" className="sr-only">
                          Desde
                        </Label>
                        <Input
                          id="filtro-desde"
                          type="date"
                          className="h-9 w-30 min-w-0 px-1.5"
                          title="Desde"
                          value={desde}
                          onChange={(e) => setFiltro({ desde: e.target.value })}
                        />
                        <Label htmlFor="filtro-hasta" className="sr-only">
                          Hasta
                        </Label>
                        <Input
                          id="filtro-hasta"
                          type="date"
                          className="h-9 w-30 min-w-0 px-1.5"
                          title="Hasta"
                          value={hasta}
                          onChange={(e) => setFiltro({ hasta: e.target.value })}
                        />
                      </div>
                    </TableHead>

                    <TableHead className="align-top">
                      {/* Decisión 10: solo el org_admin lee la nómina. */}
                      {puedeEscribir && (
                        <Select
                          id="filtro-autor"
                          className="h-9 w-28 font-normal"
                          aria-label="Filtrar por quién lo cargó"
                          value={createdBy}
                          onChange={(e) => setFiltro({ createdBy: e.target.value })}
                        >
                          <option value="">Todos</option>
                          {autores.map((autor) => (
                            <option key={autor.id} value={autor.id}>
                              {nombreDeAutor(autor)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </TableHead>

                    <TableHead className="align-top">
                      <Select
                        id="filtro-periodo"
                        className="h-9 w-28 font-normal"
                        aria-label="Filtrar por período"
                        value={periodo}
                        onChange={(e) => setFiltro({ periodo: e.target.value })}
                      >
                        {opcionesPeriodo.map((p) => (
                          <option key={p} value={p} title={formatearPeriodo(p)}>
                            {p}
                          </option>
                        ))}
                        <option value={TODOS_LOS_PERIODOS}>Todos</option>
                      </Select>
                    </TableHead>

                    {puedeEscribir && <TableHead className={CELDA_ACCIONES} />}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {gastos.map((gasto) => (
                    <TableRow key={gasto.id}>
                      <TableCell className="font-medium">
                        <span
                          className="block max-w-48 truncate"
                          title={gasto.concepto}
                        >
                          {gasto.concepto}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="flex max-w-36 flex-col"
                          title={gasto.proveedor?.razonSocial ?? undefined}
                        >
                          <span className="truncate">
                            {gasto.proveedor?.razonSocial ?? '—'}
                          </span>
                          {gasto.proveedor?.activo === false && (
                            <span className="text-xs text-muted-foreground">
                              dado de baja
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatearMonto(gasto.monto, gasto.moneda)}
                      </TableCell>
                      <TableCell>
                        <CategoriaGasto gasto={gasto} />
                      </TableCell>
                      <TableCell
                        title={gasto.esOrdinario ? 'Ordinario' : 'Extraordinario'}
                      >
                        {gasto.esOrdinario ? 'Ordinario' : 'Extraord.'}
                      </TableCell>
                      {/* dd-mm: el año ya lo fija el filtro de período. El
                          título trae la fecha completa para el caso raro en que
                          el gasto sea de otro año que el período. */}
                      <TableCell
                        className="tabular-nums"
                        title={(gasto.fechaGasto ?? '').slice(0, 10)}
                      >
                        {formatearFechaCorta(gasto.fechaGasto)}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={nombreDeAutor(gasto.creadoPor)}
                      >
                        {nombreDeAutorCorto(gasto.creadoPor)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {gasto.periodo}
                      </TableCell>
                      {puedeEscribir && (
                        <TableCell className={CELDA_ACCIONES}>
                          <AccionesGasto
                            gasto={gasto}
                            onEditar={() => setEditando(gasto)}
                            onEliminar={() => setBorrando(gasto)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}

                  {/* Con filtros que no matchean, la tabla se queda con sus
                      cabeceras (que son los filtros) y el vacío se explica acá. */}
                  {gastos.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={puedeEscribir ? 9 : 8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Ningún gasto coincide con los filtros de las columnas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>

                {/* Decisión 4: el TOTAL es del filtro completo (backend). */}
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold">TOTAL</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatearMonto(totales?.monto ?? '0.00')}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    {puedeEscribir && <TableCell className={CELDA_ACCIONES} />}
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
