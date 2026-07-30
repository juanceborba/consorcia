// frontend/src/components/esquemas/EsquemasRepartoSection.jsx — ConsorcIA
// Sección "Esquemas de reparto" del tab Configuración del edificio (S3-20,
// PRD-02-05 · CCyC art. 2049, último párrafo).
//
// DECISIONES:
//
// 1. VIVE EN CONFIGURACIÓN DEL EDIFICIO, NO EN GASTOS. Un esquema no es un dato
//    del gasto: es el setup del edificio que sale de su reglamento de
//    copropiedad y que después TODOS los gastos usan. Ponerlo acá también hace
//    obvio que se configura una vez y no en cada carga.
//
// 2. EL ESQUEMA GENERAL SE ELIGE ARRIBA, ANTES DE LA LISTA. Es la pregunta que
//    contesta la pantalla ("¿con qué reparte este edificio por default?") y sin
//    ella la lista no se puede interpretar: un esquema "Partes iguales" no dice
//    si está aplicándose a todo el edificio o a nada. Por eso el endpoint
//    devuelve las dos cosas juntas (decisión 2 de esquemas-reparto.routes.js).
//
// 3. "SIN CONFIGURAR" ES UNA OPCIÓN EXPLÍCITA, NO UN VACÍO. El default —repartir
//    por coeficiente— es el caso mayoritario y es correcto: la primera opción del
//    selector lo nombra en vez de dejar un placeholder que se lea como "falta
//    elegir algo".
//
// 4. EL GESTOR VE PERO NO TOCA (cerbos/policies/esquema_reparto.yaml). Configurar
//    el reparto cambia cuánto paga cada propietario en todas las liquidaciones
//    futuras y su fuente de autoridad es el reglamento, no el criterio de quien
//    administra el día a día. La UI no le muestra acciones en vez de dejarlo
//    chocar con un 403.
//
// 5. ELIMINAR PUEDE TERMINAR EN BAJA LÓGICA, y el diálogo lo anticipa. El backend
//    borra si el esquema no se usó nunca y desactiva si lo referencia un gasto,
//    una liquidación o la configuración; el toast del éxito dice cuál de las dos
//    pasó (mismo semáforo doble que los rubros propios de S3-13).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Pencil, Scale, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { etiquetaDeServicio } from '@/lib/gasto-schema';
import { resumenDeEsquema } from '@/lib/esquema-reparto-schema';
import { useAuthStore, SIN_ROLES } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import EsquemaRepartoFormDialog from '@/components/esquemas/EsquemaRepartoFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export default function EsquemasRepartoSection({ edificio }) {
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  // Decisión 4: el gestor lee; administra el org_admin (y el superadmin).
  const puedeAdministrar = roles.some((r) =>
    ['org_admin', 'superadmin'].includes(r),
  );

  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [esquemaEnEdicion, setEsquemaEnEdicion] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.esquemasReparto.porEdificio(edificio.id),
    queryFn: () => api.get(`/api/edificios/${edificio.id}/esquemas-reparto`),
  });

  const esquemas = data?.data ?? [];
  const activos = esquemas.filter((e) => e.activo);
  const esquemaGeneralId = data?.configuracion?.esquemaGeneralId ?? '';

  const generalMutation = useMutation({
    mutationFn: (id) =>
      api.put(`/api/edificios/${edificio.id}/configuracion-liquidacion`, {
        esquemaGeneralId: id || null,
      }),
    onSuccess: (configuracion) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.esquemasReparto.all });
      toast.success('Esquema general actualizado', {
        description: configuracion.esquemaGeneral
          ? `Los gastos generales se reparten con "${configuracion.esquemaGeneral.nombre}".`
          : 'Los gastos generales vuelven a repartirse por coeficiente.',
      });
    },
    onError: (err) => {
      toast.error('No se pudo cambiar el esquema general', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // Decisión 5: el backend decide entre borrado real y baja lógica.
  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/api/esquemas-reparto/${id}`),
    onSuccess: (respuesta, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.esquemasReparto.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.gastos.all });
      const nombre = esquemas.find((e) => e.id === id)?.nombre ?? 'El esquema';
      setAEliminar(null);
      if (respuesta.eliminado) {
        toast.success('Esquema eliminado', { description: `${nombre} se borró.` });
      } else {
        toast.success('Esquema desactivado', {
          description: `${nombre} se usó en gastos o liquidaciones, así que queda desactivado en vez de borrarse.`,
        });
      }
    },
    onError: (err) => {
      setAEliminar(null);
      toast.error('No se pudo eliminar el esquema', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const abrirAlta = () => {
    setEsquemaEnEdicion(null);
    setDialogAbierto(true);
  };

  const abrirEdicion = (id) => {
    setEsquemaEnEdicion(id);
    setDialogAbierto(true);
  };

  return (
    <>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-5 shrink-0" />
            Esquemas de reparto
            <AyudaLink variant="icon" topic="edificios/esquemas-reparto" />
          </CardTitle>
          <CardDescription>
            {puedeAdministrar
              ? 'Cómo se reparte cada gasto entre las unidades cuando el reglamento se aparta del coeficiente (CCyC art. 2049). Sin esquemas, todo se reparte por coeficiente.'
              : 'Cómo se reparte cada gasto entre las unidades. Solo lectura para tu rol: lo configura el administrador de la organización.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando los esquemas…
            </p>
          )}

          {isError && (
            <p className="text-sm text-destructive">
              No se pudieron cargar los esquemas: {error.message}
            </p>
          )}

          {!isPending && !isError && (
            <>
              {/* Decisión 2 y 3: el default del edificio, arriba y con nombre. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="esquema-general">Esquema general del edificio</Label>
                <Select
                  id="esquema-general"
                  value={esquemaGeneralId}
                  disabled={!puedeAdministrar || generalMutation.isPending}
                  onChange={(event) => generalMutation.mutate(event.target.value)}
                >
                  <option value="">
                    Sin configurar — repartir por coeficiente
                  </option>
                  {activos.map((esquema) => (
                    <option key={esquema.id} value={esquema.id}>
                      {esquema.nombre}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Es el default de los gastos de categoría A. Los de categoría B y C
                  usan el esquema del servicio o del sector si hay uno, y si no se
                  reparten por coeficiente entre las unidades alcanzadas.
                </p>
              </div>

              {/* Lista */}
              {esquemas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este edificio no tiene esquemas: cada gasto se reparte por
                  coeficiente entre las unidades que le corresponden, que es el
                  comportamiento normal. Creá uno solo si el reglamento define un
                  reparto distinto (por ejemplo, planta baja exenta del ascensor).
                </p>
              ) : (
                <ul
                  aria-label="Esquemas de reparto del edificio"
                  className="flex flex-col divide-y divide-border rounded-lg border border-border"
                >
                  {esquemas.map((esquema) => (
                    <li
                      key={esquema.id}
                      className="flex flex-wrap items-start justify-between gap-3 p-3"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{esquema.nombre}</span>
                          {!esquema.activo && (
                            <Badge variant="outline">Desactivado</Badge>
                          )}
                          {esquema.id === esquemaGeneralId && (
                            <Badge variant="info">General</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {resumenDeEsquema(esquema, etiquetaDeServicio)}
                          {esquema.pesos.length > 0 &&
                            ` · ${esquema.pesos.length} unidad(es) con peso propio`}
                        </p>
                        {esquema.clausulaReglamento && (
                          <p className="text-xs text-muted-foreground">
                            Según {esquema.clausulaReglamento}
                            {esquema.documentoUrl && (
                              <>
                                {' · '}
                                <a
                                  href={esquema.documentoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline"
                                >
                                  ver documento
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </div>

                      {puedeAdministrar && (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${esquema.nombre}`}
                            onClick={() => abrirEdicion(esquema.id)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Eliminar ${esquema.nombre}`}
                            onClick={() => setAEliminar(esquema)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {puedeAdministrar && (
                <div>
                  <Button type="button" variant="outline" onClick={abrirAlta}>
                    Nuevo esquema
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {dialogAbierto && (
        <EsquemaRepartoFormDialog
          edificio={edificio}
          esquemaId={esquemaEnEdicion}
          isOpen={dialogAbierto}
          onClose={() => setDialogAbierto(false)}
        />
      )}

      <ConfirmDialog
        isOpen={aEliminar !== null}
        onClose={() => setAEliminar(null)}
        onConfirm={() => deleteMutation.mutate(aEliminar.id)}
        title="Eliminar esquema de reparto"
        description={`Vas a eliminar "${aEliminar?.nombre ?? ''}". Si ya se usó en algún gasto o liquidación no se borra: queda desactivado, para que los recibos emitidos sigan diciendo con qué se calcularon.`}
        confirmText="Eliminar esquema"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
