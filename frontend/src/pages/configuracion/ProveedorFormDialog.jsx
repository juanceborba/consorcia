// frontend/src/pages/configuracion/ProveedorFormDialog.jsx — ConsorcIA
// Alta y edición de un proveedor PROPIO de la organización (S3-14,
// PRD-04-02 §1.3). Un solo diálogo para los dos modos: los campos son los
// mismos y el único cambio es el verbo (POST /api/proveedores vs
// PUT /api/proveedores/:id).
//
// Se reusa desde dos lugares:
//   1. la pantalla de administración (/configuracion/proveedores),
//   2. el alta inline del selector de proveedor del form de gasto
//      (ProveedorSelect), que necesita el proveedor creado para dejarlo
//      seleccionado — de ahí el callback `onGuardado(proveedor)`.
//
// Errores que el usuario puede corregir se muestran INLINE en su campo, no en un
// toast: `409 CUIT_DUPLICADO` va al campo cuit y `422 RUBRO_INVALIDO` al rubro
// habitual (pasa si el rubro se ocultó en otra pestaña mientras el diálogo
// estaba abierto). El resto va a un toast de error.
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  aFormulario,
  aPayload,
  PROVEEDOR_VACIO,
  proveedorSchema,
} from '@/lib/proveedor-schema';
import { opcionesPlanas } from '@/lib/rubro-schema';
import { useRubros } from '@/hooks/useRubros';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

// Campo de texto con label y error inline. Local al diálogo: el resto de la app
// arma sus campos a mano y no hay un componente de formulario compartido todavía.
function Campo({ id, label, error, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function ProveedorFormDialog({
  proveedor = null,
  razonSocialInicial = '',
  isOpen,
  onClose,
  onGuardado,
}) {
  const queryClient = useQueryClient();
  const esEdicion = proveedor !== null;

  // El rubro habitual es una sugerencia: solo se ofrecen los rubros USABLES (sin
  // ocultos), porque el backend valida contra ese mismo árbol.
  const { arbol, cargando: cargandoRubros } = useRubros({ enabled: isOpen });
  const opcionesRubro = opcionesPlanas(arbol);

  const {
    register,
    reset,
    setError,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(proveedorSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: PROVEEDOR_VACIO,
  });

  // Cada apertura reinicia el form: alta → vacío, edición → los datos de la
  // fila. Sin esto, cerrar y abrir sobre otro proveedor arrastra los valores del
  // anterior.
  // `razonSocialInicial` es lo que el alta inline del selector de proveedor ya
  // tenía tipeado (S3-08): su botón promete `Crear "Plomería del Sur"`, así que
  // el diálogo tiene que abrir con ese nombre puesto en vez de en blanco.
  useEffect(() => {
    if (isOpen) {
      reset(
        esEdicion
          ? aFormulario(proveedor)
          : { ...PROVEEDOR_VACIO, razonSocial: razonSocialInicial },
      );
    }
  }, [isOpen, esEdicion, proveedor, razonSocialInicial, reset]);

  const mutation = useMutation({
    mutationFn: (valores) =>
      esEdicion
        ? api.put(`/api/proveedores/${proveedor.id}`, aPayload(valores))
        : api.post('/api/proveedores', aPayload(valores)),
    onSuccess: (guardado) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proveedores.all });
      toast.success(esEdicion ? 'Proveedor actualizado' : 'Proveedor creado', {
        description: guardado.razonSocial,
      });
      onGuardado?.(guardado);
      onClose();
    },
    onError: (err) => {
      if (err.code === 'CUIT_DUPLICADO') {
        setError('cuit', { type: 'server', message: err.message });
        return;
      }
      if (err.code === 'RUBRO_INVALIDO') {
        setError('rubroHabitualId', { type: 'server', message: err.message });
        return;
      }
      toast.error(
        esEdicion
          ? 'No se pudo actualizar el proveedor'
          : 'No se pudo crear el proveedor',
        { description: err.message ?? 'Error inesperado' },
      );
    },
  });

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}
      description={
        esEdicion
          ? proveedor.razonSocial
          : 'Queda en el directorio de tu organización. Solo la razón social es obligatoria.'
      }
      size="xl"
    >
      <form
        onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
        className="flex flex-col gap-4"
      >
        <Campo id="proveedor-razon-social" label="Razón social *" error={errors.razonSocial}>
          <Input
            id="proveedor-razon-social"
            autoComplete="off"
            placeholder="Ascensores del Plata S.A."
            aria-invalid={errors.razonSocial ? true : undefined}
            {...register('razonSocial')}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            id="proveedor-cuit"
            label="CUIT"
            error={errors.cuit}
            hint="Formato 30-12345678-9. Se usa para no duplicar proveedores."
          >
            <Input
              id="proveedor-cuit"
              autoComplete="off"
              placeholder="30-12345678-9"
              inputMode="numeric"
              aria-invalid={errors.cuit ? true : undefined}
              {...register('cuit')}
            />
          </Campo>

          <Campo
            id="proveedor-rubro"
            label="Rubro habitual"
            error={errors.rubroHabitualId}
            hint="Se sugiere al cargar un gasto de este proveedor."
          >
            <Select
              id="proveedor-rubro"
              disabled={cargandoRubros}
              aria-invalid={errors.rubroHabitualId ? true : undefined}
              {...register('rubroHabitualId')}
            >
              <option value="">
                {cargandoRubros ? 'Cargando rubros…' : 'Sin rubro habitual'}
              </option>
              {opcionesRubro.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.etiqueta}
                </option>
              ))}
            </Select>
          </Campo>

          <Campo id="proveedor-email" label="Email" error={errors.email}>
            <Input
              id="proveedor-email"
              type="email"
              autoComplete="off"
              placeholder="contacto@proveedor.com"
              aria-invalid={errors.email ? true : undefined}
              {...register('email')}
            />
          </Campo>

          <Campo id="proveedor-telefono" label="Teléfono" error={errors.telefono}>
            <Input
              id="proveedor-telefono"
              autoComplete="off"
              placeholder="11 4567-8900"
              aria-invalid={errors.telefono ? true : undefined}
              {...register('telefono')}
            />
          </Campo>
        </div>

        <Campo id="proveedor-direccion" label="Dirección" error={errors.direccion}>
          <Input
            id="proveedor-direccion"
            autoComplete="off"
            aria-invalid={errors.direccion ? true : undefined}
            {...register('direccion')}
          />
        </Campo>

        <Campo
          id="proveedor-notas"
          label="Notas internas"
          error={errors.notas}
          hint="Solo las ve el staff de tu organización."
        >
          <textarea
            id="proveedor-notas"
            rows={3}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
            aria-invalid={errors.notas ? true : undefined}
            {...register('notas')}
          />
        </Campo>

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={mutation.isPending || (esEdicion && !isDirty)}
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {mutation.isPending
              ? 'Guardando…'
              : esEdicion
                ? 'Guardar cambios'
                : 'Crear proveedor'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
