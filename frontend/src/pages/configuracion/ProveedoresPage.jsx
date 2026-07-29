// frontend/src/pages/configuracion/ProveedoresPage.jsx — ConsorcIA
// Directorio de proveedores de la organización (S3-14, PRD-04-02 §1.3).
// Ruta /configuracion/proveedores.
//
// El directorio es HÍBRIDO: mezcla el catálogo global de plataforma con los
// proveedores propios de la organización, y la fila tiene que decir de cuál se
// trata — de ahí el badge Global/Propio. Los globales se leen pero no se tocan:
// el backend responde `403 PROVEEDOR_GLOBAL_NO_EDITABLE` (decisión 1 de S3-12),
// así que sus acciones van deshabilitadas con el motivo en el `title` en vez de
// dejar al usuario chocar contra el 403.
//
// Acceso: la policy `proveedor.yaml` da CRUD al org_admin y READ al gestor. La
// ruta la puede abrir todo el staff (a diferencia de /configuracion/usuarios,
// donde el gestor no tiene ni lectura); lo que se oculta al gestor son las
// acciones de escritura (know-how pattern/require-role-guards-ui).
//
// El buscador `?q=` va al backend (busca por razón social Y CUIT sobre el
// directorio completo, no solo la página visible) con debounce de 300 ms.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Loader2, MoreHorizontal, Plus, Search, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { opcionesPlanas } from '@/lib/rubro-schema';
import { useProveedores } from '@/hooks/useProveedores';
import { useRubros } from '@/hooks/useRubros';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import ProveedorFormDialog from '@/pages/configuracion/ProveedorFormDialog';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const columnHelper = createColumnHelper();
const POR_PAGINA = 25;

function ProveedoresSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-8 w-full max-w-sm animate-pulse rounded bg-muted" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

// Dos vacíos distintos: el directorio vacío pide un CTA de alta, la búsqueda sin
// resultados pide corregir el término (§6.2).
function EmptyState({ buscando, puedeCrear, onCrear }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Truck className="size-8 text-muted-foreground" />
      {buscando ? (
        <>
          <p className="font-medium">Ningún proveedor coincide con la búsqueda</p>
          <p className="text-sm text-muted-foreground">
            Se busca por razón social y por CUIT. Probá con menos texto.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">Todavía no hay proveedores en el directorio</p>
          <p className="text-sm text-muted-foreground">
            Cargá los proveedores con los que trabaja tu organización: cada gasto
            se carga a nombre de uno.
          </p>
          {puedeCrear && (
            <Button className="mt-2" onClick={onCrear}>
              <Plus className="size-4" />
              Nuevo proveedor
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default function ProveedoresPage() {
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const puedeEscribir = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  const [busqueda, setBusqueda] = useState('');
  const [q, setQ] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [borrando, setBorrando] = useState(null);

  // Debounce del buscador: sin esto cada tecla dispara una query al backend.
  useEffect(() => {
    const timer = setTimeout(() => setQ(busqueda), 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  // Cambiar el filtro reinicia la paginación: quedarse en la página 4 de un
  // resultado de 3 filas deja la tabla vacía sin explicación.
  useEffect(() => {
    setPage(1);
  }, [q, incluirInactivos]);

  const { proveedores, total, cargando, refrescando, error } = useProveedores({
    q,
    page,
    limit: POR_PAGINA,
    incluirInactivos,
  });

  // El rubro habitual llega como id: se resuelve contra el árbol para mostrar
  // "Mantenimiento › Plomería" en vez de un UUID.
  const { arbol } = useRubros();
  const nombreDeRubro = useMemo(() => {
    const porId = new Map(opcionesPlanas(arbol).map((o) => [o.id, o.etiqueta]));
    return (id) => (id ? (porId.get(id) ?? '—') : '—');
  }, [arbol]);

  // DELETE decide en el backend: sin gastos borra, con gastos degrada a
  // `activo=false` (el gasto es histórico contable, Ley 941). La respuesta dice
  // qué pasó y el toast lo refleja para que el usuario no crea que se borró.
  const bajaMutation = useMutation({
    mutationFn: (proveedor) => api.del(`/api/proveedores/${proveedor.id}`),
    onSuccess: (respuesta, proveedor) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proveedores.all });
      setBorrando(null);
      if (respuesta.desactivado) {
        toast.success('Proveedor desactivado', {
          description: `${proveedor.razonSocial} tiene gastos asociados, así que se conserva desactivado en lugar de eliminarse.`,
        });
      } else {
        toast.success('Proveedor eliminado', { description: proveedor.razonSocial });
      }
    },
    onError: (err) => {
      toast.error('No se pudo dar de baja el proveedor', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const reactivarMutation = useMutation({
    mutationFn: (proveedor) =>
      api.put(`/api/proveedores/${proveedor.id}`, { activo: true }),
    onSuccess: (proveedor) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proveedores.all });
      toast.success('Proveedor reactivado', { description: proveedor.razonSocial });
    },
    onError: (err) => {
      toast.error('No se pudo reactivar el proveedor', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('razonSocial', {
        header: 'Razón social',
        cell: (info) => (
          <span className="font-medium">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('cuit', {
        header: 'CUIT',
        cell: (info) => (
          <span className="tabular-nums">{info.getValue() ?? '—'}</span>
        ),
      }),
      columnHelper.accessor((p) => p, {
        id: 'contacto',
        header: 'Contacto',
        cell: (info) => {
          const { email, telefono } = info.getValue();
          if (!email && !telefono) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="flex flex-col text-sm">
              {email && <span>{email}</span>}
              {telefono && (
                <span className="text-muted-foreground">{telefono}</span>
              )}
            </span>
          );
        },
      }),
      columnHelper.accessor('rubroHabitualId', {
        header: 'Rubro habitual',
        cell: (info) => (
          <span className="text-sm text-muted-foreground">
            {nombreDeRubro(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor((p) => p, {
        id: 'origen',
        header: 'Origen',
        cell: (info) => {
          const proveedor = info.getValue();
          return (
            <span className="flex flex-wrap gap-1">
              <Badge
                variant={proveedor.esGlobal ? 'info' : 'secondary'}
                title={
                  proveedor.esGlobal
                    ? 'Del catálogo global de la plataforma: lo comparten todas las organizaciones'
                    : 'Cargado por tu organización'
                }
              >
                {proveedor.esGlobal ? 'Global' : 'Propio'}
              </Badge>
              {!proveedor.activo && (
                <Badge variant="warning">Desactivado</Badge>
              )}
            </span>
          );
        },
      }),
      columnHelper.accessor((p) => p, {
        id: 'acciones',
        header: () => <span className="sr-only">Acciones</span>,
        cell: (info) => {
          const proveedor = info.getValue();
          if (!puedeEscribir) return null;
          // Los globales son de la plataforma (S3-12 decisión 1): se leen, no se
          // escriben. El `title` da el motivo sin necesidad de intentarlo.
          const motivoGlobal = proveedor.esGlobal
            ? 'Es del catálogo global de la plataforma: no se edita desde tu organización'
            : undefined;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Acciones de ${proveedor.razonSocial}`}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      disabled={proveedor.esGlobal}
                      title={motivoGlobal}
                      onClick={() => setEditando(proveedor)}
                    >
                      Editar
                    </DropdownMenuItem>
                    {proveedor.activo ? (
                      <DropdownMenuItem
                        disabled={proveedor.esGlobal}
                        title={motivoGlobal}
                        onClick={() => setBorrando(proveedor)}
                      >
                        Dar de baja
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={proveedor.esGlobal}
                        title={motivoGlobal}
                        onClick={() => reactivarMutation.mutate(proveedor)}
                      >
                        Reactivar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [nombreDeRubro, puedeEscribir, reactivarMutation],
  );

  const table = useReactTable({
    data: proveedores,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Proveedores{total > 0 && ` (${total})`}
          <AyudaLink variant="icon" topic="gastos/proveedores" />
        </CardTitle>
        <CardDescription>
          Directorio de tu organización: los proveedores del catálogo global de la
          plataforma más los que cargás vos. Cada gasto se carga a nombre de uno.
        </CardDescription>
        {puedeEscribir && (
          <CardAction>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="size-4" />
              Nuevo proveedor
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Label htmlFor="proveedores-buscar">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="proveedores-buscar"
                className="pl-8"
                placeholder="Razón social o CUIT"
                autoComplete="off"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
              />
              {refrescando && (
                <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={incluirInactivos}
              onChange={(event) => setIncluirInactivos(event.target.checked)}
            />
            Mostrar desactivados
          </label>
        </div>

        {cargando && <ProveedoresSkeleton />}

        {!cargando && error && (
          <p className="text-sm text-destructive">
            No se pudo cargar el directorio de proveedores.{' '}
            {error.message ?? 'Intentá de nuevo más tarde.'}
          </p>
        )}

        {!cargando && !error && proveedores.length === 0 && (
          <EmptyState
            buscando={q.trim().length > 0}
            puedeCrear={puedeEscribir}
            onCrear={() => setFormOpen(true)}
          />
        )}

        {!cargando && !error && proveedores.length > 0 && (
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
                  <TableRow
                    key={row.id}
                    className={row.original.activo ? undefined : 'opacity-60'}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPaginas > 1 && (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Página {page} de {totalPaginas}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((actual) => actual - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPaginas}
                    onClick={() => setPage((actual) => actual + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <ProveedorFormDialog
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
      />

      <ProveedorFormDialog
        proveedor={editando}
        isOpen={editando !== null}
        onClose={() => setEditando(null)}
      />

      {/* La baja NO es siempre un borrado: con gastos asociados el backend
          degrada a `activo=false`. El copy lo dice de antemano para que el
          resultado del toast no sorprenda. */}
      <ConfirmDialog
        isOpen={borrando !== null}
        onClose={() => setBorrando(null)}
        onConfirm={() => bajaMutation.mutate(borrando)}
        loading={bajaMutation.isPending}
        title="Dar de baja el proveedor"
        variant="danger"
        confirmText="Dar de baja"
        description={
          borrando
            ? `${borrando.razonSocial} deja de ofrecerse al cargar gastos. Si ya tiene gastos asociados no se elimina: se conserva desactivado, porque los gastos son documentación del consorcio (Ley 941).`
            : ''
        }
      />
    </Card>
  );
}
