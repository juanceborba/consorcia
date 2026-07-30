// frontend/src/pages/configuracion/RubroFormDialog.jsx — ConsorcIA
// Alta y edición de un rubro o subrubro PROPIO de la organización (S3-14,
// PRD-04-02 §1.4). Los ítems del maestro de plataforma no pasan por acá: se
// ocultan con el toggle de visibilidad de la fila.
//
// El árbol tiene DOS niveles fijos (rubro → subrubro hoja), así que el alta solo
// necesita saber de qué rubro cuelga: `parentId` null = rubro de nivel 1. El
// padre viene fijado desde la fila que abrió el diálogo ("Agregar subrubro"), no
// se elige acá — elegirlo en un select duplicaría la decisión que el usuario ya
// tomó al hacer clic.
//
// En la EDICIÓN el padre no se muestra ni se manda: mover un rubro de padre
// cambiaría la segmentación de los gastos ya cargados (el backend tampoco lo
// acepta, ver rubro.schema.js).
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { RUBRO_VACIO, rubroSchema } from '@/lib/rubro-schema';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function RubroFormDialog({
  // Ítem a editar; null en el alta.
  rubro = null,
  // Rubro de nivel 1 del que cuelga el subrubro nuevo; null = rubro de nivel 1.
  padre = null,
  isOpen,
  onClose,
  onGuardado,
}) {
  const queryClient = useQueryClient();
  const esEdicion = rubro !== null;

  const {
    register,
    reset,
    setError,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(rubroSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: RUBRO_VACIO,
  });

  useEffect(() => {
    if (isOpen) {
      reset(
        esEdicion ? { nombre: rubro.nombre, orden: rubro.orden } : RUBRO_VACIO,
      );
    }
  }, [isOpen, esEdicion, rubro, reset]);

  const mutation = useMutation({
    mutationFn: (valores) =>
      esEdicion
        ? api.put(`/api/rubros/${rubro.id}`, valores)
        : api.post('/api/rubros', { ...valores, parentId: padre?.id ?? null }),
    onSuccess: (guardado) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rubros.all });
      toast.success(esEdicion ? 'Rubro actualizado' : 'Rubro creado', {
        description: guardado.nombre,
      });
      onGuardado?.(guardado);
      onClose();
    },
    onError: (err) => {
      // 409 RUBRO_DUPLICADO es corregible en el campo: el nombre ya existe entre
      // los hermanos VISIBLES del árbol mergeado (maestro incluido), así que el
      // duplicado puede ser contra un ítem del maestro que el usuario no cargó.
      if (err.code === 'RUBRO_DUPLICADO') {
        setError('nombre', { type: 'server', message: err.message });
        return;
      }
      toast.error(
        esEdicion ? 'No se pudo actualizar el rubro' : 'No se pudo crear el rubro',
        { description: err.message ?? 'Error inesperado' },
      );
    },
  });

  const esSubrubro = esEdicion ? rubro.parentId !== null : padre !== null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        esEdicion
          ? esSubrubro
            ? 'Editar subrubro'
            : 'Editar rubro'
          : esSubrubro
            ? 'Nuevo subrubro'
            : 'Nuevo rubro'
      }
      description={
        esEdicion
          ? rubro.nombre
          : padre
            ? `Cuelga de "${padre.nombre}". Los gastos se cargan a nombre de un subrubro.`
            : 'Rubro de primer nivel. Después podés colgarle subrubros.'
      }
    >
      <form
        onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="rubro-nombre">Nombre *</Label>
          <Input
            id="rubro-nombre"
            autoComplete="off"
            placeholder={esSubrubro ? 'Plomería' : 'Mantenimiento'}
            aria-invalid={errors.nombre ? true : undefined}
            {...register('nombre')}
          />
          {errors.nombre && (
            <p className="text-sm text-destructive">{errors.nombre.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="rubro-orden">Orden</Label>
          <Input
            id="rubro-orden"
            type="number"
            min={0}
            max={9999}
            className="max-w-24"
            aria-invalid={errors.orden ? true : undefined}
            {...register('orden')}
          />
          {errors.orden ? (
            <p className="text-sm text-destructive">{errors.orden.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Posición en la lista. A igual orden se ordena alfabéticamente.
            </p>
          )}
        </div>

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
                : 'Crear'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
