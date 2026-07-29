// frontend/src/components/layout/SinAccesoOrganizacion.jsx — ConsorcIA
// Pantalla para el usuario autenticado que NO tiene acceso a ninguna
// organización (S4-11 / QA-03).
//
// Pasa cuando a alguien le dieron de baja su membresía staff, o cuando la
// identidad existe sin ningún vínculo (`encargado@demo.com` en el seed). El
// login devuelve 200 con `organizaciones: []`, `organizacionId: null` y
// `roles: []`, y a partir de ahí todo responde 403 SIN_ORGANIZACION_ACTIVA.
//
// Antes eso se veía como "No se pudieron cargar los edificios. Intentá de nuevo
// más tarde." — un error transitorio con invitación a reintentar para lo que es
// una condición PERMANENTE de permisos, y sin más salida que desloguearse a
// mano. Acá se dice qué pasó, qué hacer y se ofrece cerrar sesión.
import { useNavigate } from 'react-router';
import { ShieldOff } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function SinAccesoOrganizacion() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const salir = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <ShieldOff className="size-8 text-muted-foreground" />
          <CardTitle>Tu cuenta no tiene acceso a ninguna organización</CardTitle>
          <CardDescription>
            Entraste como <strong>{user?.email}</strong>, pero esta cuenta no
            tiene hoy ninguna administración asignada ni ninguna unidad a su
            nombre. Contactá a tu administración para que te den acceso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={salir}>
            Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
