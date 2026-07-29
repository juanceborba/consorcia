// frontend/src/components/auth/RequireStaff.jsx — ConsorcIA
// Guard de las rutas del backoffice (S4-12, #58).
//
// Todo el backoffice pasa por el middleware `tenant`, que responde 403
// SIN_ORGANIZACION_ACTIVA si el JWT no trae `org_id`. Un residente puro no lo
// trae por diseño (PRD-04-11 §5.5), así que sin este guard aterrizaba en un
// dashboard vacío con el selector de edificios deshabilitado (#58, BUG 2).
// Se lo manda a su vista de solo lectura en vez de dejarlo mirando un error
// transitorio (mismo criterio que QA-03).
import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';
import { esResidentePuro } from '@/lib/acceso';

export default function RequireStaff() {
  const user = useAuthStore((s) => s.user);

  if (esResidentePuro(user)) {
    return <Navigate to="/mis-unidades" replace />;
  }
  return <Outlet />;
}
