// tests/cambiar-organizacion.test.js — Cambio de organización activa (S4-05)
// Contrato: docs/sprints/S4-usuarios-identidad.md (S4-05), PRD-04-11 §4.6/§6.
// Corre contra la DB del stack dockerizado (org demo del seed S1-03).
//
// Escenario: una persona con membresía en la org demo y en una org propia de
// prueba cambia de contexto sin re-login.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { levantarApp, cerrarApp, apiFetch, login, prisma, borrarOrgDePrueba } from './helpers.js';

const RUTA = '/api/auth/cambiar-organizacion';

describe('cambiar organización activa (S4-05)', () => {
  let server;
  let baseUrl;
  let orgDemoId;
  let orgPropiaId;
  let torrePalermoId;
  let edificioPropioId;
  // Persona con dos membresías: gestora en la org demo, org_admin en la propia
  let multiOrg;
  const PASSWORD = 'multiorg1234';
  const email = `multi-org-${Date.now()}${Math.floor(Math.random() * 1000)}@test.dev`;

  before(async () => {
    ({ server, baseUrl } = await levantarApp());

    const { data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234');
    orgDemoId = admin.user.organizacionId;
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: admin.refreshToken },
    });

    const torre = await prisma.edificio.findFirst({
      where: { organizacionId: orgDemoId, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    torrePalermoId = torre.id;

    // Org propia, con nombre que ordena DESPUÉS de "Administración Demo S.A."
    // para que la org activa por defecto (primera alfabética) sea la demo.
    const org = await prisma.organizacion.create({
      data: {
        nombre: `Zeta Administración ${Date.now()}`,
        cuit: `30-${String(Date.now()).slice(-8)}-7`,
        matriculaRPA: 'RPA-4646',
      },
    });
    orgPropiaId = org.id;
    const edificio = await prisma.edificio.create({
      data: {
        organizacionId: orgPropiaId,
        nombre: 'Edificio Zeta',
        direccion: 'Zeta 100',
        ciudad: 'CABA',
        provincia: 'Buenos Aires',
        codigoPostal: 'C1425BGW',
        totalM2: 500,
        amenities: [],
      },
    });
    edificioPropioId = edificio.id;

    const usuario = await prisma.usuario.create({
      data: {
        email,
        nombre: 'Multi',
        apellido: 'Org',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
    });
    await prisma.organizacionUsuario.createMany({
      data: [
        { organizacionId: orgDemoId, usuarioId: usuario.id, rol: 'GESTOR' },
        { organizacionId: orgPropiaId, usuarioId: usuario.id, rol: 'ORG_ADMIN' },
      ],
    });
    // Gestora de Torre Palermo en la demo. La asignación de un edificio de la
    // org propia NO debe aparecer cuando la org activa es la demo.
    await prisma.gestorEdificio.createMany({
      data: [
        { usuarioId: usuario.id, edificioId: torrePalermoId },
        { usuarioId: usuario.id, edificioId: edificioPropioId },
      ],
    });
    multiOrg = usuario;
  });

  after(async () => {
    await prisma.gestorEdificio.deleteMany({ where: { usuarioId: multiOrg.id } });
    await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: multiOrg.id } });
    await prisma.usuario.delete({ where: { id: multiOrg.id } });
    await prisma.edificio.delete({ where: { id: edificioPropioId } });
    await borrarOrgDePrueba(orgPropiaId);
    await cerrarApp(server);
  });

  it('el login arranca en la primera org alfabética y expone las membresías', async () => {
    const { status, data } = await login(baseUrl, email, PASSWORD);
    assert.equal(status, 200);
    assert.equal(data.user.organizacionId, orgDemoId);
    assert.deepEqual(data.user.roles, ['gestor']);

    // Selector del header (S4-09): las dos membresías activas, ordenadas por nombre
    assert.equal(data.user.organizaciones.length, 2);
    assert.deepEqual(
      data.user.organizaciones.map((o) => o.id),
      [orgDemoId, orgPropiaId]
    );
    assert.deepEqual(
      data.user.organizaciones.map((o) => o.rol),
      ['gestor', 'org_admin']
    );

    // Los edificios asignados están scopeados a la org activa: el edificio de
    // la org propia no se filtra en los claims de la demo.
    assert.deepEqual(data.user.edificiosAsignados, [torrePalermoId]);

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: data.refreshToken },
    });
  });

  it('cambia de organización, re-emite los tokens con los claims de la elegida y rota el refresh', async () => {
    const { data: sesion } = await login(baseUrl, email, PASSWORD);

    const { status, data } = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      token: sesion.accessToken,
      body: { organizacionId: orgPropiaId, refreshToken: sesion.refreshToken },
    });

    assert.equal(status, 200);
    assert.equal(data.user.organizacionId, orgPropiaId);
    // En la org propia es org_admin, no gestora: cambian rol y edificios
    assert.deepEqual(data.user.roles, ['org_admin']);
    assert.equal(data.user.edificiosAsignados, undefined);
    assert.equal(data.user.organizaciones.length, 2);
    assert.notEqual(data.accessToken, sesion.accessToken);
    assert.notEqual(data.refreshToken, sesion.refreshToken);

    // El access token nuevo opera en la org elegida: ve su edificio y no los
    // de la organización que dejó.
    const { status: statusEdificios, data: edificios } = await apiFetch(baseUrl, '/api/edificios', {
      token: data.accessToken,
    });
    assert.equal(statusEdificios, 200);
    assert.deepEqual(
      edificios.map((e) => e.id),
      [edificioPropioId]
    );

    // El refresh de la sesión anterior quedó revocado (rotación)
    const viejo = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
    assert.equal(viejo.status, 401);
    assert.equal(viejo.data.error.code, 'REFRESH_INVALIDO');

    // El nuevo sirve y sigue apuntando a la org elegida
    const nuevo = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: data.refreshToken },
    });
    assert.equal(nuevo.status, 200);
    const { data: orgActual } = await apiFetch(baseUrl, '/api/organizaciones/me', {
      token: nuevo.data.accessToken,
    });
    assert.equal(orgActual.id, orgPropiaId);

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: nuevo.data.refreshToken },
    });
  });

  it('cambiar a una organización ajena o inexistente devuelve 403 SIN_MEMBRESIA', async () => {
    const { data: sesion } = await login(baseUrl, email, PASSWORD);

    for (const organizacionId of [randomUUID()]) {
      const { status, data } = await apiFetch(baseUrl, RUTA, {
        method: 'POST',
        token: sesion.accessToken,
        body: { organizacionId },
      });
      assert.equal(status, 403);
      assert.equal(data.error.code, 'SIN_MEMBRESIA');
    }

    // La org demo existe pero el gestor del seed no es miembro de la org propia
    const { data: gestorDemo } = await login(baseUrl, 'gestor@demo.com', 'demo1234');
    const ajena = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      token: gestorDemo.accessToken,
      body: { organizacionId: orgPropiaId },
    });
    assert.equal(ajena.status, 403);
    assert.equal(ajena.data.error.code, 'SIN_MEMBRESIA');

    for (const refreshToken of [sesion.refreshToken, gestorDemo.refreshToken]) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
  });

  it('una membresía desactivada no permite cambiar a esa organización (403)', async () => {
    const { data: sesion } = await login(baseUrl, email, PASSWORD);
    await prisma.organizacionUsuario.updateMany({
      where: { usuarioId: multiOrg.id, organizacionId: orgPropiaId },
      data: { activo: false },
    });

    const { status, data } = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      token: sesion.accessToken,
      body: { organizacionId: orgPropiaId },
    });
    assert.equal(status, 403);
    assert.equal(data.error.code, 'SIN_MEMBRESIA');

    await prisma.organizacionUsuario.updateMany({
      where: { usuarioId: multiOrg.id, organizacionId: orgPropiaId },
      data: { activo: true },
    });
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
  });

  it('sin token devuelve 401 y con body inválido 422', async () => {
    const sinToken = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      body: { organizacionId: orgPropiaId },
    });
    assert.equal(sinToken.status, 401);

    const { data: sesion } = await login(baseUrl, email, PASSWORD);
    const bodyMalo = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      token: sesion.accessToken,
      body: { organizacionId: 'no-es-un-uuid' },
    });
    assert.equal(bodyMalo.status, 422);
    assert.equal(bodyMalo.data.error.code, 'VALIDACION_FALLIDA');

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
  });
});
