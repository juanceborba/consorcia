// frontend/e2e/selector-organizacion.spec.js — E2E del selector de organización
// (S4-09, PRD-04-11 §4.6 y DoD del sprint: "staff con 2 membresías → el
// selector del header cambia el contexto sin re-login").
//
// El seed tiene una sola organización, así que el escenario se arma por API
// antes del test: se registra (o reusa) una segunda administración y desde ella
// se invita a `admin@demo.com` como ORG_ADMIN. La membresía nace activa
// (PRD-04-11 §4.3), así que el admin del seed queda con DOS membresías y un
// solo login — que es justo lo que hace aparecer el selector.
//
// Después del cambio se verifica lo que importa: el header muestra la
// organización nueva, el cache viejo NO sobrevive (la organización B no tiene
// edificios, así que el selector de edificio queda en "Sin edificios" en vez de
// mostrar los de la organización A) y la URL vuelve al dashboard.
//
// Cleanup: la membresía del admin en la organización B se desactiva. La
// organización B en sí queda en la DB (no hay endpoint de borrado) pero se
// REUSA entre corridas: email y CUIT son fijos.

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

const ORG_B = {
  nombre: 'E2E Administración B',
  cuit: '30-70000001-9',
  matriculaRPA: 'RPA-E2E-B',
};
const ADMIN_B = { email: 'e2e-admin-b@demo.com', password: 'orgb1234' };
const ADMIN_A = { email: 'admin@demo.com', password: 'demo1234' };

// Token del org_admin de la organización B, registrándola si es la primera vez.
async function sesionOrgB(request) {
  const registro = await request.post(`${API_URL}/api/auth/register`, {
    data: {
      ...ADMIN_B,
      nombre: 'Admin',
      apellido: 'OrgB',
      organizacion: ORG_B,
    },
  });
  if (registro.ok()) return (await registro.json()).accessToken;

  // 422 EMAIL_YA_REGISTRADO / CUIT_YA_REGISTRADO: ya existe de una corrida
  // anterior, se entra con su password.
  const login = await request.post(`${API_URL}/api/auth/login`, {
    data: ADMIN_B,
  });
  expect(login.status()).toBe(200);
  return (await login.json()).accessToken;
}

let tokenOrgB;
let idOrgB;

test.beforeEach(async ({ request }) => {
  tokenOrgB = await sesionOrgB(request);
  const headers = { Authorization: `Bearer ${tokenOrgB}` };

  const me = await request.get(`${API_URL}/api/organizaciones/me`, { headers });
  idOrgB = (await me.json()).id;

  // Invita al admin del seed como ORG_ADMIN de la organización B. En re-runs
  // puede responder 409 (invitación pendiente o vínculo ya activo): en los dos
  // casos la membresía existe, que es lo único que este test necesita.
  const alta = await request.post(`${API_URL}/api/organizaciones/me/usuarios`, {
    headers,
    data: {
      email: ADMIN_A.email,
      nombre: 'Admin',
      apellido: 'Demo',
      rol: 'ORG_ADMIN',
    },
  });
  expect([201, 200, 409]).toContain(alta.status());

  // Si venía desactivada de una corrida anterior, se reactiva.
  await request.patch(
    `${API_URL}/api/organizaciones/me/usuarios/${await idDelAdminA(request, headers)}`,
    { headers, data: { activo: true } },
  );
});

// La membresía se identifica por el usuarioId (identidad global): sale de la
// nómina de la organización B.
async function idDelAdminA(request, headers) {
  const staff = await (
    await request.get(`${API_URL}/api/organizaciones/me/usuarios`, { headers })
  ).json();
  return staff.find((m) => m.email === ADMIN_A.email).id;
}

test.afterEach(async ({ request }) => {
  const headers = { Authorization: `Bearer ${tokenOrgB}` };
  // Baja lógica de la membresía: el admin del seed vuelve a tener una sola
  // organización y el resto de los specs no ve el selector.
  await request.patch(
    `${API_URL}/api/organizaciones/me/usuarios/${await idDelAdminA(request, headers)}`,
    { headers, data: { activo: false } },
  );
});

test('staff con 2 membresías cambia de organización sin re-login', async ({
  page,
}) => {
  await test.step('login: la organización activa es la primera alfabéticamente', async () => {
    await page.goto('/login');
    await page.locator('#email').fill(ADMIN_A.email);
    await page.locator('#password').fill(ADMIN_A.password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/edificios$/);

    // Con 2 membresías el nombre de la organización pasa a ser un dropdown
    await expect(
      page.getByRole('button', { name: /Administración Demo S\.A\./ }),
    ).toBeVisible();
    // Y se ven los edificios de la organización A
    await expect(page.getByRole('link', { name: 'Torre Palermo' })).toBeVisible();
  });

  await test.step('cambiar a la organización B', async () => {
    await page
      .getByRole('button', { name: /Administración Demo S\.A\./ })
      .click();
    await page.getByRole('menuitem', { name: ORG_B.nombre }).click();

    // Redirect al dashboard (la ruta anterior puede ser de la otra org)
    await expect(page).toHaveURL(/localhost:5173\/$/);
    await expect(
      page.getByRole('button', { name: new RegExp(ORG_B.nombre) }),
    ).toBeVisible();
  });

  await test.step('el cache de la organización anterior no sobrevive', async () => {
    // queryClient.clear(): la organización B no tiene edificios, así que el
    // selector de edificio del header queda vacío en vez de mostrar los de A.
    await expect(page.getByRole('button', { name: /Sin edificios/ })).toBeVisible();
    await page.goto('/edificios');
    await expect(
      page.getByRole('link', { name: 'Torre Palermo' }),
    ).toHaveCount(0);
  });

  await test.step('la organización activa queda marcada en el selector', async () => {
    await page.getByRole('button', { name: new RegExp(ORG_B.nombre) }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Administración Demo S.A.');
    await expect(menu).toContainText(ORG_B.nombre);
    await page.keyboard.press('Escape');
  });
});

test('con una sola membresía el selector no se muestra', async ({
  page,
  request,
}) => {
  // Se desactiva la segunda membresía ANTES de loguear: el DTO de usuario sale
  // de las membresías activas al momento del login.
  const headers = { Authorization: `Bearer ${tokenOrgB}` };
  await request.patch(
    `${API_URL}/api/organizaciones/me/usuarios/${await idDelAdminA(request, headers)}`,
    { headers, data: { activo: false } },
  );

  await page.goto('/login');
  await page.locator('#email').fill(ADMIN_A.email);
  await page.locator('#password').fill(ADMIN_A.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);

  // El nombre de la organización es texto plano, no un botón
  await expect(page.getByText('Administración Demo S.A.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Administración Demo S\.A\./ }),
  ).toHaveCount(0);
});
