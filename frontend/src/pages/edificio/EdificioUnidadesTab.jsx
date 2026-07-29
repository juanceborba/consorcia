// frontend/src/pages/edificio/EdificioUnidadesTab.jsx — ConsorcIA
// Tab "Unidades" del detalle de edificio (S2-08): DataTable con TanStack
// Table según PRD-07-02 §3.5 — sort por número/tipo/m²/coeficiente, fila
// TOTAL al pie (Σm² y Σcoeficiente en 6 decimales, success si cierra en
// 1.000000 / danger si no), badges de categorías A/B/C (tokens S2-05),
// empty state (§6.2) y skeleton de carga. El botón "+ Agregar" del header
// (wireframe §3.5) abre el modal de alta de S2-09 (UnidadAltaDialog).
//
// Datos: GET /api/edificios/:id/unidades con TanStack Query
// (queryKeys.edificios.unidades). El contrato pagina (?page=&limit=, máx
// 100); se pide el límite máximo en una sola página porque la fila TOTAL
// necesita el set completo de unidades para verificar la invariante. Si un
// edificio supera las 100 unidades (fuera de escala del MVP), el pie aclara
// que los totales son parciales.
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

export default function EdificioUnidadesTab() {
  const { edificio } = useOutletContext();
  const [sorting, setSorting] = useState([{ id: 'numero', desc: false }]);
  const [altaOpen, setAltaOpen] = useState(false);
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

  // Totales del set completo de unidades (filas de datos, no del orden visual).
  const totalM2 = unidades.reduce((acc, u) => acc + Number(u.m2), 0);
  const totalCoeficiente = unidades.reduce(
    (acc, u) => acc + Number(u.coeficiente),
    0,
  );
  // Invariante: la suma de coeficientes debe cerrar en 1.000000. Se compara
  // el valor formateado (no el float crudo) para evitar errores de redondeo.
  const cuadraCoeficientes =
    formatearCoeficiente(totalCoeficiente) === '1.000000';
  const totalesParciales = total > unidades.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unidades ({total})</CardTitle>
        <CardDescription>
          {total === 1 ? '1 unidad' : `${total} unidades`} del edificio
        </CardDescription>
        <CardAction>
          <Button onClick={() => setAltaOpen(true)}>
            <Plus className="size-4" />
            Agregar
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {unidades.length === 0 ? (
          <EmptyState />
        ) : (
          <>
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
                        cuadraCoeficientes ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatearCoeficiente(totalCoeficiente)}
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

      {/* Alta de unidades (S2-09): modal con form individual + bulk */}
      <UnidadAltaDialog
        edificioId={edificio.id}
        unidadesExistentes={unidades}
        isOpen={altaOpen}
        onClose={() => setAltaOpen(false)}
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
