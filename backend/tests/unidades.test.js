// tests/unidades.test.js — Tests de integración del slice S2 (S2-03)
// Contrato: docs/sprints/S2-edificios-unidades.md (S2-01, S2-02),
// PRD-04-01 §1.3 (invariante de coeficientes) y §2 (endpoints).
// Corre contra la DB del stack dockerizado. Crea sus propios edificios de
// prueba dentro de la org demo y los limpia en after() (baja física vía
// Prisma de lo que el API solo puede dar de baja lógica).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

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
    await prisma.organizacionUsuario.deleteMany({ where: { organizacionId: orgBId } });
    await prisma.usuario.deleteMany({ where: { organizacionId: orgBId } });
    await prisma.organizacion.delete({ where: { id: orgBId } });

    for (const sesion of [admin, gestor, orgB]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  it('bulk feliz: crea las 5 UFs cuya suma de coeficientes es 1.000000', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: LOTE_OK,
    });
    assert.equal(status, 201);
    assert.equal(data.length, 5);
    unidad1A = data.find((u) => u.numero === '1A');
    assert.ok(unidad1A?.id);
    // Defaults del schema: categoriaA true, categoriaC null
    assert.equal(unidad1A.categoriaA, true);
    assert.equal(unidad1A.categoriaC, null);
  });

  it('GET /:id/unidades pagina con ?page=&limit=', async () => {
    const { status, data } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioId}/unidades?page=2&limit=2`,
      auth(admin)
    );
    assert.equal(status, 200);
    assert.equal(data.data.length, 2);
    assert.deepEqual(data.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
  });

  it('rechaza bulk cuyos coeficientes no suman 1 (422 con suma y delta)', async () => {
    // Sobre el edificio vacío: lote que suma 0.900000 → falta 0.100000
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioVacioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: [
        { numero: '1A', tipo: 'departamento', m2: 60, coeficiente: '0.500000' },
        { numero: '1B', tipo: 'departamento', m2: 60, coeficiente: '0.400000' },
      ],
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(data.error.sumaActual, '0.900000');
    assert.equal(data.error.delta, '0.100000');

    // Y no quedó nada persistido
    const { data: lista } = await apiFetch(
      baseUrl,
      `/api/edificios/${edificioVacioId}/unidades`,
      auth(admin)
    );
    assert.equal(lista.pagination.total, 0);
  });

  it('rechaza agregar UFs a un edificio ya cuadrado (suma > 1)', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${edificioId}/unidades`, {
      method: 'POST',
      ...auth(admin),
      body: [{ numero: '9Z', tipo: 'departamento', m2: 50, coeficiente: '0.100000' }],
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(data.error.sumaActual, '1.100000');
    assert.equal(data.error.delta, '-0.100000');
  });

  it('rechaza PATCH de coeficiente que descuadra el edificio (422)', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { coeficiente: '0.300000' },
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(data.error.sumaActual, '1.050000');
    assert.equal(data.error.delta, '-0.050000');
  });

  it('PATCH de datos sin coeficiente funciona y DELETE en edificio cuadrado → 422', async () => {
    // PATCH de numero (no toca la invariante)
    const patch = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { numero: '1A-PH' },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.numero, '1A-PH');
    // Revertir para no afectar otros tests
    await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'PATCH',
      ...auth(admin),
      body: { numero: '1A' },
    });

    // DELETE: la suma resultante (0.750000) no cuadra → 422
    const del = await apiFetch(baseUrl, `/api/unidades/${unidad1A.id}`, {
      method: 'DELETE',
      ...auth(admin),
    });
    assert.equal(del.status, 422);
    assert.equal(del.data.error.code, 'COEFICIENTES_NO_CUADRAN');
    assert.equal(del.data.error.sumaActual, '0.750000');
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

  it('bulk concurrente sobre el mismo edificio: uno commitea y el otro recibe 422 (TOCTOU, SEC-01)', async () => {
    // Dos bulk en paralelo cuyos lotes suman 1.000000 cada uno: sin el lock
    // del edificio ambos leen "0 existentes", ambos validan OK y commitean,
    // dejando la suma en 2.000000. Con el lock se serializan: el segundo
    // re-lee las UFs del primero y la invariante lo rechaza.
    const edificio = await crearEdificio(`Test S2 Concurrencia ${Date.now()}`);
    try {
      const lote = (prefijo) => [
        { numero: `${prefijo}-1`, tipo: 'departamento', m2: 60, coeficiente: '0.600000' },
        { numero: `${prefijo}-2`, tipo: 'departamento', m2: 40, coeficiente: '0.400000' },
      ];
      const [r1, r2] = await Promise.all([
        apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
          method: 'POST',
          ...auth(admin),
          body: lote('A'),
        }),
        apiFetch(baseUrl, `/api/edificios/${edificio.id}/unidades`, {
          method: 'POST',
          ...auth(admin),
          body: lote('B'),
        }),
      ]);

      assert.deepEqual([r1.status, r2.status].sort((a, b) => a - b), [201, 422]);
      const perdedor = r1.status === 422 ? r1 : r2;
      assert.equal(perdedor.data.error.code, 'COEFICIENTES_NO_CUADRAN');
      assert.equal(perdedor.data.error.sumaActual, '2.000000');

      // El edificio quedó cuadrado con un solo lote (la invariante se sostuvo)
      const { data: lista } = await apiFetch(
        baseUrl,
        `/api/edificios/${edificio.id}/unidades`,
        auth(admin)
      );
      assert.equal(lista.pagination.total, 2);
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
    assert.equal(paginado.data.pagination.total, 13);

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
