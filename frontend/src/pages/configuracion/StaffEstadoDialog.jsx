// frontend/src/pages/configuracion/StaffEstadoDialog.jsx — ConsorcIA
// Activar / desactivar una membresía staff (S4-07). La baja es LÓGICA y sobre
// la membresía, no sobre el Usuario global (PRD-04-11 §4: la persona puede
// seguir siendo residente o staff de otra organización con el mismo login) —
// por eso el texto del diálogo lo aclara.
//
// Va por ConfirmDialog (PRD-07-02 §4.8/§6.3): quitarle el acceso a alguien es
// una operación delicada. Variante danger al desactivar, info al reactivar.
//
// 422 ULTIMO_ORG_ADMIN (§9): la organización debe conservar al menos un
// org_admin activo. El backend lo garantiza con un lock de la fila de la
// organización; acá el mensaje va a un toast de error.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export default function StaffEstadoDialog({ miembro, isOpen, onClose }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (activo) =>
      api.patch(`/api/organizaciones/me/usuarios/${miembro.id}`, { activo }),
    onSuccess: (actualizado) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizaciones.staff() });
      toast.success(
        actualizado.activo ? 'Membresía reactivada' : 'Membresía desactivada',
      );
      onClose();
    },
    onError: (err) => {
      toast.error('No se pudo cambiar el estado', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  if (!miembro) return null;

  const desactivando = miembro.activo;
  const quien =
    [miembro.nombre, miembro.apellido].filter(Boolean).join(' ') || miembro.email;

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => mutation.mutate(!miembro.activo)}
      loading={mutation.isPending}
      variant={desactivando ? 'danger' : 'info'}
      title={desactivando ? 'Desactivar membresía' : 'Reactivar membresía'}
      confirmText={desactivando ? 'Desactivar' : 'Reactivar'}
      description={
        desactivando
          ? `${quien} pierde el acceso al backoffice de esta organización. Su cuenta de ConsorcIA sigue existiendo (puede ser residente o staff de otra administración) y podés reactivarla cuando quieras.`
          : `${quien} vuelve a tener acceso al backoffice de esta organización con el rol y los edificios que ya tenía.`
      }
    />
  );
}
