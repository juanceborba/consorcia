// frontend/src/pages/configuracion/StaffEditarDialog.jsx — ConsorcIA
// Edición de una membresía staff (S4-07, PRD-04-11 §4 "gestión posterior"):
// cambiar rol y editar los edificios del gestor.
//
// PATCH /api/organizaciones/me/usuarios/:usuarioId — el `:id` es el usuarioId
// (identidad global), no el id de la membresía. El PATCH REEMPLAZA el set de
// edificios y promover a ORG_ADMIN los limpia, así que el multi-select se
// deshabilita cuando el rol elegido es administrador.
//
// 422 ULTIMO_ORG_ADMIN (§9): degradar al último org_admin activo dejaría a la
// organización sin nadie que administre usuarios → el mensaje del backend va a
// un toast de error y el diálogo queda abierto para corregir.
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { editarStaffSchema, ROLES_STAFF } from '@/lib/staff-schema';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import EdificiosCheckboxGroup from '@/pages/configuracion/EdificiosCheckboxGroup';

export default function StaffEditarDialog({
  miembro,
  isOpen,
  onClose,
  edificios,
  cargandoEdificios,
}) {
  const queryClient = useQueryClient();

  const {
    control,
    register,
    watch,
    reset,
    handleSubmit,
    formState: { errors, isValid, isDirty },
  } = useForm({
    resolver: zodResolver(editarStaffSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { rol: 'GESTOR', edificioIds: [] },
  });

  // Los valores del miembro llegan cuando se abre el diálogo desde la fila.
  useEffect(() => {
    if (miembro) {
      reset({
        rol: miembro.rol,
        edificioIds: miembro.edificios.map((e) => e.id),
      });
    }
  }, [miembro, reset]);

  const esGestor = watch('rol') === 'GESTOR';

  const mutation = useMutation({
    mutationFn: (valores) =>
      api.patch(`/api/organizaciones/me/usuarios/${miembro.id}`, {
        rol: valores.rol,
        // Un ORG_ADMIN no lleva edificios (el backend rechaza el set y el
        // PATCH los limpia solo); solo se manda el reemplazo del gestor.
        ...(valores.rol === 'GESTOR' ? { edificioIds: valores.edificioIds } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizaciones.staff() });
      toast.success('Permisos actualizados');
      onClose();
    },
    onError: (err) => {
      // 422 ULTIMO_ORG_ADMIN entre otros: el message del contrato ya explica qué hacer.
      toast.error('No se pudieron actualizar los permisos', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  if (!miembro) return null;

  const nombreCompleto = [miembro.nombre, miembro.apellido]
    .filter(Boolean)
    .join(' ');

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Editar permisos"
      description={`${nombreCompleto || miembro.email} — ${miembro.email}`}
      size="lg"
    >
      <form
        onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-editar-rol">Rol</Label>
          <Select id="staff-editar-rol" {...register('rol')}>
            {ROLES_STAFF.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          {errors.rol && (
            <p className="text-sm text-destructive">{errors.rol.message}</p>
          )}
        </div>

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

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!isValid || !isDirty || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
