// frontend/src/pages/edificio/EdificioConfiguracionTab.jsx — ConsorcIA
// Tab "Configuración" del detalle de edificio (S2-10). Tres secciones:
//
// 1. Edición de datos (PATCH /api/edificios/:id, parcial: solo campos
//    modificados, según editarEdificioSchema del backend). Patrones de
//    formularios PRD-07-02 §6.1 (validación onBlur, submit deshabilitado si
//    no hay cambios o es inválido, loading en botón, toast éxito/error,
//    confirmación al salir con cambios sin guardar) y mutación con
//    optimistic update + rollback según PRD-07-04 §2.5.
// 2. Esquemas de reparto (S3-20, `components/esquemas/EsquemasRepartoSection`):
//    el setup contable del edificio — con qué se reparte cada gasto cuando el
//    reglamento se aparta del coeficiente. Vive acá y no en Gastos porque es
//    configuración del edificio, no un dato de cada gasto (ver la decisión 1 de
//    esa sección).
// 3. Zona de peligro: eliminar edificio (DELETE, soft delete activo=false)
//    con ConfirmDialog requireText = nombre del edificio (PRD-07-02 §4.8,
//    flujo destructivo §6.3). Al confirmar: invalida listas, toast y
//    redirige a /edificios.
//
// Permisos (PRD-04-01 §2.1): editan org_admin, superadmin y gestor asignado;
// eliminar es solo org_admin/superadmin (la zona de peligro no se muestra al
// gestor). Otros roles ven el formulario en solo lectura.
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useBlocker, useNavigate, useOutletContext } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Settings, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { edificioFormSchema } from '@/lib/edificio-schema';
import { TIPOS_EDIFICIO } from '@/lib/tipos-edificio';
import { useAuthStore, SIN_ROLES } from '@/stores/auth.store';
import { useEdificioStore } from '@/stores/edificio.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import EsquemasRepartoSection from '@/components/esquemas/EsquemasRepartoSection';
import FondoReservaSection from '@/components/fondo-reserva/FondoReservaSection';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

// Defaults del form a partir del edificio del API. totalM2 llega como string
// decimal de Prisma ("3064.00"): se normaliza a string numérica ("3064") para
// que el dirty-check de RHF (comparación estricta) no lo marque siempre
// modificado. fechaInicioAdmin llega ISO; el input date usa "yyyy-mm-dd".
function defaultsDesdeEdificio(edificio) {
  return {
    nombre: edificio.nombre ?? '',
    direccion: edificio.direccion ?? '',
    codigoPostal: edificio.codigoPostal ?? '',
    ciudad: edificio.ciudad ?? '',
    provincia: edificio.provincia ?? '',
    tipo: edificio.tipo ?? 'ph',
    totalM2:
      edificio.totalM2 != null && edificio.totalM2 !== ''
        ? String(Number(edificio.totalM2))
        : '',
    fechaInicioAdmin: edificio.fechaInicioAdmin
      ? edificio.fechaInicioAdmin.slice(0, 10)
      : '',
  };
}

function Campo({ id, label, obligatorio = true, error, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {obligatorio && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function EdificioConfiguracionTab() {
  const { edificio } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const setEdificioId = useEdificioStore((s) => s.setEdificioId);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  // PRD-04-01 §2.1: PATCH para org_admin/superadmin/gestor asignado; DELETE
  // solo org_admin (y superadmin). El resto lee.
  const puedeEditar = roles.some((r) =>
    ['org_admin', 'superadmin', 'gestor'].includes(r),
  );
  const puedeEliminar = roles.some((r) =>
    ['org_admin', 'superadmin'].includes(r),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, isDirty, dirtyFields },
  } = useForm({
    resolver: zodResolver(edificioFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: defaultsDesdeEdificio(edificio),
  });

  // PATCH con optimistic update + rollback (PRD-07-04 §2.5): onMutate
  // cancela queries en vuelo, guarda snapshot y aplica el cambio; onError
  // restaura el snapshot + toast; onSettled revalida detalle y listas.
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/api/edificios/${id}`, payload),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.edificios.detail(id),
      });
      const anterior = queryClient.getQueryData(queryKeys.edificios.detail(id));
      queryClient.setQueryData(queryKeys.edificios.detail(id), (old) =>
        old ? { ...old, ...payload } : old,
      );
      return { anterior };
    },
    onError: (err, { id }, context) => {
      queryClient.setQueryData(
        queryKeys.edificios.detail(id),
        context?.anterior,
      );
      toast.error('No se pudieron guardar los cambios', {
        description: err.message ?? 'Error inesperado',
      });
    },
    onSuccess: (actualizado, { values }) => {
      // El PATCH devuelve el edificio sin unidades: se preservan las que ya
      // están en cache y se resetea el form con los valores confirmados.
      queryClient.setQueryData(queryKeys.edificios.detail(actualizado.id), (old) =>
        old ? { ...old, ...actualizado, unidades: old.unidades } : old,
      );
      reset(values);
      toast.success('Cambios guardados', {
        description: `Los datos de ${actualizado.nombre} quedaron actualizados.`,
      });
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.lists() });
    },
  });

  // DELETE (soft delete) — flujo destructivo PRD-07-02 §6.3: ConfirmDialog
  // con requireText, loading en el botón, toast de éxito/error y redirección
  // al listado. Sin optimistic: el edificio deja de existir para el usuario.
  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/api/edificios/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.edificios.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.lists() });
      // El selector del header no puede seguir apuntando a un edificio dado
      // de baja.
      if (useEdificioStore.getState().edificioId === id) setEdificioId(null);
      setConfirmarBaja(false);
      toast.success('Edificio eliminado', {
        description: `${edificio.nombre} fue dado de baja.`,
      });
      navigate('/edificios');
    },
    onError: (err) => {
      setConfirmarBaja(false);
      toast.error('No se pudo eliminar el edificio', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // Confirmación al salir con cambios sin guardar (PRD-07-02 §6.1.8), mismo
  // patrón que el alta (S2-06): useBlocker para navegación interna +
  // beforeunload para cierre/recarga.
  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Tenés cambios sin guardar. ¿Salir de todas formas?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // PATCH parcial: solo los campos modificados (editarEdificioSchema exige al
  // menos uno). fechaInicioAdmin vacía no se envía: el backend no admite
  // limpiar la fecha (z.coerce.date() no acepta null ni string vacío).
  const onSubmit = (values) => {
    const payload = {};
    for (const campo of Object.keys(dirtyFields)) {
      if (campo === 'fechaInicioAdmin' && !values.fechaInicioAdmin) continue;
      payload[campo] = values[campo];
    }
    if (Object.keys(payload).length === 0) {
      toast.info('No hay cambios para guardar');
      reset(values);
      return;
    }
    updateMutation.mutate({ id: edificio.id, payload, values });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Edición de datos */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5 shrink-0" />
            Datos del edificio
            {/* Ayuda contextual: conceptos del módulo Edificios (§6.5) */}
            <AyudaLink variant="icon" topic="edificios" />
          </CardTitle>
          <CardDescription>
            {puedeEditar
              ? 'Editá la información general del consorcio.'
              : 'Información general del consorcio. Solo lectura para tu rol.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <Campo id="nombre" label="Nombre" error={errors.nombre}>
                <Input
                  id="nombre"
                  disabled={!puedeEditar}
                  aria-invalid={!!errors.nombre}
                  {...register('nombre')}
                />
              </Campo>
            </div>

            <div className="sm:col-span-2">
              <Campo id="direccion" label="Dirección" error={errors.direccion}>
                <Input
                  id="direccion"
                  disabled={!puedeEditar}
                  aria-invalid={!!errors.direccion}
                  {...register('direccion')}
                />
              </Campo>
            </div>

            <Campo id="ciudad" label="Ciudad" error={errors.ciudad}>
              <Input
                id="ciudad"
                disabled={!puedeEditar}
                aria-invalid={!!errors.ciudad}
                {...register('ciudad')}
              />
            </Campo>

            <Campo id="provincia" label="Provincia" error={errors.provincia}>
              <Input
                id="provincia"
                disabled={!puedeEditar}
                aria-invalid={!!errors.provincia}
                {...register('provincia')}
              />
            </Campo>

            <Campo
              id="codigoPostal"
              label="Código postal"
              error={errors.codigoPostal}
            >
              <Input
                id="codigoPostal"
                disabled={!puedeEditar}
                aria-invalid={!!errors.codigoPostal}
                {...register('codigoPostal')}
              />
            </Campo>

            <Campo id="tipo" label="Tipo de edificio" error={errors.tipo}>
              <Select
                id="tipo"
                disabled={!puedeEditar}
                aria-invalid={!!errors.tipo}
                {...register('tipo')}
              >
                {TIPOS_EDIFICIO.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </Select>
            </Campo>

            <Campo
              id="totalM2"
              label="Superficie total (m²)"
              error={errors.totalM2}
            >
              <Input
                id="totalM2"
                type="number"
                min="0"
                step="any"
                disabled={!puedeEditar}
                aria-invalid={!!errors.totalM2}
                {...register('totalM2')}
              />
            </Campo>

            <Campo
              id="fechaInicioAdmin"
              label="Inicio de la administración"
              obligatorio={false}
              error={errors.fechaInicioAdmin}
            >
              <Input
                id="fechaInicioAdmin"
                type="date"
                disabled={!puedeEditar}
                aria-invalid={!!errors.fechaInicioAdmin}
                {...register('fechaInicioAdmin')}
              />
            </Campo>

            {puedeEditar && (
              <div className="flex gap-2 pt-2 sm:col-span-2">
                <Button
                  type="submit"
                  disabled={!isDirty || !isValid || updateMutation.isPending}
                >
                  {updateMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {updateMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
                </Button>
                {isDirty && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reset()}
                  >
                    Descartar
                  </Button>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Esquemas de reparto (S3-20): el gestor la ve en solo lectura. */}
      <EsquemasRepartoSection edificio={edificio} />

      {/* S3-21: las reglas del fondo van al lado de los esquemas — las dos
          responden "cómo se calcula lo que paga cada UF". */}
      <FondoReservaSection edificio={edificio} />

      {/* Zona de peligro: solo org_admin/superadmin (PRD-04-01 §2.1) */}
      {puedeEliminar && (
        <Card className="max-w-2xl border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5 shrink-0" />
              Zona de peligro
            </CardTitle>
            <CardDescription>
              Eliminar el edificio lo da de baja para toda la organización:
              deja de listarse y no se puede volver a acceder desde la app.
              Los datos se conservan (baja lógica).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmarBaja(true)}
            >
              Eliminar edificio
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmarBaja}
        onClose={() => setConfirmarBaja(false)}
        onConfirm={() => deleteMutation.mutate(edificio.id)}
        title="Eliminar edificio"
        description={`Vas a dar de baja ${edificio.nombre}. Esta acción no se puede deshacer desde la app.`}
        confirmText="Eliminar edificio"
        variant="danger"
        requireText={edificio.nombre}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
