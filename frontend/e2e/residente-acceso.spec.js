// frontend/e2e/residente-acceso.spec.js — Acceso de lectura del residente (#58)
// Flujo completo del issue: el admin invita a alguien como INQUILINO desde el
// panel "Residentes" de una UF → la persona activa su cuenta con el link →
// entra por /login y ve SU edificio y SU unidad en solo lectura.
//
// Lo que se protege acá (BUG 2 de #58): antes el residente aterrizaba en un
// dashboard vacío con el selector de edificios deshabilitado, porque
// GET /api/edificios pasa por `tenant` y su JWT no trae `org_id`. Ahora el
// contexto sale de GET /api/me/unidades y las rutas de staff lo redirigen a
// /mis-unidades en vez de dejarlo en una pantalla sin nada.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
// Cleanup: los vínculos `e2e-residente-*` de Torre Palermo se dan de baja por
// API; el Usuario global sobrevive hasta el próximo `make db-seed` (la baja es
// lógica por diseño, PRD-04-11 §5.6).

import { expect, test } from '@playwright/test';

const API_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const EMAIL = `e2e-residente-acceso-${Date.now()}@demo.com`;
const PASSWORD = 'inquilino1234';
const PREFIJO = 'e2e-residente-acceso-';

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
    await request.get(`${API_URL}/api/edificios/${torre.id}/unidades?page=1&limit=100`, {
      headers,
    })
  ).json();
  for (const unidad of unidades.data ?? []) {
    const vinculos = await (
      await request.get(`${API_URL}/api/unidades/${unidad.id}/residentes`, { headers })
    ).json();
    for (const vinculo of vinculos) {
      if (vinculo.vigente && vinculo.usuario.email.startsWith(PREFIJO)) {
        await request.delete(`${API_URL}/api/unidades/${unidad.id}/residentes/${vinculo.id}`, {
          headers,
        });
      }
    }
  }
});

test('un inquilino invitado ve su edificio y su UF en solo lectura', async ({
  request,
  browser,
}) => {
  let invitacionUrl;
  let numeroUF;

  await test.step('el admin invita a un inquilino desde la UF (por API)', async () => {
    // El alta desde el drawer ya la cubre residentes-invitacion.spec.js; lo
    // que se prueba en ESTE spec es lo que ve el residente después, así que la
    // precondición se arma por API (más rápida y sin acoplarse a ese form).
    const login = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'admin@demo.com', password: 'demo1234' },
    });
    const { accessToken } = await login.json();
    const headers = { Authorization: `Bearer ${accessToken}` };

    const edificios = await (await request.get(`${API_URL}/api/edificios`, { headers })).json();
    const torre = edificios.find((e) => e.nombre === 'Torre Palermo');
    expect(torre, 'el seed tiene que tener Torre Palermo').toBeTruthy();

    const unidades = await (
      await request.get(`${API_URL}/api/edificios/${torre.id}/unidades?page=1&limit=100`, {
        headers,
      })
    ).json();
    // La ÚLTIMA UF: las primeras las usan los otros specs y el seed.
    const unidad = unidades.data[unidades.data.length - 1];
    numeroUF = unidad.numero;

    const alta = await request.post(`${API_URL}/api/unidades/${unidad.id}/residentes`, {
      headers,
      // Inquilino, NO propietario: el atributo del vínculo es lo que se muestra.
      data: {
        email: EMAIL,
        nombre: 'Ana',
        apellido: 'Inquilina',
        esPropietario: false,
        esInquilino: true,
      },
    });
    expect(alta.status()).toBe(201);
    invitacionUrl = (await alta.json()).invitacionUrl;
  });

  // Contexto propio: el auth.store vive en localStorage (por origen).
  const contextoResidente = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const residente = await contextoResidente.newPage();

  await test.step('activa su cuenta y entra directo a sus unidades', async () => {
    await residente.goto(new URL(invitacionUrl).pathname);
    await residente.locator('#password').fill(PASSWORD);
    await residente.locator('#confirmacion').fill(PASSWORD);
    await residente.locator('#confirmacion').press('Tab');
    await residente.getByRole('button', { name: 'Activar cuenta y entrar' }).click();

    // BUG 2: acá aterrizaba en el dashboard vacío. Ahora va a /mis-unidades.
    await expect(residente).toHaveURL(/\/mis-unidades$/);
  });

  await test.step('cierra sesión y vuelve a entrar por /login', async () => {
    await residente.getByRole('button', { name: /Ana|e2e-residente-acceso/ }).click();
    await residente.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
    await expect(residente).toHaveURL(/\/login$/);

    await residente.locator('#email').fill(EMAIL);
    await residente.locator('#password').fill(PASSWORD);
    await residente.getByRole('button', { name: 'Ingresar' }).click();
    await expect(residente).toHaveURL(/\/mis-unidades$/);
  });

  await test.step('ve su edificio, su UF y su rol de inquilino', async () => {
    const main = residente.locator('main');
    await expect(main).toContainText('Torre Palermo');
    await expect(main).toContainText(`UF ${numeroUF}`);
    await expect(main).toContainText('Inquilino');
    await expect(main).toContainText('Administración Demo S.A.');
    await expect(main).not.toContainText('Propietario');

    // El selector del header ya no está vacío: sale de sus vínculos.
    await expect(
      residente.getByRole('button', { name: /Torre Palermo/ }),
    ).toBeVisible();
  });

  await test.step('no ve nada de staff', async () => {
    // Sidebar sin módulos del backoffice
    const nav = residente.locator('nav');
    await expect(nav.getByRole('link', { name: 'Mis unidades' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Edificios' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);

    // Sin acciones de escritura en su vista
    await expect(residente.getByRole('button', { name: 'Nuevo edificio' })).toHaveCount(0);
    await expect(residente.getByRole('button', { name: /Vincular persona/ })).toHaveCount(0);

    // Y si tipea una ruta de staff a mano, vuelve a su vista (no queda en un
    // dashboard vacío ni en un error transitorio).
    await residente.goto('/edificios');
    await expect(residente).toHaveURL(/\/mis-unidades$/);
    await residente.goto('/');
    await expect(residente).toHaveURL(/\/mis-unidades$/);
  });

  await residente.close();
  await contextoResidente.close();
});
