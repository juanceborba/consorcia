// frontend/e2e/edificio-unidades.spec.js — E2E del slice S2 en browser real (S2-12)
// Flujo del DoD del sprint, con la UX de #57 (invariante informativa + flujos
// de alta separados): login admin → "Nuevo edificio" → alta → redirect al
// detalle → breadcrumbs (Inicio / Edificios / {nombre} / Unidades) → tab
// unidades → "Carga rápida" (dialog bulk propio, sin tabs) con coeficientes
// que suman 0.9: el feedback dice "falta 0.100000" pero Guardar sigue
// HABILITADO → se guarda igual → la tabla muestra las unidades, la fila TOTAL
// en warning y el Alert "Faltan 0.100000…" → se completa la unidad que falta
// desde "Agregar unidad" (dialog individual), con el coeficiente SUGERIDO a
// partir de los m² (m²/totalM2) → la fila TOTAL cierra en 1.000000 verde y el
// Alert desaparece.
// Segundo caso (#57): el dialog individual tiene el tab "Categorías de gastos"
// con las 3 explicaciones → "Más información" abre el drawer de ayuda ENCIMA
// del modal (breadcrumb Edificios › Unidades › Categorías de gastos) → se
// cierra y el modal sigue intacto → se guarda una UF con categoría B marcada
// desde el otro tab (RHF conserva los valores) → badge "B: ascensor" en el
// listado.
// Cleanup: baja del edificio desde el tab Configuración (ConfirmDialog con
// requireText) + barrido por API en afterEach por si el test falla a mitad.
// Requiere el stack levantado con el seed (make up && make db-seed).

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const NOMBRE = `E2E ${Date.now()}`;
const NOMBRE_AYUDA = `E2E Ayuda ${Date.now()}`;

// Login con el admin del seed → cae en el listado de edificios.
async function login(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

// Alta de edificio de 300 m² desde "Nuevo edificio" → queda en el detalle,
// tab unidades (default).
async function crearEdificio(page, nombre) {
  await page.goto('/edificios');
  await page.getByRole('link', { name: 'Nuevo edificio' }).click();
  await expect(page).toHaveURL(/\/edificios\/nuevo$/);

  await page.locator('#nombre').fill(nombre);
  await page.locator('#direccion').fill('Av. E2E 1234');
  await page.locator('#codigoPostal').fill('C1425BGW');
  await page.locator('#totalM2').fill('300');
  // Blur del último campo: dispara la validación (mode onBlur) y habilita
  // el submit solo cuando el form queda válido.
  await page.locator('#totalM2').press('Tab');
  const crear = page.getByRole('button', { name: 'Crear edificio' });
  await expect(crear).toBeEnabled();
  await crear.click();
  await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]{36}\/unidades$/);
}

// Baja del edificio desde el tab Configuración (ConfirmDialog con requireText).
async function eliminarEdificio(page, nombre) {
  await page.getByRole('tab', { name: 'Configuración' }).click();
  await expect(page).toHaveURL(/\/configuracion$/);
  await page.getByRole('button', { name: 'Eliminar edificio' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.locator('#confirm-dialog-require-text').fill(nombre);
  await confirm.getByRole('button', { name: 'Eliminar edificio' }).click();

  await expect(page).toHaveURL(/\/edificios$/);
  await expect(page.getByRole('link', { name: nombre })).toHaveCount(0);
}

// Barrido de seguridad: borra (soft delete) cualquier edificio de prueba que
// haya quedado activo, así el spec es re-ejecutable y no deja basura.
test.afterEach(async ({ request }) => {
  const loginRes = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  const { accessToken } = await loginRes.json();
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
    await login(page);
  });

  await test.step('alta de edificio desde "Nuevo edificio"', async () => {
    await crearEdificio(page, NOMBRE);
  });

  await test.step('breadcrumbs: Inicio / Edificios / {nombre} / Unidades', async () => {
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav).toContainText('Inicio');
    await expect(nav).toContainText('Edificios');
    await expect(nav).toContainText(NOMBRE);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Unidades');
  });

  await test.step('bulk que suma 0.9: feedback de delta sin bloquear Guardar', async () => {
    // Desde #57 la carga rápida es un dialog propio, sin tabs de modo
    await page.getByRole('button', { name: 'Carga rápida', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

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
    // El alta individual es otro dialog: abre directo en "Datos de la unidad"
    await page.getByRole('button', { name: 'Agregar unidad' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar unidad' });
    await expect(dialog).toBeVisible();

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
    await eliminarEdificio(page, NOMBRE);
  });
});

test('tab Categorías de gastos con ayuda contextual y guardado con categoría B', async ({ page }) => {
  await test.step('login y alta de edificio', async () => {
    await login(page);
    await crearEdificio(page, NOMBRE_AYUDA);
  });

  await test.step('el tab Categorías muestra las 3 explicaciones y marca B', async () => {
    await page.getByRole('button', { name: 'Agregar unidad' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar unidad' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('tab', { name: 'Categorías de gastos' }).click();
    await expect(dialog).toContainText('A — Gastos generales');
    await expect(dialog).toContainText('B — Servicios específicos');
    await expect(dialog).toContainText('C — Sectores');

    // Marca la categoría B acá: después guarda desde el otro tab (RHF
    // conserva los valores del tab desmontado)
    await dialog.getByRole('checkbox', { name: 'Ascensor' }).check();
  });

  await test.step('"Más información" abre el drawer de ayuda ENCIMA del modal', async () => {
    const dialog = page.getByRole('dialog', { name: 'Agregar unidad' });
    await dialog.getByRole('button', { name: 'Más información' }).click();

    // El drawer también es un dialog (Base UI): se apila encima del modal
    const drawer = page.getByRole('dialog', { name: 'Categorías de gastos' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(
      'Edificios › Unidades › Categorías de gastos',
    );
    await expect(drawer).toContainText('Cómo se reparten los gastos al liquidar');

    // Interactuar con el drawer: scrollear su contenido con la rueda no hace
    // falta — alcanza con leerlo y cerrarlo con la X
    await drawer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(drawer).not.toBeVisible();

    // El modal del alta sigue abierto e intacto
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Ascensor' }),
    ).toBeChecked();
  });

  await test.step('guarda desde el tab Datos y el listado muestra el badge B', async () => {
    const dialog = page.getByRole('dialog', { name: 'Agregar unidad' });
    await dialog.getByRole('tab', { name: 'Datos de la unidad' }).click();

    await dialog.locator('#unidad-numero').fill('PB');
    // 100 m² de 300 totales → coeficiente sugerido 0.333333
    await dialog.locator('#unidad-m2').fill('100');
    await expect(dialog.locator('#unidad-coeficiente')).toHaveValue('0.333333');

    const guardar = dialog.getByRole('button', { name: 'Guardar unidad' });
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(dialog).not.toBeVisible();

    // La categoría B marcada en el otro tab quedó guardada
    await expect(page.getByRole('cell', { name: 'PB', exact: true })).toBeVisible();
    await expect(page.getByText('B: ascensor')).toBeVisible();
  });

  await test.step('cleanup: baja del edificio con ConfirmDialog (requireText)', async () => {
    await eliminarEdificio(page, NOMBRE_AYUDA);
  });
});
