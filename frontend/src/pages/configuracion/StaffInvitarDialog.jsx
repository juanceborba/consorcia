// frontend/src/pages/configuracion/StaffInvitarDialog.jsx — ConsorcIA
// Form de invitación de staff (S4-07, Workflow A de PRD-04-11 §4.2): email,
// nombre, apellido, rol (org_admin | gestor) y multi-select de edificios si el
// rol es gestor. Patrones de formularios de PRD-07-02 §6.1: validación onBlur,
// errores inline, submit deshabilitado hasta que el form sea válido, loading en
// el botón y toast de éxito/error.
//
// POST /api/organizaciones/me/usuarios → 201 { ..., invitacionUrl }: el alta
// abre el modal con el link para copiar (MVP sin email, §4.4).
//
// 409 INVITACION_PENDIENTE (§9): esa persona ya tiene una invitación sin usar.
// No es un error del admin — es el caso frecuente de "no le llegó / la perdió",
// así que en vez de un toast rojo se ofrece REENVIAR, que reposta con
// `{ reenviar: true }`, regenera token y expiración y responde 200 con un link
// nuevo (el viejo queda invalidado).
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, MailWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { invitarStaffSchema, ROLES_STAFF } from '@/lib/staff-schema';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import EdificiosCheckboxGroup from '@/pages/configuracion/EdificiosCheckboxGroup';

const VALORES_INICIALES = {
  email: '',
  nombre: '',
  apellido: '',
  rol: 'GESTOR',
  edificioIds: [],
};

// Campo con label + error inline (patrón §6.1, igual que UnidadAltaDialog).
function Campo({ id, label, error, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        <span className="text-destructive">*</span>
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function StaffInvitarDialog({
  isOpen,
  onClose,
  onInvitada,
  edificios,
  cargandoEdificios,
}) {
  const queryClient = useQueryClient();
  // Email con invitación pendiente: habilita el reenvío explícito.
  const [pendiente, setPendiente] = useState(null);

  const {
    control,
    register,
    watch,
    reset,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(invitarStaffSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: VALORES_INICIALES,
  });

  const rol = watch('rol');
  const esGestor = rol === 'GESTOR';

  // El aviso de invitación pendiente es de un email concreto: si lo cambian,
  // deja de aplicar.
  const email = watch('email');
  useEffect(() => {
    setPendiente((actual) => (actual && actual !== email ? null : actual));
  }, [email]);

  const mutation = useMutation({
    mutationFn: ({ valores, reenviar }) =>
      api.post('/api/organizaciones/me/usuarios', {
        email: valores.email.trim().toLowerCase(),
        nombre: valores.nombre,
        apellido: valores.apellido,
        rol: valores.rol,
        // El contrato rechaza edificios en un ORG_ADMIN (422): se mandan solo
        // cuando el rol es GESTOR.
        edificioIds: valores.rol === 'GESTOR' ? valores.edificioIds : [],
        ...(reenviar ? { reenviar: true } : {}),
      }),
    onSuccess: (respuesta) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizaciones.staff() });
      toast.success(
        respuesta.invitacion.reenviada
          ? 'Invitación reenviada'
          : 'Invitación creada',
        { description: 'Copiale el link a la persona para que active su cuenta.' },
      );
      setPendiente(null);
      reset(VALORES_INICIALES);
      onInvitada(respuesta);
    },
    onError: (err) => {
      // 409 con invitación pendiente: se ofrece reenviar en vez de fallar.
      if (err.code === 'INVITACION_PENDIENTE') {
        setPendiente(watch('email'));
        return;
      }
      toast.error('No se pudo invitar a esa persona', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const enviar = (reenviar) =>
    handleSubmit((valores) => mutation.mutate({ valores, reenviar }))();

  const cerrar = () => {
    setPendiente(null);
    reset(VALORES_INICIALES);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={cerrar}
      title="Invitar staff"
      description="La persona recibe un link para definir su contraseña. Si ya tiene cuenta en ConsorcIA, suma esta organización al mismo login."
      size="lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          enviar(false);
        }}
        className="flex flex-col gap-4"
      >
        <Campo id="staff-email" label="Email" error={errors.email}>
          <Input
            id="staff-email"
            type="email"
            autoComplete="off"
            placeholder="gestor@administracion.com"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="staff-nombre" label="Nombre" error={errors.nombre}>
            <Input
              id="staff-nombre"
              placeholder="Ana"
              aria-invalid={!!errors.nombre}
              {...register('nombre')}
            />
          </Campo>
          <Campo id="staff-apellido" label="Apellido" error={errors.apellido}>
            <Input
              id="staff-apellido"
              placeholder="Gómez"
              aria-invalid={!!errors.apellido}
              {...register('apellido')}
            />
          </Campo>
        </div>

        <Campo id="staff-rol" label="Rol" error={errors.rol}>
          <Select id="staff-rol" aria-invalid={!!errors.rol} {...register('rol')}>
            {ROLES_STAFF.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Campo>

        {/* El multi-select solo aplica al gestor: un org_admin opera toda la org */}
        <Controller
          control={control}
          name="edificioIds"
          render={({ field }) => (
            <EdificiosCheckboxGroup
              edificios={edificios}
              cargando={cargandoEdificios}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={!esGestor}
              error={errors.edificioIds}
            />
          )}
        />

        {pendiente && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MailWarning className="size-4 text-warning" />
              Esa persona ya tiene una invitación sin usar
            </p>
            <p className="text-sm text-muted-foreground">
              Podés reenviarla: se genera un link nuevo con los datos de este
              formulario y el anterior deja de servir.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={mutation.isPending}
              onClick={() => enviar(true)}
            >
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Reenviar invitación
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={!isValid || mutation.isPending}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {mutation.isPending ? 'Invitando…' : 'Invitar'}
          </Button>
          <Button type="button" variant="outline" onClick={cerrar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
