// frontend/e2e/fondo-reserva.spec.js — E2E del fondo de reserva (S3-21) en
// browser real: PRD-04-03 §5 y `docs/investigacion/ledger-y-fondo-de-reserva.md`.
//
// QUÉ VERIFICA QUE LOS TESTS DE BACKEND NO PUEDEN: que el administrador pueda
// CONFIGURAR la regla desde la pantalla y ver su efecto en la liquidación del
// período — que es donde se nota si el número que configuró es el que se cobra.
// El cálculo, la resolución por período y la reconciliación al centavo están en
// `backend/tests/fondo-reserva.test.js`.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// ESTRATEGIA DE DATOS: la regla que este spec crea tiene vigencia FUTURA, así
// que no liquida nada y se puede borrar al final. La regla que se ve en acción
// es la del seed (5% en Torre Palermo): una regla ya usada por una liquidación
// NO se puede borrar —la FK es Restrict, y está bien que lo sea—, así que
// crearla acá dejaría residuo permanente en la DB de desarrollo.
//
// Cleanup: la regla futura se elimina, la liquidación generada se anula (no se
// borra: es documentación del consorcio) y el gasto y el proveedor se dan de baja.

import { expect, request as apiRequest, test } from '@playwright/test';

const API = 'http://localhost:3000';
const SUFIJO = Date.now();

// Torre Palermo: el seed le deja la regla del 5% de las ordinarias, que es la
// que se ve aplicada en la liquidación.
const EDIFICIO = 'Torre Palermo';

async function login(page) {
  await page.goto('/login');
  await page.locator('#email').fill('admin@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

test('configurar el fondo de reserva y verlo en la liquidación', async ({ page }) => {
  await login(page);

  await page.getByRole('link', { name: new RegExp(EDIFICIO) }).first().click();
  await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]+\/unidades$/);
  const edificioId = page.url().match(/\/edificios\/([0-9a-f-]+)\//)[1];

  const api = await apiRequest.newContext();
  const sesion = await api.post(`${API}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  const headers = { Authorization: `Bearer ${(await sesion.json()).accessToken}` };

  // Una corrida anterior que no llegó al cleanup deja su regla futura: se borra
  // (el backend rechaza con 409 las que ya liquidaron, y esas se dejan estar).
  const previas = await api.get(`${API}/api/edificios/${edificioId}/fondo-reserva`, {
    headers,
  });
  const futuras = ((await previas.json()).data ?? []).filter(
    (r) => r.vigenciaDesde > new Date().toISOString().slice(0, 7),
  );
  for (const regla of futuras) {
    await api.delete(`${API}/api/fondo-reserva/${regla.id}`, { headers });
  }

  await test.step('la regla del seed se ve como la vigente, con su respaldo', async () => {
    await page.getByRole('tab', { name: 'Configuración' }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
    await expect(page.getByText('Fondo de reserva', { exact: true })).toBeVisible();
    await expect(page.getByText('5,00%', { exact: true })).toBeVisible();
    await expect(page.getByText('Vigente', { exact: true })).toBeVisible();
    await expect(page.getByText(/Asamblea ordinaria/)).toBeVisible();
  });

  await test.step('una regla con vigencia futura se carga y NO desplaza a la vigente', async () => {
    // Decisión 2 de la sección: la lista está ordenada por vigencia, así que la
    // futura encabeza el historial sin ser la que rige.
    await page.getByRole('button', { name: 'Nueva regla' }).click();
    await expect(
      page.getByRole('heading', { name: 'Nueva regla del fondo de reserva' }),
    ).toBeVisible();

    const enSeisMeses = new Date();
    enSeisMeses.setUTCMonth(enSeisMeses.getUTCMonth() + 6);
    await page
      .locator('#fondo-vigencia')
      .selectOption(enSeisMeses.toISOString().slice(0, 7));
    await page.locator('#fondo-base').selectOption('ORDINARIAS');
    await page.locator('#fondo-valor').fill('8');
    await page.locator('#fondo-motivo').fill(`Asamblea E2E ${SUFIJO}`);
    await page.getByRole('button', { name: 'Guardar regla' }).click();

    await expect(page.getByText('Regla del fondo guardada')).toBeVisible();
    await expect(page.getByText('8,00%', { exact: true })).toBeVisible();
    await expect(page.getByText('Desde el futuro', { exact: true })).toBeVisible();
    await expect(page.getByText(`Asamblea E2E ${SUFIJO}`)).toBeVisible();
    // La que rige sigue siendo la del 5%: cambiar el porcentaje a futuro no
    // toca el período en curso.
    await expect(page.getByText('Vigente', { exact: true })).toBeVisible();
    await expect(page.getByText(/Hoy se aporta 5,00%/)).toBeVisible();
  });

  await test.step('y avisa que el fondo todavía no se puede usar', async () => {
    // La capa A acumula pero no permite gastar el fondo: eso pide el ledger del
    // edificio, y la pantalla lo dice en vez de prometer una operación que no
    // existe.
    await expect(
      page.getByText(/Usarlo para financiar una obra extraordinaria/),
    ).toBeVisible();
  });

  await test.step('la liquidación del período incluye el aporte como tercer subtotal', async () => {
    // Los gastos y la liquidación se manejan por API: el recorrido de carga ya
    // está cubierto en gastos-carga.spec.js y liquidacion-preview.spec.js, y lo
    // que este spec vino a ver es el efecto de la regla.
    const periodo = new Date().toISOString().slice(0, 7);
    const proveedor = await api.post(`${API}/api/proveedores`, {
      headers,
      data: { razonSocial: `E2E Fondo ${SUFIJO}` },
    });
    const proveedorId = (await proveedor.json()).id;
    const arbol = await api.get(`${API}/api/rubros`, { headers });
    const rubroId = (await arbol.json()).data[0].subrubros[0].id;

    const gasto = await api.post(`${API}/api/edificios/${edificioId}/gastos`, {
      headers,
      data: {
        proveedorId,
        rubroId,
        categoria: 'A',
        periodo,
        fechaGasto: `${periodo}-05`,
        concepto: `E2E Fondo gasto ${SUFIJO}`,
        monto: '100000.00',
        esOrdinario: true,
      },
    });
    expect(gasto.status()).toBe(201);
    const gastoId = (await gasto.json()).id;

    const liquidacion = await api.post(
      `${API}/api/edificios/${edificioId}/liquidaciones`,
      { headers, data: { periodo } },
    );
    expect(liquidacion.status()).toBe(201);
    const creada = await liquidacion.json();

    // El 5% del seed sobre las ordinarias del período, sin hardcodear el total:
    // el seed carga gastos demo y este spec suma uno más.
    const ordinarias = Number(creada.totalOrdinarias);
    expect(Number(creada.totalFondoReserva)).toBeCloseTo(ordinarias * 0.05, 2);
    expect(Number(creada.totalGeneral)).toBeCloseTo(
      ordinarias + Number(creada.totalExtraordinarias) + Number(creada.totalFondoReserva),
      2,
    );

    await page.goto(`/edificios/${edificioId}/liquidaciones/${creada.id}`);
    await expect(page.getByText('Fondo de reserva', { exact: true }).first()).toBeVisible();

    // El snapshot explica de dónde salió el número.
    await expect(
      page.getByText('5,00% de las expensas ordinarias', { exact: true }).first(),
    ).toBeVisible();

    // Cleanup: anular la liquidación (no se borra: es documentación del
    // consorcio) y borrar el gasto y el proveedor del spec.
    await api.post(`${API}/api/liquidaciones/${creada.id}/anular`, { headers });
    await api.delete(`${API}/api/gastos/${gastoId}`, { headers });
    await api.delete(`${API}/api/proveedores/${proveedorId}`, { headers });
  });

  await test.step('cleanup: la regla futura, que no liquidó nada, se puede borrar', async () => {
    await page.goto(`/edificios/${edificioId}/configuracion`);
    // La primera de la lista es la futura (orden por vigencia desc).
    await page.getByRole('button', { name: /Eliminar la regla desde/ }).first().click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText('Regla eliminada')).toBeVisible();
    await api.dispose();
  });
});
