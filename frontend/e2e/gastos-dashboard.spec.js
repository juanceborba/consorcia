// frontend/e2e/gastos-dashboard.spec.js — E2E del dashboard de gastos (S3-17,
// PRD-04-02 §3 y PRD-07-03 §2.2) en browser real.
//
// QUÉ VINO A PROBAR ESTE SPEC: que los filtros son UNO SOLO para las dos vistas
// que los comparten (S3-16). El dashboard y el listado leen los mismos search
// params por `useFiltrosGastos` pero pegan a dos endpoints con contratos
// distintos, así que la falla que importa es la de contradicción: los KPIs de un
// período con la tabla de otro, o un rango conviviendo con un período (el
// dashboard responde 422 y la tabla sigue andando, precisión 2 de §3.4).
// Verificarlo pide un browser: la exclusión vive en la URL y en los controles.
//
// Y el consolidado de la organización (`/reportes/gastos`), que es la MISMA
// pantalla con otro alcance: acá se ejercita lo que solo se ve por DOM — que el
// hub muestra el reporte bloqueado en vez de esconderlo, que el 403 por plan se
// explica en la pantalla, y que elegir un edificio se lleva los filtros puestos.
//
// LO QUE NO REPITE: los KPIs de un gasto recién cargado y las tarjetas por
// categoría ya están en gastos-carga.spec.js, que llega ahí por el formulario.
// Acá los gastos de partida se crean por API (mismo criterio que
// liquidacion-preview.spec.js): el recorrido bajo prueba es el de los filtros.
//
// LOS TRES GASTOS SE MIRAN SIEMPRE CON `q` PUESTO (el sufijo con timestamp).
// El filtro de concepto viaja a las DOS queries, así que recorta el dashboard y
// la lista por igual: los totales que este spec afirma son exactos aunque el
// edificio tenga otros gastos del seed o de una corrida anterior sin cleanup.
//
// Requiere el stack levantado con el seed (make up && make db-seed).
//
// Cleanup: los gastos y los dos proveedores creados se dan de baja en el
// afterAll. El sufijo mantiene las corridas independientes.

import { expect, request as apiRequest, test } from '@playwright/test';

const API = 'http://localhost:3000';

const SUFIJO = `${Date.now()}`;
const CONCEPTO_PLOMERIA = `E2E Dash plomería ${SUFIJO}`;
const CONCEPTO_ELECTRICIDAD = `E2E Dash electricidad ${SUFIJO}`;
const CONCEPTO_LIMPIEZA = `E2E Dash limpieza ${SUFIJO}`;
const PROVEEDOR_MAYOR = `E2E Dash Mayor ${SUFIJO}`;
const PROVEEDOR_MENOR = `E2E Dash Menor ${SUFIJO}`;

// Dos períodos dentro de la ventana de 12 meses del selector, y libres: -6 lo
// usa esquemas-reparto.spec.js, -7 y -11 liquidacion-preview.spec.js.
const mesesAtras = (n) => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - n, 1))
    .toISOString()
    .slice(0, 7);
};
const PERIODO_A = mesesAtras(9);
const PERIODO_B = mesesAtras(8);

// Los montos están elegidos para que cada corte dé un número distinto y una
// aserción no pueda pasar por casualidad con el filtro equivocado:
//
//   período A → 40.000 (30.000 ordinarias + 10.000 extraordinarias, 2 gastos)
//   período B → 20.000 (20.000 ordinarias, 1 gasto)
//   todo/rango → 60.000 (50.000 ordinarias + 10.000 extraordinarias, 3 gastos)
//   rubro Mantenimiento → 40.000 (Plomería 30.000 + Electricidad 10.000)
//   proveedor mayor → 50.000 (2 gastos) · proveedor menor → 10.000 (1 gasto)
const GASTOS = [
  {
    concepto: CONCEPTO_PLOMERIA,
    monto: '30000.00',
    esOrdinario: true,
    periodo: PERIODO_A,
    rubro: ['Mantenimiento', 'Plomería'],
    proveedor: 'mayor',
  },
  {
    concepto: CONCEPTO_ELECTRICIDAD,
    monto: '10000.00',
    esOrdinario: false,
    periodo: PERIODO_A,
    rubro: ['Mantenimiento', 'Electricidad'],
    proveedor: 'menor',
  },
  {
    concepto: CONCEPTO_LIMPIEZA,
    monto: '20000.00',
    esOrdinario: true,
    periodo: PERIODO_B,
    rubro: ['Limpieza', 'Limpieza general'],
    proveedor: 'mayor',
  },
];

const creado = { edificioId: null, proveedores: {}, gastos: [] };
let api;
let headers;

// El alta va en un `beforeAll` porque son tres tests sobre los mismos datos y
// ninguno los modifica. `request` es una fixture de test, así que el contexto de
// API se crea a mano (es lo que Playwright expone para los hooks de suite).
test.beforeAll(async () => {
  api = await apiRequest.newContext();

  const login = await api.post(`${API}/api/auth/login`, {
    data: { email: 'admin@demo.com', password: 'demo1234' },
  });
  expect(login.status()).toBe(200);
  headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };

  const edificios = await api.get(`${API}/api/edificios`, { headers });
  creado.edificioId = (await edificios.json()).find((e) =>
    e.nombre.includes('Torre Palermo'),
  ).id;

  for (const [clave, razonSocial] of [
    ['mayor', PROVEEDOR_MAYOR],
    ['menor', PROVEEDOR_MENOR],
  ]) {
    const proveedor = await api.post(`${API}/api/proveedores`, {
      headers,
      data: { razonSocial },
    });
    expect(proveedor.status()).toBe(201);
    creado.proveedores[clave] = (await proveedor.json()).id;
  }

  // El `rubroId` del gasto es siempre una hoja: el rollup a rubro raíz que
  // muestra el chart lo hace el backend (precisión 6 de §3.4).
  const arbol = await api.get(`${API}/api/rubros`, { headers });
  const raices = (await arbol.json()).data;
  const hoja = ([raiz, sub]) =>
    raices.find((r) => r.nombre === raiz).subrubros.find((s) => s.nombre === sub).id;

  for (const gasto of GASTOS) {
    const respuesta = await api.post(
      `${API}/api/edificios/${creado.edificioId}/gastos`,
      {
        headers,
        data: {
          proveedorId: creado.proveedores[gasto.proveedor],
          rubroId: hoja(gasto.rubro),
          categoria: 'A',
          periodo: gasto.periodo,
          fechaGasto: `${gasto.periodo}-05`,
          concepto: gasto.concepto,
          monto: gasto.monto,
          esOrdinario: gasto.esOrdinario,
        },
      },
    );
    expect(respuesta.status()).toBe(201);
    creado.gastos.push((await respuesta.json()).id);
  }
});

test.afterAll(async () => {
  for (const id of creado.gastos) {
    await api.delete(`${API}/api/gastos/${id}`, { headers });
  }
  for (const id of Object.values(creado.proveedores)) {
    await api.delete(`${API}/api/proveedores/${id}`, { headers });
  }
  await api.dispose();
});

async function login(page, email) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/edificios$/);
}

// Los KPIs, por su nombre accesible: el total es una región (`role=group`) y las
// tarjetas de tipo son botones donde hay listado abajo (decisión 1 de GastosKpis).
const kpiTotal = (page, rotulo) => page.getByRole('group', { name: rotulo });
const kpiOrdinarias = (page) =>
  page.getByRole('button', { name: 'Filtrar la lista por gastos ordinarios' });
const kpiExtraordinarias = (page) =>
  page.getByRole('button', { name: 'Filtrar la lista por gastos extraordinarios' });

// El detalle, acotado a SU tabla: los charts publican su serie como tabla
// `sr-only` (la alternativa accesible del SVG), así que un `getByRole('row')` de
// toda la página traería también esas filas.
const tablaDetalle = (page) => page.getByRole('table').filter({ hasText: 'Concepto' });

test('el dashboard y la lista comparten un solo filtro, y los modos de período son excluyentes', async ({
  page,
}) => {
  await login(page, 'admin@demo.com');
  await page.goto(`/edificios/${creado.edificioId}/gastos`);

  await test.step('el buscador recorta las dos vistas a los gastos del spec', async () => {
    // Tiene debounce y pega al backend: se espera el efecto en la URL, que es lo
    // que dispara las dos queries.
    await page.locator('#filtro-concepto').fill(SUFIJO);
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
  });

  await test.step('el período elegido mueve los KPIs Y la tabla al mismo tiempo', async () => {
    await page.locator('#filtro-periodo').selectOption(PERIODO_A);
    await expect(page).toHaveURL(new RegExp(`periodo=${PERIODO_A}`));

    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
    await expect(kpiOrdinarias(page)).toContainText('$ 30.000,00');
    await expect(kpiExtraordinarias(page)).toContainText('$ 10.000,00');
    await expect(page.getByRole('group', { name: 'Cantidad de gastos' })).toContainText(
      '2',
    );

    // La lista de abajo dice lo mismo: dos gastos, no los tres del spec.
    await expect(page.getByText(`Detalle de gastos (2)`)).toBeVisible();
    await expect(tablaDetalle(page).getByRole('row')).toHaveCount(4); // header + 2 + TOTAL
  });

  await test.step('cambiar de período recalcula todo, no solo la tabla', async () => {
    await page.locator('#filtro-periodo').selectOption(PERIODO_B);
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 20.000,00');
    await expect(kpiExtraordinarias(page)).toContainText('$ 0,00');
    await expect(page.getByText(`Detalle de gastos (1)`)).toBeVisible();
  });

  await test.step('elegir un rango BORRA el período (o el dashboard daría 422)', async () => {
    await page.locator('#filtro-periodo').selectOption('rango');
    await page.locator('#filtro-desde').fill(`${PERIODO_A}-01`);
    await page.locator('#filtro-hasta').fill(`${PERIODO_B}-28`);

    await expect(page).toHaveURL(/desde=/);
    await expect(page).toHaveURL(/hasta=/);
    // La invariante de `useFiltrosGastos`: un modo y uno solo en la URL.
    await expect(page).not.toHaveURL(/periodo=/);

    // El rótulo del KPI ES el modo activo, y el rango abarca los dos períodos.
    await expect(kpiTotal(page, 'Total del rango')).toContainText('$ 60.000,00');
    await expect(page.getByText(`Detalle de gastos (3)`)).toBeVisible();
  });

  await test.step('"Todos los períodos" borra el rango y cambia el rótulo', async () => {
    await page.locator('#filtro-periodo').selectOption('todos');
    await expect(page).toHaveURL(/periodo=todos/);
    await expect(page).not.toHaveURL(/desde=/);

    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');
    await expect(kpiOrdinarias(page)).toContainText('$ 50.000,00');
    await expect(page.getByText(`Detalle de gastos (3)`)).toBeVisible();
  });

  await test.step('la evolución mensual publica su serie como tabla accesible', async () => {
    // El SVG no es leíble por un lector de pantalla ni por un spec: la tabla
    // `sr-only` es la que dice los valores (decisión 3 de chart-base).
    const serie = page.getByRole('table', { name: 'Evolución mensual del gasto' });
    await expect(serie.getByRole('row').filter({ hasText: '$ 40.000,00' })).toHaveCount(1);
    await expect(serie.getByRole('row').filter({ hasText: '$ 20.000,00' })).toHaveCount(1);
  });

  await test.step('el filtro de tipo mueve SOLO la lista, y lo avisa', async () => {
    // Precisión 3 de §3.4: el desglose ordinarias/extraordinarias ES ese corte,
    // así que el dashboard lo ignora a propósito. Sin el aviso, el total que no
    // coincide con la tabla se lee como un bug.
    await kpiExtraordinarias(page).click();
    await expect(page).toHaveURL(/tipo=extraordinario/);
    await expect(kpiExtraordinarias(page)).toHaveAttribute('aria-pressed', 'true');

    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');
    await expect(page.getByText(`Detalle de gastos (1)`)).toBeVisible();
    await expect(
      page.getByText(/El filtro de tipo solo se aplica a la lista de abajo/),
    ).toBeVisible();

    // Volver a clickear la tarjeta lo saca (es un toggle).
    await kpiExtraordinarias(page).click();
    await expect(page).not.toHaveURL(/tipo=/);
    await expect(page.getByText(`Detalle de gastos (3)`)).toBeVisible();
  });

  await test.step('el drill-down de rubro baja un nivel sin filtrar, y el subrubro sí filtra', async () => {
    // Rubro raíz CON subrubros → entra (decisión 1 de PorRubroChart), no filtra.
    await page.getByRole('button', { name: /^Mantenimiento/ }).click();
    await expect(page.getByText('Rubro: Mantenimiento')).toBeVisible();
    await expect(page).not.toHaveURL(/rubroId=/);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');

    // La hoja sí: filtra la pantalla entera, KPIs y lista incluidos.
    await page.getByRole('button', { name: /^Plomería/ }).click();
    await expect(page).toHaveURL(/rubroId=/);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 30.000,00');
    await expect(page.getByText(`Detalle de gastos (1)`)).toBeVisible();

    // Y el rubro filtrado tiene chip propio, porque su control es el chart.
    await page.getByRole('button', { name: 'Quitar el filtro de rubro' }).click();
    await expect(page).not.toHaveURL(/rubroId=/);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');
  });

  await test.step('el top de proveedores también es un control del filtro', async () => {
    const proveedorMayor = page.getByRole('button', {
      name: `Filtrar por el proveedor ${PROVEEDOR_MAYOR}`,
    });
    await expect(proveedorMayor).toContainText('$ 50.000,00');
    await expect(
      page.getByRole('button', { name: `Filtrar por el proveedor ${PROVEEDOR_MENOR}` }),
    ).toContainText('$ 10.000,00');

    await proveedorMayor.click();
    await expect(page).toHaveURL(/proveedorId=/);
    await expect(proveedorMayor).toHaveAttribute('aria-pressed', 'true');
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 50.000,00');
    await expect(page.getByText(`Detalle de gastos (2)`)).toBeVisible();
  });

  await test.step('el filtro completo sobrevive a un reload: vive en la URL', async () => {
    const url = page.url();
    await page.reload();
    expect(page.url()).toBe(url);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 50.000,00');
    await expect(page.getByText(`Detalle de gastos (2)`)).toBeVisible();
  });
});

test('el consolidado de la organización es el mismo dashboard con otro alcance', async ({
  page,
}) => {
  await login(page, 'admin@demo.com');

  await test.step('el hub de reportes ofrece el consolidado con el plan Business', async () => {
    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reportes$/);
    await page.getByRole('link', { name: /Gastos consolidados/ }).click();
    await expect(page).toHaveURL(/\/reportes\/gastos$/);
  });

  await test.step('los mismos filtros dan los mismos números, sumando todos los edificios', async () => {
    await page.locator('#filtro-concepto').fill(SUFIJO);
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
    await page.locator('#filtro-periodo').selectOption(PERIODO_A);

    // Los gastos del spec están todos en Torre Palermo, así que el consolidado
    // de la organización tiene que dar exactamente lo mismo que su tab.
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
    await expect(
      page.getByRole('group', { name: 'Ordinarias', exact: true }),
    ).toContainText('$ 30.000,00');
  });

  await test.step('sin listado abajo, las tarjetas de tipo no son botones', async () => {
    // `filtroDeTipo={false}`: un botón que no puede filtrar nada sería una
    // promesa incumplida para el teclado.
    await expect(kpiOrdinarias(page)).toHaveCount(0);
    await expect(page.getByText('Detalle de gastos')).toHaveCount(0);
  });

  await test.step('elegir un edificio es el drill-down, y se lleva los filtros puestos', async () => {
    await page.locator('#filtro-edificio').selectOption({ label: 'Torre Palermo' });
    await expect(page).toHaveURL(new RegExp(`/edificios/${creado.edificioId}/gastos`));
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
    await expect(page).toHaveURL(new RegExp(`periodo=${PERIODO_A}`));
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
  });
});

test('el consolidado en un plan menor se explica, no se rompe', async ({ page }) => {
  // Org B ("Administración Sur S.R.L.") está en plan starter y el consolidado es
  // Business+ (§3.2): es el caso 403 PLAN_INSUFICIENTE del seed.
  await login(page, 'admin.sur@demo.com');

  await test.step('el hub muestra el reporte bloqueado en vez de esconderlo', async () => {
    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reportes$/);
    // Decisión 1 de ReportesPage: la tarjeta está, con el badge del plan y el
    // motivo, pero no es un link.
    await expect(page.getByText('Gastos consolidados')).toBeVisible();
    await expect(page.getByRole('link', { name: /Gastos consolidados/ })).toHaveCount(0);
  });

  await test.step('entrar por URL muestra el motivo, no un error genérico', async () => {
    await page.goto('/reportes/gastos');
    await expect(
      page.getByText('El consolidado de la organización necesita otro plan'),
    ).toBeVisible();
    // El backend manda los dos planes en el error justamente para este copy.
    await expect(page.getByText(/plan es\s+starter/)).toBeVisible();
    await expect(page.getByText(/desde el plan\s+business/)).toBeVisible();
    // Y no se muestra como falla de carga.
    await expect(page.getByText('No se pudieron cargar los indicadores')).toHaveCount(0);
  });
});

test('el gestor no llega al consolidado: es un reporte de la administración', async ({
  page,
}) => {
  // Precisión 9 de §3.4: el alcance del gestor son sus edificios asignados, así
  // que el hub ni aparece en su sidebar y la ruta está detrás de RequireRole.
  await login(page, 'gestor@demo.com');

  await expect(page.getByRole('link', { name: 'Reportes' })).toHaveCount(0);

  await page.goto('/reportes/gastos');
  await expect(page).toHaveURL(/\/edificios$/);
});
