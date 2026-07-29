// frontend/src/pages/edificio/EdificioUnidadesTab.jsx — ConsorcIA
// Tab "Unidades" del detalle de edificio (S2-08): DataTable con TanStack
// Table según PRD-07-02 §3.5 — sort por número/tipo/m²/coeficiente, fila
// TOTAL al pie (Σm² y Σcoeficiente en 6 decimales, success si cierra en
// 1.000000 / warning si no), badges de categorías A/B/C (tokens S2-05),
// empty state (§6.2) y skeleton de carga. Desde #57 el header tiene dos
// botones, uno por flujo de alta (S2-09): "Agregar unidad" abre el alta
// individual (UnidadAltaDialog, con tab de categorías A/B/C) y "Carga rápida"
// abre la grilla bulk (UnidadBulkDialog).
//
// Invariante de coeficientes (#57): es INFORMATIVA. Si Σ≠1 no se bloquea nada;
// se muestra un Alert warning arriba de la tabla ("Faltan/Sobran X…") y la fila
// TOTAL pasa a warning. La suma la calcula el backend con decimal.js y viene en
// `coeficientes: { suma, delta, cuadra }` de la respuesta del listado — no se
// recalcula en cliente (evita divergencias de float y de paginación).
//
// Datos: GET /api/edificios/:id/unidades con TanStack Query
// (queryKeys.edificios.unidades). El contrato pagina (?page=&limit=, máx
// 100); se pide el límite máximo en una sola página para poder mostrar todas
// las filas. El Σm² del pie sí es del set traído (si el edificio supera las
// 100 unidades el pie aclara que es parcial); el Σcoeficiente nunca lo es,
// porque el backend lo calcula sobre todas las unidades del edificio.
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Plus,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import ResidentesDrawer from '@/pages/edificio/ResidentesDrawer';
import UnidadAltaDialog from '@/pages/edificio/UnidadAltaDialog';
import UnidadBulkDialog from '@/pages/edificio/UnidadBulkDialog';
import AyudaLink from '@/components/ayuda/AyudaLink';
import { Alert } from '@/components/ui/alert';
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

const columnHelper = createColumnHelper();

// Coeficiente SIEMPRE con 6 decimales (Decimal(10,6) del schema).
function formatearCoeficiente(coeficiente) {
  return coeficiente.toFixed(6);
}

function formatearM2(m2) {
  return m2.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Categorías de distribución de gastos (Ley 941): A = gastos generales,
// B = servicios específicos (lista), C = sector específico. Badges con las
// variantes de dominio de S2-05.
function CategoriasUnidad({ unidad }) {
  const badges = [];
  if (unidad.categoriaA) badges.push({ key: 'A', variante: 'categoriaA', texto: 'A' });
  for (const b of unidad.categoriaB ?? []) {
    badges.push({ key: `B-${b}`, variante: 'categoriaB', texto: `B: ${b}` });
  }
  if (unidad.categoriaC) {
    badges.push({ key: 'C', variante: 'categoriaC', texto: `C: ${unidad.categoriaC}` });
  }
  if (badges.length === 0) return <span>—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map(({ key, variante, texto }) => (
        <Badge key={key} variant={variante}>
          {texto}
        </Badge>
      ))}
    </span>
  );
}

// Header clickeable para columnas sorteables (PRD-07-02 §3.5). Muestra la
// dirección actual del sort o un ícono neutro si la columna no está ordenada.
function HeaderSorteable({ column, titulo, alignRight = false }) {
  const direccion = column.getIsSorted(); // false | 'asc' | 'desc'
  const Icono =
    direccion === 'asc' ? ArrowUp : direccion === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={`flex w-full cursor-pointer items-center gap-1 font-medium ${
        alignRight ? 'justify-end' : ''
      }`}
    >
      {titulo}
      <Icono
        className={`size-3.5 ${direccion ? 'text-foreground' : 'text-muted-foreground'}`}
      />
    </button>
  );
}

// Las columnas se arman con una factory porque la de acciones necesita el
// callback que abre el panel de residentes (S4-08).
const crearColumnas = (onVerResidentes) => [
  columnHelper.accessor('numero', {
    header: ({ column }) => <HeaderSorteable column={column} titulo="Número" />,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('tipo', {
    header: ({ column }) => <HeaderSorteable column={column} titulo="Tipo" />,
    cell: (info) => {
      const tipo = info.getValue();
      return tipo.charAt(0).toUpperCase() + tipo.slice(1);
    },
  }),
  // m2 y coeficiente vienen como strings (Decimal de Prisma serializado);
  // el accessor los convierte a número para que el sort sea numérico.
  columnHelper.accessor((unidad) => Number(unidad.m2), {
    id: 'm2',
    header: ({ column }) => (
      <HeaderSorteable column={column} titulo="m²" alignRight />
    ),
    cell: (info) => (
      <span className="flex justify-end">{formatearM2(info.getValue())}</span>
    ),
  }),
  columnHelper.accessor((unidad) => Number(unidad.coeficiente), {
    id: 'coeficiente',
    header: ({ column }) => (
      <HeaderSorteable column={column} titulo="Coeficiente" alignRight />
    ),
    cell: (info) => (
      <span className="flex justify-end tabular-nums">
        {formatearCoeficiente(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor((unidad) => unidad, {
    id: 'categorias',
    header: 'Categorías',
    enableSorting: false,
    cell: (info) => <CategoriasUnidad unidad={info.getValue()} />,
  }),
  // Acción "Residentes" de la fila (S4-08, PRD-04-11 §5: el alta de residentes
  // se hace desde la unidad). Abre el panel lateral con los vínculos de la UF.
  columnHelper.accessor((unidad) => unidad, {
    id: 'residentes',
    header: () => <span className="sr-only">Residentes</span>,
    enableSorting: false,
    cell: (info) => {
      const unidad = info.getValue();
      return (
        <span className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            aria-label={`Residentes de la unidad ${unidad.numero}`}
            onClick={() => onVerResidentes(unidad)}
          >
            <Users className="size-4" />
            Residentes
          </Button>
        </span>
      );
    },
  }),
];

// Skeleton de carga (§6.2): replica la estructura de la tabla con bloques
// animados, siguiendo el patrón de los skeletons existentes en la app.
function UnidadesSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-10 rounded bg-muted" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

// Empty state (§6.2): nunca tabla vacía sin mensaje.
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Building2 className="size-8 text-muted-foreground" />
      <p className="font-medium">Este edificio todavía no tiene unidades</p>
      <p className="text-sm text-muted-foreground">
        Cargá las unidades funcionales con sus coeficientes para empezar a
        liquidar expensas.
      </p>
    </div>
  );
}

// Alerta de la invariante (#57): informativa, arriba de la tabla. `delta` es
// lo que falta para 1.000000 (negativo = sobra), calculado por el backend.
function AlertaCoeficientes({ delta }) {
  const sobra = Number(delta) < 0;
  const magnitud = Math.abs(Number(delta)).toFixed(6);
  return (
    <Alert
      variant="warning"
      title={`${sobra ? 'Sobran' : 'Faltan'} ${magnitud}.`}
    >
      Revisá los coeficientes de tus unidades y/o verificá si{' '}
      {sobra
        ? 'cargaste alguna unidad de más al sistema'
        : 'te falta cargar alguna unidad al sistema'}
      . La sumatoria total debe ser 1.
    </Alert>
  );
}

export default function EdificioUnidadesTab() {
  const { edificio } = useOutletContext();
  const [sorting, setSorting] = useState([{ id: 'numero', desc: false }]);
  // Un estado por flujo de alta (#57): individual y carga rápida son dos
  // dialogs independientes, cada uno con su botón.
  const [altaOpen, setAltaOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // UF cuyo panel de residentes está abierto (S4-08).
  const [unidadResidentes, setUnidadResidentes] = useState(null);
  const columns = useMemo(() => crearColumnas(setUnidadResidentes), []);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.edificios.unidades(edificio.id),
    queryFn: () =>
      api.get(`/api/edificios/${edificio.id}/unidades?page=1&limit=100`),
  });

  const unidades = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  const table = useReactTable({
    data: unidades,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (isLoading) return <UnidadesSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
        <Building2 className="size-8 text-muted-foreground" />
        <p className="font-medium">No se pudieron cargar las unidades</p>
        <p className="text-sm text-muted-foreground">
          Intentá de nuevo más tarde.
        </p>
      </div>
    );
  }

  // Σm²: del set traído (client-side). Σcoeficiente y su veredicto: del
  // backend (decimal.js sobre TODAS las unidades del edificio, #57).
  const totalM2 = unidades.reduce((acc, u) => acc + Number(u.m2), 0);
  const coeficientes = data?.coeficientes ?? { suma: '0.000000', delta: '1.000000', cuadra: false };
  const totalesParciales = total > unidades.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Unidades ({total})
          {/* Ayuda contextual: unidades y coeficientes (§6.5) */}
          <AyudaLink variant="icon" topic="edificios/unidades" />
        </CardTitle>
        <CardDescription>
          {total === 1 ? '1 unidad' : `${total} unidades`} del edificio
        </CardDescription>
        <CardAction>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              Carga rápida
            </Button>
            <Button onClick={() => setAltaOpen(true)}>
              <Plus className="size-4" />
              Agregar unidad
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {unidades.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {!coeficientes.cuadra && (
              <AlertaCoeficientes delta={coeficientes.delta} />
            )}
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
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
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="font-semibold">TOTAL</TableCell>
                  <TableCell />
                  <TableCell>
                    <span className="flex justify-end font-semibold tabular-nums">
                      {formatearM2(totalM2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`flex justify-end font-semibold tabular-nums ${
                        coeficientes.cuadra ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {coeficientes.suma}
                    </span>
                  </TableCell>
                  {/* Categorías y acciones no suman nada en el pie */}
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
            {totalesParciales && (
              <p className="text-xs text-muted-foreground">
                Mostrando {unidades.length} de {total} unidades — los totales
                del pie son parciales.
              </p>
            )}
          </>
        )}
      </CardContent>

      {/* Alta de unidades (S2-09): dos flujos separados desde #57 — el alta
          individual (con tab de categorías A/B/C) y la carga rápida bulk */}
      <UnidadAltaDialog
        edificioId={edificio.id}
        edificioTotalM2={edificio.totalM2}
        unidadesExistentes={unidades}
        isOpen={altaOpen}
        onClose={() => setAltaOpen(false)}
      />
      <UnidadBulkDialog
        edificioId={edificio.id}
        edificioTotalM2={edificio.totalM2}
        unidadesExistentes={unidades}
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
      />

      {/* Residentes de la UF (S4-08): panel lateral desde la fila */}
      <ResidentesDrawer
        unidad={unidadResidentes}
        isOpen={unidadResidentes !== null}
        onClose={() => setUnidadResidentes(null)}
      />
    </Card>
  );
}
