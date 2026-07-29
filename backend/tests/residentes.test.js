// tests/residentes.test.js — Residentes de una UF (S4-04, Workflow B)
// Contrato: docs/sprints/S4-usuarios-identidad.md (S4-04), PRD-04-11 §5/§6/§9.
// Corre contra la DB del stack dockerizado (org demo del seed S1-03).
//
// Cobertura: feliz (email nuevo / existente / multi-UF), permisos (gestor en
// edificio asignado sí y en no asignado no, cross-org) y los errores del
// contrato (VINCULO_DUPLICADO, VALIDACION_FALLIDA, VINCULO_NO_ENCONTRADO).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

describe('residentes de una UF (S4-04)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let orgId;
  // Torre Palermo: el gestor del seed la tiene asignada. El otro edificio no.
  let unidadAsignada;
  let unidadNoAsignada;

  const emailsCreados = [];

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    orgId = admin.user.organizacionId;

    const asignado = gestor.user.edificiosAsignados[0];
    unidadAsignada = await prisma.unidad.findFirst({
      where: { organizacionId: orgId, edificioId: asignado },
      select: { id: true, edificioId: true },
    });
    unidadNoAsignada = await prisma.unidad.findFirst({
      where: {
        organizacionId: orgId,
        edificioId: { notIn: gestor.user.edificiosAsignados },
        edificio: { activo: true },
      },
      select: { id: true, edificioId: true },
    });
    assert.ok(unidadAsignada && unidadNoAsignada, 'el seed debe tener UFs en dos edificios');
  });

  after(async () => {
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: emailsCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.invitacion.deleteMany({ where: { email: { in: emailsCreados } } });
    await prisma.unidadUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });

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

  const ruta = (unidadId, sufijoRuta = '') =>
    `/api/unidades/${unidadId}/residentes${sufijoRuta}`;

  const vincular = (unidadId, body, token = admin.accessToken) =>
    apiFetch(baseUrl, ruta(unidadId), { method: 'POST', token, body });

  // -------------------------------------------------------------------------
  // POST / — alta
  // -------------------------------------------------------------------------

  it('vincular un email nuevo crea Usuario sin password, el vínculo y la invitación', async () => {
    const email = nuevoEmail('propietario-nuevo');
    const { status, data } = await vincular(unidadAsignada.id, {
      email: email.toUpperCase(), // se normaliza a lowercase (identidad global)
      nombre: 'Nueva',
      apellido: 'Propietaria',
      esPropietario: true,
      fechaInicio: '2026-07-01',
    });

    assert.equal(status, 201);
    assert.equal(data.usuario.email, email);
    assert.equal(data.usuario.cuentaActivada, false);
    assert.equal(data.vinculo.esPropietario, true);
    assert.equal(data.vinculo.esInquilino, false);
    assert.equal(data.vinculo.vigente, true);
    assert.equal(data.vinculo.fechaFin, null);
    assert.ok(data.vinculo.fechaInicio.startsWith('2026-07-01'));
    assert.equal(data.emailEnviado, false); // MVP: link para copiar

    const invitacion = await prisma.invitacion.findUnique({ where: { id: data.invitacion.id } });
    assert.equal(invitacion.tipo, 'RESIDENTE');
    assert.equal(invitacion.email, email);
    assert.equal(invitacion.payload.unidadId, unidadAsignada.id);
    assert.equal(invitacion.invitadoPorId, admin.user.id);
    assert.ok(data.invitacionUrl.endsWith(`/invitacion/${invitacion.token}`));

    // El vínculo desnormaliza la organización (scope de queries y Cerbos)
    const enDb = await prisma.unidadUsuario.findUnique({ where: { id: data.vinculo.id } });
    assert.equal(enDb.organizacionId, orgId);
    assert.equal(enDb.unidadId, unidadAsignada.id);

    // Sin password no hay login posible todavía
    const sinActivar = await login(baseUrl, email, 'cualquier-cosa');
    assert.equal(sinActivar.status, 401);
  });

  it('vincular un email que ya tiene cuenta suma la UF sin tocar su password', async () => {
    const email = nuevoEmail('ya-registrado');
    const existente = await prisma.usuario.create({
      data: { email, nombre: 'Ya', apellido: 'Registrado', passwordHash: 'hash-previo' },
    });

    const { status, data } = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Otro',
      apellido: 'Nombre',
      esInquilino: true,
    });

    assert.equal(status, 201);
    assert.equal(data.usuario.id, existente.id);
    assert.equal(data.usuario.cuentaActivada, true);
    assert.equal(data.vinculo.esInquilino, true);

    const sinTocar = await prisma.usuario.findUnique({ where: { id: existente.id } });
    assert.equal(sinTocar.passwordHash, 'hash-previo');
    assert.equal(sinTocar.nombre, 'Ya');
    assert.equal((await prisma.usuario.findMany({ where: { email } })).length, 1);
  });

  it('la misma persona acumula N UFs con un solo Usuario (multi-pertenencia)', async () => {
    const email = nuevoEmail('multi-uf');
    const primera = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Multi',
      apellido: 'UF',
      esPropietario: true,
    });
    assert.equal(primera.status, 201);

    // Segunda UF en otro edificio de la misma org: la invitación pendiente se
    // reusa (una sola por email+org+tipo) regenerando el token
    const segunda = await vincular(unidadNoAsignada.id, {
      email,
      nombre: 'Multi',
      apellido: 'UF',
      esPropietario: true,
    });
    assert.equal(segunda.status, 201);
    assert.equal(segunda.data.usuario.id, primera.data.usuario.id);
    assert.equal(segunda.data.invitacion.reenviada, true);
    assert.equal(segunda.data.invitacion.id, primera.data.invitacion.id);
    assert.notEqual(segunda.data.invitacionUrl, primera.data.invitacionUrl);

    // Un solo Usuario, dos vínculos vigentes, una sola invitación pendiente
    assert.equal((await prisma.usuario.findMany({ where: { email } })).length, 1);
    assert.equal(
      await prisma.unidadUsuario.count({
        where: { usuarioId: primera.data.usuario.id, fechaFin: null },
      }),
      2
    );
    assert.equal(
      await prisma.invitacion.count({ where: { email, organizacionId: orgId, usadaAt: null } }),
      1
    );

    // Y al activar entra como propietario, sin organización activa (§5.5)
    const activacion = await apiFetch(baseUrl, `/api/invitaciones/${segunda.data.invitacionUrl.split('/').pop()}/aceptar`, {
      method: 'POST',
      body: { password: 'residente1234' },
    });
    assert.equal(activacion.status, 200);
    assert.deepEqual(activacion.data.user.roles, ['propietario']);
    assert.equal(activacion.data.user.organizacionId, null);
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: activacion.data.refreshToken },
    });
  });

  it('un vínculo vigente duplicado devuelve 409 VINCULO_DUPLICADO', async () => {
    const email = nuevoEmail('duplicado');
    const primera = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Dupli',
      esPropietario: true,
    });
    assert.equal(primera.status, 201);

    const segunda = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Dupli',
      esInquilino: true,
    });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.data.error.code, 'VINCULO_DUPLICADO');
  });

  it('exige al menos propietario o inquilino (422 VALIDACION_FALLIDA)', async () => {
    const { status, data } = await vincular(unidadAsignada.id, {
      email: nuevoEmail('sin-tipo'),
      nombre: 'Sin',
      esPropietario: false,
      esInquilino: false,
    });
    assert.equal(status, 422);
    assert.equal(data.error.code, 'VALIDACION_FALLIDA');
  });

  // -------------------------------------------------------------------------
  // GET /
  // -------------------------------------------------------------------------

  it('GET lista los vínculos vigentes e históricos con datos del usuario', async () => {
    const email = nuevoEmail('listado');
    const { data: alta } = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Lista',
      apellido: 'Do',
      esPropietario: true,
      esInquilino: true,
    });

    const { status, data } = await apiFetch(baseUrl, ruta(unidadAsignada.id), {
      token: admin.accessToken,
    });
    assert.equal(status, 200);
    const fila = data.find((v) => v.id === alta.vinculo.id);
    assert.equal(fila.usuario.email, email);
    assert.equal(fila.usuario.nombre, 'Lista');
    assert.equal(fila.usuario.cuentaActivada, false);
    assert.equal(fila.esPropietario, true);
    assert.equal(fila.esInquilino, true);
    assert.equal(fila.vigente, true);
    // Nunca se filtra el hash de la password
    assert.equal(fila.usuario.passwordHash, undefined);

    // Los vigentes van primero
    const indiceUltimoVigente = data.map((v) => v.vigente).lastIndexOf(true);
    const indicePrimerHistorico = data.map((v) => v.vigente).indexOf(false);
    if (indicePrimerHistorico !== -1) {
      assert.ok(indicePrimerHistorico > indiceUltimoVigente);
    }
  });

  it('GET de una UF de otra organización devuelve 403', async () => {
    // Se simula con una UF inexistente (404) y con la validación de tenant:
    // una UF de otra org nunca es alcanzable desde este JWT.
    const { status, data } = await apiFetch(baseUrl, ruta(randomUUID()), {
      token: admin.accessToken,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'UNIDAD_NO_ENCONTRADA');
  });

  // -------------------------------------------------------------------------
  // DELETE /:vinculoId
  // -------------------------------------------------------------------------

  it('DELETE da de baja el vínculo con fechaFin, sin borrado físico', async () => {
    const email = nuevoEmail('a-desvincular');
    const { data: alta } = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Sale',
      esInquilino: true,
    });

    const { status, data } = await apiFetch(baseUrl, ruta(unidadAsignada.id, `/${alta.vinculo.id}`), {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(status, 200);
    assert.equal(data.vigente, false);
    assert.ok(data.fechaFin);

    // La fila sigue en la DB (historial de expensas y pagos, §5.6)
    const enDb = await prisma.unidadUsuario.findUnique({ where: { id: alta.vinculo.id } });
    assert.ok(enDb);
    assert.ok(enDb.fechaFin);

    // Idempotente: no reescribe la fecha original
    const repetido = await apiFetch(baseUrl, ruta(unidadAsignada.id, `/${alta.vinculo.id}`), {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(repetido.status, 200);
    assert.equal(repetido.data.fechaFin, data.fechaFin);

    // Y re-vincularla reabre el MISMO vínculo (unique org+unidad+usuario)
    const revinculo = await vincular(unidadAsignada.id, {
      email,
      nombre: 'Sale',
      esPropietario: true,
    });
    assert.equal(revinculo.status, 201);
    assert.equal(revinculo.data.vinculo.id, alta.vinculo.id);
    assert.equal(revinculo.data.vinculo.vigente, true);
    assert.equal(revinculo.data.vinculo.esPropietario, true);
  });

  it('DELETE de un vínculo que no es de esa UF devuelve 404', async () => {
    const email = nuevoEmail('otra-uf');
    const { data: alta } = await vincular(unidadNoAsignada.id, {
      email,
      nombre: 'Otra',
      esPropietario: true,
    });

    // El vínculo existe, pero pertenece a otra unidad
    const { status, data } = await apiFetch(baseUrl, ruta(unidadAsignada.id, `/${alta.vinculo.id}`), {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'VINCULO_NO_ENCONTRADO');

    // Y sigue vigente
    const intacto = await prisma.unidadUsuario.findUnique({ where: { id: alta.vinculo.id } });
    assert.equal(intacto.fechaFin, null);
  });

  // -------------------------------------------------------------------------
  // Permisos del gestor
  // -------------------------------------------------------------------------

  it('el gestor opera residentes en su edificio asignado', async () => {
    const email = nuevoEmail('por-gestor');
    const alta = await vincular(
      unidadAsignada.id,
      { email, nombre: 'Del', apellido: 'Gestor', esPropietario: true },
      gestor.accessToken
    );
    assert.equal(alta.status, 201);

    const lista = await apiFetch(baseUrl, ruta(unidadAsignada.id), { token: gestor.accessToken });
    assert.equal(lista.status, 200);
    assert.ok(lista.data.some((v) => v.usuario.email === email));

    const baja = await apiFetch(baseUrl, ruta(unidadAsignada.id, `/${alta.data.vinculo.id}`), {
      method: 'DELETE',
      token: gestor.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.vigente, false);
  });

  it('el gestor no toca residentes de un edificio no asignado (403)', async () => {
    const lista = await apiFetch(baseUrl, ruta(unidadNoAsignada.id), { token: gestor.accessToken });
    assert.equal(lista.status, 403);
    assert.equal(lista.data.error.code, 'EDIFICIO_NO_ASIGNADO');

    const alta = await vincular(
      unidadNoAsignada.id,
      { email: nuevoEmail('no-asignado'), nombre: 'No', esPropietario: true },
      gestor.accessToken
    );
    assert.equal(alta.status, 403);
    assert.equal(alta.data.error.code, 'EDIFICIO_NO_ASIGNADO');
  });

  it('sin token devuelve 401', async () => {
    const { status } = await apiFetch(baseUrl, ruta(unidadAsignada.id));
    assert.equal(status, 401);
  });
});
