// frontend/playwright.config.js — E2E en browser real (S1-14, S2-12)
// Corre DESDE EL HOST (no en el contenedor) con el CLI de Playwright:
//   cd frontend && playwright test
// @playwright/test está en devDependencies (instalar siempre dentro del
// contenedor: docker exec consorcIA-frontend npm install); en el host se
// resuelve contra el CLI global. Requiere el stack levantado
// (make up + make db-seed) y chromium cacheado (playwright install chromium).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Secuencial: es un smoke con estado compartido (sesión, orden de pasos)
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
});
