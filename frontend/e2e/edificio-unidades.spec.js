// frontend/e2e/edificio-unidades.spec.js — E2E del slice S2 en browser real (S2-12)
// Flujo del DoD del sprint, con la UX de #57 (invariante informativa): login
// admin → "Nuevo edificio" → alta → redirect al detalle → breadcrumbs (Inicio /
// Edificios / {nombre} / Unidades) → tab unidades → "+ Agregar" → modo bulk con
// coeficientes que suman 0.9: el feedback dice "falta 0.100000" pero Guardar
// sigue HABILITADO → se guarda igual → la tabla muestra las unidades, la fila
// TOTAL en warning y el Alert "Faltan 0.100000…" → se completa la unidad que
// falta desde el modo individual, con el coeficiente SUGERIDO a partir de los m²
// (m²/totalM2) → la fila TOTAL cierra en 1.000000 verde y el Alert desaparece.
// Cleanup: baja del edificio desde el tab Configuración (ConfirmDialog con
// requireText) + barrido por API en afterEach por si el test falla a mitad.
// Requiere el stack levantado con el seed (make up && make db-seed).

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const NOMBRE = `E2E ${Date.now()}`;

// Barrido de seguridad: borra (soft delete) cualquier edificio de prueba que
// haya quedado activo, así el spec es re-ejecutable y no deja basura.
test.afterEach(async ({ request }) => {
  const login = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const lista = await request.get(`${API_URL}/api/edificios`, { headers });
  for (const edificio of await lista.json()) {
    if (edificio.nombre.startsWith('E2E ')) {
      await request.delete(`${API_URL}/api/edificios/${edificio.id}`, { headers });
    }
  }
});

test('crear edificio y agregar unidades (bulk con invariante)', async ({ page }) => {
  await test.step('login con admin@demo.com', async () => {
    await page.goto('/login');
    await page.locator('#email').fill('admin@demo.com');
    await page.locator('#password').fill('demo1234');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    // Sin ruta origen guardada, RequireAuth cae en el listado de edificios
    await expect(page).toHaveURL(/\/edificios$/);
  });

  await test.step('alta de edificio desde "Nuevo edificio"', async () => {
    await page.goto('/edificios');
    await page.getByRole('link', { name: 'Nuevo edificio' }).click();
    await expect(page).toHaveURL(/\/edificios\/nuevo$/);

    await page.locator('#nombre').fill(NOMBRE);
    await page.locator('#direccion').fill('Av. E2E 1234');
    await page.locator('#codigoPostal').fill('C1425BGW');
    await page.locator('#totalM2').fill('300');
    // Blur del último campo: dispara la validación (mode onBlur) y habilita
    // el submit solo cuando el form queda válido.
    await page.locator('#totalM2').press('Tab');
    const crear = page.getByRole('button', { name: 'Crear edificio' });
    await expect(crear).toBeEnabled();
    await crear.click();
    // Redirige al detalle, tab unidades (default)
    await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]{36}\/unidades$/);
  });

  await test.step('breadcrumbs: Inicio / Edificios / {nombre} / Unidades', async () => {
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav).toContainText('Inicio');
    await expect(nav).toContainText('Edificios');
    await expect(nav).toContainText(NOMBRE);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Unidades');
  });

  await test.step('bulk que suma 0.9: feedback de delta sin bloquear Guardar', async () => {
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('tab', { name: 'Carga rápida (varias)' }).click();
    // 3 filas por defecto + 2 más = 5 unidades. Se agregan con Enter sobre el
    // botón (no click): cada fila nueva desplaza el botón una fila hacia
    // abajo y el click por coordenadas puede caer donde el botón ya no está.
    const agregarFila = dialog.getByRole('button', { name: 'Agregar fila' });
    await agregarFila.press('Enter');
    await expect(dialog.getByLabel('Número de la fila 4')).toBeVisible();
    await agregarFila.press('Enter');
    await expect(dialog.getByLabel('Número de la fila 5')).toBeVisible();

    const filas = [
      { numero: '1A', m2: '80', coeficiente: '0.300000' },
      { numero: '1B', m2: '70', coeficiente: '0.250000' },
      { numero: '2A', m2: '65', coeficiente: '0.200000' },
      { numero: '2B', m2: '60', coeficiente: '0.100000' },
      { numero: 'COCH', m2: '25', coeficiente: '0.050000' },
    ];
    for (const [i, fila] of filas.entries()) {
      await dialog.getByLabel(`Número de la fila ${i + 1}`).fill(fila.numero);
      await dialog.getByLabel(`m² de la fila ${i + 1}`).fill(fila.m2);
      await dialog
        .getByLabel(`Coeficiente de la fila ${i + 1}`)
        .fill(fila.coeficiente);
    }
    await dialog.getByLabel('Tipo de la fila 5').selectOption('cochera');
    // Blur del último coeficiente para revalidar el form
    await dialog.getByLabel('Coeficiente de la fila 5').press('Tab');

    // Suma 0.900000 → descuadra, pero desde #57 NO bloquea el guardado
    await expect(dialog).toContainText('Suma actual: 0.900000 — falta 0.100000');
    await expect(
      dialog.getByRole('button', { name: 'Guardar 5 unidades' }),
    ).toBeEnabled();
  });

  await test.step('#57: guarda con la suma en 0.9 y el listado muestra la alerta', async () => {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Guardar 5 unidades' }).click();
    await expect(dialog).not.toBeVisible();

    // exact: desde S4-08 cada fila tiene un botón "Residentes de la unidad 1A"
    await expect(
      page.getByRole('cell', { name: '1A', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'COCH', exact: true })).toBeVisible();

    // Alert warning arriba de la tabla + fila TOTAL en warning (no danger)
    const alerta = page.locator('[data-slot="alert"]');
    await expect(alerta).toContainText('Faltan 0.100000.');
    await expect(alerta).toContainText('La sumatoria total debe ser 1.');
    const parcial = page.getByRole('cell', { name: '0.900000' });
    await expect(parcial.locator('span')).toHaveClass(/text-warning/);
  });

  await test.step('#57: alta individual con coeficiente sugerido por m² cierra en 1.000000', async () => {
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // El modal recuerda el modo del uso anterior (bulk): volver a "Una unidad"
    await dialog.getByRole('tab', { name: 'Una unidad' }).click();

    await dialog.locator('#unidad-numero').fill('3C');
    // El edificio tiene 300 m² totales: 30 m² → 30/300 = 0.100000 sugerido
    await dialog.locator('#unidad-m2').fill('30');
    await expect(dialog.locator('#unidad-coeficiente')).toHaveValue('0.100000');
    await expect(dialog).toContainText('Suma actual: 1.000000 ✓');

    const guardar = dialog.getByRole('button', { name: 'Guardar unidad' });
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(dialog).not.toBeVisible();
  });

  await test.step('la fila TOTAL cierra en 1.000000 verde y la alerta desaparece', async () => {
    await expect(page.getByRole('cell', { name: 'TOTAL' })).toBeVisible();
    const suma = page.getByRole('cell', { name: '1.000000' });
    await expect(suma).toBeVisible();
    await expect(suma.locator('span')).toHaveClass(/text-success/);
    await expect(page.locator('[data-slot="alert"]')).toHaveCount(0);
  });

  await test.step('cleanup: baja del edificio con ConfirmDialog (requireText)', async () => {
    await page.getByRole('tab', { name: 'Configuración' }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
    await page.getByRole('button', { name: 'Eliminar edificio' }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-dialog-require-text').fill(NOMBRE);
    await confirm.getByRole('button', { name: 'Eliminar edificio' }).click();

    await expect(page).toHaveURL(/\/edificios$/);
    await expect(page.getByRole('link', { name: NOMBRE })).toHaveCount(0);
  });
});
