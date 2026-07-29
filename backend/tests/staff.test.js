// tests/staff.test.js — Endpoints de staff (S4-03, Workflow A)
// Contrato: docs/sprints/S4-usuarios-identidad.md (S4-03), PRD-04-11 §4/§6/§9.
// Corre contra la DB del stack dockerizado (org demo del seed S1-03).
//
// Cobertura: feliz (alta nueva / email existente), permisos (gestor 403, otra
// org no ve el staff ajeno) y los errores del contrato (VINCULO_DUPLICADO,
// INVITACION_PENDIENTE + reenvío, EDIFICIO_INVALIDO, ULTIMO_ORG_ADMIN, 404).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma, borrarOrgDePrueba } from './helpers.js';

const RUTA = '/api/organizaciones/me/usuarios';

describe('staff de la organización (S4-03)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let orgId;
  let torrePalermoId;
  let sanMartinId;

  // Todo lo que crean los tests, para limpiar en el after
  const emailsCreados = [];
  const orgsCreadas = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    orgId = admin.user.organizacionId;

    // Solo activos: los tests de S2 dejan edificios con soft delete, y un
    // edificio dado de baja no es asignable a un gestor.
    const edificios = await prisma.edificio.findMany({
      where: { organizacionId: orgId, activo: true },
      select: { id: true, nombre: true },
    });
    torrePalermoId = edificios.find((e) => e.nombre === 'Torre Palermo').id;
    sanMartinId = edificios.find((e) => e.nombre !== 'Torre Palermo').id;
  });

  after(async () => {
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: emailsCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.invitacion.deleteMany({ where: { email: { in: emailsCreados } } });
    await prisma.unidadUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.gestorEdificio.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });

    for (const id of orgsCreadas) await borrarOrgDePrueba(id);

    for (const refreshToken of [admin.refreshToken, gestor.refreshToken]) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
    await cerrarApp(server);
  });

  const sufijo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  function nuevoEmail(prefijo) {
    const email = `${prefijo}-${sufijo()}@test.dev`;
    emailsCreados.push(email);
    return email;
  }

  const invitar = (body, token = admin.accessToken) =>
    apiFetch(baseUrl, RUTA, { method: 'POST', token, body });

  // -------------------------------------------------------------------------
  // GET /
  // -------------------------------------------------------------------------

  it('GET lista el staff de la org con rol, edificios y estado', async () => {
    const { status, data } = await apiFetch(baseUrl, RUTA, { token: admin.accessToken });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));

    const adminDemo = data.find((m) => m.email === 'admin@demo.com');
    assert.equal(adminDemo.rol, 'ORG_ADMIN');
    assert.equal(adminDemo.activo, true);
    assert.equal(adminDemo.cuentaActivada, true);
    // Un org_admin no tiene asignaciones por edificio: administra toda la org
    assert.deepEqual(adminDemo.edificios, []);

    const gestorDemo = data.find((m) => m.email === 'gestor@demo.com');
    assert.equal(gestorDemo.rol, 'GESTOR');
    assert.deepEqual(
      gestorDemo.edificios.map((e) => e.nombre),
      ['Torre Palermo']
    );
  });

  it('un gestor no puede ver ni tocar el staff (Cerbos: solo org_admin)', async () => {
    const lista = await apiFetch(baseUrl, RUTA, { token: gestor.accessToken });
    assert.equal(lista.status, 403);
    assert.equal(lista.data.error.code, 'ACCESO_DENEGADO');

    const alta = await invitar(
      { email: nuevoEmail('por-gestor'), nombre: 'No', rol: 'GESTOR' },
      gestor.accessToken
    );
    assert.equal(alta.status, 403);
    assert.equal(alta.data.error.code, 'ACCESO_DENEGADO');
  });

  it('sin token devuelve 401', async () => {
    const { status } = await apiFetch(baseUrl, RUTA);
    assert.equal(status, 401);
  });

  // -------------------------------------------------------------------------
  // POST / — alta
  // -------------------------------------------------------------------------

  it('invitar un gestor nuevo crea Usuario sin password, membresía, edificios e invitación', async () => {
    const email = nuevoEmail('gestor-nuevo');
    const { status, data } = await invitar({
      email: email.toUpperCase(), // se normaliza a lowercase (identidad global)
      nombre: 'Nueva',
      apellido: 'Gestora',
      rol: 'GESTOR',
      edificioIds: [torrePalermoId],
    });

    assert.equal(status, 201);
    assert.equal(data.usuario.email, email);
    assert.equal(data.usuario.cuentaActivada, false);
    assert.equal(data.membresia.rol, 'GESTOR');
    assert.equal(data.membresia.activo, true);
    assert.deepEqual(data.edificios, [torrePalermoId]);
    assert.equal(data.invitacion.reenviada, false);
    assert.equal(data.emailEnviado, false); // MVP: link para copiar

    // El link apunta a la SPA y trae el token de la invitación
    const invitacion = await prisma.invitacion.findUnique({ where: { id: data.invitacion.id } });
    assert.equal(invitacion.tipo, 'STAFF');
    assert.equal(invitacion.email, email);
    assert.equal(invitacion.organizacionId, orgId);
    assert.equal(invitacion.invitadoPorId, admin.user.id);
    assert.ok(data.invitacionUrl.endsWith(`/invitacion/${invitacion.token}`));

    // Vínculos en DB, y sin password no hay login posible todavía
    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: { organizaciones: true, edificiosGestionados: true },
    });
    assert.equal(usuario.passwordHash, null);
    assert.equal(usuario.organizaciones.length, 1);
    assert.equal(usuario.edificiosGestionados[0].edificioId, torrePalermoId);

    // Y aparece en la lista con la cuenta sin activar
    const { data: lista } = await apiFetch(baseUrl, RUTA, { token: admin.accessToken });
    const fila = lista.find((m) => m.email === email);
    assert.equal(fila.cuentaActivada, false);
    assert.equal(fila.rol, 'GESTOR');
  });

  it('invitar un email que ya tiene cuenta suma la membresía sin tocar su password', async () => {
    // Persona que ya existe y está activada (creada como residente en otra org)
    const email = nuevoEmail('ya-registrada');
    const existente = await prisma.usuario.create({
      data: { email, nombre: 'Ya', apellido: 'Registrada', passwordHash: 'hash-previo' },
    });

    const { status, data } = await invitar({
      email,
      nombre: 'Otro',
      apellido: 'Nombre',
      rol: 'ORG_ADMIN',
    });

    assert.equal(status, 201);
    // Un solo Usuario: la identidad es global, la membresía es el vínculo nuevo
    assert.equal(data.usuario.id, existente.id);
    assert.equal(data.usuario.cuentaActivada, true);
    assert.equal(data.membresia.rol, 'ORG_ADMIN');

    const sinTocar = await prisma.usuario.findUnique({ where: { id: existente.id } });
    assert.equal(sinTocar.passwordHash, 'hash-previo');
    // El nombre del form no sobrescribe el de una persona ya registrada
    assert.equal(sinTocar.nombre, 'Ya');

    const usuarios = await prisma.usuario.findMany({ where: { email } });
    assert.equal(usuarios.length, 1);
  });

  it('invitar a alguien que ya es miembro activo devuelve 409 VINCULO_DUPLICADO', async () => {
    const { status, data } = await invitar({
      email: 'gestor@demo.com',
      nombre: 'Gestor',
      rol: 'GESTOR',
      edificioIds: [torrePalermoId],
    });
    assert.equal(status, 409);
    assert.equal(data.error.code, 'VINCULO_DUPLICADO');
  });

  it('una segunda invitación pendiente devuelve 409 y con reenviar: true regenera el token', async () => {
    const email = nuevoEmail('pendiente');
    const primera = await invitar({ email, nombre: 'Pen', rol: 'GESTOR' });
    assert.equal(primera.status, 201);
    const tokenOriginal = primera.data.invitacionUrl;

    const segunda = await invitar({ email, nombre: 'Pen', rol: 'GESTOR' });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.data.error.code, 'INVITACION_PENDIENTE');

    // Reenvío explícito: misma fila, token y expiración nuevos, 200 (no crea recurso)
    const reenvio = await invitar({
      email,
      nombre: 'Pen',
      apellido: 'Diente',
      rol: 'GESTOR',
      edificioIds: [sanMartinId],
      reenviar: true,
    });
    assert.equal(reenvio.status, 200);
    assert.equal(reenvio.data.invitacion.reenviada, true);
    assert.equal(reenvio.data.invitacion.id, primera.data.invitacion.id);
    assert.notEqual(reenvio.data.invitacionUrl, tokenOriginal);
    assert.deepEqual(reenvio.data.edificios, [sanMartinId]);

    // Sigue habiendo UNA sola invitación pendiente para esa terna
    const pendientes = await prisma.invitacion.count({
      where: { email, organizacionId: orgId, tipo: 'STAFF', usadaAt: null },
    });
    assert.equal(pendientes, 1);
  });

  it('rechaza edificios de otra organización o inexistentes con 422 EDIFICIO_INVALIDO', async () => {
    const fantasma = randomUUID();
    const { status, data } = await invitar({
      email: nuevoEmail('edificio-invalido'),
      nombre: 'Mala',
      rol: 'GESTOR',
      edificioIds: [torrePalermoId, fantasma],
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'EDIFICIO_INVALIDO');
    assert.ok(data.error.message.includes(fantasma));
  });

  it('valida el body: rol inválido y edificios en un ORG_ADMIN', async () => {
    const rolMalo = await invitar({ email: nuevoEmail('rol'), nombre: 'X', rol: 'PROPIETARIO' });
    assert.equal(rolMalo.status, 422);
    assert.equal(rolMalo.data.error.code, 'VALIDACION_FALLIDA');

    const adminConEdificios = await invitar({
      email: nuevoEmail('admin-edificios'),
      nombre: 'X',
      rol: 'ORG_ADMIN',
      edificioIds: [torrePalermoId],
    });
    assert.equal(adminConEdificios.status, 422);
    assert.equal(adminConEdificios.data.error.code, 'VALIDACION_FALLIDA');
  });

  // -------------------------------------------------------------------------
  // PATCH /:id
  // -------------------------------------------------------------------------

  it('PATCH cambia el rol, reemplaza los edificios del gestor y desactiva la membresía', async () => {
    const email = nuevoEmail('editable');
    const { data: alta } = await invitar({
      email,
      nombre: 'Edi',
      apellido: 'Table',
      rol: 'GESTOR',
      edificioIds: [torrePalermoId],
    });
    const usuarioId = alta.usuario.id;

    // Reemplazo de edificios (no acumula: sale Torre Palermo, entra San Martín)
    const edificios = await apiFetch(baseUrl, `${RUTA}/${usuarioId}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: { edificioIds: [sanMartinId] },
    });
    assert.equal(edificios.status, 200);
    assert.deepEqual(
      edificios.data.edificios.map((e) => e.id),
      [sanMartinId]
    );

    // Promoción a ORG_ADMIN: las asignaciones por edificio se limpian
    const promovido = await apiFetch(baseUrl, `${RUTA}/${usuarioId}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: { rol: 'ORG_ADMIN' },
    });
    assert.equal(promovido.status, 200);
    assert.equal(promovido.data.rol, 'ORG_ADMIN');
    assert.deepEqual(promovido.data.edificios, []);
    assert.equal(
      await prisma.gestorEdificio.count({ where: { usuarioId } }),
      0
    );

    // Desactivación (baja lógica de la membresía; el Usuario global sobrevive)
    const baja = await apiFetch(baseUrl, `${RUTA}/${usuarioId}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: { activo: false },
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.activo, false);
    assert.ok(await prisma.usuario.findUnique({ where: { id: usuarioId } }));
  });

  it('PATCH no deja desactivar ni degradar al último org_admin activo (422 ULTIMO_ORG_ADMIN)', async () => {
    // Org propia para no dejar la demo sin admin
    const registro = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: nuevoEmail('solo-admin'),
        password: 'password1234',
        nombre: 'Solo',
        apellido: 'Admin',
        organizacion: {
          nombre: `Org Último Admin ${sufijo()}`,
          cuit: `30-${String(Date.now()).slice(-8)}-9`,
          matriculaRPA: 'RPA-9999',
        },
      },
    });
    assert.equal(registro.status, 201);
    const solo = registro.data;
    orgsCreadas.push(solo.user.organizacionId);

    const ruta = `${RUTA}/${solo.user.id}`;
    for (const body of [{ activo: false }, { rol: 'GESTOR' }]) {
      const { status, data } = await apiFetch(baseUrl, ruta, {
        method: 'PATCH',
        token: solo.accessToken,
        body,
      });
      assert.equal(status, 422);
      assert.equal(data.error.code, 'ULTIMO_ORG_ADMIN');
    }

    // Con un segundo org_admin activo, degradarse a sí mismo ya es válido
    const segundo = nuevoEmail('segundo-admin');
    const { status: statusAlta, data: alta } = await apiFetch(baseUrl, RUTA, {
      method: 'POST',
      token: solo.accessToken,
      body: { email: segundo, nombre: 'Segundo', rol: 'ORG_ADMIN' },
    });
    assert.equal(statusAlta, 201);
    assert.ok(alta.membresia.activo);

    const degradado = await apiFetch(baseUrl, ruta, {
      method: 'PATCH',
      token: solo.accessToken,
      body: { rol: 'GESTOR' },
    });
    assert.equal(degradado.status, 200);
    assert.equal(degradado.data.rol, 'GESTOR');

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: solo.refreshToken },
    });
  });

  it('PATCH de un usuario que no es miembro de la org devuelve 404', async () => {
    const { status, data } = await apiFetch(baseUrl, `${RUTA}/${randomUUID()}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: { activo: false },
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'USUARIO_NO_ENCONTRADO');
  });

  it('PATCH sin campos devuelve 422 VALIDACION_FALLIDA', async () => {
    const { status, data } = await apiFetch(baseUrl, `${RUTA}/${admin.user.id}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: {},
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'VALIDACION_FALLIDA');
  });

  // -------------------------------------------------------------------------
  // Aislamiento cross-org
  // -------------------------------------------------------------------------

  it('el staff de otra organización no aparece en la lista (aislamiento)', async () => {
    const emailB = nuevoEmail('org-b-admin');
    const registro = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: emailB,
        password: 'password1234',
        nombre: 'Org',
        apellido: 'B',
        organizacion: {
          nombre: `Org B Aislamiento ${sufijo()}`,
          cuit: `33-${String(Date.now() + 1).slice(-8)}-1`,
          matriculaRPA: 'RPA-1111',
        },
      },
    });
    assert.equal(registro.status, 201);
    const orgB = registro.data;
    orgsCreadas.push(orgB.user.organizacionId);

    const { data: staffA } = await apiFetch(baseUrl, RUTA, { token: admin.accessToken });
    assert.ok(!staffA.some((m) => m.email === emailB));

    const { data: staffB } = await apiFetch(baseUrl, RUTA, { token: orgB.accessToken });
    assert.deepEqual(
      staffB.map((m) => m.email),
      [emailB]
    );

    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: orgB.refreshToken },
    });
  });
});
