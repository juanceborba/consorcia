// frontend/src/main.jsx — ConsorcIA
// Entry point: React Router 7 + estilos globales (Tailwind 4 + shadcn/ui).
// Rutas placeholder (S1-10); guards de auth y layout real llegan en S1-11 a S1-13.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
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
        <Route path="/" element={<DashboardPage />} />
        <Route path="/edificios" element={<EdificiosPage />} />
        <Route path="/edificios/:id" element={<EdificioDetallePage />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>,
);
