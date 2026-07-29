// frontend/src/pages/configuracion/RubrosPage.jsx — ConsorcIA
// Árbol de rubros de la organización (S3-14, PRD-04-02 §1.4).
// Ruta /configuracion/rubros.
//
// El árbol es el MERGE de tres fuentes (S3-13): el maestro de plataforma, los
// overrides de visibilidad de la organización y los ítems propios. La pantalla no
// es una DataTable sino un árbol de 2 niveles: la relación rubro → subrubro es el
// dato principal (el gasto se carga contra una hoja) y una tabla plana la
// perdería.
//
// UN SOLO CONTROL PARA "SE VE O NO SE VE", dos endpoints detrás:
//   - ítem del maestro → `PUT /api/rubros/:id/visibilidad` (override de la org;
//     el maestro es de la plataforma y no se toca),
//   - ítem propio      → `PUT /api/rubros/:id` con `activo` (baja lógica; el
//     backend responde 422 RUBRO_PROPIO_SIN_VISIBILIDAD si se le pide el otro).
// Son dos mecanismos por diseño (decisión 2 de S3-13), pero para el usuario el
// efecto es el mismo — "aparece al cargar un gasto" — y exponer la diferencia
// sería filtrar la implementación.
//
// Ocultar un rubro de nivel 1 oculta también sus subrubros (§1.4): las filas
// hijas se muestran atenuadas y su control deshabilitado, porque cambiarlo no
// tendría efecto mientras el padre esté oculto.
//
// Acceso: `rubro.yaml` da CRUD al org_admin y READ al gestor. La ruta la abre
// todo el staff; las acciones de escritura se ocultan al gestor.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronRight,
  Eye,
  EyeOff,
  FolderTree,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import RubroFormDialog from '@/pages/configuracion/RubroFormDialog';
import { useRubros } from '@/hooks/useRubros';
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
import { cn } from '@/lib/utils';

// Un ítem se ofrece al cargar un gasto si es visible (maestro) y está activo
// (propio). El backend ya devuelve las dos banderas por nodo.
const seOfrece = (item) => item.visible && item.activo;

function RubrosSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className={cn('h-9 animate-pulse rounded bg-muted', i % 3 === 0 || 'ml-8')}
        />
      ))}
    </div>
  );
}

// Fila del árbol. `nivel` cambia solo la indentación y el peso tipográfico: la
// lógica de acciones es idéntica en los dos niveles.
function FilaRubro({
  item,
  nivel,
  puedeEscribir,
  bloqueadoPorPadre,
  onToggle,
  onEditar,
  onAgregarSubrubro,
  onBorrar,
}) {
  // El backend propaga el ocultamiento al hijo de dos formas distintas: sobre el
  // maestro devuelve el subrubro con `visible: false`, pero un rubro PROPIO
  // inactivo simplemente desaparece del árbol usable arrastrando a sus hijos, que
  // siguen llegando con `visible: true` y `activo: true`. La fila razona sobre el
  // estado EFECTIVO — se ofrece o no — para que las dos ramas se lean igual.
  const oculto = !seOfrece(item) || bloqueadoPorPadre;
  const Icono = oculto ? EyeOff : Eye;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50',
        nivel === 2 && 'ml-6',
        oculto && 'opacity-60',
      )}
    >
      {nivel === 2 && (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <span className={cn('truncate', nivel === 1 ? 'font-medium' : 'text-sm')}>
        {item.nombre}
      </span>

      {item.esMaestro ? (
        <Badge variant="secondary" title="Del maestro de la plataforma">
          Maestro
        </Badge>
      ) : (
        <Badge variant="info" title="Creado por tu organización">
          Propio
        </Badge>
      )}
      {oculto && <Badge variant="warning">Oculto</Badge>}

      {puedeEscribir && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={bloqueadoPorPadre}
            aria-label={
              oculto ? `Mostrar ${item.nombre}` : `Ocultar ${item.nombre}`
            }
            title={
              bloqueadoPorPadre
                ? 'Su rubro está oculto: mostralo primero'
                : oculto
                  ? 'Mostrar al cargar gastos'
                  : 'Ocultar al cargar gastos'
            }
            onClick={() => onToggle(item)}
          >
            <Icono className="size-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Acciones de ${item.nombre}`}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-48">
              <DropdownMenuGroup>
                {nivel === 1 && (
                  <DropdownMenuItem onClick={() => onAgregarSubrubro(item)}>
                    Agregar subrubro
                  </DropdownMenuItem>
                )}
                {/* El maestro no se edita ni se borra: se oculta (decisión 1 de
                    S3-13, el backend responde 403 RUBRO_MAESTRO_NO_EDITABLE). */}
                <DropdownMenuItem
                  disabled={item.esMaestro}
                  title={
                    item.esMaestro
                      ? 'Es del maestro de la plataforma: podés ocultarlo o colgarle subrubros propios'
                      : undefined
                  }
                  onClick={() => onEditar(item)}
                >
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={item.esMaestro}
                  title={
                    item.esMaestro
                      ? 'Es del maestro de la plataforma: no se borra, se oculta'
                      : undefined
                  }
                  onClick={() => onBorrar(item)}
                >
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export default function RubrosPage() {
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const puedeEscribir = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  // La administración necesita ver los ocultos para poder volver a mostrarlos:
  // sin esto un rubro oculto desaparece de la pantalla que lo administra.
  const [mostrarOcultos, setMostrarOcultos] = useState(true);
  const { arbol, cargando, error } = useRubros({ incluirOcultos: mostrarOcultos });

  const [creando, setCreando] = useState(null); // { padre } | null
  const [editando, setEditando] = useState(null);
  const [borrando, setBorrando] = useState(null);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.rubros.all });

  // Dos endpoints, un solo gesto del usuario (ver cabecera del archivo).
  const toggleMutation = useMutation({
    mutationFn: (item) =>
      item.esMaestro
        ? api.put(`/api/rubros/${item.id}/visibilidad`, { visible: !item.visible })
        : api.put(`/api/rubros/${item.id}`, { activo: !item.activo }),
    onSuccess: (_respuesta, item) => {
      invalidar();
      toast.success(
        seOfrece(item) ? `"${item.nombre}" ya no se ofrece` : `"${item.nombre}" vuelve a ofrecerse`,
      );
    },
    onError: (err) => {
      toast.error('No se pudo cambiar la visibilidad', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // Igual que proveedores: con gastos asociados el backend degrada a
  // `activo=false` en vez de borrar. `409 RUBRO_CON_SUBRUBROS` es un error del
  // usuario con arreglo claro, así que va al toast con el mensaje del backend
  // (dice cuántos subrubros hay que sacar primero).
  const borrarMutation = useMutation({
    mutationFn: (item) => api.del(`/api/rubros/${item.id}`),
    onSuccess: (respuesta, item) => {
      invalidar();
      setBorrando(null);
      if (respuesta.desactivado) {
        toast.success('Rubro desactivado', {
          description: `"${item.nombre}" tiene gastos asociados, así que se conserva desactivado en lugar de eliminarse.`,
        });
      } else {
        toast.success('Rubro eliminado', { description: item.nombre });
      }
    },
    onError: (err) => {
      setBorrando(null);
      toast.error('No se pudo eliminar el rubro', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Rubros
          <AyudaLink variant="icon" topic="gastos/rubros" />
        </CardTitle>
        <CardDescription>
          Segmentan los gastos para analizarlos. Son independientes de las
          categorías A/B/C, que definen cómo se reparte el gasto entre las
          unidades. Arrancás con el árbol de la plataforma: ocultá lo que no uses y
          agregá tus propios rubros.
        </CardDescription>
        {puedeEscribir && (
          <CardAction>
            <Button onClick={() => setCreando({ padre: null })}>
              <Plus className="size-4" />
              Nuevo rubro
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={mostrarOcultos}
            onChange={(event) => setMostrarOcultos(event.target.checked)}
          />
          Mostrar los rubros ocultos
        </label>

        {cargando && <RubrosSkeleton />}

        {!cargando && error && (
          <p className="text-sm text-destructive">
            No se pudo cargar el árbol de rubros.{' '}
            {error.message ?? 'Intentá de nuevo más tarde.'}
          </p>
        )}

        {!cargando && !error && arbol.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
            <FolderTree className="size-8 text-muted-foreground" />
            <p className="font-medium">No hay rubros visibles</p>
            <p className="text-sm text-muted-foreground">
              {mostrarOcultos
                ? 'Creá el primer rubro de tu organización para empezar a segmentar los gastos.'
                : 'Están todos ocultos: tildá "Mostrar los rubros ocultos" para volver a habilitarlos.'}
            </p>
          </div>
        )}

        {!cargando && !error && arbol.length > 0 && (
          <div className="flex flex-col divide-y">
            {arbol.map((rubro) => (
              <div key={rubro.id} className="py-1">
                <FilaRubro
                  item={rubro}
                  nivel={1}
                  puedeEscribir={puedeEscribir}
                  bloqueadoPorPadre={false}
                  onToggle={(item) => toggleMutation.mutate(item)}
                  onEditar={setEditando}
                  onAgregarSubrubro={(padre) => setCreando({ padre })}
                  onBorrar={setBorrando}
                />
                {rubro.subrubros.map((subrubro) => (
                  <FilaRubro
                    key={subrubro.id}
                    item={subrubro}
                    nivel={2}
                    puedeEscribir={puedeEscribir}
                    // Ocultar el rubro oculta sus subrubros: tocar el hijo no
                    // tendría efecto hasta que el padre vuelva a mostrarse.
                    bloqueadoPorPadre={!seOfrece(rubro)}
                    onToggle={(item) => toggleMutation.mutate(item)}
                    onEditar={setEditando}
                    onAgregarSubrubro={() => {}}
                    onBorrar={setBorrando}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <RubroFormDialog
        padre={creando?.padre ?? null}
        isOpen={creando !== null}
        onClose={() => setCreando(null)}
      />

      <RubroFormDialog
        rubro={editando}
        isOpen={editando !== null}
        onClose={() => setEditando(null)}
      />

      <ConfirmDialog
        isOpen={borrando !== null}
        onClose={() => setBorrando(null)}
        onConfirm={() => borrarMutation.mutate(borrando)}
        loading={borrarMutation.isPending}
        title="Eliminar el rubro"
        variant="danger"
        confirmText="Eliminar"
        description={
          borrando
            ? `"${borrando.nombre}" deja de ofrecerse al cargar gastos. Si ya tiene gastos asociados no se elimina: se conserva desactivado, porque los gastos son documentación del consorcio (Ley 941).`
            : ''
        }
      />
    </Card>
  );
}
