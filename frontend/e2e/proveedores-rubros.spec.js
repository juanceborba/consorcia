// frontend/e2e/proveedores-rubros.spec.js — E2E de la gestión de proveedores y
// rubros (S3-14, PRD-04-02 §1.3/§1.4) en browser real.
//
// Cubre lo que no se puede verificar sin DOM: el badge Global/Propio del
// directorio híbrido, el buscador que pega al backend por CUIT, el alta/baja de
// un proveedor propio, el override de visibilidad sobre un ítem del maestro, el
// alta de rubros y subrubros propios con la herencia del ocultamiento, y las dos
// protecciones del árbol (el maestro no se edita, un rubro con subrubros no se
// borra).
//
// NO cubre `ProveedorSelect` ni `RubroSelect` (components/gastos/): todavía no
// hay pantalla que los monte — los consume el form de gasto de S3-08. Su
// cobertura E2E va con esa tarea; en particular el combobox de proveedor es el
// primer uso de `Combobox` de Base UI en la app y no está ejercitado en browser.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: el proveedor, el rubro y el subrubro creados se borran al final (sin
// gastos asociados el DELETE es físico) y la visibilidad del rubro maestro se
// restaura dentro del mismo paso que la cambia. El sufijo con timestamp mantiene
// las corridas independientes por si un cleanup no llega a ejecutarse.

import { expect, test } from '@playwright/test';

const SUFIJO = Date.now();
const PROVEEDOR = `E2E Plomería ${SUFIJO}`;
const RUBRO = `E2E Rubro ${SUFIJO}`;
const SUBRUBRO = `E2E Subrubro ${SUFIJO}`;
// CUIT válido según el regex del backend, con los dígitos del medio derivados
// del timestamp para no chocar con el dedup entre corridas.
const CUIT = `30-${String(SUFIJO).slice(-8)}-9`;

async function loginAdmin(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

test('directorio de proveedores: alta, búsqueda por CUIT y baja', async ({ page }) => {
  await loginAdmin(page);

  await test.step('entrada por el sidebar', async () => {
    await page.getByRole('link', { name: 'Proveedores' }).click();
    await expect(page).toHaveURL(/\/configuracion\/proveedores$/);
    // S3-22b: el directorio es de la organización, no de un edificio, así que el
    // header no ofrece el selector de edificio de trabajo, y el breadcrumb dice
    // dónde está parado (con "Configuración" como texto: esa página no existe).
    await expect(
      page.getByRole('button', { name: /^Edificio de trabajo:/ }),
    ).toHaveCount(0);
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toContainText('Configuración');
    await expect(
      breadcrumb.getByRole('link', { name: 'Configuración' }),
    ).toHaveCount(0);
    await expect(breadcrumb.getByText('Proveedores')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Proveedor propio del seed: confirma que el badge de origen se pinta.
    const fila = page.getByRole('row', { name: /Ascensores Otis SA/ });
    await expect(fila).toContainText('Propio');
  });

  await test.step('alta de un proveedor propio', async () => {
    await page.getByRole('button', { name: 'Nuevo proveedor' }).click();
    await page.locator('#proveedor-razon-social').fill(PROVEEDOR);
    await page.locator('#proveedor-cuit').fill(CUIT);
    await page.locator('#proveedor-email').fill('e2e@proveedor.test');
    await page.getByRole('button', { name: 'Crear proveedor' }).click();

    await expect(page.getByRole('row', { name: new RegExp(PROVEEDOR) })).toContainText(
      'Propio',
    );
  });

  await test.step('CUIT inválido se marca en el campo, no en un toast', async () => {
    await page.getByRole('button', { name: 'Nuevo proveedor' }).click();
    await page.locator('#proveedor-razon-social').fill('Formato mal');
    await page.locator('#proveedor-cuit').fill('30123456789');
    // El error es de Zod en el cliente: se dispara al salir del campo.
    await page.locator('#proveedor-razon-social').click();
    await expect(page.getByText(/CUIT inválido/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  await test.step('el buscador pega al backend y encuentra por CUIT', async () => {
    await page.locator('#proveedores-buscar').fill(CUIT);
    await expect(page.getByRole('row', { name: new RegExp(PROVEEDOR) })).toBeVisible();
    // El otro proveedor del seed queda fuera: filtra el backend, no el cliente.
    await expect(
      page.getByRole('row', { name: /Ascensores Otis SA/ }),
    ).toHaveCount(0);
  });

  await test.step('baja: sin gastos asociados se elimina', async () => {
    await page
      .getByRole('button', { name: `Acciones de ${PROVEEDOR}` })
      .click();
    await page.getByRole('menuitem', { name: 'Dar de baja' }).click();
    await page.getByRole('button', { name: 'Dar de baja' }).click();

    await expect(page.getByText('Proveedor eliminado')).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(PROVEEDOR) }),
    ).toHaveCount(0);
  });
});

// El maestro es estado COMPARTIDO del seed: ocultarlo y que el test aborte antes
// de restaurarlo deja el rubro oculto para la corrida siguiente (y para quien
// esté mirando la app). Los pasos que lo tocan van sobre un rubro PROPIO del
// test, y el override de visibilidad del maestro se verifica en un solo paso que
// oculta y restaura sin assertions intermedias que puedan cortarlo por la mitad.
test('árbol de rubros: visibilidad, subrubros propios y protección del maestro', async ({
  page,
}) => {
  await loginAdmin(page);

  await page.getByRole('link', { name: 'Rubros' }).click();
  await expect(page).toHaveURL(/\/configuracion\/rubros$/);
  // S3-22b: el árbol es de la organización; sin selector de edificio en el
  // header y con breadcrumb propio.
  await expect(
    page.getByRole('button', { name: /^Edificio de trabajo:/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Rubros'),
  ).toHaveAttribute('aria-current', 'page');

  // Los toasts de sonner repiten el nombre del rubro: los asserts sobre el árbol
  // se acotan a `main` para no matchear la notificación.
  const arbol = page.getByRole('main');

  await test.step('el maestro del seed está en el árbol', async () => {
    await expect(page.getByText('Mantenimiento', { exact: true })).toBeVisible();
    await expect(page.getByText('Plomería', { exact: true })).toBeVisible();
  });

  await test.step('el maestro no se edita ni se borra: solo se oculta', async () => {
    await page
      .getByRole('button', { name: 'Acciones de Mantenimiento', exact: true })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Editar' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Eliminar' })).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  await test.step('override de visibilidad sobre un ítem del maestro', async () => {
    const ocultar = page.getByRole('button', {
      name: 'Ocultar Mantenimiento',
      exact: true,
    });
    await ocultar.click();
    await expect(page.getByText('"Mantenimiento" ya no se ofrece')).toBeVisible();
    // Restaurar YA, antes de cualquier otra assertion: el maestro es compartido.
    await page
      .getByRole('button', { name: 'Mostrar Mantenimiento', exact: true })
      .click();
    await expect(page.getByText('"Mantenimiento" vuelve a ofrecerse')).toBeVisible();
    await expect(ocultar).toBeEnabled();
  });

  await test.step('alta de un rubro propio de nivel 1', async () => {
    await page.getByRole('button', { name: 'Nuevo rubro' }).click();
    await page.locator('#rubro-nombre').fill(RUBRO);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText('Rubro creado')).toBeVisible();
    await expect(arbol.getByText(RUBRO, { exact: true })).toBeVisible();
  });

  await test.step('nombre repetido en el mismo nivel se rechaza inline', async () => {
    await page.getByRole('button', { name: 'Nuevo rubro' }).click();
    await page.locator('#rubro-nombre').fill('Mantenimiento');
    await page.getByRole('button', { name: 'Crear' }).click();
    // 409 RUBRO_DUPLICADO contra un hermano del MAESTRO: va al campo, no al toast.
    await expect(page.getByText(/Ya existe un rubro "Mantenimiento"/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  await test.step('subrubro propio colgado del rubro propio', async () => {
    await page.getByRole('button', { name: `Acciones de ${RUBRO}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Agregar subrubro' }).click();
    await page.locator('#rubro-nombre').fill(SUBRUBRO);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText('Rubro creado')).toBeVisible();
    await expect(arbol.getByText(SUBRUBRO, { exact: true })).toBeVisible();
  });

  await test.step('ocultar el rubro propio arrastra a su subrubro', async () => {
    await page.getByRole('button', { name: `Ocultar ${RUBRO}`, exact: true }).click();
    await expect(page.getByText(`"${RUBRO}" ya no se ofrece`)).toBeVisible();
    // Herencia: el backend ya devuelve el hijo con `visible: false`, así que su
    // botón pasa a "Mostrar" y va deshabilitado (mostrarlo no tendría efecto).
    await expect(
      page.getByRole('button', { name: `Mostrar ${SUBRUBRO}`, exact: true }),
    ).toBeDisabled();

    await page.getByRole('button', { name: `Mostrar ${RUBRO}`, exact: true }).click();
    await expect(page.getByText(`"${RUBRO}" vuelve a ofrecerse`)).toBeVisible();
  });

  await test.step('un rubro con subrubros no se elimina', async () => {
    await page.getByRole('button', { name: `Acciones de ${RUBRO}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    // 409 RUBRO_CON_SUBRUBROS: borrarlo ascendería a sus hijos a nivel 1.
    await expect(page.getByText(/subrubro/)).toBeVisible();
  });

  await test.step('cleanup: subrubro y rubro propios, en ese orden', async () => {
    for (const nombre of [SUBRUBRO, RUBRO]) {
      await page.getByRole('button', { name: `Acciones de ${nombre}`, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Eliminar' }).click();
      await page.getByRole('button', { name: 'Eliminar' }).click();
      await expect(page.getByText('Rubro eliminado')).toBeVisible();
      await expect(arbol.getByText(nombre, { exact: true })).toHaveCount(0);
    }
  });
});
