// frontend/src/components/auth/UsuariosDemoDialog.jsx — ConsorcIA
// Diálogo "Usuarios de demo" del login (S3-22c): las identidades que crea el
// seed, con lo que cada una PUEDE y NO PUEDE hacer.
//
// POR QUÉ EXISTE: hasta acá el login ofrecía dos emails sueltos en una línea de
// texto y el resto del elenco vivía en AGENTS.md, que lee un agente y no una
// persona que abre la demo. Sin esto, la pregunta "¿por qué este usuario no ve
// el botón Nuevo gasto?" se responde leyendo policies de Cerbos.
//
// DECISIONES:
//
// 1. SOLO EN DEV (o con `VITE_DEMO_USUARIOS=1`). Son credenciales en pantalla:
//    en un deploy real serían una lista de cuentas válidas servida al público.
//    El flag permite encenderlo a propósito en un entorno de demo, que es el
//    único caso donde tiene sentido.
//
// 2. CADA TARJETA COMPLETA EL FORMULARIO en vez de pedir copiar y pegar: es la
//    acción que sigue el 100% de las veces. El de la invitación pendiente no
//    tiene contraseña (todavía no la eligió), así que en vez de un botón que
//    fallaría al submit lleva el link de activación, que es su recorrido real.
//
// 3. EL CONTENIDO NO VIVE ACÁ, sino en `lib/usuarios-demo.js`, con su gate
//    (`npm run check:demo`) contra el seed. Este componente solo lo dibuja.
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, X } from 'lucide-react';
import {
  PASSWORD_DEMO,
  USUARIOS_DEMO,
} from '@/lib/usuarios-demo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

// Decisión 1: el diálogo no se monta si no corresponde.
export const HAY_USUARIOS_DEMO =
  import.meta.env.DEV || import.meta.env.VITE_DEMO_USUARIOS === '1';

function Lista({ titulo, items, Icono, tono }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground uppercase">{titulo}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <Icono className={`mt-0.5 size-3.5 shrink-0 ${tono}`} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function UsuariosDemoDialog({ onUsar }) {
  const [abierto, setAbierto] = useState(false);
  if (!HAY_USUARIOS_DEMO) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4 w-full"
        onClick={() => setAbierto(true)}
      >
        Ver los usuarios de demo y qué puede hacer cada uno
      </Button>

      <Dialog
        isOpen={abierto}
        onClose={() => setAbierto(false)}
        size="xl"
        title="Usuarios de demo"
        description={`Las identidades que crea el seed, de más alcance a menos. La contraseña de todas es "${PASSWORD_DEMO}".`}
      >
        <ul className="flex flex-col gap-3">
          {USUARIOS_DEMO.map((usuario) => (
            <li key={usuario.email} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{usuario.rol}</span>
                    <Badge variant="secondary">{usuario.alcance}</Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {usuario.nombre} · <code>{usuario.email}</code>
                  </span>
                </div>

                {/* Decisión 2. */}
                {usuario.sinPassword ? (
                  <Button
                    render={<Link to="/invitacion/seed-invitacion-pendiente" />}
                    variant="outline"
                    size="sm"
                  >
                    Activar la invitación
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onUsar(usuario.email);
                      setAbierto(false);
                    }}
                  >
                    Usar esta cuenta
                  </Button>
                )}
              </div>

              <p className="text-sm">{usuario.resumen}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <Lista
                  titulo="Puede"
                  items={usuario.puede}
                  Icono={Check}
                  tono="text-success"
                />
                <Lista
                  titulo="No puede"
                  items={usuario.noPuede}
                  Icono={X}
                  tono="text-muted-foreground"
                />
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
