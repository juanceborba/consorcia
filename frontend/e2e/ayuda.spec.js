// frontend/e2e/ayuda.spec.js — E2E de la ayuda contextual por pantalla (#57+)
// Convención nueva (PRD-07-02 §6.5): cada pantalla tiene su acceso a ayuda
// (ícono junto al título, aria-label="Ayuda") y los topics se navegan entre
// sí por "Temas relacionados" dentro del mismo drawer. Cubre los dos flujos:
// (a) /edificios → topic "Edificios" → relacionado → "Unidades y coeficientes";
// (b) /configuracion/usuarios → topic "Roles y accesos" → relacionado →
// "Cómo se habilitan los usuarios".
// Requiere el stack levantado con el seed (make up && make db-seed).

import { expect, test } from '@playwright/test';

// Login con el admin del seed → cae en el listado de edificios.
async function login(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

test('edificios: ayuda del listado y navegación por temas relacionados', async ({ page }) => {
  await login(page);

  await test.step('el ícono del título abre el drawer con el topic Edificios', async () => {
    await page.getByRole('button', { name: 'Ayuda', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Edificios' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('¿Qué es un edificio?');
  });

  await test.step('el relacionado navega al topic Unidades dentro del drawer', async () => {
    const drawer = page.getByRole('dialog', { name: 'Edificios' });
    await drawer
      .getByRole('button', { name: 'Unidades y coeficientes' })
      .click();

    // Mismo drawer, topic nuevo: título y breadcrumb cambian
    const navegado = page.getByRole('dialog', {
      name: 'Unidades y coeficientes',
    });
    await expect(navegado).toBeVisible();
    await expect(navegado).toContainText('Edificios › Unidades');
    await expect(navegado).toContainText('El coeficiente de cada unidad');
  });

  await test.step('cerrar el drawer deja la pantalla intacta', async () => {
    const drawer = page.getByRole('dialog', {
      name: 'Unidades y coeficientes',
    });
    await drawer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(drawer).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Edificios' }),
    ).toBeVisible();
  });
});

test('usuarios: ayuda del backoffice y relacionado a invitaciones', async ({ page }) => {
  await login(page);
  await page.goto('/configuracion/usuarios');
  // El título de la Card no es un heading semántico (es un div data-slot)
  await expect(page.locator('[data-slot="card-title"]')).toContainText(
    'Usuarios (',
  );

  await test.step('el ícono del título abre el drawer con el topic Roles y accesos', async () => {
    await page.getByRole('button', { name: 'Ayuda', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Roles y accesos' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Una persona, un solo login');
  });

  await test.step('el relacionado navega al topic de invitaciones y se cierra', async () => {
    const drawer = page.getByRole('dialog', { name: 'Roles y accesos' });
    await drawer
      .getByRole('button', { name: 'Cómo se habilitan los usuarios' })
      .click();

    const navegado = page.getByRole('dialog', {
      name: 'Cómo se habilitan los usuarios',
    });
    await expect(navegado).toBeVisible();
    await expect(navegado).toContainText(
      'Usuarios › Cómo se habilitan los usuarios',
    );
    await expect(navegado).toContainText('Nadie se registra por su cuenta');

    await navegado.getByRole('button', { name: 'Cerrar' }).click();
    await expect(navegado).not.toBeVisible();
    // La pantalla sigue intacta
    await expect(page.locator('[data-slot="card-title"]')).toContainText(
      'Usuarios (',
    );
  });
});
