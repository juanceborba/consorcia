// frontend/e2e/liquidacion-aprobacion.spec.js — E2E del workflow de aprobación y
// de los recibos (S3-10, PRD-04-03 §1 y §2 PASO 4-5) en browser real.
//
// Este spec cubre lo que liquidacion-preview.spec.js (S3-09) deliberadamente
// dejaba afuera: las transiciones de estado desde la UI y la descarga del PDF de
// cada UF. El recorrido es el tramo del DoD del sprint que va del borrador al
// recibo descargable: BORRADOR → Aprobar → APROBADA → Generar recibos → ENVIADA
// → descargar un PDF, y al final Anular (que además es el cleanup).
//
// LOS GASTOS Y LA LIQUIDACIÓN DE PARTIDA SE CREAN POR API. Generar una
// liquidación desde el diálogo ya está probado punta a punta en
// liquidacion-preview.spec.js; repetirlo acá sumaría pasos frágiles a un spec que
// vino a probar las ACCIONES sobre una liquidación que ya existe.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: la liquidación se anula por UI (es el último paso del workflow que hay
// que probar) y los gastos y el proveedor creados se dan de baja por API. Los
// recibos emitidos NO se borran: son documentación del consorcio (Ley 941) y el
// backend no ofrece borrarlos. El sufijo con timestamp mantiene las corridas
// independientes.

import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000';

const SUFIJO = Date.now();
const PROVEEDOR = `E2E Recibos ${SUFIJO}`;
const ORDINARIO = `E2E Portería ${SUFIJO}`;

// Período propio del spec para no pisarse con los otros que liquidan el mismo
// edificio: -6 lo usa esquemas-reparto.spec.js y -7/-11 liquidacion-preview.
const mesesAtras = (n) => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - n, 1))
    .toISOString()
    .slice(0, 7);
};
const PERIODO = mesesAtras(9);

async function login(page, email) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

async function irATorrePalermo(page) {
  await page.getByRole('link', { name: /Torre Palermo/ }).first().click();
  await expect(page).toHaveURL(/\/edificios\/[0-9a-f-]+\/unidades$/);
  return page.url().match(/\/edificios\/([0-9a-f-]+)\//)[1];
}

async function tokenDeLaSesion(page) {
  return page.evaluate(() => {
    const guardado = JSON.parse(localStorage.getItem('consorcia-auth'));
    return guardado?.state?.accessToken ?? null;
  });
}

// Deja el período limpio y crea un gasto de categoría A + su liquidación en
// BORRADOR. Devuelve los ids para el cleanup.
async function prepararBorrador(request, headers, edificioId) {
  const creados = { proveedorId: null, gastos: [], liquidacionId: null };

  const previas = await request.get(
    `${API}/api/edificios/${edificioId}/liquidaciones?periodo=${PERIODO}`,
    { headers },
  );
  for (const vieja of (await previas.json()).data ?? []) {
    if (vieja.estado !== 'ANULADA') {
      await request.post(`${API}/api/liquidaciones/${vieja.id}/anular`, { headers });
    }
  }

  const viejos = await request.get(
    `${API}/api/edificios/${edificioId}/gastos?periodo=${PERIODO}&limit=100`,
    { headers },
  );
  for (const gasto of (await viejos.json()).data ?? []) {
    if (gasto.concepto.startsWith('E2E ')) {
      await request.delete(`${API}/api/gastos/${gasto.id}`, { headers });
    }
  }

  const proveedor = await request.post(`${API}/api/proveedores`, {
    headers,
    data: { razonSocial: PROVEEDOR },
  });
  expect(proveedor.status()).toBe(201);
  creados.proveedorId = (await proveedor.json()).id;

  const arbol = await request.get(`${API}/api/rubros`, { headers });
  const rubroId = (await arbol.json()).data[0].subrubros[0].id;

  const gasto = await request.post(`${API}/api/edificios/${edificioId}/gastos`, {
    headers,
    data: {
      proveedorId: creados.proveedorId,
      rubroId,
      categoria: 'A',
      periodo: PERIODO,
      fechaGasto: `${PERIODO}-05`,
      concepto: ORDINARIO,
      monto: '50000.00',
      esOrdinario: true,
    },
  });
  expect(gasto.status()).toBe(201);
  creados.gastos.push((await gasto.json()).id);

  const liquidacion = await request.post(
    `${API}/api/edificios/${edificioId}/liquidaciones`,
    { headers, data: { periodo: PERIODO } },
  );
  expect(liquidacion.status()).toBe(201);
  const cuerpo = await liquidacion.json();
  expect(cuerpo.estado).toBe('BORRADOR');
  creados.liquidacionId = cuerpo.id;

  return creados;
}

async function limpiar(request, headers, creados) {
  if (creados.liquidacionId) {
    await request.post(`${API}/api/liquidaciones/${creados.liquidacionId}/anular`, {
      headers,
    });
  }
  for (const id of creados.gastos) {
    await request.delete(`${API}/api/gastos/${id}`, { headers });
  }
  if (creados.proveedorId) {
    await request.delete(`${API}/api/proveedores/${creados.proveedorId}`, { headers });
  }
}

test('workflow: aprobar, generar recibos y descargar el PDF de una UF', async ({
  page,
  request,
}) => {
  await login(page, 'admin@demo.com');
  const edificioId = await irATorrePalermo(page);
  const headers = { Authorization: `Bearer ${await tokenDeLaSesion(page)}` };

  const creados = await prepararBorrador(request, headers, edificioId);

  await page.goto(`/edificios/${edificioId}/liquidaciones/${creados.liquidacionId}`);

  await test.step('un borrador ofrece Aprobar y Anular, no Generar recibos', async () => {
    await expect(page.getByText('Borrador', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprobar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anular' })).toBeVisible();
    // Decisión 1 de AccionesLiquidacion: la acción que el estado no permite no
    // se dibuja grisada, no se dibuja.
    await expect(page.getByRole('button', { name: 'Generar recibos' })).toHaveCount(0);
    // Decisión 1 de RecibosCard: sobre un borrador la card no existe.
    await expect(
      page.getByText('Todavía no se emitieron los recibos', { exact: true }),
    ).toHaveCount(0);
  });

  await test.step('aprobar pide confirmación y explica qué se congela', async () => {
    await page.getByRole('button', { name: 'Aprobar' }).click();

    // Decisión 2: el diálogo dice qué deja de poder hacerse después.
    await expect(page.getByText('¿Aprobar esta liquidación?')).toBeVisible();
    await expect(
      page.getByText(/no se pueden editar los gastos del período/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar liquidación' }).click();

    await expect(page.getByText('Liquidación aprobada')).toBeVisible();
    await expect(page.getByText('Aprobada', { exact: true })).toBeVisible();
  });

  await test.step('aprobada: la card de recibos aparece vacía y nombra la acción', async () => {
    // Decisión 1 de RecibosCard: el vacío conecta el estado con el botón.
    await expect(
      page.getByText('Todavía no se emitieron los recibos', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar recibos' })).toBeVisible();
    // Ya aprobada, "Aprobar" desaparece del juego de acciones.
    await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
  });

  await test.step('generar recibos emite uno por UF y los lista', async () => {
    await page.getByRole('button', { name: 'Generar recibos' }).click();
    await expect(page.getByText('¿Generar los recibos?')).toBeVisible();
    // La card de recibos habla también de la matrícula RPA: se busca la frase
    // propia del diálogo.
    await expect(
      page.getByText(/Se emite un recibo PDF por unidad/),
    ).toBeVisible();
    // El botón de confirmar comparte rótulo con el que abrió el diálogo: se toma
    // el del diálogo, que es el último del DOM.
    await page.getByRole('button', { name: 'Generar recibos' }).last().click();

    await expect(page.getByText('Recibos generados')).toBeVisible();
    await expect(page.getByText('Enviada', { exact: true })).toBeVisible();

    // Torre Palermo tiene 10 UFs en el seed: un recibo por unidad.
    const filas = page.getByRole('button', { name: /^Descargar el recibo/ });
    await expect(filas.first()).toBeVisible();
    expect(await filas.count()).toBeGreaterThan(1);
  });

  await test.step('el PDF de una UF se descarga', async () => {
    // Decisión 3 de RecibosCard: la descarga es un fetch con Bearer que dispara
    // un anchor sobre un blob, no un href al endpoint (bajaría un 401).
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /^Descargar el recibo/ }).first().click(),
    ]);
    // El nombre sale del Content-Disposition de la API.
    expect(descarga.suggestedFilename()).toMatch(/^recibo-.+\.pdf$/);
    expect(await descarga.path()).toBeTruthy();
  });

  await test.step('anular una enviada libera el período', async () => {
    await page.getByRole('button', { name: 'Anular' }).click();
    await expect(page.getByText('¿Anular esta liquidación?')).toBeVisible();
    // Los recibos ya emitidos no se borran: es documentación del consorcio.
    await expect(page.getByText(/no se borran/)).toBeVisible();
    await page.getByRole('button', { name: 'Anular liquidación' }).click();

    await expect(page.getByText('Liquidación anulada')).toBeVisible();
    await expect(page.getByText('Anulada', { exact: true })).toBeVisible();
    // Decisión 1: una anulada no ofrece ninguna acción.
    await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
  });

  await test.step('cleanup', async () => {
    // La liquidación ya quedó anulada por la UI; `limpiar` es idempotente.
    await limpiar(request, headers, creados);
  });
});

test('el gestor no opera el workflow pero descarga los recibos emitidos', async ({
  page,
  request,
  browser,
}) => {
  // Decisión 5 de la preview: `liquidacion.yaml` le da al gestor solo `read`, así
  // que no ve los botones de transición. `recibo.yaml` sí le da `read` sobre los
  // recibos de sus edificios asignados: la descarga tiene que funcionarle.
  await login(page, 'admin@demo.com');
  const edificioId = await irATorrePalermo(page);
  const headers = { Authorization: `Bearer ${await tokenDeLaSesion(page)}` };

  const creados = await prepararBorrador(request, headers, edificioId);
  await request.post(`${API}/api/liquidaciones/${creados.liquidacionId}/aprobar`, {
    headers,
  });
  const enviada = await request.post(
    `${API}/api/liquidaciones/${creados.liquidacionId}/enviar`,
    { headers },
  );
  expect(enviada.status()).toBe(200);

  const contexto = await browser.newContext();
  const pageGestor = await contexto.newPage();
  try {
    await login(pageGestor, 'gestor@demo.com');
    await pageGestor.goto(
      `/edificios/${edificioId}/liquidaciones/${creados.liquidacionId}`,
    );

    await expect(pageGestor.getByText('Enviada', { exact: true })).toBeVisible();
    await expect(pageGestor.getByRole('button', { name: 'Anular' })).toHaveCount(0);
    await expect(
      pageGestor.getByRole('button', { name: 'Generar recibos' }),
    ).toHaveCount(0);

    const [descarga] = await Promise.all([
      pageGestor.waitForEvent('download'),
      pageGestor
        .getByRole('button', { name: /^Descargar el recibo/ })
        .first()
        .click(),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^recibo-.+\.pdf$/);
  } finally {
    await contexto.close();
    await limpiar(request, headers, creados);
  }
});
