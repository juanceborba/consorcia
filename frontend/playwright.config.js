// frontend/playwright.config.js — Smoke E2E en browser real (S1-14)
// Corre DESDE EL HOST (no en el contenedor): requiere una sola vez
//   npm install -D @playwright/test && npx playwright install chromium
// y el stack levantado (make up + make db-seed). Ejecutar: npm run test:e2e
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
