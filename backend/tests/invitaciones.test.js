// tests/invitaciones.test.js — Activación por invitación (S4-02)
// Contrato: docs/sprints/S4-usuarios-identidad.md (S4-02), PRD-04-11 §2.3/§6.
// Corre contra la DB del stack dockerizado (org demo del seed S1-03).
//
// Los endpoints que CREAN invitaciones son de S4-03/04, así que acá las
// invitaciones se insertan directamente con Prisma.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

describe('invitaciones (S4-02)', () => {
  let server;
  let baseUrl;
  let admin;
  let orgId;
  let torrePalermoId;
  let unidadId;

  // Todo lo creado por el test, para limpiar en el after
  const emailsCreados = [];
  const tokensCreados = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    orgId = admin.user.organizacionId;

    const edificio = await prisma.edificio.findFirst({
      where: { organizacionId: orgId, nombre: 'Torre Palermo' },
      select: { id: true },
    });
    torrePalermoId = edificio.id;

    const unidad = await prisma.unidad.findFirst({
      where: { edificioId: torrePalermoId, numero: '2A' },
      select: { id: true },
    });
    unidadId = unidad.id;
  });

  after(async () => {
    await prisma.invitacion.deleteMany({ where: { token: { in: tokensCreados } } });
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: emailsCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.unidadUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.gestorEdificio.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: admin.refreshToken },
    });
    await cerrarApp(server);
  });

  // Crea una invitación directamente en la DB (lo que hará S4-03/04)
  async function crearInvitacion({ email, tipo, payload, expiraAt }) {
    emailsCreados.push(email);
    const invitacion = await prisma.invitacion.create({
      data: {
        email,
        organizacionId: orgId,
        tipo,
        payload,
        expiraAt: expiraAt ?? new Date(Date.now() + SIETE_DIAS_MS),
        invitadoPorId: admin.user.id,
      },
    });
    tokensCreados.push(invitacion.token);
    return invitacion;
  }

  const sufijo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // -------------------------------------------------------------------------
  // GET /api/invitaciones/:token
  // -------------------------------------------------------------------------

  it('GET devuelve la invitación con el email enmascarado y la organización', async () => {
    const email = `staff-lectura-${sufijo()}@test.dev`;
    const invitacion = await crearInvitacion({
      email,
      tipo: 'STAFF',
      payload: { rol: 'GESTOR', nombre: 'Ana', apellido: 'Test', edificioIds: [torrePalermoId] },
    });

    const { status, data } = await apiFetch(baseUrl, `/api/invitaciones/${invitacion.token}`);
    assert.equal(status, 200);
    assert.equal(data.tipo, 'STAFF');
    assert.equal(data.organizacion.id, orgId);
    assert.equal(data.organizacion.nombre, 'Administración Demo S.A.');
    assert.equal(data.nombre, 'Ana');
    // Enmascarado: primera letra + dominio, nunca el email completo
    assert.equal(data.email, `s***@test.dev`);
    assert.ok(!data.email.includes(email.split('@')[0]));
  });

  it('GET con token inexistente devuelve 410 INVITACION_INVALIDA', async () => {
    const { status, data } = await apiFetch(baseUrl, `/api/invitaciones/${randomUUID()}`);
    assert.equal(status, 410);
    assert.equal(data.error.code, 'INVITACION_INVALIDA');
  });

  it('GET de una invitación vencida devuelve 410', async () => {
    const invitacion = await crearInvitacion({
      email: `vencida-${sufijo()}@test.dev`,
      tipo: 'STAFF',
      payload: { rol: 'GESTOR', edificioIds: [] },
      expiraAt: new Date(Date.now() - 60_000),
    });

    const { status, data } = await apiFetch(baseUrl, `/api/invitaciones/${invitacion.token}`);
    assert.equal(status, 410);
    assert.equal(data.error.code, 'INVITACION_INVALIDA');
  });

  // -------------------------------------------------------------------------
  // POST /api/invitaciones/:token/aceptar
  // -------------------------------------------------------------------------

  it('aceptar una invitación STAFF crea el usuario, la membresía y sus edificios, y loguea', async () => {
    const email = `gestor-nuevo-${sufijo()}@test.dev`;
    const invitacion = await crearInvitacion({
      email,
      tipo: 'STAFF',
      payload: { rol: 'GESTOR', nombre: 'Nuevo', apellido: 'Gestor', edificioIds: [torrePalermoId] },
    });

    const { status, data } = await apiFetch(
      baseUrl,
      `/api/invitaciones/${invitacion.token}/aceptar`,
      { method: 'POST', body: { password: 'invitado1234', confirmacion: 'invitado1234' } }
    );

    assert.equal(status, 200);
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
    assert.equal(data.user.email, email);
    assert.deepEqual(data.user.roles, ['gestor']);
    assert.equal(data.user.organizacionId, orgId);
    assert.deepEqual(data.user.edificiosAsignados, [torrePalermoId]);

    // Vínculos en DB
    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: { organizaciones: true, edificiosGestionados: true },
    });
    assert.equal(usuario.organizaciones.length, 1);
    assert.equal(usuario.organizaciones[0].rol, 'GESTOR');
    assert.equal(usuario.organizaciones[0].activo, true);
    assert.equal(usuario.edificiosGestionados.length, 1);
    assert.equal(usuario.edificiosGestionados[0].edificioId, torrePalermoId);

    // La invitación quedó consumida
    const consumida = await prisma.invitacion.findUnique({ where: { id: invitacion.id } });
    assert.ok(consumida.usadaAt);

    // Y ya puede loguearse con la password que definió
    const { status: statusLogin, data: sesion } = await login(baseUrl, email, 'invitado1234');
    assert.equal(statusLogin, 200);
    assert.deepEqual(sesion.user.roles, ['gestor']);

    // Solo ve su edificio asignado (el gestor invitado no ve San Martín)
    const { status: statusEdificios, data: edificios } = await apiFetch(baseUrl, '/api/edificios', {
      token: sesion.accessToken,
    });
    assert.equal(statusEdificios, 200);
    assert.equal(edificios.length, 1);
    assert.equal(edificios[0].nombre, 'Torre Palermo');

    // Segundo uso del mismo token → 410 (un solo uso)
    const segundoUso = await apiFetch(baseUrl, `/api/invitaciones/${invitacion.token}/aceptar`, {
      method: 'POST',
      body: { password: 'otra-password-1234' },
    });
    assert.equal(segundoUso.status, 410);
    assert.equal(segundoUso.data.error.code, 'INVITACION_INVALIDA');

    for (const refreshToken of [data.refreshToken, sesion.refreshToken]) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
  });

  it('aceptar una invitación RESIDENTE crea el vínculo con la unidad (sin org activa)', async () => {
    const email = `propietario-nuevo-${sufijo()}@test.dev`;
    const invitacion = await crearInvitacion({
      email,
      tipo: 'RESIDENTE',
      payload: {
        nombre: 'Nueva',
        apellido: 'Propietaria',
        unidadId,
        esPropietario: true,
        esInquilino: false,
        fechaInicio: '2026-07-01',
      },
    });

    const { status, data } = await apiFetch(
      baseUrl,
      `/api/invitaciones/${invitacion.token}/aceptar`,
      { method: 'POST', body: { password: 'residente1234' } }
    );

    assert.equal(status, 200);
    assert.equal(data.user.email, email);
    // Residente puro: sin membresía staff no hay organización activa
    // (PRD-04-11 §5.5); el rol se deriva del vínculo con la unidad.
    assert.equal(data.user.organizacionId, null);
    assert.deepEqual(data.user.roles, ['propietario']);

    const vinculos = await prisma.unidadUsuario.findMany({
      where: { usuario: { email } },
    });
    assert.equal(vinculos.length, 1);
    assert.equal(vinculos[0].unidadId, unidadId);
    assert.equal(vinculos[0].esPropietario, true);
    assert.equal(vinculos[0].organizacionId, orgId);

    // Sin organización activa, el backoffice queda cerrado (fail-closed)
    const { status: statusEdificios, data: error } = await apiFetch(baseUrl, '/api/edificios', {
      token: data.accessToken,
    });
    assert.equal(statusEdificios, 403);
    assert.equal(error.error.code, 'SIN_ORGANIZACION_ACTIVA');

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: data.refreshToken },
    });
  });

  it('aceptar una invitación vencida devuelve 410 y no crea nada', async () => {
    const email = `vencido-aceptar-${sufijo()}@test.dev`;
    const invitacion = await crearInvitacion({
      email,
      tipo: 'RESIDENTE',
      payload: { unidadId, esPropietario: true },
      expiraAt: new Date(Date.now() - 1000),
    });

    const { status, data } = await apiFetch(
      baseUrl,
      `/api/invitaciones/${invitacion.token}/aceptar`,
      { method: 'POST', body: { password: 'password1234' } }
    );
    assert.equal(status, 410);
    assert.equal(data.error.code, 'INVITACION_INVALIDA');

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    assert.equal(usuario, null);
  });

  it('valida la password: mínimo 8 caracteres y confirmación coincidente', async () => {
    const invitacion = await crearInvitacion({
      email: `validacion-${sufijo()}@test.dev`,
      tipo: 'STAFF',
      payload: { rol: 'ORG_ADMIN', edificioIds: [] },
    });

    const corta = await apiFetch(baseUrl, `/api/invitaciones/${invitacion.token}/aceptar`, {
      method: 'POST',
      body: { password: 'corta' },
    });
    assert.equal(corta.status, 422);
    assert.equal(corta.data.error.code, 'VALIDACION_FALLIDA');

    const noCoincide = await apiFetch(baseUrl, `/api/invitaciones/${invitacion.token}/aceptar`, {
      method: 'POST',
      body: { password: 'password1234', confirmacion: 'otra-cosa-1234' },
    });
    assert.equal(noCoincide.status, 422);
    assert.equal(noCoincide.data.error.code, 'VALIDACION_FALLIDA');

    // La invitación sigue pendiente después de los intentos inválidos
    const sigueVigente = await prisma.invitacion.findUnique({ where: { id: invitacion.id } });
    assert.equal(sigueVigente.usadaAt, null);
  });

  it('una persona ya registrada suma vínculos sin perder su password (identidad global)', async () => {
    // Residente que ya activó su cuenta en la org demo
    const email = `multi-vinculo-${sufijo()}@test.dev`;
    const primera = await crearInvitacion({
      email,
      tipo: 'RESIDENTE',
      payload: { nombre: 'Multi', apellido: 'Vínculo', unidadId, esPropietario: true },
    });
    const activacion = await apiFetch(baseUrl, `/api/invitaciones/${primera.token}/aceptar`, {
      method: 'POST',
      body: { password: 'original1234' },
    });
    assert.equal(activacion.status, 200);
    const usuarioId = activacion.data.user.id;
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: activacion.data.refreshToken },
    });

    // Ahora la misma persona es invitada como staff de la misma organización
    const segunda = await crearInvitacion({
      email,
      tipo: 'STAFF',
      payload: { rol: 'GESTOR', edificioIds: [torrePalermoId] },
    });
    const { status, data } = await apiFetch(
      baseUrl,
      `/api/invitaciones/${segunda.token}/aceptar`,
      { method: 'POST', body: { password: 'intento-de-cambio-1234' } }
    );
    assert.equal(status, 200);

    // Un solo Usuario en la DB, con los dos vínculos
    assert.equal(data.user.id, usuarioId);
    const usuarios = await prisma.usuario.findMany({ where: { email } });
    assert.equal(usuarios.length, 1);
    const membresias = await prisma.organizacionUsuario.count({ where: { usuarioId } });
    const unidades = await prisma.unidadUsuario.count({ where: { usuarioId } });
    assert.equal(membresias, 1);
    assert.equal(unidades, 1);
    // Con membresía staff ya tiene organización activa y rol de gestor
    assert.deepEqual(data.user.roles, ['gestor']);
    assert.equal(data.user.organizacionId, orgId);

    // La password original NO fue sobrescrita por quien tenía el link
    const conNueva = await login(baseUrl, email, 'intento-de-cambio-1234');
    assert.equal(conNueva.status, 401);
    const conOriginal = await login(baseUrl, email, 'original1234');
    assert.equal(conOriginal.status, 200);

    for (const refreshToken of [data.refreshToken, conOriginal.data.refreshToken]) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
  });

  it('solo puede haber una invitación pendiente por (email, organización, tipo)', async () => {
    const email = `duplicada-${sufijo()}@test.dev`;
    await crearInvitacion({
      email,
      tipo: 'STAFF',
      payload: { rol: 'GESTOR', edificioIds: [] },
    });

    await assert.rejects(
      () => crearInvitacion({ email, tipo: 'STAFF', payload: { rol: 'ORG_ADMIN', edificioIds: [] } }),
      (err) => err.code === 'P2002'
    );

    // El mismo email con otro tipo sí puede tener su propia pendiente
    const residente = await crearInvitacion({
      email,
      tipo: 'RESIDENTE',
      payload: { unidadId, esInquilino: true },
    });
    assert.ok(residente.id);
  });
});
