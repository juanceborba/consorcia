// frontend/src/components/invitaciones/InvitacionLinkDialog.jsx — ConsorcIA
// Modal con el link de invitación para copiar (PRD-04-11 §4.4 y §5.4). En el
// MVP no hay envío de email (AgentMail llega post-beta, PRD-05-01): el backend
// devuelve `invitacionUrl` + `emailEnviado: false` y la única forma de que la
// persona active su cuenta es que el admin le pase este link.
//
// Compartido por el alta de staff (S4-07) y la de residentes (S4-08).
//
// El link es una credencial de un solo uso: se muestra completo en un input
// readOnly (seleccionable para copiar a mano si la Clipboard API no está
// disponible — contexto no seguro, permiso denegado) y el texto aclara que
// vence a los 7 días.
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatearVencimiento(expiraAt) {
  if (!expiraAt) return null;
  const fecha = new Date(expiraAt);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function InvitacionLinkDialog({
  isOpen,
  onClose,
  invitacion,
  title = 'Invitación creada',
}) {
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState(false);

  // El feedback de copiado no sobrevive al cierre del modal.
  useEffect(() => {
    if (!isOpen) {
      setCopiado(false);
      setErrorCopia(false);
    }
  }, [isOpen]);

  const url = invitacion?.invitacionUrl ?? '';
  const vence = formatearVencimiento(invitacion?.invitacion?.expiraAt);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setErrorCopia(false);
    } catch {
      // Sin Clipboard API (http en LAN, permiso denegado): el input queda
      // seleccionado para copiar con el teclado.
      setErrorCopia(true);
      setCopiado(false);
      document.getElementById('invitacion-url')?.select();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={
        invitacion?.usuario?.email
          ? `Pasale este link a ${invitacion.usuario.email} para que defina su contraseña y entre. Todavía no enviamos emails automáticos.`
          : 'Pasale este link a la persona invitada para que defina su contraseña y entre. Todavía no enviamos emails automáticos.'
      }
      size="lg"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="invitacion-url">Link de invitación</Label>
        <div className="flex gap-2">
          <Input
            id="invitacion-url"
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={copiar}>
            {copiado ? (
              <Check className="size-4 text-success" />
            ) : (
              <Copy className="size-4" />
            )}
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        {errorCopia && (
          <p className="text-sm text-warning">
            No pudimos copiarlo automáticamente: seleccionalo y copialo con el
            teclado.
          </p>
        )}
        {vence && (
          <p className="text-sm text-muted-foreground">
            El link vence el {vence} y sirve una sola vez. Si vence, volvé a
            invitar a la persona para generar uno nuevo.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Dialog>
  );
}
