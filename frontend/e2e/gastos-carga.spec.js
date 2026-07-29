// frontend/e2e/gastos-carga.spec.js — E2E de la carga de gastos (S3-08,
// PRD-04-02 §1.1/§4.2) en browser real.
//
// Cubre lo que no se puede verificar sin DOM, y en particular lo que S3-14 dejó
// sin ejercitar: `ProveedorSelect` es el PRIMER uso de `Combobox` de Base UI en
// la app (búsqueda del servidor + alta inline que deja el proveedor nuevo
// elegido) y `RubroSelect` es la cascada rubro → subrubro que no fija el
// `rubroId` hasta llegar a una hoja. Además: el monto tipeado en es-AR
// ("1.500,50") que viaja canónico, el servicio de la categoría B que sale de las
// unidades del edificio, la edición y el borrado con su ConfirmDialog.
//
// NO cubre el gasto congelado por una liquidación aprobada (acción de fila
// deshabilitada): la UI de liquidación es S3-09/S3-10 y todavía no existe, así
// que llegar a ese estado desde el browser no es posible. El 409 del backend
// está cubierto en `backend/tests/gastos.test.js` junto con el flag `editable`
// que apaga la acción; el recorrido completo cargar → liquidar → aprobar es del
// spec de cierre del sprint (S3-11).
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: el gasto se elimina como último paso del recorrido (es parte de lo
// que se prueba) y el proveedor creado inline se da de baja al final. El sufijo
// con timestamp mantiene las corridas independientes por si un cleanup no llega
// a ejecutarse.

import { expect, test } from '@playwright/test';

const SUFIJO = Date.now();
const CONCEPTO = `E2E Reparación ${SUFIJO}`;
const PROVEEDOR = `E2E Gremio ${SUFIJO}`;

// El seed de Torre Palermo declara `categoriaB: ['ascensor']` en todas las
// unidades que no son cochera: es el servicio que tiene que ofrecer la
// categoría B (el desplegable sale de las unidades, no de una lista fija).
const SERVICIO_DEL_SEED = 'Ascensor';

async function loginAdmin(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

async function irAGastosDeTorrePalermo(page) {
  await page.getByRole('link', { name: /Torre Palermo/ }).first().click();
  await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]+\/unidades$/);
  await page.getByRole('tab', { name: 'Gastos' }).click();
  await expect(page).toHaveURL(/\/gastos$/);
}

test('carga de un gasto: combobox de proveedor con alta inline, cascada de rubro y es-AR', async ({
  page,
}) => {
  await loginAdmin(page);
  await irAGastosDeTorrePalermo(page);

  const fila = page.getByRole('row', { name: new RegExp(CONCEPTO) });

  await test.step('el formulario abre con los defaults del período corriente', async () => {
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
    // Default: hoy y el mes corriente (§4.2).
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    await expect(page.locator('#gasto-fecha')).toHaveValue(
      `${hoy.getFullYear()}-${mes}-${String(hoy.getDate()).padStart(2, '0')}`,
    );
    await expect(page.locator('#gasto-periodo')).toHaveValue(
      `${hoy.getFullYear()}-${mes}`,
    );
  });

  await test.step('el alta inline crea el proveedor y lo deja elegido', async () => {
    // Primer uso del Combobox de Base UI: se escribe y el backend filtra.
    await page.locator('#gasto-proveedor').fill(PROVEEDOR);
    // Sin resultados, el combobox ofrece crearlo con el texto tipeado.
    await page.getByRole('button', { name: `Crear "${PROVEEDOR}"` }).click();

    // El diálogo de proveedor abre con la razón social ya puesta.
    await expect(page.locator('#proveedor-razon-social')).toHaveValue(PROVEEDOR);
    await page.getByRole('button', { name: 'Crear proveedor' }).click();
    await expect(page.getByText('Proveedor creado')).toBeVisible();

    // Y vuelve al form de gasto con el proveedor nuevo seleccionado.
    await expect(page.locator('#gasto-proveedor')).toHaveValue(PROVEEDOR);
  });

  await test.step('un rubro con subrubros no alcanza: hay que llegar a la hoja', async () => {
    await page.locator('#gasto-concepto').fill(CONCEPTO);
    // Monto tipeado en es-AR: el backend solo entiende punto decimal.
    await page.locator('#gasto-monto').fill('1.500,50');

    // "Mantenimiento" (maestro) tiene subrubros → el rubroId sigue vacío.
    await page.locator('#gasto-rubro').selectOption({ label: 'Mantenimiento' });
    await page.getByRole('button', { name: 'Cargar gasto' }).click();
    await expect(page.getByText(/Elegí el rubro y, si tiene, el subrubro/)).toBeVisible();

    await page.locator('#gasto-rubro-subrubro').selectOption({ label: 'Plomería' });
  });

  await test.step('la fecha futura se rechaza en el campo', async () => {
    await page.locator('#gasto-fecha').fill('2099-01-01');
    await page.getByRole('button', { name: 'Cargar gasto' }).click();
    await expect(page.getByText('La fecha no puede ser futura')).toBeVisible();

    const hoy = new Date();
    await page
      .locator('#gasto-fecha')
      .fill(
        `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(
          hoy.getDate(),
        ).padStart(2, '0')}`,
      );
  });

  await test.step('el gasto se carga y aparece en la lista con el monto es-AR', async () => {
    await page.getByRole('button', { name: 'Cargar gasto' }).click();
    await expect(page.getByText('Gasto cargado')).toBeVisible();
    // "1.500,50" tipeado → "1500.50" persistido → "$ 1.500,50" mostrado.
    await expect(fila).toContainText('1.500,50');
    await expect(fila).toContainText('Ordinario');
  });

  await test.step('editar a categoría B ofrece los servicios de las unidades', async () => {
    await page.getByRole('button', { name: `Acciones de ${CONCEPTO}` }).click();
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar gasto' })).toBeVisible();

    await page.locator('#gasto-categoria').selectOption('B');
    // El desplegable sale de `categoriaB` de las unidades del edificio.
    await page
      .locator('#gasto-servicio')
      .selectOption({ label: SERVICIO_DEL_SEED });

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Gasto actualizado')).toBeVisible();
    // El badge de la fila muestra la categoría con su servicio.
    await expect(fila).toContainText('B: ascensor');
  });

  await test.step('eliminar avisa que el registro se conserva (Ley 941)', async () => {
    await page.getByRole('button', { name: `Acciones de ${CONCEPTO}` }).click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await expect(page.getByText(/se conserva en el sistema/)).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.getByText('Gasto eliminado')).toBeVisible();
    await expect(fila).toHaveCount(0);
  });

  await test.step('cleanup: baja del proveedor creado inline', async () => {
    await page.getByRole('link', { name: 'Proveedores' }).click();
    await expect(page).toHaveURL(/\/configuracion\/proveedores$/);
    await page.locator('#proveedores-buscar').fill(PROVEEDOR);
    // El buscador tiene debounce de 300 ms y la tabla se vuelve a renderizar
    // cuando llega la respuesta: se espera el resultado ESTABLE (solo el
    // proveedor buscado, más el header) antes de abrir el menú de la fila, o el
    // re-render lo desmonta mientras Playwright clickea.
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: `Acciones de ${PROVEEDOR}` }).click();
    await page.getByRole('menuitem', { name: 'Dar de baja' }).click();
    await page.getByRole('button', { name: 'Dar de baja' }).click();
    await expect(page.getByText(/Proveedor eliminado|Proveedor desactivado/)).toBeVisible();
  });
});

test('el gestor lee los gastos pero no los carga', async ({ page }) => {
  // Decisión 6 del tab: la policy `gasto.yaml` le da al gestor solo `read`, así
  // que la UI no le ofrece acciones de escritura (know-how
  // pattern/require-role-guards-ui).
  await page.goto('/login');
  await page.locator('#email').fill('gestor@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);

  await irAGastosDeTorrePalermo(page);

  // `CardTitle` es un div, no un heading: se busca por texto.
  await expect(page.getByText(/^Gastos \(\d+\)$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toHaveCount(0);
});
