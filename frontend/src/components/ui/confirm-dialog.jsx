// frontend/src/components/ui/confirm-dialog.jsx — ConsorcIA
// ConfirmDialog (PRD-07-02 §4.8, componente de dominio): diálogo de
// confirmación para operaciones delicadas o destructivas (flujo §6.3).
// Implementado sobre AlertDialog de Base UI (modal, no cierra por click
// fuera ni pierde el foco). Con `requireText`, el botón de confirmar solo se
// habilita cuando el texto tipeado coincide exactamente (ej. el nombre del
// edificio a eliminar). `loading` cubre el estado "Procesando..." de §6.3.
import { useEffect, useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const VARIANTES = {
  danger: { icon: AlertTriangle, iconClass: 'text-destructive', confirmVariant: 'destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-warning', confirmVariant: 'default' },
  info: { icon: Info, iconClass: 'text-info', confirmVariant: 'default' },
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger',
  requireText,
  loading = false,
}) {
  const [texto, setTexto] = useState('');

  // El texto de confirmación no sobrevive al cierre del diálogo.
  useEffect(() => {
    if (!isOpen) setTexto('');
  }, [isOpen]);

  const { icon: Icono, iconClass, confirmVariant } =
    VARIANTES[variant] ?? VARIANTES.danger;
  const faltaTexto = requireText ? texto !== requireText : false;

  return (
    <AlertDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg">
          <div className="flex items-center gap-2">
            <Icono className={cn('size-5 shrink-0', iconClass)} aria-hidden />
            <AlertDialog.Title className="text-lg font-semibold">
              {title}
            </AlertDialog.Title>
          </div>
          <AlertDialog.Description className="text-sm text-muted-foreground">
            {description}
          </AlertDialog.Description>

          {requireText && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-dialog-require-text">
                Escribí <span className="font-semibold">{requireText}</span>{' '}
                para confirmar
              </Label>
              <Input
                id="confirm-dialog-require-text"
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                autoComplete="off"
                disabled={loading}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <AlertDialog.Close
              render={<Button type="button" variant="outline" disabled={loading} />}
            >
              {cancelText}
            </AlertDialog.Close>
            <Button
              type="button"
              variant={confirmVariant}
              disabled={faltaTexto || loading}
              onClick={onConfirm}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {confirmText}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
