// tests/unidades.test.js — Tests de integración del slice S2 (S2-03)
// Contrato: docs/sprints/S2-edificios-unidades.md (S2-01, S2-02),
// PRD-04-01 §1.3 (invariante de coeficientes, INFORMATIVA desde #57) y §2
// (endpoints). Las escrituras de unidades ya no rechazan con 422 cuando la
// suma no cierra en 1.000000: guardan e informan `coeficientes: { suma, delta,
// cuadra }`. El gate duro es de la liquidación (S3) y se testea aparte en
// tests/coeficientes.test.js.
// Corre contra la DB del stack dockerizado. Crea sus propios edificios de
// prueba dentro de la org demo y los limpia en after() (baja física vía
// Prisma de lo que el API solo puede dar de baja lógica).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarApp, cerrarApp, apiFetch, login, prisma, borrarOrgDePrueba } from './helpers.js';

// Lote de 5 UFs cuyos coeficientes suman exactamente 1.000000
const LOTE_OK = [
  { numero: 'PB', tipo: 'local', m2: 80, coeficiente: '0.200000' },
  { numero: '1A', tipo: 'departamento', m2: 60, coeficiente: '0.250000' },
  { numero: '1B', tipo: 'departamento', m2: 60, coeficiente: '0.250000' },
  { numero: '2A', tipo: 'departamento', m2: 55, coeficiente: '0.200000' },
  { numero: 'Coch-1', tipo: 'cochera', m2: 12, coeficiente: '0.100000', categoriaB: [] },
];

describe('unidades (S2)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let orgB; // sesión del admin de otra organización
  let orgBId;
  let edificioId; // edificio de prueba de la org demo
  let edificioVacioId; // segundo edificio, sin unidades
  let unidad1A; // UF creada por el bulk feliz

  function auth(sesion) {
    return { token: sesion.accessToken };
  }

  async function crearEdificio(nombre) {
    const { status, data } = await apiFetch(baseUrl, '/api/edificios', {
      method: 'POST',
      token: admin.accessToken,
      body: {
        nombre,
        direccion: 'Calle de Prueba 123',
        codigoPostal: 'C1414ABC',
        totalM2: 300,
        fechaInicioAdmin: '2026-07-01',
      },
    });
    assert.equal(status, 201);
    return data;
  }

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));

    // Organización B (tenant independiente) para las pruebas de aislamiento
    const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const { status, data: sesion } = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: `orgb-${sufijo}@test.dev`,
        password: 'test12345',
        nombre: 'Test',
        apellido: 'OrgB',
        organizacion: {
          nombre: `Org B Test ${sufijo}`,
          cuit: `30-${sufijo.slice(0, 8)}-${Math.floor(Math.random() * 10)}`,
          matriculaRPA: '00.000-T',
        },
      },
    });
    assert.equal(status, 201);
    orgB = sesion;
    orgBId = sesion.user.organizacionId;

    // Edificios de prueba de la org demo
    const edificio = await crearEdificio(`Test S2 Unidades ${sufijo}`);
    edificioId = edificio.id;
    assert.equal(edificio.tipo, 'ph'); // default del schema Zod (S2-01)
    assert.equal(edificio.activo, true);

    const vacio = await crearEdificio(`Test S2 Vacío ${sufijo}`);
    edificioVacioId = vacio.id;
  });

  after(async () => {
    // Limpieza de datos creados por el test (baja física vía Prisma)
    await prisma.unidad.deleteMany({ where: { edificioId: { in: [edificioId, edificioVacioId] } } });
    await prisma.edificio.deleteMany({ where: { id: { in: [edificioId, edificioVacioId] } } });
    await borrarOrgDePrueba(orgBId);

    for (const sesion of [admin, gestor, orgB]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  it('bulk feliz: crea las 5 UFs y reporta la suma cuadrada', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: LOTE_OK,
    });
    assert.equal(status, 201);
    assert.equal(data.unidades.length, 5);
    // Estado informativo de la invariante (#57)
    assert.deepEqual(data.coeficientes, {
      suma: '1.000000',
      delta: '0.000000',
      cuadra: true,
    });
    unidad1A = data.unidades.find((u) => u.numero === '1A');
    assert.ok(unidad1A?.id);
    // Defaults del schema: categoriaA true, categoriaC null
    assert.equal(unidad1A.categoriaA, true);
    assert.equal(unidad1A.categoriaC, null);
  });

  it('GET /:id/unidades pagina con ?page=&limit= e informa la suma del edificio', async () => {
    const { status, data } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioId}/unidades?page=2&limit=2`,
      auth(admin)
    );
    assert.equal(status, 200);
    assert.equal(data.data.length, 2);
    assert.deepEqual(data.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
    // La suma es del set COMPLETO del edificio, no de la página
    assert.deepEqual(data.coeficientes, {
      suma: '1.000000',
      delta: '0.000000',
      cuadra: true,
    });
  });

  it('#57: guarda el bulk cuyos coeficientes no suman 1 e informa el delta', async () => {
    // Sobre el edificio vacío: lote que suma 0.900000 → falta 0.100000
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioVacioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: [
        { numero: '1A', tipo: 'departamento', m2: 60, coeficiente: '0.500000' },
        { numero: '1B', tipo: 'departamento', m2: 60, coeficiente: '0.400000' },
      ],
    });
    assert.equal(status, 201);
    assert.equal(data.unidades.length, 2);
    assert.deepEqual(data.coeficientes, {
      suma: '0.900000',
      delta: '0.100000',
      cuadra: false,
    });

    // Quedó persistido (carga incremental) y el GET reporta el mismo estado
    const { data: lista } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioVacioId}/unidades`,
      auth(admin)
    );
    assert.equal(lista.pagination.total, 2);
    assert.equal(lista.coeficientes.suma, '0.900000');
    assert.equal(lista.coeficientes.cuadra, false);

    // Y el detalle del edificio también lo trae
    const { data: detalle } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioVacioId}`,
      auth(admin)
    );
    assert.equal(detalle.coeficientes.suma, '0.900000');

    // Limpieza: el resto del spec asume este edificio vacío
    await prisma.unidad.deleteMany({ where: { edificioId: edificioVacioId } });
  });

  it('#57: agregar UFs a un edificio ya cuadrado guarda e informa que sobra', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: [{ numero: '9Z', tipo: 'departamento', m2: 50, coeficiente: '0.100000' }],
    });
    assert.equal(status, 201);
    assert.deepEqual(data.coeficientes, {
      suma: '1.100000',
      delta: '-0.100000',
      cuadra: false,
    });

    // Revertir: el resto del spec asume el edificio cuadrado en 1.000000
    const del = await apiFetch(baseUrl, `/api/unidades/${data.unidades[0].id}`, {
      method: 'DELETE',
      ...auth(admin),
    });
    assert.equal(del.status, 200);
    assert.equal(del.data.coeficientes.suma, '1.000000');
  });

  it('#57: PATCH de coeficiente que descuadra el edificio guarda e informa (200)', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { coeficiente: '0.300000' },
    });
    assert.equal(status, 200);
    // Los Decimal de Prisma se serializan sin ceros a la derecha ("0.3"); los
    // 6 decimales del contrato los garantiza el estado informativo.
    assert.equal(Number(data.coeficiente), 0.3);
    assert.deepEqual(data.coeficientes, {
      suma: '1.050000',
      delta: '-0.050000',
      cuadra: false,
    });

    // Revertir al valor del lote
    const revert = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { coeficiente: '0.250000' },
    });
    assert.equal(revert.data.coeficientes.cuadra, true);
  });

  it('#57: PATCH sin coeficiente y DELETE en edificio cuadrado funcionan', async () => {
    // PATCH de numero (no toca la suma, que sigue cuadrada)
    const patch = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { numero: '1A-PH' },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.numero, '1A-PH');
    assert.equal(patch.data.coeficientes.cuadra, true);
    // Revertir para no afectar otros tests
    await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { numero: '1A' },
    });

    // DELETE de una UF de un edificio cuadrado: se elimina e informa que la
    // suma quedó en 0.750000 (antes era un 422).
    const del = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'DELETE',
      ...auth(admin),
    });
    assert.equal(del.status, 200);
    assert.equal(del.data.eliminada, true);
    assert.deepEqual(del.data.coeficientes, {
      suma: '0.750000',
      delta: '0.250000',
      cuadra: false,
    });

    // Recrear la UF para el resto del spec (mismo número y coeficiente)
    const recrear = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: [{ numero: '1A', tipo: 'departamento', m2: 60, coeficiente: '0.250000' }],
    });
    assert.equal(recrear.status, 201);
    assert.equal(recrear.data.coeficientes.cuadra, true);
    unidad1A = recrear.data.unidades[0];
  });

  it('rechaza número de UF duplicado en el edificio (409)', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { numero: 'PB' },
    });
    assert.equal(status, 409);
    assert.equal(data.error.code, 'UNIDAD_DUPLICADA');
  });

  it('bulk concurrente con el mismo número de UF: uno commitea y el otro 409 (unicidad, #57)', async () => {
    // Al quitarse el lock del edificio (ya no hay invariante que serializar,
    // #57) la unicidad del número de UF queda a cargo del índice único
    // (organizacion_id, edificio_id, numero): dos bulk en paralelo que traen
    // el mismo número se serializan en el índice y el perdedor recibe 409.
    const edificio = await crearEdificio(`Test S2 Concurrencia ${Date.now()}`);
    try {
      const lote = [{ numero: 'DUP-1', tipo: 'departamento', m2: 60, coeficiente: '0.600000' }];
      const [r1, r2] = await Promise.all([
        apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
          method: 'POST',
          ...auth(admin),
          body: lote,
        }),
        apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
          method: 'POST',
          ...auth(admin),
          body: lote,
        }),
      ]);

      assert.deepEqual([r1.status, r2.status].sort((a, b) => a - b), [201, 409]);
      const perdedor = r1.status === 409 ? r1 : r2;
      assert.equal(perdedor.data.error.code, 'UNIDAD_DUPLICADA');

      // Quedó UNA sola UF (el lote perdedor no dejó rastro: la transacción del
      // bulk sigue siendo atómica)
      const { data: lista } = await apiFetch(
        baseUrl,
        `/api/edificios/${edificio.id}/unidades`,
        auth(admin)
      );
      assert.equal(lista.pagination.total, 1);
      assert.equal(lista.coeficientes.suma, '0.600000');
    } finally {
      await prisma.unidad.deleteMany({ where: { edificioId: edificio.id } });
      await prisma.edificio.deleteMany({ where: { id: edificio.id } });
    }
  });

  it('#57: carga incremental — dos bulk sucesivos llegan a 1.000000', async () => {
    const edificio = await crearEdificio(`Test S2 Incremental ${Date.now()}`);
    try {
      const primero = await apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
        method: 'POST',
        ...auth(admin),
        body: [{ numero: '1A', tipo: 'departamento', m2: 60, coeficiente: '0.400000' }],
      });
      assert.equal(primero.status, 201);
      assert.deepEqual(primero.data.coeficientes, {
        suma: '0.400000',
        delta: '0.600000',
        cuadra: false,
      });

      const segundo = await apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
        method: 'POST',
        ...auth(admin),
        body: [{ numero: '1B', tipo: 'departamento', m2: 90, coeficiente: '0.600000' }],
      });
      assert.equal(segundo.status, 201);
      assert.deepEqual(segundo.data.coeficientes, {
        suma: '1.000000',
        delta: '0.000000',
        cuadra: true,
      });
    } finally {
      await prisma.unidad.deleteMany({ where: { edificioId: edificio.id } });
      await prisma.edificio.deleteMany({ where: { id: edificio.id } });
    }
  });

  it('el gestor no puede crear unidades en un edificio no asignado (403)', async () => {
    // El edificio de prueba es de la org demo pero NO está asignado al gestor
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioVacioId}/unidades`, {
      method: 'POST',
      ...auth(gestor),
      body: [{ numero: '1A', tipo: 'departamento', m2: 50, coeficiente: '1.000000' }],
    });
    assert.equal(status, 403);
    assert.equal(data.error.code, 'EDIFICIO_NO_ASIGNADO');

    // Tampoco puede tocar UFs de ese edificio
    const patch = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(gestor),
      body: { numero: 'HACK' },
    });
    assert.equal(patch.status, 403);
    assert.equal(patch.data.error.code, 'EDIFICIO_NO_ASIGNADO');
  });

  it('el gestor sí opera unidades en su edificio asignado (Torre Palermo)', async () => {
    const { data: lista } = await apiFetch(baseUrl, '/api/edificios', auth(gestor));
    const torre = lista.find((e) => e.nombre === 'Torre Palermo');

    const paginado = await apiFetch(
      baseUrl,
      `/api/edificios/${torre.id}/unidades?limit=5`,
      auth(gestor)
    );
    assert.equal(paginado.status, 200);
    // >= y no ==: la DB de desarrollo acumula UFs cargadas a mano entre
    // reseeds (know-how bug/tests-conteos-absolutos-flaky).
    assert.ok(
      paginado.data.pagination.total >= 13,
      `Torre Palermo debería tener al menos las 13 UFs del seed, tiene ${paginado.data.pagination.total}`
    );

    const uf = paginado.data.data[0];
    const patch = await apiFetch(baseUrl, `/api/unidades/${uf.id}`, {
      method: 'PATCH',
      ...auth(gestor),
      body: { numero: `${uf.numero}-TMP` },
    });
    assert.equal(patch.status, 200);
    // Revertir
    await apiFetch(baseUrl, `/api/unidades/${uf.id}`, {
      method: 'PATCH',
      ...auth(gestor),
      body: { numero: uf.numero },
    });
  });

  it('aislamiento: la org B no toca edificios ni unidades de la org demo', async () => {
    // Bulk sobre edificio ajeno → 403 FUERA_DE_ORGANIZACION
    const bulk = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(orgB),
      body: [{ numero: '1A', tipo: 'departamento', m2: 50, coeficiente: '1.000000' }],
    });
    assert.equal(bulk.status, 403);
    assert.equal(bulk.data.error.code, 'FUERA_DE_ORGANIZACION');

    // PATCH de UF ajena → 403
    const patchUf = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(orgB),
      body: { numero: 'HACK' },
    });
    assert.equal(patchUf.status, 403);
    assert.equal(patchUf.data.error.code, 'FUERA_DE_ORGANIZACION');

    // PATCH y DELETE de edificio ajeno → 403
    const patchEd = await apiFetch(baseUrl, `/api/edificios/${edificioId}`, {
      method: 'PATCH',
      ...auth(orgB),
      body: { nombre: 'Edificio Hackeado' },
    });
    assert.equal(patchEd.status, 403);
    assert.equal(patchEd.data.error.code, 'FUERA_DE_ORGANIZACION');

    const delEd = await apiFetch(baseUrl, `/api/edificios/${edificioId}`, {
      method: 'DELETE',
      ...auth(orgB),
    });
    assert.equal(delEd.status, 403);
    assert.equal(delEd.data.error.code, 'FUERA_DE_ORGANIZACION');
  });

  it('el gestor no puede crear ni eliminar edificios (403)', async () => {
    const crear = await apiFetch(baseUrl, '/api/edificios', {
      method: 'POST',
      ...auth(gestor),
      body: { nombre: 'Edificio Gestor', direccion: 'Calle Falsa 999', codigoPostal: '1425', totalM2: 100 },
    });
    assert.equal(crear.status, 403);
    assert.equal(crear.data.error.code, 'ACCESO_DENEGADO');

    const { data: lista } = await apiFetch(baseUrl, '/api/edificios', auth(gestor));
    const torre = lista.find((e) => e.nombre === 'Torre Palermo');
    const del = await apiFetch(baseUrl, `/api/edificios/${torre.id}`, {
      method: 'DELETE',
      ...auth(gestor),
    });
    assert.equal(del.status, 403);
    assert.equal(del.data.error.code, 'ACCESO_DENEGADO');
  });
});
