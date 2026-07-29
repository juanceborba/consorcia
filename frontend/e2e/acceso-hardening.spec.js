// frontend/e2e/acceso-hardening.spec.js — E2E del hardening S4-11
// Cubre las dos caras visibles de los fixes del issue #53:
//
//   1. SEC-01 / review S2 — aceptar una invitación dirigida a una cuenta que YA
//      estaba activa no emite sesión: la pantalla lo dice y manda a /login, en
//      vez de festejar una contraseña que el backend descartó.
//   2. QA-03 — un usuario sin membresía activa ni vínculos ve un mensaje
//      PERMANENTE y accionable, no el "Intentá de nuevo más tarde" del error de
//      red genérico.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Datos de prueba del caso 1: email con timestamp y prefijo `e2e-staff-`, que
// es el que limpia el reseed (no se toca ningún usuario del seed).

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

const EMAIL = `e2e-staff-yaactiva-${Date.now()}@demo.com`;
const PASSWORD_PROPIA = 'propia1234';

// La "administración atacante": una organización ajena, registrada por el
// endpoint público de /register (que es la precondición real del hallazgo). Se
// REUSA entre corridas con email y CUIT fijos, igual que la del spec del
// selector: no hay endpoint de borrado de organizaciones.
const ORG_AJENA = {
  nombre: 'E2E Administración Ajena',
  cuit: '30-70000002-7',
  matriculaRPA: 'RPA-E2E-AJENA',
};
const ADMIN_AJENO = { email: 'e2e-admin-ajena@demo.com', password: 'ajena1234' };

async function sesionOrgAjena(request) {
  const registro = await request.post(`${API_URL}/api/auth/register`, {
    data: { ...ADMIN_AJENO, nombre: 'Admin', apellido: 'Ajena', organizacion: ORG_AJENA },
  });
  if (registro.ok()) return (await registro.json()).accessToken;

  const login = await request.post(`${API_URL}/api/auth/login`, { data: ADMIN_AJENO });
  expect(login.status()).toBe(200);
  return (await login.json()).accessToken;
}

// Invita a EMAIL como gestor y devuelve el token del link, que es lo que en el
// MVP se queda el invitador.
async function invitar(request, accessToken) {
  const alta = await request.post(`${API_URL}/api/organizaciones/me/usuarios`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { email: EMAIL, nombre: 'Ya', apellido: 'Activa', rol: 'GESTOR' },
  });
  expect([200, 201]).toContain(alta.status());
  return (await alta.json()).invitacionUrl.split('/').pop();
}

test('una organización ajena no obtiene sesión invitando a una cuenta activa (SEC-01)', async ({
  page,
  request,
}) => {
  const login = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();

  // La organización demo da de alta a la persona: esa invitación crea la
  // identidad, así que activa de verdad y entra.
  const primerToken = await invitar(request, accessToken);
  await page.goto(`/invitacion/${primerToken}`);
  await expect(page.getByText('Activá tu cuenta')).toBeVisible();
  await page.locator('#password').fill(PASSWORD_PROPIA);
  await page.locator('#confirmacion').fill(PASSWORD_PROPIA);
  await page.locator('#confirmacion').press('Tab');
  await page.getByRole('button', { name: 'Activar cuenta y entrar' }).click();
  // Cuenta nueva: sí entra, la sesión viene emitida en la respuesta del accept
  await expect(page).toHaveURL(/localhost:5173\/$/);

  // Una organización SIN ninguna relación con esa persona la invita con solo su
  // email y se queda con el link: el escenario exacto de SEC-01.
  const segundoToken = await invitar(request, await sesionOrgAjena(request));
  await page.goto(`/invitacion/${segundoToken}`);
  await expect(page.getByText('Activá tu cuenta')).toBeVisible();
  await page.locator('#password').fill('otra-password-1234');
  await page.locator('#confirmacion').fill('otra-password-1234');
  await page.locator('#confirmacion').press('Tab');
  await page.getByRole('button', { name: 'Activar cuenta y entrar' }).click();

  // Ni sesión ni redirección al dashboard: estado explícito y salida al login.
  await expect(page.getByText('Tu cuenta ya estaba activa')).toBeVisible();
  await expect(page.getByText('la que acabás de escribir no se guardó')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/invitacion/${segundoToken}$`));

  await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // La password que definió la persona sigue siendo la suya
  expect(
    (
      await request.post(`${API_URL}/api/auth/login`, {
        data: { email: EMAIL, password: 'otra-password-1234' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`${API_URL}/api/auth/login`, {
        data: { email: EMAIL, password: PASSWORD_PROPIA },
      })
    ).status(),
  ).toBe(200);
});

test('un usuario sin acceso a ninguna organización ve un mensaje permanente (QA-03)', async ({
  page,
}) => {
  // `encargado@demo.com` es una identidad del seed sin membresía ni vínculos:
  // loguea con 200 pero todo lo demás le responde 403.
  await page.goto('/login');
  await page.locator('#email').fill('encargado@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();

  await expect(
    page.getByText('Tu cuenta no tiene acceso a ninguna organización'),
  ).toBeVisible();
  await expect(page.getByText('Contactá a tu administración')).toBeVisible();
  // Nada del shell ni el error transitorio de red
  await expect(page.getByText('Intentá de nuevo más tarde')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edificios' })).toHaveCount(0);

  // Y hay salida: cerrar sesión vuelve al login
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
