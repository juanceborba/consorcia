// frontend/src/main.jsx — ConsorcIA
// Entry point: TanStack Query (S2-04) + React Router 7 en modo data router
// (createBrowserRouter, S2-06: habilita useBlocker para confirmar salida con
// cambios sin guardar en formularios) + estilos globales (Tailwind 4 +
// shadcn/ui). /login es pública; el resto pasa por RequireAuth (S1-11) y
// AppLayout (S1-12).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import RequireAuth from '@/components/auth/RequireAuth';
import RequireRole from '@/components/auth/RequireRole';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import EdificiosPage from '@/pages/EdificiosPage';
import EdificioNuevoPage from '@/pages/EdificioNuevoPage';
import EdificioDetallePage from '@/pages/EdificioDetallePage';
import EdificioOverviewTab from '@/pages/edificio/EdificioOverviewTab';
import EdificioUnidadesTab from '@/pages/edificio/EdificioUnidadesTab';
import EdificioConfiguracionTab from '@/pages/edificio/EdificioConfiguracionTab';
import ConfiguracionUsuariosPage from '@/pages/configuracion/ConfiguracionUsuariosPage';
import './index.css';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    // Rutas privadas: guard de auth + layout con sidebar/header
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/edificios', element: <EdificiosPage /> },
          {
            // Alta de edificio: solo org_admin/superadmin (qa S2 #1). El
            // backend ya devuelve 403 al resto; esto evita mostrar un form
            // que siempre falla al submit.
            element: <RequireRole roles={['org_admin', 'superadmin']} />,
            children: [
              { path: '/edificios/nuevo', element: <EdificioNuevoPage /> },
              // Backoffice de staff (S4-07, PRD-04-11 §4): administrar usuarios
              // es exclusivo de org_admin (Cerbos `staff` no le da al gestor ni
              // lectura de la nómina), así que la ruta va detrás del guard.
              {
                path: '/configuracion/usuarios',
                element: <ConfiguracionUsuariosPage />,
              },
            ],
          },
          {
            // Detalle con tabs anidados (S2-07, PRD-07-03 §2): /edificios/:id
            // redirige a /unidades (tab default).
            path: '/edificios/:id',
            element: <EdificioDetallePage />,
            children: [
              { index: true, element: <Navigate to="unidades" replace /> },
              { path: 'overview', element: <EdificioOverviewTab /> },
              { path: 'unidades', element: <EdificioUnidadesTab /> },
              { path: 'configuracion', element: <EdificioConfiguracionTab /> },
            ],
          },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
