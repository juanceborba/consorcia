// frontend/src/components/layout/AppLayout.jsx — ConsorcIA
// Layout de la app autenticada (S1-12): sidebar con módulos (solo Edificios
// activo en S1) y header con organización, selector de edificio de trabajo
// y menú de usuario con logout.
import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Building2, ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import { useEdificioStore } from '@/stores/edificio.store';
import { useEdificios } from '@/hooks/useEdificios';
import { useMisUnidades } from '@/hooks/useMisUnidades';
import { useOrganizacion } from '@/hooks/useOrganizacion';
import { esResidentePuro, sinAcceso } from '@/lib/acceso';
import AyudaDrawer from '@/components/ayuda/AyudaDrawer';
import Breadcrumbs from '@/components/layout/Breadcrumbs';
import OrganizacionSelector from '@/components/layout/OrganizacionSelector';
import SinAccesoOrganizacion from '@/components/layout/SinAccesoOrganizacion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Módulos del sidebar (PRD-07-03 §4). "Usuarios" (S4-07) solo se muestra a
// org_admin: Cerbos no le da al gestor ni lectura de la nómina, así que el
// gestor vería un link que siempre responde 403 (know-how
// pattern/require-role-guards-ui).
const MODULOS = [
  { nombre: 'Edificios', path: '/edificios', activo: true },
  { nombre: 'Gastos', activo: false },
  { nombre: 'Liquidaciones', activo: false },
  { nombre: 'Cobranzas', activo: false },
  {
    nombre: 'Usuarios',
    path: '/configuracion/usuarios',
    activo: true,
    roles: ['org_admin', 'superadmin'],
  },
];

// Sidebar del residente puro (S4-12, #58): ningún módulo del backoffice le
// responde 200 (todos pasan por `tenant` y él no tiene org activa). Su única
// vista hoy es la lectura de sus UFs; el portal completo es S5 (PRD-04-05).
const MODULOS_RESIDENTE = [
  { nombre: 'Mis unidades', path: '/mis-unidades', activo: true },
  { nombre: 'Expensas', activo: false },
  { nombre: 'Pagos', activo: false },
];

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  // El residente puro no tiene organización activa: /api/edificios y
  // /api/organizaciones/me le responden 403 SIN_ORGANIZACION_ACTIVA. Su
  // contexto sale de sus vínculos (GET /api/me/unidades), así que las queries
  // del backoffice ni se disparan — antes reintentaban 3 veces y dejaban el
  // header en "Sin edificios" (#58, BUG 2).
  const residente = esResidentePuro(user);
  const staff = useEdificios({ enabled: !residente });
  const misUnidades = useMisUnidades({ enabled: residente });
  const edificios = residente ? misUnidades.edificios : staff.edificios;
  const cargando = residente ? misUnidades.cargando : staff.cargando;

  const edificioId = useEdificioStore((s) => s.edificioId);
  const setEdificioId = useEdificioStore((s) => s.setEdificioId);
  // Nombre de la organización para el header (GET /api/organizaciones/me). Al
  // residente lo administran N organizaciones (una por consorcio), así que la
  // suya sale del vínculo, no de una organización activa que no tiene.
  const { organizacion } = useOrganizacion({ enabled: !residente });
  const organizacionResidente =
    misUnidades.vinculos.find((v) => v.edificio.id === edificioId)?.organizacion ??
    misUnidades.vinculos[0]?.organizacion ??
    null;

  // Si no hay edificio elegido (o el guardado ya no es visible), usar el primero.
  useEffect(() => {
    if (edificios.length > 0 && !edificios.some((e) => e.id === edificioId)) {
      setEdificioId(edificios[0].id);
    }
  }, [edificios, edificioId, setEdificioId]);

  const edificioActual = edificios.find((e) => e.id === edificioId) ?? null;

  // Los módulos con `roles` se ocultan a quien no los tiene.
  const roles = user?.roles ?? SIN_ROLES;
  const modulosVisibles = residente
    ? MODULOS_RESIDENTE
    : MODULOS.filter(
        (modulo) =>
          !modulo.roles || modulo.roles.some((rol) => roles.includes(rol)),
      );

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Sin membresía activa Y sin vínculos de unidad no hay nada que mostrar: el
  // shell entero responde 403 y el usuario veía un error de red genérico
  // (S4-11 / QA-03). Es una condición permanente, así que va antes del layout.
  // Un residente puro sí entra: no tiene organización activa pero sí roles.
  if (sinAcceso(user)) {
    return <SinAccesoOrganizacion />;
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar de módulos */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="text-lg font-semibold">ConsorcIA</span>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {modulosVisibles.map((modulo) =>
            modulo.activo ? (
              <NavLink
                key={modulo.nombre}
                to={modulo.path}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60',
                  )
                }
              >
                {modulo.nombre}
              </NavLink>
            ) : (
              <span
                key={modulo.nombre}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
                title="Disponible próximamente"
              >
                {modulo.nombre}
                <Badge variant="secondary" className="text-[10px]">
                  {residente ? 'S5' : 'S2+'}
                </Badge>
              </span>
            ),
          )}
        </nav>
      </aside>

      {/* Columna principal: header + contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b px-4">
          {/* Organización (tenant raíz del SaaS). Con más de una membresía
              activa pasa a ser un selector de contexto (S4-09); con una sola
              es texto, que es el caso de la enorme mayoría. */}
          {(user?.organizaciones?.length ?? 0) > 1 ? (
            <OrganizacionSelector />
          ) : (
            <span className="truncate text-sm font-medium">
              {(residente ? organizacionResidente?.nombre : organizacion?.nombre) ??
                '…'}
            </span>
          )}

          {/* Selector de edificio de trabajo */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cargando || edificios.length === 0}
                />
              }
            >
              <Building2 className="size-4" />
              <span className="max-w-40 truncate">
                {cargando
                  ? 'Cargando…'
                  : (edificioActual?.nombre ?? 'Sin edificios')}
              </span>
              <ChevronsUpDown className="size-4 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {residente ? 'Mi edificio' : 'Edificio de trabajo'}
                </DropdownMenuLabel>
                {edificios.map((edificio) => (
                  <DropdownMenuItem
                    key={edificio.id}
                    onClick={() => {
                      setEdificioId(edificio.id);
                      // El residente no tiene acceso al detalle de staff:
                      // su vista es la lectura de sus propias UFs.
                      navigate(
                        residente
                          ? '/mis-unidades'
                          : `/edificios/${edificio.id}/unidades`,
                      );
                    }}
                  >
                    <span
                      className={cn(
                        edificio.id === edificioId && 'font-semibold',
                      )}
                    >
                      {edificio.nombre}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto">
            {/* Menú de usuario */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="sm" />}
              >
                <UserRound className="size-4" />
                <span className="max-w-40 truncate">
                  {user?.nombre ?? user?.email}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span>{user?.nombre}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {user?.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="size-4" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-6">
          {/* Breadcrumbs dinámicos (S2-11, PRD-07-03 §5) */}
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>

      {/* Ayuda contextual: una sola instancia para toda la app autenticada.
          Vive fuera de la columna principal (portal propio) para poder abrirse
          encima de cualquier Dialog de dominio sin cerrarlo. */}
      <AyudaDrawer />
    </div>
  );
}
