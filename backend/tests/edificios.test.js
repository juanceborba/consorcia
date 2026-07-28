// tests/edificios.test.js — Tests de integración de edificios y aislamiento
// multi-tenant (S1-09). Contrato: docs/sprints/S1-fundacion.md (S1-05, S1-06,
// S1-08), PRD-04-01 §3, PRD-02-01 §6.2.
// Corre contra la DB del stack dockerizado (seed S1-03: la org demo tiene
// Torre Palermo —13 unidades— y Edificio San Martín —7—; el gestor solo
// tiene asignada Torre Palermo).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

describe('edificios', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
  });

  after(async () => {
    // Logout de las sesiones usadas para no dejar refresh tokens en Redis
    for (const sesion of [admin, gestor]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  // IDs de los edificios demo, resueltos desde la lista que ve el admin
  async function idsEdificiosDemo() {
    const { data } = await apiFetch(baseUrl, '/api/edificios', { token: admin.accessToken });
    return {
      torrePalermo: data.find((e) => e.nombre === 'Torre Palermo')?.id,
      sanMartin: data.find((e) => e.nombre === 'Edificio San Martín')?.id,
    };
  }

  it('el org_admin ve los 2 edificios de su organización', async () => {
    const { status, data } = await apiFetch(baseUrl, '/api/edificios', {
      token: admin.accessToken,
    });
    assert.equal(status, 200);
    assert.equal(data.length, 2);
    const nombres = data.map((e) => e.nombre);
    assert.ok(nombres.includes('Torre Palermo'));
    assert.ok(nombres.includes('Edificio San Martín'));
  });

  it('el gestor solo ve su edificio asignado (Torre Palermo)', async () => {
    const { status, data } = await apiFetch(baseUrl, '/api/edificios', {
      token: gestor.accessToken,
    });
    assert.equal(status, 200);
    assert.equal(data.length, 1);
    assert.equal(data[0].nombre, 'Torre Palermo');
  });

  it('GET /:id devuelve el detalle con sus unidades', async () => {
    const { torrePalermo } = await idsEdificiosDemo();
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${torrePalermo}`, {
      token: admin.accessToken,
    });
    assert.equal(status, 200);
    assert.equal(data.nombre, 'Torre Palermo');
    // Torre Palermo tiene 13 unidades en el seed (S1-03)
    assert.equal(data.unidades.length, 13);
    assert.ok(data.unidades.some((u) => u.numero === 'PB'));
  });

  it('el gestor no puede ver un edificio no asignado (403)', async () => {
    const { sanMartin } = await idsEdificiosDemo();
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${sanMartin}`, {
      token: gestor.accessToken,
    });
    assert.equal(status, 403);
    assert.equal(data.error.code, 'EDIFICIO_NO_ASIGNADO');
  });

  it('GET /:id con id inexistente devuelve 404', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/edificios/${randomUUID()}`, {
      token: admin.accessToken,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'EDIFICIO_NO_ENCONTRADO');
  });

  it('aislamiento: un usuario de otra organización no ve nada de la demo', async () => {
    // Registra una organización nueva (tenant independiente) con su org_admin
    const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cuit = `30-${sufijo.slice(0, 8)}-${Math.floor(Math.random() * 10)}`;
    const { status, data: sesion } = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: `aislamiento-${sufijo}@test.dev`,
        password: 'test12345',
        nombre: 'Test',
        apellido: 'Aislamiento',
        organizacion: {
          nombre: `Org Test Aislamiento ${sufijo}`,
          cuit,
          matriculaRPA: '00.000-T',
        },
      },
    });
    assert.equal(status, 201);
    const orgPruebaId = sesion.user.organizacionId;

    try {
      // Su lista de edificios está vacía (no hereda nada de la org demo)
      const { status: statusLista, data: lista } = await apiFetch(baseUrl, '/api/edificios', {
        token: sesion.accessToken,
      });
      assert.equal(statusLista, 200);
      assert.deepEqual(lista, []);

      // Pedir un edificio de la org demo → 403 (tenant.middleware)
      const { torrePalermo } = await idsEdificiosDemo();
      const { status: statusDetalle, data: error } = await apiFetch(
        baseUrl,
        `/api/edificios/${torrePalermo}`,
        { token: sesion.accessToken },
      );
      assert.equal(statusDetalle, 403);
      assert.equal(error.error.code, 'FUERA_DE_ORGANIZACION');
    } finally {
      // Limpieza: logout + borrado de la org de prueba y su usuario
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
      await prisma.organizacionUsuario.deleteMany({ where: { organizacionId: orgPruebaId } });
      await prisma.usuario.deleteMany({ where: { organizacionId: orgPruebaId } });
      await prisma.organizacion.delete({ where: { id: orgPruebaId } });
    }
  });
});
