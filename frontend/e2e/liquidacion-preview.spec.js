// frontend/e2e/liquidacion-preview.spec.js — E2E de generar una liquidación y
// leer su preview (S3-09, PRD-04-03 §2 y §4.1) en browser real.
//
// El recorrido es el del DoD del sprint hasta donde llega esta tarea: con los
// gastos del período cargados, generar la liquidación desde la UI y verificar en
// la preview los totales, el detalle por UF y el desglose del reparto de cada
// unidad — que es lo que un administrador mira ANTES de aprobar.
//
// LOS GASTOS DE PARTIDA SE CREAN POR API, no por el formulario. Cargar un gasto
// por la UI ya está cubierto punta a punta en gastos-carga.spec.js y en
// esquemas-reparto.spec.js; repetirlo acá agregaría diez pasos frágiles a un
// spec que vino a probar OTRA pantalla. Lo que este spec ejercita por el DOM es
// todo lo de S3-09: el diálogo de generación, sus errores y la preview.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: la liquidación se anula (no se borra: es documentación del
// consorcio, Ley 941) y los gastos y el proveedor creados se dan de baja. El
// sufijo con timestamp mantiene las corridas independientes.

import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000';

const SUFIJO = Date.now();
const PROVEEDOR = `E2E Servicios ${SUFIJO}`;
const ORDINARIO = `E2E Limpieza ${SUFIJO}`;
const EXTRAORDINARIO = `E2E Obra terraza ${SUFIJO}`;

// Períodos dentro de la ventana de 12 meses que ofrece el selector. -7 para el
// período que se liquida (esquemas-reparto.spec.js usa -6 sobre el mismo
// edificio) y -11 para el que tiene que quedar vacío, que es el caso SIN_GASTOS.
const mesesAtras = (n) => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - n, 1))
    .toISOString()
    .slice(0, 7);
};
const PERIODO = mesesAtras(7);
const PERIODO_VACIO = mesesAtras(11);

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
// Mismo formato que `formatearPeriodo` del frontend, para las aserciones sobre
// el copy. El selector se opera por VALUE y no por etiqueta: la etiqueta de un
// período ya liquidado incluye el sufijo "— ya liquidado (borrador)".
const etiquetaPeriodo = (periodo) => {
  const [anio, mes] = periodo.split('-');
  return `${MESES[Number(mes) - 1]} ${anio}`;
};

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

// El access token que el browser ya tiene: la API se llama con la misma sesión.
async function tokenDeLaSesion(page) {
  return page.evaluate(() => {
    const guardado = JSON.parse(localStorage.getItem('consorcia-auth'));
    return guardado?.state?.accessToken ?? null;
  });
}

test('liquidación: generarla desde la UI y verificar la preview', async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  const edificioId = await irATorrePalermo(page);
  const token = await tokenDeLaSesion(page);
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };

  const creados = { proveedorId: null, gastos: [], liquidacionId: null };

  await test.step('precondición: dos gastos de categoría A en el período', async () => {
    // El período admite UNA liquidación viva: si una corrida anterior se cortó
    // antes de anular la suya, el POST del diálogo respondería 409.
    const previas = await request.get(
      `${API}/api/edificios/${edificioId}/liquidaciones?periodo=${PERIODO}`,
      { headers },
    );
    for (const vieja of (await previas.json()).data ?? []) {
      if (vieja.estado !== 'ANULADA') {
        await request.post(`${API}/api/liquidaciones/${vieja.id}/anular`, { headers });
      }
    }

    // Y los gastos de una corrida que no llegó al cleanup se acumularían en el
    // mismo período, inflando los totales que este spec afirma. Se borran los
    // que llevan el prefijo del spec; nada más de ese período se toca.
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

    // Categoría A: pagan todas las unidades, así que la tabla de la preview
    // tiene una fila por UF y la fila TOTAL reconcilia con las tarjetas.
    // Uno ordinario y uno extraordinario para que las dos tarjetas de la
    // preview tengan número propio (Ley 941: van separadas).
    const fecha = `${PERIODO}-05`;
    for (const gasto of [
      { concepto: ORDINARIO, monto: '30000.00', esOrdinario: true },
      { concepto: EXTRAORDINARIO, monto: '10000.00', esOrdinario: false },
    ]) {
      const creado = await request.post(
        `${API}/api/edificios/${edificioId}/gastos`,
        {
          headers,
          data: {
            proveedorId: creados.proveedorId,
            rubroId,
            categoria: 'A',
            periodo: PERIODO,
            fechaGasto: fecha,
            ...gasto,
          },
        },
      );
      expect(creado.status()).toBe(201);
      creados.gastos.push((await creado.json()).id);
    }
  });

  await test.step('el período sin gastos no se puede liquidar, y lo dice con la salida', async () => {
    await page.getByRole('tab', { name: 'Liquidaciones' }).click();
    await expect(page).toHaveURL(/\/liquidaciones$/);

    await page.getByRole('button', { name: 'Generar liquidación' }).click();
    await page
      .locator('#liquidacion-periodo')
      .selectOption(PERIODO_VACIO);
    await page.getByRole('button', { name: 'Generar liquidación' }).click();

    // Decisión 3 del diálogo: el 422 se responde con la acción que lo resuelve.
    await expect(page.getByText('No hay gastos en ese período')).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: `Cargar los gastos de ${etiquetaPeriodo(PERIODO_VACIO)}`,
      }),
    ).toBeVisible();
  });

  await test.step('generar el período con gastos lleva a la preview', async () => {
    await page
      .locator('#liquidacion-periodo')
      .selectOption(PERIODO);
    await page.getByRole('button', { name: 'Generar liquidación' }).click();

    await expect(page.getByText('Liquidación generada')).toBeVisible();
    await expect(page).toHaveURL(/\/liquidaciones\/[0-9a-f-]+$/);
    creados.liquidacionId = page.url().split('/').pop();

    // El tab sigue marcado en Liquidaciones aunque la URL tenga un segmento más
    // (el fix de `tabActual` en EdificioDetallePage).
    await expect(page.getByRole('tab', { name: 'Liquidaciones' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  await test.step('las tarjetas de resumen separan ordinarias de extraordinarias', async () => {
    await expect(
      page.getByText(`Liquidación de ${etiquetaPeriodo(PERIODO)}`),
    ).toBeVisible();
    await expect(page.getByText('Borrador', { exact: true })).toBeVisible();

    // 30.000 ordinarias + 10.000 extraordinarias = 40.000 general.
    await expect(page.getByText(/30\.000,00/).first()).toBeVisible();
    await expect(page.getByText(/10\.000,00/).first()).toBeVisible();
    await expect(page.getByText(/40\.000,00/).first()).toBeVisible();
    // Los dos gastos repartidos entre las UF del edificio.
    await expect(page.getByText(/2 gasto\(s\) repartidos entre \d+ unidad\(es\)/)).toBeVisible();
  });

  await test.step('el detalle por unidad cierra al centavo con el total', async () => {
    const filas = page.locator('tbody tr');
    await expect(filas.first()).toBeVisible();

    // Decisión 4 de la preview: si el pie no reconciliara con el total general,
    // la pantalla lo denuncia. Que la alerta NO esté es la afirmación del DoD
    // ("la suma de los detalles = totalGeneral al centavo").
    await expect(page.getByText('Los totales no reconcilian')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'TOTAL' })).toBeVisible();

    // Planta baja paga: el gasto es de categoría A.
    const filaPB = page.locator('tbody tr').filter({ hasText: /^PB/ }).first();
    await expect(filaPB).toBeVisible();
  });

  await test.step('expandir una unidad muestra el detalle de gastos agrupado por rubro', async () => {
    const filaPB = page.locator('tbody tr').filter({ hasText: /^PB/ }).first();
    await filaPB.click();

    // Decisión 7 de la preview: el desglose es el borrador del recibo. Los dos
    // gastos de la precondición son del MISMO rubro pero uno es ordinario y el
    // otro extraordinario, así que tienen que caer en secciones distintas.
    await expect(page.getByText(/Detalle de la unidad PB/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Expensas ordinarias', level: 4 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Expensas extraordinarias', level: 4 }),
    ).toBeVisible();

    // Cada ítem se identifica por su concepto, no por un id de gasto.
    await expect(page.getByText(ORDINARIO, { exact: true })).toBeVisible();
    await expect(page.getByText(EXTRAORDINARIO, { exact: true })).toBeVisible();

    // Decisión 2: el reparto sigue estando, en la línea secundaria del ítem.
    // Sin esquema de reparto el peso es el coeficiente y no se nombra ninguno.
    await expect(
      page.getByText(/Imputación única · participación 0\./).first(),
    ).toBeVisible();
  });

  await test.step('el período ya liquidado avisa antes de dejar reintentar', async () => {
    await page.getByRole('link', { name: 'Volver a liquidaciones' }).click();
    await expect(page).toHaveURL(/\/liquidaciones$/);

    // La lista ya tiene la liquidación recién generada, con su badge de estado.
    // Se filtra también por el estado: un período puede tener varias filas —
    // las anuladas de corridas anteriores siguen listadas (no se borran, se
    // anulan), que es exactamente lo que la lista tiene que mostrar.
    const fila = page
      .locator('tbody tr')
      .filter({ hasText: etiquetaPeriodo(PERIODO) })
      .filter({ hasText: 'Borrador' });
    await expect(fila).toBeVisible();

    await page.getByRole('button', { name: 'Generar liquidación' }).click();
    await page
      .locator('#liquidacion-periodo')
      .selectOption(PERIODO);
    // Decisión 2 del diálogo: se avisa y se deshabilita el submit, en vez de
    // dejar que el usuario descubra el 409.
    await expect(page.getByText('Este período ya tiene liquidación')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Generar liquidación' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  await test.step('cleanup', async () => {
    if (creados.liquidacionId) {
      await request.post(`${API}/api/liquidaciones/${creados.liquidacionId}/anular`, {
        headers,
      });
    }
    for (const id of creados.gastos) {
      await request.delete(`${API}/api/gastos/${id}`, { headers });
    }
    if (creados.proveedorId) {
      await request.delete(`${API}/api/proveedores/${creados.proveedorId}`, {
        headers,
      });
    }
  });
});

test('el gestor ve las liquidaciones pero no las genera', async ({ page }) => {
  // Decisión 3 del tab: `liquidacion.yaml` le da al gestor solo `read`, así que
  // la UI no le ofrece el botón en vez de dejarlo chocar con un 403.
  await page.goto('/login');
  await page.locator('#email').fill('gestor@demo.com');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);

  await page.getByRole('link', { name: /Torre Palermo/ }).first().click();
  await page.getByRole('tab', { name: 'Liquidaciones' }).click();
  await expect(page).toHaveURL(/\/liquidaciones$/);

  await expect(page.getByText('Liquidaciones', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generar liquidación' }),
  ).toHaveCount(0);
});
