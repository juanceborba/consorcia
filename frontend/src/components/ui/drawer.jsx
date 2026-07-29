// frontend/src/components/ui/drawer.jsx — ConsorcIA
// Panel lateral (S4-08) sobre Dialog de Base UI, misma familia que el modal de
// §3.6 y el ConfirmDialog de §4.8. Se usa cuando el contenido es una vista
// secundaria de una fila de tabla (los residentes de una UF) y conviene no
// tapar la tabla: el panel entra por el borde derecho y ocupa el alto completo.
//
// Igual que el Dialog: cierra con Escape y con la X, no por click fuera (los
// formularios de dominio confirman antes de perder cambios, §6.1.8).
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZES = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  size = 'lg',
  children,
}) {
  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Popup
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col gap-4 overflow-y-auto border-l bg-background p-6 shadow-lg',
            SIZES[size] ?? SIZES.lg,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Cerrar"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
