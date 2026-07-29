// frontend/src/components/auth/RequireRole.jsx — ConsorcIA
// Guard de rutas por rol (S2 pre-ship, qa #1): si el usuario no tiene
// ninguno de los roles requeridos, redirige al listado de edificios.
// Es solo UX/defensa en profundidad — la autorización real la hace el
// backend (Cerbos, fail-closed con 403).
import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';

export default function RequireRole({ roles }) {
  const userRoles = useAuthStore((s) => s.user?.roles ?? []);

  if (!roles.some((rol) => userRoles.includes(rol))) {
    return <Navigate to="/edificios" replace />;
  }
  return <Outlet />;
}
