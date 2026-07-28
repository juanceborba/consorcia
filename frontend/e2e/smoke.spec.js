// frontend/e2e/smoke.spec.js — Smoke E2E del slice S1 en browser real (S1-14)
// Flujo: redirect a /login sin sesión → login con admin@demo.com → lista de
// edificios (2 cards) → detalle con tabla de unidades → logout.
// Requiere el stack levantado con el seed (make up && make db-seed).

import { expect, test } from '@playwright/test';

test('smoke S1: login → edificios → detalle → logout', async ({ page }) => {
  await test.step('sin sesión, / redirige a /login', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('login con admin@demo.com', async () => {
    await page.locator('#email').fill('admin@demo.com');
    await page.locator('#password').fill('demo1234');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    // Vuelve a la ruta original (/) guardada por RequireAuth
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('la lista muestra 2 cards de edificios', async () => {
    await page.getByRole('link', { name: 'Edificios' }).click();
    await expect(page).toHaveURL(/\/edificios$/);
    // Excluye el link "Nuevo edificio" (/edificios/nuevo, agregado en S2-06)
    await expect(
      page.locator('a[href^="/edificios/"]:not([href="/edificios/nuevo"])'),
    ).toHaveCount(2);
  });

  await test.step('el detalle muestra la tabla de unidades', async () => {
    await page.getByRole('link', { name: /Torre Palermo/ }).click();
    await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('table')).toBeVisible();
    // Torre Palermo tiene 13 unidades en el seed; la fila "PB" siempre existe
    await expect(page.getByRole('cell', { name: 'PB' })).toBeVisible();
  });

  await test.step('logout vuelve a /login', async () => {
    await page.getByRole('button', { name: /María Fernanda/ }).click();
    await page.getByRole('menuitem', { name: /Cerrar sesión/ }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
