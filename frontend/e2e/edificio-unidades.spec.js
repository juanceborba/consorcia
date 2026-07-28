// frontend/e2e/edificio-unidades.spec.js — E2E del slice S2 en browser real (S2-12)
// Flujo del DoD del sprint: login admin → "Nuevo edificio" → alta → redirect
// al detalle → breadcrumbs (Inicio / Edificios / {nombre} / Unidades) → tab
// unidades → "+ Agregar" → modo bulk: primero con coeficientes que suman 0.9
// (feedback "falta 0.100000" y Guardar deshabilitado) y después cuadrados en
// 1.000000 → guardar → la tabla muestra las unidades y la fila TOTAL con
// Σcoeficiente = 1.000000 en verde (text-success). Cleanup: baja del edificio
// desde el tab Configuración (ConfirmDialog con requireText) + barrido por
// API en afterEach por si el test falla a mitad de camino.
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

  await test.step('bulk que suma 0.9: feedback de delta y Guardar deshabilitado', async () => {
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

    // Suma 0.900000 → invariante descuadrada (DoD: botón deshabilitado en UI)
    await expect(dialog).toContainText('Suma actual: 0.900000 — falta 0.100000');
    await expect(
      dialog.getByRole('button', { name: 'Guardar 5 unidades' }),
    ).toBeDisabled();
  });

  await test.step('bulk corregido a 1.000000: Guardar habilitado y alta exitosa', async () => {
    const dialog = page.getByRole('dialog');
    // 0.900000 + 0.100000: la fila 5 pasa de 0.050000 a 0.150000
    await dialog.getByLabel('Coeficiente de la fila 5').fill('0.150000');
    await dialog.getByLabel('Coeficiente de la fila 5').press('Tab');

    await expect(dialog).toContainText('Suma actual: 1.000000 ✓');
    const guardar = dialog.getByRole('button', { name: 'Guardar 5 unidades' });
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(dialog).not.toBeVisible();
  });

  await test.step('la tabla muestra las unidades y TOTAL en 1.000000 verde', async () => {
    await expect(page.getByRole('cell', { name: '1A' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'COCH', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'TOTAL' })).toBeVisible();
    const suma = page.getByRole('cell', { name: '1.000000' });
    await expect(suma).toBeVisible();
    await expect(suma.locator('span')).toHaveClass(/text-success/);
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
