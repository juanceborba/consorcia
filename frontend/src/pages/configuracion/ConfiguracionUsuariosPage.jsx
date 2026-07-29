// frontend/src/pages/configuracion/ConfiguracionUsuariosPage.jsx — ConsorcIA
// Backoffice de staff (S4-07, PRD-04-11 §4 Workflow A · PRD-07-03: ruta
// /configuracion/usuarios). Nómina de la organización activa con DataTable
// (TanStack Table, patrón de S2-08): nombre, email, rol, edificios asignados y
// estado de la membresía, más las acciones de gestión posterior (editar
// permisos, activar/desactivar).
//
// Datos: GET /api/organizaciones/me/usuarios (org del JWT, solo org_admin por
// Cerbos). La lista incluye las membresías DESACTIVADAS: la baja es lógica y
// desde acá se reactiva.
//
// Guard: la ruta está envuelta en RequireRole org_admin (main.jsx) — defensa en
// profundidad sobre el 403 de Cerbos, patrón de S2 (know-how
// pattern/require-role-guards-ui).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { ROL_LABEL } from '@/lib/staff-schema';
import { useEdificios } from '@/hooks/useEdificios';
import { useAuthStore } from '@/stores/auth.store';
import InvitacionLinkDialog from '@/components/invitaciones/InvitacionLinkDialog';
import AyudaLink from '@/components/ayuda/AyudaLink';
import StaffEditarDialog from '@/pages/configuracion/StaffEditarDialog';
import StaffEstadoDialog from '@/pages/configuracion/StaffEstadoDialog';
import StaffInvitarDialog from '@/pages/configuracion/StaffInvitarDialog';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const columnHelper = createColumnHelper();

const nombreCompleto = (miembro) =>
  [miembro.nombre, miembro.apellido].filter(Boolean).join(' ') || '—';

// Estado de la membresía: cruza el estado del vínculo (activo) con el de la
// cuenta global (cuentaActivada = ya definió su password, S4-02). "Invitado"
// distingue a quien fue dado de alta pero todavía no entró.
function EstadoMembresia({ miembro }) {
  if (!miembro.activo) return <Badge variant="secondary">Desactivado</Badge>;
  if (!miembro.cuentaActivada) return <Badge variant="warning">Invitado</Badge>;
  return <Badge variant="success">Activo</Badge>;
}

function EdificiosAsignados({ miembro }) {
  if (miembro.rol === 'ORG_ADMIN') {
    return <span className="text-muted-foreground">Todos</span>;
  }
  if (miembro.edificios.length === 0) {
    return <span className="text-warning">Sin asignar</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {miembro.edificios.map((edificio) => (
        <Badge key={edificio.id} variant="secondary">
          {edificio.nombre}
        </Badge>
      ))}
    </span>
  );
}

function StaffSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-56 rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-10 rounded bg-muted" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

// Empty state (§6.2): en la práctica nunca se ve vacío (quien mira la pantalla
// es org_admin y por lo tanto está en la lista), pero la tabla nunca queda sin
// mensaje.
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Users className="size-8 text-muted-foreground" />
      <p className="font-medium">Todavía no hay staff en la organización</p>
      <p className="text-sm text-muted-foreground">
        Invitá a los gestores y administradores que van a operar los edificios.
      </p>
    </div>
  );
}

export default function ConfiguracionUsuariosPage() {
  const usuarioId = useAuthStore((s) => s.user?.id);
  const { edificios, cargando: cargandoEdificios } = useEdificios();

  const [invitarOpen, setInvitarOpen] = useState(false);
  // Respuesta del alta: alimenta el modal con el link para copiar.
  const [invitacion, setInvitacion] = useState(null);
  const [editando, setEditando] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.organizaciones.staff(),
    queryFn: () => api.get('/api/organizaciones/me/usuarios'),
  });

  const staff = data ?? [];

  const columns = useMemo(
    () => [
      columnHelper.accessor(nombreCompleto, {
        id: 'nombre',
        header: 'Nombre',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnHelper.accessor('email', { header: 'Email' }),
      columnHelper.accessor('rol', {
        header: 'Rol',
        cell: (info) => ROL_LABEL[info.getValue()] ?? info.getValue(),
      }),
      columnHelper.accessor((miembro) => miembro, {
        id: 'edificios',
        header: 'Edificios',
        enableSorting: false,
        cell: (info) => <EdificiosAsignados miembro={info.getValue()} />,
      }),
      columnHelper.accessor((miembro) => miembro, {
        id: 'estado',
        header: 'Estado',
        enableSorting: false,
        cell: (info) => <EstadoMembresia miembro={info.getValue()} />,
      }),
      columnHelper.accessor((miembro) => miembro, {
        id: 'acciones',
        header: () => <span className="sr-only">Acciones</span>,
        enableSorting: false,
        cell: (info) => {
          const miembro = info.getValue();
          // La membresía propia no se toca desde acá: desactivarse a sí mismo
          // es justo el caso que el backend corta con 422 ULTIMO_ORG_ADMIN
          // cuando es el último, y cambiarse el rol propio sería un pie en el
          // pie silencioso.
          const esPropia = miembro.id === usuarioId;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Acciones de ${miembro.email}`}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                {/* w-auto: el ancho por defecto del popup es el del trigger
                    (--anchor-width) y el trigger es un botón de ícono. */}
                <DropdownMenuContent align="end" className="w-auto min-w-40">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      disabled={esPropia}
                      onClick={() => setEditando(miembro)}
                    >
                      Editar permisos
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={esPropia}
                      onClick={() => setCambiandoEstado(miembro)}
                    >
                      {miembro.activo ? 'Desactivar' : 'Reactivar'}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [usuarioId],
  );

  const [sorting, setSorting] = useState([{ id: 'nombre', desc: false }]);

  const table = useReactTable({
    data: staff,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (isLoading) return <StaffSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
        <Users className="size-8 text-muted-foreground" />
        <p className="font-medium">No se pudo cargar el staff</p>
        <p className="text-sm text-muted-foreground">
          {error.message ?? 'Intentá de nuevo más tarde.'}
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Usuarios ({staff.length})
          {/* Ayuda contextual: roles y accesos (§6.5) */}
          <AyudaLink variant="icon" topic="usuarios/roles" />
        </CardTitle>
        <CardDescription>
          Staff de la organización: administradores y gestores con acceso al
          backoffice. Los propietarios e inquilinos se administran desde cada
          unidad.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setInvitarOpen(true)}>
            <UserPlus className="size-4" />
            Invitar staff
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <EmptyState />
        ) : (
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
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <StaffInvitarDialog
        isOpen={invitarOpen}
        onClose={() => setInvitarOpen(false)}
        edificios={edificios}
        cargandoEdificios={cargandoEdificios}
        onInvitada={(respuesta) => {
          setInvitarOpen(false);
          setInvitacion(respuesta);
        }}
      />

      <InvitacionLinkDialog
        isOpen={invitacion !== null}
        onClose={() => setInvitacion(null)}
        invitacion={invitacion}
        title={
          invitacion?.invitacion?.reenviada
            ? 'Invitación reenviada'
            : 'Invitación creada'
        }
      />

      <StaffEditarDialog
        miembro={editando}
        isOpen={editando !== null}
        onClose={() => setEditando(null)}
        edificios={edificios}
        cargandoEdificios={cargandoEdificios}
      />

      <StaffEstadoDialog
        miembro={cambiandoEstado}
        isOpen={cambiandoEstado !== null}
        onClose={() => setCambiandoEstado(null)}
      />
    </Card>
  );
}
