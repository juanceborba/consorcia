// frontend/e2e/staff-usuarios.spec.js — E2E del backoffice de staff (S4-07)
// Flujo del Workflow A de PRD-04-11 §4 en browser real: login admin → sidebar
// "Usuarios" → la nómina muestra al admin y al gestor del seed con sus
// edificios → "Invitar staff" (gestor con un edificio) → modal con el
// invitacionUrl → re-invitar el mismo email → 409 INVITACION_PENDIENTE ofrece
// reenviar → link nuevo → editar permisos (promover a administrador limpia los
// edificios) → desactivar con ConfirmDialog.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Datos de prueba: el email lleva timestamp para que cada corrida sea
// independiente. Cleanup: la membresía queda DESACTIVADA (el test termina justo
// ahí) — no hay endpoint de borrado de usuarios y la baja es lógica por diseño
// (PRD-04-11 §4). El `Usuario` global sin activar queda en la DB hasta el
// próximo `make db-seed`.

import { expect, test } from '@playwright/test';

const EMAIL = `e2e-staff-${Date.now()}@demo.com`;

test('backoffice de staff: invitar, reenviar, editar permisos y desactivar', async ({
  page,
}) => {
  await test.step('login admin y entrada por el sidebar', async () => {
    await page.goto('/login');
    await page.locator('#email').fill('admin@demo.com');
    await page.locator('#password').fill('demo1234');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/edificios$/);

    await page.getByRole('link', { name: 'Usuarios' }).click();
    await expect(page).toHaveURL(/\/configuracion\/usuarios$/);
    // S3-22b: la nómina es de la organización, no de un edificio, así que el
    // header no ofrece el selector de edificio de trabajo.
    await expect(
      page.getByRole('button', { name: /^Edificio de trabajo:/ }),
    ).toHaveCount(0);
  });

  await test.step('la nómina muestra al staff del seed', async () => {
    // exact: el botón de acciones de la fila también lleva el email en su label
    await expect(
      page.getByRole('cell', { name: 'admin@demo.com', exact: true }),
    ).toBeVisible();
    const filaGestor = page.getByRole('row', { name: /gestor@demo\.com/ });
    await expect(filaGestor).toContainText('Gestor');
    // El gestor del seed está limitado a Torre Palermo
    await expect(filaGestor).toContainText('Torre Palermo');
  });

  await test.step('invitar un gestor nuevo → modal con el link', async () => {
    await page.getByRole('button', { name: 'Invitar staff' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#staff-email').fill(EMAIL);
    await dialog.locator('#staff-nombre').fill('Ana');
    await dialog.locator('#staff-apellido').fill('E2E');
    // Rol GESTOR es el default: el multi-select de edificios está habilitado
    await dialog.getByRole('checkbox', { name: 'Torre Palermo' }).check();
    // Blur del último campo: con mode onBlur el submit se habilita al validar
    await dialog.locator('#staff-apellido').press('Tab');

    const invitar = dialog.getByRole('button', { name: 'Invitar', exact: true });
    await expect(invitar).toBeEnabled();
    await invitar.click();

    // Modal del link de invitación (MVP sin envío de email)
    const link = page.getByRole('dialog');
    await expect(link).toContainText('Invitación creada');
    await expect(link.locator('#invitacion-url')).toHaveValue(
      /\/invitacion\/[0-9a-f-]{36}$/,
    );
    await link.getByRole('button', { name: 'Listo' }).click();
  });

  await test.step('la fila nueva aparece como "Invitado"', async () => {
    const fila = page.getByRole('row', { name: new RegExp(EMAIL) });
    await expect(fila).toContainText('Invitado');
    await expect(fila).toContainText('Torre Palermo');
  });

  await test.step('re-invitar el mismo email ofrece reenviar (409)', async () => {
    await page.getByRole('button', { name: 'Invitar staff' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#staff-email').fill(EMAIL);
    await dialog.locator('#staff-nombre').fill('Ana');
    await dialog.locator('#staff-apellido').fill('E2E');
    await dialog.locator('#staff-apellido').press('Tab');
    await dialog.getByRole('button', { name: 'Invitar', exact: true }).click();

    // No es un error del admin: la UI ofrece el reenvío explícito
    await expect(dialog).toContainText('ya tiene una invitación sin usar');
    await dialog.getByRole('button', { name: 'Reenviar invitación' }).click();

    const link = page.getByRole('dialog');
    await expect(link).toContainText('Invitación reenviada');
    await link.getByRole('button', { name: 'Listo' }).click();
  });

  await test.step('promover a administrador limpia sus edificios', async () => {
    await page.getByRole('button', { name: `Acciones de ${EMAIL}` }).click();
    await page.getByRole('menuitem', { name: 'Editar permisos' }).click();

    const dialog = page.getByRole('dialog');
    await dialog
      .locator('#staff-editar-rol')
      .selectOption('ORG_ADMIN');
    // Con rol administrador el multi-select se deshabilita (el PATCH limpia
    // las asignaciones por edificio: administra toda la organización)
    await expect(
      dialog.getByRole('checkbox', { name: 'Torre Palermo' }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(dialog).not.toBeVisible();

    const fila = page.getByRole('row', { name: new RegExp(EMAIL) });
    await expect(fila).toContainText('Administrador');
    await expect(fila).toContainText('Todos');
  });

  await test.step('desactivar la membresía con ConfirmDialog', async () => {
    await page.getByRole('button', { name: `Acciones de ${EMAIL}` }).click();
    await page.getByRole('menuitem', { name: 'Desactivar' }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('pierde el acceso al backoffice');
    await confirm.getByRole('button', { name: 'Desactivar' }).click();

    await expect(
      page.getByRole('row', { name: new RegExp(EMAIL) }),
    ).toContainText('Desactivado');
  });
});
