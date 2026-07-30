// frontend/e2e/usuarios-demo.spec.js — E2E del diálogo "Usuarios de demo" del
// login (S3-22c).
//
// QUÉ VERIFICA QUE EL GATE NO PUEDE: `npm run check:demo` compara el catálogo
// contra el seed (emails, nombres, password), pero no puede probar que la
// cuenta ofrecida efectivamente entra. Acá se elige una del diálogo y se
// completa el login con ella: si el seed cambia y el catálogo queda viejo, el
// gate lo dice; si el catálogo está bien pero la cuenta no sirve, lo dice esto.
//
// Requiere el stack levantado con el seed (make up && make db-seed).

import { expect, test } from '@playwright/test';

test('el login explica los usuarios de demo y entra con el que elijas', async ({
  page,
}) => {
  await page.goto('/login');

  await test.step('el diálogo lista los roles con lo que pueden y no pueden hacer', async () => {
    await page
      .getByRole('button', { name: /Ver los usuarios de demo/ })
      .click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toContainText('Usuarios de demo');
    // La jerarquía: el administrador de la organización primero, el gestor
    // después, los residentes al final.
    await expect(dialogo).toContainText('Administrador de la organización');
    await expect(dialogo).toContainText('Gestor (un edificio)');
    await expect(dialogo).toContainText('Inquilino');

    // Lo que hace útil al diálogo es el corte por permisos, no la lista de mails.
    await expect(dialogo).toContainText(
      'Cargar, editar o eliminar gastos: el botón "Nuevo gasto" ni aparece.',
    );
  });

  await test.step('la invitación pendiente no ofrece entrar, ofrece activarse', async () => {
    // No tiene contraseña todavía: un botón "Usar esta cuenta" fallaría al
    // submit (decisión 2 del componente).
    const dialogo = page.getByRole('dialog');
    await expect(
      dialogo.getByRole('link', { name: 'Activar la invitación' }),
    ).toHaveAttribute('href', '/invitacion/seed-invitacion-pendiente');
  });

  await test.step('elegir una cuenta completa el formulario y entra', async () => {
    // El gestor: es el que más se usa para ver la diferencia de permisos.
    await page
      .getByRole('dialog')
      .getByRole('listitem')
      .filter({ hasText: 'Gestor (un edificio)' })
      .getByRole('button', { name: 'Usar esta cuenta' })
      .click();

    await expect(page.locator('#email')).toHaveValue('gestor@demo.com');
    await expect(page.locator('#password')).toHaveValue('demo1234');

    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/edificios$/);
    // Y lo que el diálogo prometía de este rol se cumple: un solo edificio.
    await expect(page.getByRole('link', { name: /Torre Palermo/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /San Martín/ })).toHaveCount(0);
  });
});
