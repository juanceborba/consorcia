// frontend/src/pages/edificio/ResidentesDrawer.jsx — ConsorcIA
// Residentes de una unidad funcional (S4-08, Workflow B de PRD-04-11 §5). Se
// abre desde la fila de la DataTable de unidades (§5: "desde la unidad → fila →
// Residentes") en un panel lateral para no perder de vista la tabla.
//
// Contenido:
//   - Vínculos VIGENTES (fechaFin null) y el HISTÓRICO en una sección aparte:
//     desvincular es baja temporal, nunca borrado (§5.6), porque el historial
//     de expensas y pagos cuelga de esa titularidad.
//   - Form "Vincular persona": email, nombre, apellido, propietario/inquilino
//     (al menos uno) y fechaInicio con default hoy.
//   - Tras vincular, modal con el `invitacionUrl` para copiar (MVP sin email).
//   - Desvincular con ConfirmDialog (flujo destructivo, §6.3).
//
// GET/POST /api/unidades/:id/residentes · DELETE /:vinculoId. El endpoint deja
// entrar a org_admin y al gestor con ese edificio asignado (Cerbos `residente`),
// el mismo permiso que ya hace falta para ver la unidad — de ahí que la acción
// no lleve guard de rol extra en la UI.
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { hoyISO, vincularResidenteSchema } from '@/lib/residente-schema';
import InvitacionLinkDialog from '@/components/invitaciones/InvitacionLinkDialog';
import AyudaLink from '@/components/ayuda/AyudaLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const VALORES_INICIALES = () => ({
  email: '',
  nombre: '',
  apellido: '',
  esPropietario: true,
  esInquilino: false,
  fechaInicio: hoyISO(),
});

// Las fechas del contrato son fechas de calendario serializadas en UTC: se
// formatean en UTC para no correrlas un día por el offset local (-03:00 en AR).
function formatearFecha(valor) {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

function nombreDe(usuario) {
  return [usuario.nombre, usuario.apellido].filter(Boolean).join(' ') || usuario.email;
}

function TiposVinculo({ vinculo }) {
  return (
    <span className="flex gap-1">
      {vinculo.esPropietario && <Badge variant="info">Propietario</Badge>}
      {vinculo.esInquilino && <Badge variant="secondary">Inquilino</Badge>}
    </span>
  );
}

function FilaVinculo({ vinculo, onDesvincular }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-medium">{nombreDe(vinculo.usuario)}</span>
        <span className="truncate text-sm text-muted-foreground">
          {vinculo.usuario.email}
        </span>
        <TiposVinculo vinculo={vinculo} />
        <span className="text-xs text-muted-foreground">
          Desde {formatearFecha(vinculo.fechaInicio)}
          {vinculo.fechaFin && ` · hasta ${formatearFecha(vinculo.fechaFin)}`}
        </span>
        {vinculo.vigente && !vinculo.usuario.cuentaActivada && (
          <span className="text-xs text-warning">
            Todavía no activó su cuenta
          </span>
        )}
      </div>
      {vinculo.vigente && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDesvincular(vinculo)}
        >
          Desvincular
        </Button>
      )}
    </li>
  );
}

export default function ResidentesDrawer({ unidad, isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [invitacion, setInvitacion] = useState(null);
  const [desvinculando, setDesvinculando] = useState(null);

  const unidadId = unidad?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.unidades.residentes(unidadId),
    queryFn: () => api.get(`/api/unidades/${unidadId}/residentes`),
    // Sin unidad no hay panel abierto; evita una request con `undefined`.
    enabled: isOpen && Boolean(unidadId),
    // #58 (BUG 1): "Todavía no activó su cuenta" sale de `cuentaActivada`, que
    // el residente cambia desde OTRA sesión al aceptar su invitación. Con el
    // staleTime global de 5 min, reabrir el panel dentro de esa ventana servía
    // el cache y la persona seguía figurando como no activada aunque ya lo
    // estuviera. Este panel muestra estado que cambia fuera de esta pestaña:
    // cada apertura tiene que releer.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(vincularResidenteSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: VALORES_INICIALES(),
  });

  const invalidar = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.unidades.residentes(unidadId),
    });

  const vincular = useMutation({
    mutationFn: (valores) =>
      api.post(`/api/unidades/${unidadId}/residentes`, {
        email: valores.email.trim().toLowerCase(),
        nombre: valores.nombre,
        apellido: valores.apellido,
        esPropietario: valores.esPropietario,
        esInquilino: valores.esInquilino,
        fechaInicio: valores.fechaInicio,
      }),
    onSuccess: (respuesta) => {
      invalidar();
      toast.success('Persona vinculada a la unidad', {
        description: 'Copiale el link para que active su cuenta.',
      });
      reset(VALORES_INICIALES());
      setInvitacion(respuesta);
    },
    onError: (err) => {
      // 409 VINCULO_DUPLICADO entre otros: el message del contrato ya explica.
      toast.error('No se pudo vincular a esa persona', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const desvincular = useMutation({
    mutationFn: (vinculoId) =>
      api.del(`/api/unidades/${unidadId}/residentes/${vinculoId}`),
    onSuccess: () => {
      invalidar();
      toast.success('Vínculo dado de baja', {
        description: 'Queda en el historial de la unidad con su fecha de fin.',
      });
      setDesvinculando(null);
    },
    onError: (err) => {
      toast.error('No se pudo dar de baja el vínculo', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const vinculos = data ?? [];
  const vigentes = vinculos.filter((v) => v.vigente);
  const historicos = vinculos.filter((v) => !v.vigente);

  const cerrar = () => {
    reset(VALORES_INICIALES());
    onClose();
  };

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={cerrar}
        title={
          // El título admite ReactNode: el ícono de ayuda (cómo se habilitan
          // los usuarios, §6.5) va junto al título del panel.
          <span className="flex items-center gap-1">
            Residentes — UF {unidad?.numero ?? ''}
            <AyudaLink variant="icon" topic="usuarios/invitaciones" />
          </span>
        }
        description="Propietarios e inquilinos vinculados a esta unidad. Dar de baja un vínculo no borra el historial de expensas."
      >
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            {error.message ?? 'No se pudieron cargar los residentes.'}
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                Vigentes ({vigentes.length})
              </h3>
              {vigentes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
                  <Users className="size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Esta unidad no tiene residentes vinculados
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vinculá al propietario o inquilino para que reciba sus
                    expensas en el portal.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {vigentes.map((vinculo) => (
                    <FilaVinculo
                      key={vinculo.id}
                      vinculo={vinculo}
                      onDesvincular={setDesvinculando}
                    />
                  ))}
                </ul>
              )}
            </section>

            {historicos.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Histórico ({historicos.length})
                </h3>
                <ul className="flex flex-col gap-2 opacity-70">
                  {historicos.map((vinculo) => (
                    <FilaVinculo key={vinculo.id} vinculo={vinculo} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <Separator />

        {/* Form "Vincular persona" (§5.2) */}
        <form
          onSubmit={handleSubmit((valores) => vincular.mutate(valores))}
          className="flex flex-col gap-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <UserRound className="size-4" />
            Vincular persona
          </h3>

          <div className="flex flex-col gap-2">
            <Label htmlFor="residente-email">
              Email<span className="text-destructive">*</span>
            </Label>
            <Input
              id="residente-email"
              type="email"
              autoComplete="off"
              placeholder="propietario@mail.com"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="residente-nombre">
                Nombre<span className="text-destructive">*</span>
              </Label>
              <Input
                id="residente-nombre"
                placeholder="Juan"
                aria-invalid={!!errors.nombre}
                {...register('nombre')}
              />
              {errors.nombre && (
                <p className="text-sm text-destructive">
                  {errors.nombre.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="residente-apellido">
                Apellido<span className="text-destructive">*</span>
              </Label>
              <Input
                id="residente-apellido"
                placeholder="Pérez"
                aria-invalid={!!errors.apellido}
                {...register('apellido')}
              />
              {errors.apellido && (
                <p className="text-sm text-destructive">
                  {errors.apellido.message}
                </p>
              )}
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm leading-none font-medium">
              Tipo de vínculo<span className="text-destructive">*</span>
            </legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  {...register('esPropietario')}
                />
                Propietario
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  {...register('esInquilino')}
                />
                Inquilino
              </label>
            </div>
            {/* Una UF puede tener ambos (§2.1); el error del refine cae en esPropietario */}
            {errors.esPropietario && (
              <p className="text-sm text-destructive">
                {errors.esPropietario.message}
              </p>
            )}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="residente-fecha-inicio">
              Fecha de inicio<span className="text-destructive">*</span>
            </Label>
            <Input
              id="residente-fecha-inicio"
              type="date"
              className="max-w-48"
              aria-invalid={!!errors.fechaInicio}
              {...register('fechaInicio')}
            />
            {errors.fechaInicio && (
              <p className="text-sm text-destructive">
                {errors.fechaInicio.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-fit"
            disabled={!isValid || vincular.isPending}
          >
            {vincular.isPending && <Loader2 className="size-4 animate-spin" />}
            {vincular.isPending ? 'Vinculando…' : 'Vincular persona'}
          </Button>
        </form>

        {/* Anidados DENTRO del panel a propósito: el Drawer es modal y atrapa el
            foco, así que un diálogo hermano se lo perdería. Base UI encadena los
            popups anidados. */}
        <InvitacionLinkDialog
        isOpen={invitacion !== null}
        onClose={() => setInvitacion(null)}
        invitacion={invitacion}
        title="Persona vinculada"
      />

      <ConfirmDialog
        isOpen={desvinculando !== null}
        onClose={() => setDesvinculando(null)}
        onConfirm={() => desvincular.mutate(desvinculando.id)}
        loading={desvincular.isPending}
        variant="danger"
        title="Desvincular de la unidad"
        confirmText="Desvincular"
        description={
          desvinculando
            ? `${nombreDe(desvinculando.usuario)} deja de figurar como residente vigente de la UF ${unidad?.numero ?? ''}. El vínculo queda en el historial con la fecha de baja y las expensas ya emitidas no se tocan.`
            : ''
        }
        />
      </Drawer>
    </>
  );
}
