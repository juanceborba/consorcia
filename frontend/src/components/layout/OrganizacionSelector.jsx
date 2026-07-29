// frontend/src/components/layout/OrganizacionSelector.jsx — ConsorcIA
// Selector de organización activa del header (S4-09, PRD-04-11 §4.6). Con
// identidad global una misma persona puede ser staff de N administraciones con
// un solo login; este dropdown cambia el contexto SIN re-login.
//
// Solo se muestra con MÁS DE UNA membresía activa: con una sola no hay nada
// entre lo que elegir, y un residente puro (sin membresías staff) tiene
// `organizaciones: []`. La lista sale del DTO de usuario de las respuestas de
// auth (`user.organizaciones`), no de un endpoint extra.
//
// POST /api/auth/cambiar-organizacion re-emite el par access/refresh con los
// claims de la organización elegida (`org_id`, `roles`, `edificios_asignados`).
// Después del cambio hay que:
//   1. guardar los tokens nuevos (los viejos siguen apuntando a la org anterior);
//   2. `queryClient.clear()` — TODO el cache es de otro tenant, no alcanza con
//      invalidar: mostrar edificios de la org A mientras carga la B sería una
//      fuga de datos entre administraciones;
//   3. olvidar el edificio de trabajo, que es de la organización que se deja;
//   4. redirigir al dashboard: la ruta actual puede referirse a un recurso de
//      la organización anterior (`/edificios/:id` de la org A → 403/404 en B).
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useEdificioStore } from '@/stores/edificio.store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export default function OrganizacionSelector() {
  const user = useAuthStore((s) => s.user);
  const establecerSesion = useAuthStore((s) => s.establecerSesion);
  const setEdificioId = useEdificioStore((s) => s.setEdificioId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [cambiando, setCambiando] = useState(false);

  const organizaciones = user?.organizaciones ?? [];
  const activaId = user?.organizacionId ?? null;

  // Con una sola membresía (o ninguna: residente puro) no hay selector.
  if (organizaciones.length <= 1) return null;

  const activa = organizaciones.find((o) => o.id === activaId) ?? null;

  const cambiar = async (organizacionId) => {
    if (organizacionId === activaId || cambiando) return;
    const destino = organizaciones.find((o) => o.id === organizacionId);
    setCambiando(true);
    try {
      // El refreshToken de la sesión que se deja va en el body: el backend lo
      // revoca antes de emitir el par nuevo (rotación) en vez de dejarlo vivo
      // apuntando a la organización anterior.
      const sesion = await api.post('/api/auth/cambiar-organizacion', {
        organizacionId,
        refreshToken: useAuthStore.getState().refreshToken ?? undefined,
      });
      establecerSesion(sesion);
      setEdificioId(null);
      queryClient.clear();
      navigate('/', { replace: true });
      toast.success(`Estás en ${destino?.nombre ?? 'la organización elegida'}`);
    } catch (err) {
      // 403 SIN_MEMBRESIA: la membresía pudo desactivarse con el token vivo.
      toast.error('No se pudo cambiar de organización', {
        description: err.message ?? 'Error inesperado',
      });
    } finally {
      setCambiando(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={cambiando} />
        }
      >
        {cambiando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Building className="size-4" />
        )}
        <span className="max-w-48 truncate">
          {activa?.nombre ?? user?.email ?? 'Organización'}
        </span>
        <ChevronsUpDown className="size-4 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organización activa</DropdownMenuLabel>
          {organizaciones.map((organizacion) => (
            <DropdownMenuItem
              key={organizacion.id}
              onClick={() => cambiar(organizacion.id)}
            >
              <Check
                className={cn(
                  'size-4',
                  organizacion.id === activaId ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span
                className={cn(
                  'flex-1 truncate',
                  organizacion.id === activaId && 'font-semibold',
                )}
              >
                {organizacion.nombre}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
