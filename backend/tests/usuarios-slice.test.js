// tests/usuarios-slice.test.js — Slice de usuarios e identidad (S4-06)
// Contrato: docs/sprints/S4-usuarios-identidad.md (S4-06), PRD-04-11 §5/§6/§9/§10.
// Corre contra la DB del stack dockerizado (org demo del seed S1-03 = "org A").
//
// Esta suite NO repite lo que ya cubren auth/invitaciones/staff/residentes/
// cambiar-organizacion.test.js (cada endpoint por separado). Acá se prueba lo
// que solo se ve de punta a punta y CRUZANDO ORGANIZACIONES:
//   · identidad global: un email = un Usuario, aunque lo den de alta N orgs;
//   · aislamiento: org B no lee ni escribe staff ni residentes de org A;
//   · el contexto (org activa, roles, edificios) sigue a la membresía elegida.
//
// Los tests corren en orden dentro del archivo (node:test, secuencial) y
// comparten deliberadamente a la "persona multi-org" creada en el segundo test:
// el valor del escenario está en la acumulación de vínculos sobre un mismo
// Usuario. Todo lo creado se limpia en el after().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma, borrarOrgDePrueba } from './helpers.js';

const RUTA_STAFF = '/api/organizaciones/me/usuarios';
const rutaResidentes = (unidadId, sufijoRuta = '') =>
  `/api/unidades/${unidadId}/residentes${sufijoRuta}`;

describe('slice de usuarios: identidad global y aislamiento (S4-06)', () => {
  let server;
  let baseUrl;

  // Org A = la del seed (admin@demo.com). Org B y C se crean por /register.
  let admin; // sesión org_admin de la org A
  let orgAId;
  let unidadA;
  let adminB; // sesión org_admin de la org B
  let orgBId;
  let edificioB1;
  let edificioB2;
  let unidadB1;
  let unidadB2;

  // Persona con identidad global: gestora en A y org_admin en B (test 2).
  let multiOrgEmail;
  let multiOrgId;
  let multiOrgInvitacionUrlB;
  const PASSWORD_MULTI = 'multiorg1234';

  // Residente de una UF de A y otra de B (test 7).
  let residenteMultiOrgId;
  let residenteMultiOrgEmail;

  const emailsCreados = [];
  const orgsCreadas = [];
  const edificiosCreados = [];
  const refreshTokensAbiertos = [];

  const sufijo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  function nuevoEmail(prefijo) {
    const email = `${prefijo}-${sufijo()}@test.dev`;
    emailsCreados.push(email);
    return email;
  }

  // Alta de una organización nueva con su org_admin (POST /register).
  async function registrarOrganizacion(prefijo, nombre) {
    const email = nuevoEmail(prefijo);
    const { status, data } = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'password1234',
        nombre: 'Admin',
        apellido: nombre,
        organizacion: {
          nombre: `${nombre} ${sufijo()}`,
          cuit: `30-${sufijo().slice(-8)}-${Math.floor(Math.random() * 10)}`,
          matriculaRPA: 'RPA-4711',
        },
      },
    });
    assert.equal(status, 201, `no se pudo registrar ${nombre}`);
    orgsCreadas.push(data.user.organizacionId);
    refreshTokensAbiertos.push(data.refreshToken);
    return { ...data, email };
  }

  // Edificio + UF de la org de prueba (Prisma directo: el invariante de
  // coeficientes es de S2 y no es lo que se prueba acá).
  async function crearEdificioConUnidad(organizacionId, nombre) {
    const edificio = await prisma.edificio.create({
      data: {
        organizacionId,
        nombre,
        direccion: `${nombre} 100`,
        ciudad: 'CABA',
        provincia: 'Buenos Aires',
        codigoPostal: 'C1425BGW',
        totalM2: 500,
        amenities: [],
      },
    });
    edificiosCreados.push(edificio.id);
    const unidad = await prisma.unidad.create({
      data: {
        organizacionId,
        edificioId: edificio.id,
        numero: '1A',
        tipo: 'departamento',
        m2: 50,
        coeficiente: 1,
      },
    });
    return { edificio, unidad };
  }

  // Claims del access token (sub, email, org_id, roles, edificios_asignados).
  const claimsDe = (accessToken) =>
    JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());

  const aceptarInvitacion = (invitacionUrl, password) =>
    apiFetch(baseUrl, `/api/invitaciones/${invitacionUrl.split('/').pop()}/aceptar`, {
      method: 'POST',
      body: { password },
    });

  before(async () => {
    ({ server, baseUrl } = await levantarApp());

    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    orgAId = admin.user.organizacionId;
    refreshTokensAbiertos.push(admin.refreshToken);

    unidadA = await prisma.unidad.findFirst({
      where: { organizacionId: orgAId, edificio: { activo: true } },
      select: { id: true, edificioId: true },
    });
    assert.ok(unidadA, 'el seed debe tener al menos una UF en la org demo');

    // Org B: dos edificios para probar el scope del gestor dentro de su org.
    adminB = await registrarOrganizacion('admin-org-b', 'Zeta Slice B');
    orgBId = adminB.user.organizacionId;
    ({ edificio: edificioB1, unidad: unidadB1 } = await crearEdificioConUnidad(
      orgBId,
      'Edificio B Uno'
    ));
    ({ edificio: edificioB2, unidad: unidadB2 } = await crearEdificioConUnidad(
      orgBId,
      'Edificio B Dos'
    ));
  });

  after(async () => {
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: emailsCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);

    await prisma.invitacion.deleteMany({
      where: { OR: [{ email: { in: emailsCreados } }, { organizacionId: { in: orgsCreadas } }] },
    });
    await prisma.unidadUsuario.deleteMany({
      where: { OR: [{ usuarioId: { in: ids } }, { organizacionId: { in: orgsCreadas } }] },
    });
    await prisma.gestorEdificio.deleteMany({
      where: { OR: [{ usuarioId: { in: ids } }, { edificioId: { in: edificiosCreados } }] },
    });
    await prisma.unidad.deleteMany({ where: { edificioId: { in: edificiosCreados } } });
    await prisma.edificio.deleteMany({ where: { id: { in: edificiosCreados } } });
    await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });

    for (const id of orgsCreadas) await borrarOrgDePrueba(id);

    for (const refreshToken of refreshTokensAbiertos) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
    await cerrarApp(server);
  });

  // -------------------------------------------------------------------------
  // Identidad global
  // -------------------------------------------------------------------------

  it('register con un email ya registrado devuelve 422 EMAIL_YA_REGISTRADO y no crea la organización', async () => {
    const cuit = `30-${String(Date.now()).slice(-8)}-4`;
    const { status, data } = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: adminB.email.toUpperCase(), // el email se normaliza antes de buscar
        password: 'otrapassword1234',
        nombre: 'Impostor',
        apellido: 'Duplicado',
        organizacion: { nombre: `Org Duplicada ${sufijo()}`, cuit, matriculaRPA: 'RPA-0001' },
      },
    });

    assert.equal(status, 422);
    assert.equal(data.error.code, 'EMAIL_YA_REGISTRADO');

    // Un solo Usuario con ese email y ninguna organización huérfana
    assert.equal((await prisma.usuario.count({ where: { email: adminB.email } })), 1);
    assert.equal(await prisma.organizacion.count({ where: { cuit } }), 0);
  });

  it('invitar como staff un email que ya es usuario de otra organización reusa el Usuario y suma membresía', async () => {
    multiOrgEmail = nuevoEmail('multi-org-staff');

    const enA = await apiFetch(baseUrl, RUTA_STAFF, {
      method: 'POST',
      token: admin.accessToken,
      body: {
        email: multiOrgEmail,
        nombre: 'Multi',
        apellido: 'Org',
        rol: 'GESTOR',
        edificioIds: [unidadA.edificioId],
      },
    });
    assert.equal(enA.status, 201);
    multiOrgId = enA.data.usuario.id;

    // Org B invita al MISMO email: usuario existente → solo nueva membresía
    const enB = await apiFetch(baseUrl, RUTA_STAFF, {
      method: 'POST',
      token: adminB.accessToken,
      body: { email: multiOrgEmail.toUpperCase(), nombre: 'Multi', rol: 'ORG_ADMIN' },
    });
    assert.equal(enB.status, 201);
    assert.equal(enB.data.usuario.id, multiOrgId, 'debe ser el mismo Usuario global');
    assert.equal(enB.data.membresia.rol, 'ORG_ADMIN');

    // Un solo Usuario, dos membresías activas, una invitación pendiente por org
    assert.equal(await prisma.usuario.count({ where: { email: multiOrgEmail } }), 1);
    const membresias = await prisma.organizacionUsuario.findMany({
      where: { usuarioId: multiOrgId, activo: true },
      select: { organizacionId: true, rol: true },
    });
    assert.deepEqual(
      membresias.map((m) => [m.organizacionId, m.rol]).sort(),
      [
        [orgAId, 'GESTOR'],
        [orgBId, 'ORG_ADMIN'],
      ].sort()
    );
    const pendientes = await prisma.invitacion.findMany({
      where: { email: multiOrgEmail, usadaAt: null },
      select: { organizacionId: true },
    });
    assert.deepEqual(pendientes.map((i) => i.organizacionId).sort(), [orgAId, orgBId].sort());

    // Guardamos el link de la invitación de B para activarla en el próximo test
    multiOrgInvitacionUrlB = enB.data.invitacionUrl;
  });

  it('aceptar la invitación activa la cuenta y el segundo uso del mismo token devuelve 410', async () => {
    const aceptada = await aceptarInvitacion(multiOrgInvitacionUrlB, PASSWORD_MULTI);
    assert.equal(aceptada.status, 200);
    assert.equal(aceptada.data.user.id, multiOrgId);
    // Con dos membresías, la org activa es la primera alfabética: la del seed
    assert.equal(aceptada.data.user.organizacionId, orgAId);
    assert.equal(aceptada.data.user.organizaciones.length, 2);
    refreshTokensAbiertos.push(aceptada.data.refreshToken);

    // Reuso del mismo token: la invitación quedó consumida
    const reuso = await aceptarInvitacion(multiOrgInvitacionUrlB, PASSWORD_MULTI);
    assert.equal(reuso.status, 410);
    assert.equal(reuso.data.error.code, 'INVITACION_INVALIDA');

    // Y ya no se puede ni mirar
    const token = multiOrgInvitacionUrlB.split('/').pop();
    const detalle = await apiFetch(baseUrl, `/api/invitaciones/${token}`);
    assert.equal(detalle.status, 410);

    // Token inexistente: mismo 410 opaco (no filtra si existió o no)
    const inventado = await apiFetch(baseUrl, `/api/invitaciones/${randomUUID()}`);
    assert.equal(inventado.status, 410);
    assert.equal(inventado.data.error.code, 'INVITACION_INVALIDA');

    // La cuenta quedó activada: un solo login para las dos organizaciones
    const sesion = await login(baseUrl, multiOrgEmail, PASSWORD_MULTI);
    assert.equal(sesion.status, 200);
    assert.equal(sesion.data.user.id, multiOrgId);
    refreshTokensAbiertos.push(sesion.data.refreshToken);
  });

  // -------------------------------------------------------------------------
  // Contexto de organización activa
  // -------------------------------------------------------------------------

  it('la persona multi-org cambia de contexto y la org elegida sobrevive al refresh', async () => {
    const { data: sesion } = await login(baseUrl, multiOrgEmail, PASSWORD_MULTI);
    assert.equal(sesion.user.organizacionId, orgAId);
    assert.deepEqual(sesion.user.roles, ['gestor']);
    assert.deepEqual(sesion.user.edificiosAsignados, [unidadA.edificioId]);

    const cambio = await apiFetch(baseUrl, '/api/auth/cambiar-organizacion', {
      method: 'POST',
      token: sesion.accessToken,
      body: { organizacionId: orgBId, refreshToken: sesion.refreshToken },
    });
    assert.equal(cambio.status, 200);
    assert.equal(cambio.data.user.organizacionId, orgBId);
    assert.deepEqual(cambio.data.user.roles, ['org_admin']);
    // En B no es gestora: el edificio asignado en A no viaja al otro contexto
    assert.equal(cambio.data.user.edificiosAsignados, undefined);

    // El refresh conserva la org elegida (no vuelve a la primera alfabética)
    const refrescada = await apiFetch(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: cambio.data.refreshToken },
    });
    assert.equal(refrescada.status, 200);
    // /refresh solo devuelve tokens: los claims se miran en el access token
    const claims = claimsDe(refrescada.data.accessToken);
    assert.equal(claims.org_id, orgBId);
    assert.deepEqual(claims.roles, ['org_admin']);
    refreshTokensAbiertos.push(refrescada.data.refreshToken);

    const { data: orgActual } = await apiFetch(baseUrl, '/api/organizaciones/me', {
      token: refrescada.data.accessToken,
    });
    assert.equal(orgActual.id, orgBId);
  });

  it('cambiar a una organización real donde no hay membresía devuelve 403 SIN_MEMBRESIA', async () => {
    const { status, data } = await apiFetch(baseUrl, '/api/auth/cambiar-organizacion', {
      method: 'POST',
      token: adminB.accessToken, // org_admin solo de B
      body: { organizacionId: orgAId },
    });
    assert.equal(status, 403);
    assert.equal(data.error.code, 'SIN_MEMBRESIA');

    // Y el token viejo sigue operando en su propia org
    const { data: orgActual } = await apiFetch(baseUrl, '/api/organizaciones/me', {
      token: adminB.accessToken,
    });
    assert.equal(orgActual.id, orgBId);
  });

  // -------------------------------------------------------------------------
  // Aislamiento entre organizaciones
  // -------------------------------------------------------------------------

  it('org B no lista ni edita el staff de org A', async () => {
    const { status, data: staffB } = await apiFetch(baseUrl, RUTA_STAFF, {
      token: adminB.accessToken,
    });
    assert.equal(status, 200);
    assert.ok(!staffB.some((m) => m.email === 'admin@demo.com'));
    assert.ok(!staffB.some((m) => m.email === 'gestor@demo.com'));
    // La persona multi-org sí aparece, pero con su rol EN B
    assert.equal(staffB.find((m) => m.email === multiOrgEmail).rol, 'ORG_ADMIN');

    // PATCH sobre un usuario que no es miembro de B: no existe para B
    const patch = await apiFetch(baseUrl, `${RUTA_STAFF}/${admin.user.id}`, {
      method: 'PATCH',
      token: adminB.accessToken,
      body: { activo: false },
    });
    assert.equal(patch.status, 404);
    assert.equal(patch.data.error.code, 'USUARIO_NO_ENCONTRADO');

    const intacta = await prisma.organizacionUsuario.findUnique({
      where: {
        organizacionId_usuarioId: { organizacionId: orgAId, usuarioId: admin.user.id },
      },
    });
    assert.equal(intacta.activo, true);
    assert.equal(intacta.rol, 'ORG_ADMIN');
  });

  it('ninguna organización vincula residentes en UFs de la otra', async () => {
    const desdeB = await apiFetch(baseUrl, rutaResidentes(unidadA.id), {
      method: 'POST',
      token: adminB.accessToken,
      body: { email: nuevoEmail('intruso-b'), nombre: 'Intruso', esPropietario: true },
    });
    assert.equal(desdeB.status, 403);
    assert.equal(desdeB.data.error.code, 'FUERA_DE_ORGANIZACION');

    const desdeA = await apiFetch(baseUrl, rutaResidentes(unidadB1.id), {
      method: 'POST',
      token: admin.accessToken,
      body: { email: nuevoEmail('intruso-a'), nombre: 'Intruso', esPropietario: true },
    });
    assert.equal(desdeA.status, 403);
    assert.equal(desdeA.data.error.code, 'FUERA_DE_ORGANIZACION');

    // Tampoco se leen los vínculos de la otra org
    const listaCruzada = await apiFetch(baseUrl, rutaResidentes(unidadB1.id), {
      token: admin.accessToken,
    });
    assert.equal(listaCruzada.status, 403);

    // Los intentos fallidos no crearon ni el Usuario ni el vínculo
    const intrusos = emailsCreados.filter((e) => e.startsWith('intruso-'));
    assert.equal(intrusos.length, 2);
    assert.equal(await prisma.usuario.count({ where: { email: { in: intrusos } } }), 0);
  });

  // -------------------------------------------------------------------------
  // Residente multi-organización (el caso que define el slice)
  // -------------------------------------------------------------------------

  it('el mismo email en una UF de org A y otra de org B es UN solo Usuario con un login único', async () => {
    const email = nuevoEmail('residente-multi-org');

    const enA = await apiFetch(baseUrl, rutaResidentes(unidadA.id), {
      method: 'POST',
      token: admin.accessToken,
      body: { email, nombre: 'Resi', apellido: 'MultiOrg', esPropietario: true },
    });
    assert.equal(enA.status, 201);

    const enB = await apiFetch(baseUrl, rutaResidentes(unidadB1.id), {
      method: 'POST',
      token: adminB.accessToken,
      body: { email: email.toUpperCase(), nombre: 'Resi', esInquilino: true },
    });
    assert.equal(enB.status, 201);
    assert.equal(enB.data.usuario.id, enA.data.usuario.id);

    // Assert directo contra la DB: identidad global, un registro y dos vínculos
    const enDb = await prisma.usuario.findMany({
      where: { email },
      include: { unidades: { where: { fechaFin: null } }, organizaciones: true },
    });
    assert.equal(enDb.length, 1);
    residenteMultiOrgId = enDb[0].id;
    assert.deepEqual(
      enDb[0].unidades.map((v) => v.organizacionId).sort(),
      [orgAId, orgBId].sort()
    );
    // Residente puro: ninguna membresía de staff
    assert.deepEqual(enDb[0].organizaciones, []);

    // Activa por el link de A y entra una sola vez con los roles de ambas UFs
    const activacion = await aceptarInvitacion(enA.data.invitacionUrl, 'residente1234');
    assert.equal(activacion.status, 200);
    assert.equal(activacion.data.user.id, residenteMultiOrgId);
    assert.equal(activacion.data.user.organizacionId, null); // sin org activa (§5.5)
    assert.deepEqual(activacion.data.user.roles.sort(), ['inquilino', 'propietario']);
    refreshTokensAbiertos.push(activacion.data.refreshToken);

    const sesion = await login(baseUrl, email, 'residente1234');
    assert.equal(sesion.status, 200);
    assert.deepEqual(sesion.data.user.roles.sort(), ['inquilino', 'propietario']);
    residenteMultiOrgEmail = email;
    refreshTokensAbiertos.push(sesion.data.refreshToken);
  });

  it('desvincular al residente en una org deja fechaFin y no toca su vínculo en la otra', async () => {
    const vinculoB = await prisma.unidadUsuario.findFirst({
      where: { usuarioId: residenteMultiOrgId, organizacionId: orgBId },
      select: { id: true },
    });

    const baja = await apiFetch(baseUrl, rutaResidentes(unidadB1.id, `/${vinculoB.id}`), {
      method: 'DELETE',
      token: adminB.accessToken,
    });
    assert.equal(baja.status, 200);

    // Baja lógica: el vínculo sigue existiendo con fechaFin
    const enDb = await prisma.unidadUsuario.findUnique({ where: { id: vinculoB.id } });
    assert.ok(enDb, 'el vínculo no se borra físicamente');
    assert.ok(enDb.fechaFin instanceof Date);

    // El vínculo de la org A sigue vigente y el login conserva ese rol
    const vigentes = await prisma.unidadUsuario.findMany({
      where: { usuarioId: residenteMultiOrgId, fechaFin: null },
      select: { organizacionId: true },
    });
    assert.deepEqual(
      vigentes.map((v) => v.organizacionId),
      [orgAId]
    );

    const sesion = await login(baseUrl, residenteMultiOrgEmail, 'residente1234');
    assert.equal(sesion.status, 200);
    assert.deepEqual(sesion.data.user.roles, ['propietario']); // ya no es inquilino en B
    refreshTokensAbiertos.push(sesion.data.refreshToken);
  });

  // -------------------------------------------------------------------------
  // Scope del gestor dentro de su organización
  // -------------------------------------------------------------------------

  it('un gestor invitado a org B solo vincula residentes en su edificio asignado', async () => {
    const email = nuevoEmail('gestor-org-b');
    const alta = await apiFetch(baseUrl, RUTA_STAFF, {
      method: 'POST',
      token: adminB.accessToken,
      body: {
        email,
        nombre: 'Gestora',
        apellido: 'B Uno',
        rol: 'GESTOR',
        edificioIds: [edificioB1.id],
      },
    });
    assert.equal(alta.status, 201);

    const activacion = await aceptarInvitacion(alta.data.invitacionUrl, 'gestorab1234');
    assert.equal(activacion.status, 200);
    assert.deepEqual(activacion.data.user.roles, ['gestor']);
    assert.deepEqual(activacion.data.user.edificiosAsignados, [edificioB1.id]);
    refreshTokensAbiertos.push(activacion.data.refreshToken);
    const tokenGestor = activacion.data.accessToken;

    // Edificio NO asignado (misma org): 403
    const noAsignado = await apiFetch(baseUrl, rutaResidentes(unidadB2.id), {
      method: 'POST',
      token: tokenGestor,
      body: { email: nuevoEmail('resi-no-asignado'), nombre: 'No', esPropietario: true },
    });
    assert.equal(noAsignado.status, 403);
    assert.equal(noAsignado.data.error.code, 'EDIFICIO_NO_ASIGNADO');
    assert.equal(await prisma.unidadUsuario.count({ where: { unidadId: unidadB2.id } }), 0);

    // Edificio asignado: 201
    const asignado = await apiFetch(baseUrl, rutaResidentes(unidadB1.id), {
      method: 'POST',
      token: tokenGestor,
      body: { email: nuevoEmail('resi-asignado'), nombre: 'Sí', esPropietario: true },
    });
    assert.equal(asignado.status, 201);
    assert.equal(asignado.data.vinculo.vigente, true);

    // Y no se escapa a la org A ni con su token de gestor
    const cruzado = await apiFetch(baseUrl, rutaResidentes(unidadA.id), {
      method: 'POST',
      token: tokenGestor,
      body: { email: nuevoEmail('resi-cruzado'), nombre: 'No', esPropietario: true },
    });
    assert.equal(cruzado.status, 403);
  });

  // -------------------------------------------------------------------------
  // Guard del último org_admin (por organización, no por persona)
  // -------------------------------------------------------------------------

  it('ULTIMO_ORG_ADMIN cuenta por organización y no afecta las otras membresías', async () => {
    const adminC = await registrarOrganizacion('admin-org-c', 'Zeta Slice C');
    const orgCId = adminC.user.organizacionId;

    // La persona multi-org suma una tercera membresía, como org_admin de C
    const alta = await apiFetch(baseUrl, RUTA_STAFF, {
      method: 'POST',
      token: adminC.accessToken,
      body: { email: multiOrgEmail, nombre: 'Multi', rol: 'ORG_ADMIN' },
    });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.usuario.id, multiOrgId);

    // Con dos org_admin activos, desactivar a uno se puede
    const primera = await apiFetch(baseUrl, `${RUTA_STAFF}/${adminC.user.id}`, {
      method: 'PATCH',
      token: adminC.accessToken,
      body: { activo: false },
    });
    assert.equal(primera.status, 200);
    assert.equal(primera.data.activo, false);

    // Ahora la multi-org es la última admin de C: no se la puede desactivar
    const { data: sesionMulti } = await login(baseUrl, multiOrgEmail, PASSWORD_MULTI);
    refreshTokensAbiertos.push(sesionMulti.refreshToken);
    const cambio = await apiFetch(baseUrl, '/api/auth/cambiar-organizacion', {
      method: 'POST',
      token: sesionMulti.accessToken,
      body: { organizacionId: orgCId, refreshToken: sesionMulti.refreshToken },
    });
    assert.equal(cambio.status, 200);
    refreshTokensAbiertos.push(cambio.data.refreshToken);

    const ultima = await apiFetch(baseUrl, `${RUTA_STAFF}/${multiOrgId}`, {
      method: 'PATCH',
      token: cambio.data.accessToken,
      body: { activo: false },
    });
    assert.equal(ultima.status, 422);
    assert.equal(ultima.data.error.code, 'ULTIMO_ORG_ADMIN');

    // Sus membresías en A y B siguen intactas (el guard es por organización)
    const otras = await prisma.organizacionUsuario.findMany({
      where: { usuarioId: multiOrgId, organizacionId: { in: [orgAId, orgBId] } },
      select: { organizacionId: true, activo: true },
    });
    assert.equal(otras.length, 2);
    assert.ok(otras.every((m) => m.activo));
  });
});
