// frontend/src/components/auth/RequireAuth.jsx — ConsorcIA
// Guard de rutas privadas (S1-11): sin accessToken redirige a /login,
// guardando la ruta de origen para volver después del login.
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';

export default function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
