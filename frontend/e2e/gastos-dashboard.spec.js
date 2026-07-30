// frontend/e2e/gastos-dashboard.spec.js — E2E del reporte de gastos (S3-17,
// rescopeado en S3-22) sobre PRD-04-02 §3 y PRD-07-03 §2.2.
//
// QUÉ VINO A PROBAR ESTE SPEC: el tablero en su única casa —Reportes → Gastos—
// y la separación que S3-22 vino a arreglar. Son dos pantallas con dos
// intenciones: el tab del edificio es la operación (cargar, editar, listar) y el
// reporte es el análisis (KPIs, evolución, rubros, proveedores). Un test
// verifica explícitamente que el tab NO tiene tablero, porque esa fusión es
// justamente el bug que se corrigió.
//
// Lo que solo se puede verificar por DOM: que los tres modos de período son
// EXCLUYENTES en la URL (el contrato del dashboard responde 422 si llegan
// combinados, precisión 2 de §3.4), que el alcance es un filtro más —cambiar de
// edificio no navega a ninguna parte—, que el drill-down de rubro no filtra y el
// subrubro sí, y que los dos gates de "Todos los edificios" (plan y rol) se
// explican en la pantalla en vez de mostrarse como una falla de carga.
//
// LOS TRES GASTOS SE MIRAN SIEMPRE CON `q` PUESTO (el sufijo con timestamp).
// El filtro de concepto viaja a las dos queries, así que recorta el reporte y la
// lista por igual: los totales que este spec afirma son exactos aunque el
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

// Los KPIs, por su nombre accesible. En el reporte no hay listado que filtrar,
// así que las tarjetas de tipo son regiones y no botones (decisión 4 de la
// página / decisión 1 de GastosKpis).
const kpiTotal = (page, rotulo) =>
  page.getByRole('group', { name: rotulo, exact: true });

test('el reporte de gastos: alcance por edificio y los tres modos de período excluyentes', async ({
  page,
}) => {
  await login(page, 'admin@demo.com');
  await page.goto(`/reportes/gastos?edificioId=${creado.edificioId}`);

  await test.step('el buscador recorta el tablero a los gastos del spec', async () => {
    // Tiene debounce y pega al backend: se espera el efecto en la URL, que es lo
    // que dispara la query.
    await page.locator('#filtro-concepto').fill(SUFIJO);
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
  });

  await test.step('el período elegido recalcula todos los indicadores', async () => {
    await page.locator('#filtro-periodo').selectOption(PERIODO_A);
    await expect(page).toHaveURL(new RegExp(`periodo=${PERIODO_A}`));

    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
    await expect(kpiTotal(page, 'Ordinarias')).toContainText('$ 30.000,00');
    await expect(kpiTotal(page, 'Extraordinarias')).toContainText('$ 10.000,00');
    await expect(kpiTotal(page, 'Cantidad de gastos')).toContainText('2');
  });

  await test.step('cambiar de período trae otro número, no el mismo', async () => {
    await page.locator('#filtro-periodo').selectOption(PERIODO_B);
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 20.000,00');
    await expect(kpiTotal(page, 'Extraordinarias')).toContainText('$ 0,00');
  });

  await test.step('elegir un rango BORRA el período (o el contrato daría 422)', async () => {
    await page.locator('#filtro-periodo').selectOption('rango');
    await page.locator('#filtro-desde').fill(`${PERIODO_A}-01`);
    await page.locator('#filtro-hasta').fill(`${PERIODO_B}-28`);

    await expect(page).toHaveURL(/desde=/);
    await expect(page).toHaveURL(/hasta=/);
    // La invariante de `useFiltrosGastos`: un modo y uno solo en la URL.
    await expect(page).not.toHaveURL(/periodo=/);

    // El rótulo del KPI ES el modo activo, y el rango abarca los dos períodos.
    await expect(kpiTotal(page, 'Total del rango')).toContainText('$ 60.000,00');
  });

  await test.step('"Todos los períodos" borra el rango y cambia el rótulo', async () => {
    await page.locator('#filtro-periodo').selectOption('todos');
    await expect(page).toHaveURL(/periodo=todos/);
    await expect(page).not.toHaveURL(/desde=/);

    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');
    await expect(kpiTotal(page, 'Ordinarias')).toContainText('$ 50.000,00');
  });

  await test.step('la evolución mensual publica su serie como tabla accesible', async () => {
    // El SVG no es leíble por un lector de pantalla ni por un spec: la tabla
    // `sr-only` es la que dice los valores (decisión 3 de chart-base).
    const serie = page.getByRole('table', { name: 'Evolución mensual del gasto' });
    await expect(serie.getByRole('row').filter({ hasText: '$ 40.000,00' })).toHaveCount(1);
    await expect(serie.getByRole('row').filter({ hasText: '$ 20.000,00' })).toHaveCount(1);
  });

  await test.step('sin listado abajo, el tipo no se ofrece como filtro', async () => {
    // Decisión 4: un botón que no puede filtrar nada sería una promesa
    // incumplida para el teclado.
    await expect(
      page.getByRole('button', { name: 'Filtrar la lista por gastos ordinarios' }),
    ).toHaveCount(0);
    await expect(page.getByRole('table').filter({ hasText: 'Concepto' })).toHaveCount(0);
  });

  await test.step('el drill-down de rubro baja un nivel sin filtrar, y el subrubro sí filtra', async () => {
    // Rubro raíz CON subrubros → entra (decisión 1 de PorRubroChart), no filtra.
    await page.getByRole('button', { name: /^Mantenimiento/ }).click();
    await expect(page.getByText('Rubro: Mantenimiento')).toBeVisible();
    await expect(page).not.toHaveURL(/rubroId=/);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 60.000,00');

    // La hoja sí: filtra el reporte entero.
    await page.getByRole('button', { name: /^Plomería/ }).click();
    await expect(page).toHaveURL(/rubroId=/);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 30.000,00');

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
  });

  await test.step('el filtro completo sobrevive a un reload: vive en la URL', async () => {
    const url = page.url();
    await page.reload();
    expect(page.url()).toBe(url);
    await expect(kpiTotal(page, 'Total histórico')).toContainText('$ 50.000,00');
  });

  await test.step('el breadcrumb vuelve al hub de reportes', async () => {
    // Entrar a un reporte sin salida hacia arriba deja al usuario dependiendo
    // del sidebar, que no dice dónde está parado.
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toContainText('Reportes');
    await expect(breadcrumb.getByText('Gastos')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await breadcrumb.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reportes$/);
    await page.goBack();
  });

  await test.step('el header no ofrece el selector de edificio en Reportes', async () => {
    // S3-22b: el alcance del reporte ya es un selector de esta pantalla; el del
    // header cambia el contexto de trabajo Y navega, así que acá sacaría al
    // usuario del reporte que está mirando.
    await expect(
      page.getByRole('button', { name: /^Edificio de trabajo:/ }),
    ).toHaveCount(0);
    await expect(page.locator('#filtro-edificio')).toBeVisible();
  });

  await test.step('el drill-down al detalle lleva los mismos filtros al tab', async () => {
    // Decisión 3: el detalle es del edificio, y el link se lleva el recorte.
    await page.getByRole('link', { name: /Ver el detalle de Torre Palermo/ }).click();
    await expect(page).toHaveURL(new RegExp(`/edificios/${creado.edificioId}/gastos`));
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
    await expect(page).toHaveURL(/proveedorId=/);
    // El alcance no viaja: en el tab lo dice la ruta.
    await expect(page).not.toHaveURL(/edificioId=/);
  });
});

test('el tab del edificio es la operación, no el tablero', async ({ page }) => {
  // Decisión 15 de S3-22: es la separación que esta tarea vino a arreglar.
  await login(page, 'admin@demo.com');
  await page.goto(`/edificios/${creado.edificioId}/gastos?q=${SUFIJO}&periodo=todos`);

  await test.step('tiene el listado, el totalizador del filtro y el alta', async () => {
    await expect(page.getByText(`Gastos (3)`)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Total del filtro', exact: true })).toContainText(
      '$ 60.000,00',
    );
    await expect(page.getByRole('group', { name: 'Ordinarios', exact: true })).toContainText(
      '$ 50.000,00',
    );
    await expect(page.getByRole('group', { name: 'Extraordinarios' })).toContainText(
      '$ 10.000,00',
    );
    await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toBeVisible();

    // header + 3 gastos + TOTAL
    const tabla = page.getByRole('table').filter({ hasText: 'Concepto' });
    await expect(tabla.getByRole('row')).toHaveCount(5);
  });

  await test.step('el header sí ofrece el selector: acá el edificio ES el contexto', async () => {
    await expect(
      page.getByRole('button', { name: /^Edificio de trabajo:/ }),
    ).toBeVisible();
  });

  await test.step('y NO tiene ninguno de los componentes del tablero', async () => {
    await expect(page.getByText('Evolución mensual')).toHaveCount(0);
    await expect(page.getByText('Distribución por rubro')).toHaveCount(0);
    await expect(page.getByText('Distribución por categoría')).toHaveCount(0);
    await expect(page.getByText('Top proveedores')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Gasto por UF' })).toHaveCount(0);
  });

  await test.step('el filtro de tipo mueve la lista, que es lo que esta pantalla tiene', async () => {
    await page.getByRole('button', { name: /Filtros/ }).click();
    await page.locator('#filtro-tipo').selectOption('extraordinario');
    await expect(page.getByText(`Gastos (1)`)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Total del filtro', exact: true })).toContainText(
      '$ 10.000,00',
    );
  });
});

test('el consolidado de la organización es el mismo reporte con otro alcance', async ({
  page,
}) => {
  await login(page, 'admin@demo.com');

  await test.step('el hub de reportes lleva al tablero', async () => {
    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reportes$/);
    // Por la descripción de la tarjeta: "Gastos" a secas también matchea la
    // entrada del sidebar, que lleva al tab del edificio.
    await page.getByRole('link', { name: /El tablero de gastos/ }).click();
    await expect(page).toHaveURL(/\/reportes\/gastos$/);
  });

  await test.step('abre en "Todos los edificios" y suma toda la administración', async () => {
    // Decisión 2: con plan Business y org_admin, el default es el consolidado.
    await expect(page.locator('#filtro-edificio')).toHaveValue('todos');

    await page.locator('#filtro-concepto').fill(SUFIJO);
    await expect(page).toHaveURL(new RegExp(`q=${SUFIJO}`));
    await page.locator('#filtro-periodo').selectOption(PERIODO_A);

    // Los gastos del spec están todos en Torre Palermo, así que el consolidado
    // tiene que dar exactamente lo mismo que el alcance de ese edificio.
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
  });

  await test.step('cambiar el alcance a un edificio NO se va de la pantalla', async () => {
    // Decisión 1: el alcance es un filtro más, en la URL.
    await page.locator('#filtro-edificio').selectOption({ label: 'Torre Palermo' });
    await expect(page).toHaveURL(/\/reportes\/gastos/);
    await expect(page).toHaveURL(/edificioId=/);
    await expect(page).toHaveURL(new RegExp(`periodo=${PERIODO_A}`));
    await expect(kpiTotal(page, 'Total del período')).toContainText('$ 40.000,00');
  });
});

test('el consolidado en un plan menor se explica, y el reporte sigue sirviendo', async ({
  page,
}) => {
  // Org B ("Administración Sur S.R.L.") está en plan starter y "Todos los
  // edificios" es Business+ (§3.2): es el caso 403 PLAN_INSUFICIENTE del seed.
  await login(page, 'admin.sur@demo.com');

  await test.step('el hub ofrece el reporte igual, con el badge del plan', async () => {
    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reportes$/);
    // Decisión 1 del hub (S3-22): lo que está bloqueado es el alcance, no el
    // reporte, así que la tarjeta SÍ es un link.
    // Por la descripción de la tarjeta: "Gastos" a secas también matchea la
    // entrada del sidebar, que lleva al tab del edificio.
    await page.getByRole('link', { name: /El tablero de gastos/ }).click();
    await expect(page).toHaveURL(/\/reportes\/gastos$/);
  });

  await test.step('abre en su edificio y el consolidado queda deshabilitado', async () => {
    // Decisión 2: no se abre en el alcance que va a responder 403.
    await expect(page.locator('#filtro-edificio')).not.toHaveValue('todos');
    await expect(kpiTotal(page, 'Total del período')).toBeVisible();
    await expect(
      page.locator('#filtro-edificio option[value="todos"]'),
    ).toBeDisabled();
  });

  await test.step('forzar el alcance por URL muestra el motivo, no un error genérico', async () => {
    await page.goto('/reportes/gastos?edificioId=todos');
    await expect(
      page.getByText('El consolidado de la organización necesita otro plan'),
    ).toBeVisible();
    // El backend manda los dos planes en el error justamente para este copy.
    await expect(page.getByText(/plan es\s+starter/)).toBeVisible();
    await expect(page.getByText(/desde el plan\s+business/)).toBeVisible();
    await expect(page.getByText('No se pudieron cargar los indicadores')).toHaveCount(0);
  });
});

test('el gestor analiza sus edificios, pero no la administración entera', async ({
  page,
}) => {
  // Precisión 9 de §3.4: "todos los edificios" es la vista que un gestor con
  // edificios asignados no debe ver. Lo que sí puede es el tablero de SU
  // edificio, que lee los mismos datos que su listado (S3-22).
  await login(page, 'gestor@demo.com');

  await page.getByRole('link', { name: 'Reportes' }).click();
  await expect(page).toHaveURL(/\/reportes$/);
  await page.getByRole('link', { name: /El tablero de gastos/ }).click();
  await expect(page).toHaveURL(/\/reportes\/gastos$/);

  await expect(page.locator('#filtro-edificio')).toHaveValue(creado.edificioId);
  await expect(kpiTotal(page, 'Total del período')).toBeVisible();
  await expect(page.locator('#filtro-edificio option[value="todos"]')).toBeDisabled();

  // Y si lo fuerza por URL, el 403 de Cerbos se explica como alcance, no como
  // falla de carga.
  await page.goto('/reportes/gastos?edificioId=todos');
  await expect(page.getByText('Este reporte es de la administración')).toBeVisible();
});
