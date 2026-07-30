// frontend/e2e/esquemas-reparto.spec.js — E2E de los esquemas de reparto
// (S3-20, PRD-02-05 · CCyC art. 2049, último párrafo) en browser real.
//
// El recorrido es el que justifica la feature entera: crear un esquema que exime
// parcialmente a una unidad, asignárselo a un gasto y comprobar que la
// liquidación efectivamente repartió con ese esquema.
//
// EL ÚLTIMO PASO SE VERIFICA CONTRA LA API, NO CONTRA EL DOM, y es a propósito:
// la pantalla de liquidación es S3-09/S3-10 y todavía no existe, así que la
// preview no se puede abrir desde el browser. Lo que el spec hace es lo mismo
// que hará esa pantalla —`POST /api/edificios/:id/liquidaciones` y leer
// `unidades[].pesos[]`— reusando el token de la sesión del browser, y verifica
// los dos campos que S3-20 agregó al snapshot: `esquemaNombre` y `pesoAplicado`.
// Cuando exista la UI, este paso se reescribe contra el DOM sin cambiar lo que
// afirma.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: la liquidación se anula (no hay borrado: es documentación del
// consorcio), y el gasto, el esquema y el proveedor creado inline se dan de baja
// al final. El sufijo con timestamp mantiene las corridas independientes por si
// un cleanup no llega a ejecutarse.

import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000';

const SUFIJO = Date.now();
const ESQUEMA = `E2E Frente ${SUFIJO}`;
const CONCEPTO = `E2E Reparación puerta ${SUFIJO}`;
const PROVEEDOR = `E2E Herrería ${SUFIJO}`;

// Un período lejos del corriente para no chocar con la liquidación que otro spec
// pueda generar sobre el mismo edificio. Tiene que seguir entrando en la ventana
// de 12 períodos que ofrece el formulario de gasto.
const PERIODO = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 6, 1),
)
  .toISOString()
  .slice(0, 7);

async function loginAdmin(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

async function irATorrePalermo(page) {
  await page.getByRole('link', { name: /Torre Palermo/ }).first().click();
  await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]+\/unidades$/);
  return page.url().match(/\/edificios\/([0-9a-f-]+)\//)[1];
}

// La fila de un esquema en la lista de la sección. Scopeada a la lista por su
// nombre accesible: el nombre del esquema aparece además como `<option>` del
// selector de esquema general y dentro del toast de confirmación (que también es
// un `listitem`), así que un locator suelto matchearía tres cosas distintas.
const filaEsquema = (page, nombre) =>
  page
    .getByRole('list', { name: 'Esquemas de reparto del edificio' })
    .getByRole('listitem')
    .filter({ hasText: nombre });

// El access token que el browser ya tiene: la API se llama con la misma sesión
// del usuario, sin re-loguear por HTTP.
async function tokenDeLaSesion(page) {
  return page.evaluate(() => {
    const guardado = JSON.parse(localStorage.getItem('consorcia-auth'));
    return guardado?.state?.accessToken ?? null;
  });
}

test('esquema de reparto: crearlo, asignarlo a un gasto y verlo en la liquidación', async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  const edificioId = await irATorrePalermo(page);

  await test.step('la sección vive en Configuración y arranca sin esquema general', async () => {
    await page.getByRole('tab', { name: 'Configuración' }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
    // `CardTitle` es un div, no un heading: se busca por texto.
    await expect(page.getByText('Esquemas de reparto', { exact: true })).toBeVisible();
    // El seed deja Torre Palermo sin configuración de liquidación: el default
    // explícito (decisión 3 de la sección).
    await expect(page.locator('#esquema-general')).toHaveValue('');
    // Y el esquema del seed sí está en la lista.
    await expect(filaEsquema(page, 'Ascensor (PB al 50%)')).toBeVisible();
  });

  await test.step('crear un esquema que reparte solo entre dos UF, una al 50%', async () => {
    await page.getByRole('button', { name: 'Nuevo esquema' }).click();
    await expect(
      page.getByRole('heading', { name: 'Nuevo esquema de reparto' }),
    ).toBeVisible();

    await page.locator('#esquema-nombre').fill(ESQUEMA);
    // Base COEFICIENTE: el peso es un FACTOR sobre el coeficiente y la UF sin
    // fila paga el 100%. La pantalla lo dice, que es el punto de la sección.
    await page.locator('#esquema-base').selectOption('COEFICIENTE');
    await expect(page.getByText(/paga el 100% de su coeficiente/)).toBeVisible();

    // Alcance SELECCION y no SERVICIO: el seed ya tiene un esquema ACTIVO para
    // el servicio "ascensor" de este edificio y el índice único parcial
    // rechazaría un segundo (409 ALCANCE_OCUPADO). Con SELECCION el esquema no
    // matchea solo y el gasto lo toma por el override, que es justamente lo que
    // este spec quiere ejercitar.
    await page.locator('#esquema-alcance').selectOption('SELECCION');
    await page
      .locator('#esquema-clausula')
      .fill('art. 12 del reglamento de copropiedad');

    // PB al 50% de su coeficiente, 1A entero. Con SELECCION solo estas dos
    // participan del reparto.
    await page.locator('#esquema-peso-PB').fill('0,5');
    await page.locator('#esquema-peso-1A').fill('1');

    await page.getByRole('button', { name: 'Crear esquema' }).click();
    await expect(page.getByText('Esquema creado')).toBeVisible();
    await expect(filaEsquema(page, ESQUEMA)).toBeVisible();
  });

  await test.step('el gasto lo puede elegir como override', async () => {
    await page.getByRole('tab', { name: 'Gastos' }).click();
    await expect(page).toHaveURL(/\/gastos$/);

    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.locator('#gasto-concepto').fill(CONCEPTO);

    // El directorio de proveedores arranca vacío (el seed no trae ninguno): se
    // crea inline, igual que en gastos-carga.spec.js.
    await page.locator('#gasto-proveedor').fill(PROVEEDOR);
    await page.getByRole('button', { name: `Crear "${PROVEEDOR}"` }).click();
    await page.getByRole('button', { name: 'Crear proveedor' }).click();
    await expect(page.getByText('Proveedor creado')).toBeVisible();

    await page.locator('#gasto-rubro').selectOption({ label: 'Mantenimiento' });
    await page.locator('#gasto-rubro-subrubro').selectOption({ label: 'Plomería' });

    await page.locator('#gasto-monto').fill('30.000');
    await page.locator('#gasto-periodo').selectOption(PERIODO);

    // El default es "Automático": el override es la excepción (decisión 5 del
    // formulario de gasto).
    await expect(page.locator('#gasto-esquema')).toHaveValue('');
    await page.locator('#gasto-esquema').selectOption({ label: ESQUEMA });

    await page.getByRole('button', { name: 'Cargar gasto' }).click();
    await expect(page.getByText('Gasto cargado')).toBeVisible();
  });

  await test.step('la liquidación reparte con ese esquema (esquemaNombre + pesoAplicado)', async () => {
    const token = await tokenDeLaSesion(page);
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}` };

    // El período admite UNA liquidación viva: si una corrida anterior se cortó
    // antes de anular la suya, el POST respondería 409. Se anula acá en vez de
    // dejar el spec dependiendo de que el cleanup previo haya llegado a correr.
    const previas = await request.get(
      `${API}/api/edificios/${edificioId}/liquidaciones?periodo=${PERIODO}`,
      { headers },
    );
    for (const vieja of (await previas.json()).data ?? []) {
      if (vieja.estado !== 'ANULADA') {
        await request.post(`${API}/api/liquidaciones/${vieja.id}/anular`, { headers });
      }
    }

    const generada = await request.post(
      `${API}/api/edificios/${edificioId}/liquidaciones`,
      { headers, data: { periodo: PERIODO } },
    );
    expect(generada.status()).toBe(201);
    const preview = await generada.json();

    // El snapshot nombra el esquema con el que se calculó cada peso, y solo PB y
    // 1A quedaron alcanzadas (alcance SELECCION).
    const conElEsquema = preview.unidades
      .map((u) => ({
        numero: u.numero,
        peso: u.pesos.find((p) => p.esquemaNombre === ESQUEMA),
      }))
      .filter((u) => u.peso);

    expect(conElEsquema.map((u) => u.numero).sort()).toEqual(['1A', 'PB']);

    // `pesoAplicado` es el peso NORMALIZADO con el que se repartió (lo que el
    // motor persiste como `coeficienteAplicado`), así que los dos suman 1. Lo
    // que prueba la exención es su proporción: PB entra con 0.092 × 0,5 = 0.046
    // contra el 0.078 entero de 1A. Es el art. 12 puesto en números, que es lo
    // que S3-20 tenía que hacer posible.
    const pb = conElEsquema.find((u) => u.numero === 'PB').peso;
    const unoA = conElEsquema.find((u) => u.numero === '1A').peso;
    expect(
      Number(pb.pesoAplicado) + Number(unoA.pesoAplicado),
    ).toBeCloseTo(1, 6);
    expect(
      Number(pb.pesoAplicado) / Number(unoA.pesoAplicado),
      // Precisión 5 y no 6: `pesoAplicado` sale del contrato con 6 decimales
      // fijos, así que el cociente arrastra el redondeo de los dos operandos.
    ).toBeCloseTo(0.046 / 0.078, 5);
    // Los montos siguen a los pesos y suman el gasto entero.
    expect(
      Number(pb.monto) + Number(unoA.monto),
    ).toBeCloseTo(30000, 2);

    // Cleanup: una liquidación no se borra (Ley 941), se anula — y anularla
    // libera el período por si el spec vuelve a correr.
    const anulada = await request.post(
      `${API}/api/liquidaciones/${preview.id}/anular`,
      { headers },
    );
    expect(anulada.ok()).toBeTruthy();
  });

  await test.step('cleanup: el gasto, el esquema y el proveedor', async () => {
    // Por URL y no por el tab: la lista filtra por el período corriente y el
    // gasto de prueba es de seis meses atrás.
    await page.goto(`/edificios/${edificioId}/gastos?periodo=${PERIODO}`);
    const fila = page
      .locator('tbody')
      .getByRole('row', { name: new RegExp(CONCEPTO) });
    await expect(fila).toBeVisible();
    await page.getByRole('button', { name: `Acciones de ${CONCEPTO}` }).click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(fila).toHaveCount(0);

    await page.getByRole('tab', { name: 'Configuración' }).click();
    await page.getByRole('button', { name: `Eliminar ${ESQUEMA}` }).click();
    await page.getByRole('button', { name: 'Eliminar esquema' }).click();
    // El gasto quedó borrado (soft delete) pero la liquidación anulada todavía
    // referencia al esquema, así que lo esperable es la baja lógica; el borrado
    // real también es una respuesta correcta del semáforo doble.
    await expect(page.getByText(/Esquema (eliminado|desactivado)/)).toBeVisible();

    await page.getByRole('link', { name: 'Proveedores' }).click();
    await expect(page).toHaveURL(/\/configuracion\/proveedores$/);
    await page.locator('#proveedores-buscar').fill(PROVEEDOR);
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: `Acciones de ${PROVEEDOR}` }).click();
    await page.getByRole('menuitem', { name: 'Dar de baja' }).click();
    await page.getByRole('button', { name: 'Dar de baja' }).click();
    await expect(
      page.getByText(/Proveedor eliminado|Proveedor desactivado/),
    ).toBeVisible();
  });
});

test('el gestor ve los esquemas pero no los configura', async ({ page }) => {
  // Decisión 4 de la sección: `esquema_reparto.yaml` le da al gestor solo
  // `read`, así que la UI no le ofrece acciones de escritura en vez de dejarlo
  // chocar con un 403 (know-how pattern/require-role-guards-ui).
  await page.goto('/login');
  await page.locator('#email').fill('gestor@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);

  await page.getByRole('link', { name: /Torre Palermo/ }).first().click();
  await page.getByRole('tab', { name: 'Configuración' }).click();
  await expect(page.getByText('Esquemas de reparto', { exact: true })).toBeVisible();

  // Ve el esquema del seed…
  await expect(filaEsquema(page, 'Ascensor (PB al 50%)')).toBeVisible();
  // …y el selector del general, deshabilitado.
  await expect(page.locator('#esquema-general')).toBeDisabled();
  // Sin alta ni acciones de fila.
  await expect(page.getByRole('button', { name: 'Nuevo esquema' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Editar Ascensor (PB al 50%)' }),
  ).toHaveCount(0);
});
