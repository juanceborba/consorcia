// frontend/src/main.jsx — ConsorcIA
// Entry point: TanStack Query (S2-04) + React Router 7 en modo data router
// (createBrowserRouter, S2-06: habilita useBlocker para confirmar salida con
// cambios sin guardar en formularios) + estilos globales (Tailwind 4 +
// shadcn/ui). /login es pública; el resto pasa por RequireAuth (S1-11) y
// AppLayout (S1-12).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import RequireAuth from '@/components/auth/RequireAuth';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import EdificiosPage from '@/pages/EdificiosPage';
import EdificioNuevoPage from '@/pages/EdificioNuevoPage';
import EdificioDetallePage from '@/pages/EdificioDetallePage';
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
          { path: '/edificios/nuevo', element: <EdificioNuevoPage /> },
          { path: '/edificios/:id', element: <EdificioDetallePage /> },
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
