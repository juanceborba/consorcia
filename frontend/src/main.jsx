// frontend/src/main.jsx — ConsorcIA
// Entry point: React Router 7 + estilos globales (Tailwind 4 + shadcn/ui).
// /login es pública; el resto pasa por RequireAuth (S1-11) y AppLayout (S1-12).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import RequireAuth from '@/components/auth/RequireAuth';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import EdificiosPage from '@/pages/EdificiosPage';
import EdificioDetallePage from '@/pages/EdificioDetallePage';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Rutas privadas: guard de auth + layout con sidebar/header */}
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/edificios" element={<EdificiosPage />} />
            <Route path="/edificios/:id" element={<EdificioDetallePage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>,
);
