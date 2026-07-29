// frontend/e2e/residentes-invitacion.spec.js — E2E del Workflow B (S4-08)
// Flujo del DoD del sprint (PRD-04-11 §5 + §11): el admin vincula un
// propietario a una UF desde el panel "Residentes" de la fila → copia el
// invitacionUrl → el invitado abre `/invitacion/:token` en una pestaña sin
// sesión, define su password y entra → el link ya usado responde 410 y muestra
// la pantalla de invitación inválida → de vuelta en el backoffice, el admin lo
// desvincula con ConfirmDialog y el vínculo pasa al histórico.
//
// Además cubre `/register` (S4-08 punto c): 422 EMAIL_YA_REGISTRADO inline con
// el email del seed, que es el error que hace de guardia de la identidad global.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Datos de prueba: el email lleva timestamp. Cleanup en `afterEach` por API:
// da de baja TODOS los vínculos `e2e-residente-*` de las UFs de Torre Palermo,
// así una corrida que falla a mitad de camino no deja vínculos vigentes que
// desplacen los conteos de la siguiente (know-how
// bug/tests-conteos-absolutos-flaky). El `Usuario` global creado sobrevive
// hasta el próximo `make db-seed`: la baja es lógica por diseño (§5.6) y no hay
// endpoint de borrado de personas.

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const EMAIL = `e2e-residente-${Date.now()}@demo.com`;
const PASSWORD = 'residente1234';
const PREFIJO = 'e2e-residente-';

test.afterEach(async ({ request }) => {
  const login = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const edificios = await (await request.get(`${API_URL}/api/edificios`, { headers })).json();
  const torre = edificios.find((e) => e.nombre === 'Torre Palermo');
  if (!torre) return;

  const unidades = await (
    await request.get(`${API_URL}/api/edificios/${torre.id}/unidades?page=1&limit=100`, { headers })
  ).json();
  for (const unidad of unidades.data ?? []) {
    const vinculos = await (
      await request.get(`${API_URL}/api/unidades/${unidad.id}/residentes`, { headers })
    ).json();
    for (const vinculo of vinculos) {
      if (vinculo.vigente && vinculo.usuario.email.startsWith(PREFIJO)) {
        await request.delete(
          `${API_URL}/api/unidades/${unidad.id}/residentes/${vinculo.id}`,
          { headers },
        );
      }
    }
  }
});

test('vincular residente, activar por invitación y desvincular', async ({
  page,
  browser,
}) => {
  let invitacionUrl;
  // El panel se localiza por su nombre accesible: los diálogos anidados (link
  // de invitación, ConfirmDialog) conviven en el DOM y un `getByRole('dialog')`
  // suelto rompe por strict mode mientras el anidado se cierra con animación.
  const panel = page.getByRole('dialog', { name: /^Residentes — UF/ });

  await test.step('login admin y abrir las unidades de un edificio', async () => {
    await page.goto('/login');
    await page.locator('#email').fill('admin@demo.com');
    await page.locator('#password').fill('demo1234');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/edificios$/);

    await page.getByRole('link', { name: 'Torre Palermo' }).click();
    await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]{36}\/unidades$/);
  });

  await test.step('abrir el panel Residentes de la primera UF', async () => {
    await page
      .getByRole('button', { name: /^Residentes de la unidad / })
      .first()
      .click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Vincular persona');
  });

  await test.step('vincular un propietario → modal con el link', async () => {
    await panel.locator('#residente-email').fill(EMAIL);
    await panel.locator('#residente-nombre').fill('Pablo');
    await panel.locator('#residente-apellido').fill('E2E');
    // Propietario viene marcado por default; fechaInicio con default hoy
    await expect(panel.getByRole('checkbox', { name: 'Propietario' })).toBeChecked();
    await panel.locator('#residente-apellido').press('Tab');

    const vincular = panel.getByRole('button', { name: 'Vincular persona' });
    await expect(vincular).toBeEnabled();
    await vincular.click();

    const link = page.getByRole('dialog', { name: 'Persona vinculada' });
    await expect(link).toBeVisible();
    invitacionUrl = await link.locator('#invitacion-url').inputValue();
    expect(invitacionUrl).toMatch(/\/invitacion\/[0-9a-f-]{36}$/);
    await link.getByRole('button', { name: 'Listo' }).click();
  });

  await test.step('el vínculo aparece como vigente y sin activar', async () => {
    // Sobre la fila del email del test, no sobre conteos absolutos del panel
    // (know-how bug/tests-conteos-absolutos-flaky).
    const fila = panel.getByRole('listitem').filter({ hasText: EMAIL });
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('Propietario');
    await expect(fila).toContainText('Todavía no activó su cuenta');
  });

  await test.step('el invitado activa su cuenta desde el link', async () => {
    // CONTEXTO nuevo, no una pestaña: el auth.store vive en localStorage, que
    // es por origen y se comparte entre pestañas del mismo contexto — limpiarlo
    // desde acá desloguearía al admin de la otra pestaña.
    const contextoInvitado = await browser.newContext({
      baseURL: 'http://localhost:5173',
    });
    const invitado = await contextoInvitado.newPage();

    await invitado.goto(new URL(invitacionUrl).pathname);
    await expect(invitado.getByText('Activá tu cuenta')).toBeVisible();
    // Email enmascarado (Ley 25.326: el link puede terminar en un tercero)
    await expect(invitado.locator('main')).toContainText('e***@demo.com');
    // A qué ORGANIZACIÓN lo invitaron (el contrato no expone el edificio)
    await expect(invitado.locator('main')).toContainText(
      'Administración Demo S.A.',
    );
    await expect(invitado.locator('main')).toContainText(
      'como residente de una unidad',
    );

    await invitado.locator('#password').fill(PASSWORD);
    await invitado.locator('#confirmacion').fill(PASSWORD);
    await invitado.locator('#confirmacion').press('Tab');
    await invitado
      .getByRole('button', { name: 'Activar cuenta y entrar' })
      .click();

    // Residente puro: entra con sesión (sin org activa, el portal llega en S5)
    await expect(invitado).not.toHaveURL(/\/invitacion\//);

    await test.step('el link de un solo uso ya no sirve (410)', async () => {
      await invitado.goto(new URL(invitacionUrl).pathname);
      await expect(
        invitado.getByText('Invitación inválida o vencida'),
      ).toBeVisible();
    });

    await invitado.close();
    await contextoInvitado.close();
  });

  await test.step('el backoffice muestra la cuenta ya activada SIN recargar (#58)', async () => {
    // Regresión de #58 (BUG 1): el admin no recarga la página, solo cierra y
    // reabre el panel. `cuentaActivada` cambió en OTRA sesión, así que con el
    // staleTime global de 5 min el panel servía el cache y la persona seguía
    // figurando como no activada. La query del panel es staleTime 0.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    await page
      .getByRole('button', { name: /^Residentes de la unidad / })
      .first()
      .click();
    const fila = panel.getByRole('listitem').filter({ hasText: EMAIL });
    await expect(fila).toContainText('Propietario');
    await expect(fila).not.toContainText('Todavía no activó su cuenta');
  });

  await test.step('desvincular con ConfirmDialog → pasa al histórico', async () => {
    const vigente = panel.getByRole('listitem').filter({ hasText: EMAIL });
    await vigente.getByRole('button', { name: 'Desvincular' }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('queda en el historial');
    await confirm.getByRole('button', { name: 'Desvincular' }).click();

    // La fila pasa al histórico: sigue listada pero sin acción de baja y con
    // fecha de fin (el vínculo no se borra, §5.6).
    const historico = panel
      .getByRole('listitem')
      .filter({ hasText: EMAIL });
    await expect(historico).toContainText('hasta');
    await expect(
      historico.getByRole('button', { name: 'Desvincular' }),
    ).toHaveCount(0);
  });
});

test('register: 422 EMAIL_YA_REGISTRADO se muestra inline', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Creá tu administración' }).click();
  await expect(page).toHaveURL(/\/register$/);

  await page.locator('#nombre').fill('Duplicado');
  await page.locator('#apellido').fill('E2E');
  // Email del seed: la identidad es global, no hay dos cuentas con el mismo email
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirmacion').fill('demo1234');
  await page.locator('#organizacionNombre').fill(`E2E ${Date.now()}`);
  await page.locator('#cuit').fill('30-99999999-1');
  await page.locator('#matriculaRPA').fill('RPA-E2E');
  await page.locator('#matriculaRPA').press('Tab');

  const crear = page.getByRole('button', { name: 'Crear administración' });
  await expect(crear).toBeEnabled();
  await crear.click();

  await expect(page.getByText('Ese email ya tiene una cuenta')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);

  // Nada quedó creado: el chequeo de email corre antes de la transacción
  const login = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  expect(login.status()).toBe(200);
});
