// tests/me.test.js — Contexto propio del usuario (S4-12, issue #58)
// Contrato: PRD-04-11 §5.5 y §6 (`GET /api/me/unidades`).
//
// Es el único camino de lectura del residente puro: no tiene organización
// activa, así que /api/edificios (que pasa por `tenant`) le responde 403. Lo
// que se prueba acá es el scope: el residente ve SUS vínculos vigentes y nada
// más — ni otras UFs del mismo edificio, ni otros edificios de la misma
// organización, ni los vínculos que ya fueron dados de baja.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  levantarApp,
  cerrarApp,
  apiFetch,
  login,
  prisma,
  borrarOrgDePrueba,
} from './helpers.js';

const RUTA = '/api/me/unidades';

describe('GET /api/me/unidades — vínculos del usuario logueado (S4-12)', () => {
  let server;
  let baseUrl;

  // Organización propia del test: dos edificios, tres UFs. El residente queda
  // vinculado a una sola → todo lo demás tiene que quedar afuera.
  let orgId;
  let edificioUno;
  let edificioDos;
  let unidadMia; // UF del residente (edificio uno)
  let unidadVecina; // otra UF del MISMO edificio
  let unidadOtroEdificio; // UF de otro edificio de la MISMA org

  let residente; // sesión del residente puro
  const PASSWORD = 'residente1234';
  const emailsCreados = [];
  const refreshTokensAbiertos = [];

  const sufijo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function crearEdificio(nombre) {
    return prisma.edificio.create({
      data: {
        organizacionId: orgId,
        nombre: `${nombre} ${sufijo()}`,
        direccion: `${nombre} 100`,
        ciudad: 'CABA',
        provincia: 'Buenos Aires',
        codigoPostal: 'C1425BGW',
        totalM2: 500,
        amenities: [],
      },
    });
  }

  const crearUnidad = (edificioId, numero) =>
    prisma.unidad.create({
      data: {
        organizacionId: orgId,
        edificioId,
        numero,
        tipo: 'departamento',
        m2: 50,
        coeficiente: 0.5,
      },
    });

  before(async () => {
    ({ server, baseUrl } = await levantarApp());

    // Org de prueba con su org_admin (el alta de residentes es de staff).
    const emailAdmin = `me-admin-${sufijo()}@test.dev`;
    emailsCreados.push(emailAdmin);
    const { status, data: adminSesion } = await apiFetch(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: emailAdmin,
        password: 'password1234',
        nombre: 'Admin',
        apellido: 'Me',
        organizacion: {
          nombre: `Administración Me ${sufijo()}`,
          cuit: `30-${sufijo().slice(-8)}-${Math.floor(Math.random() * 10)}`,
          matriculaRPA: 'RPA-4711',
        },
      },
    });
    assert.equal(status, 201, 'no se pudo registrar la organización de prueba');
    orgId = adminSesion.user.organizacionId;
    refreshTokensAbiertos.push(adminSesion.refreshToken);

    edificioUno = await crearEdificio('Edificio Me Uno');
    edificioDos = await crearEdificio('Edificio Me Dos');
    unidadMia = await crearUnidad(edificioUno.id, '6');
    unidadVecina = await crearUnidad(edificioUno.id, '7');
    unidadOtroEdificio = await crearUnidad(edificioDos.id, '1A');

    // Flujo real del issue: se invita como INQUILINO desde el drawer de la UF
    // y la persona activa su cuenta con el link.
    const emailResidente = `me-inquilino-${sufijo()}@test.dev`;
    emailsCreados.push(emailResidente);
    const alta = await apiFetch(baseUrl, `/api/unidades/${unidadMia.id}/residentes`, {
      method: 'POST',
      token: adminSesion.accessToken,
      body: {
        email: emailResidente,
        nombre: 'Juan',
        apellido: 'Inquilino',
        esPropietario: false,
        esInquilino: true,
      },
    });
    assert.equal(alta.status, 201, 'no se pudo vincular al residente');

    const token = alta.data.invitacionUrl.split('/').pop();
    const aceptada = await apiFetch(baseUrl, `/api/invitaciones/${token}/aceptar`, {
      method: 'POST',
      body: { password: PASSWORD },
    });
    assert.equal(aceptada.status, 200, 'la activación del residente falló');
    residente = aceptada.data;
    refreshTokensAbiertos.push(residente.refreshToken);
  });

  after(async () => {
    for (const refreshToken of refreshTokensAbiertos) {
      await apiFetch(baseUrl, '/api/auth/logout', { method: 'POST', body: { refreshToken } });
    }
    await prisma.invitacion.deleteMany({ where: { organizacionId: orgId } });
    await prisma.unidadUsuario.deleteMany({ where: { organizacionId: orgId } });
    await prisma.unidad.deleteMany({ where: { organizacionId: orgId } });
    await prisma.edificio.deleteMany({ where: { organizacionId: orgId } });
    await borrarOrgDePrueba(orgId);
    await prisma.usuario.deleteMany({ where: { email: { in: emailsCreados } } });
    await cerrarApp(server);
  });

  it('sin token responde 401', async () => {
    const { status, data } = await apiFetch(baseUrl, RUTA);
    assert.equal(status, 401);
    assert.equal(data.error.code, 'TOKEN_AUSENTE');
  });

  it('la activación del residente deja la cuenta activada (BUG 1, #58)', async () => {
    // El estado que muestra el drawer ("Todavía no activó su cuenta") sale de
    // `cuentaActivada` = passwordHash != null. Tras aceptar tiene que ser true.
    const vinculos = await apiFetch(
      baseUrl,
      `/api/unidades/${unidadMia.id}/residentes`,
      { token: (await login(baseUrl, emailsCreados[0], 'password1234')).data.accessToken }
    );
    assert.equal(vinculos.status, 200);
    const mio = vinculos.data.find((v) => v.usuario.email === emailsCreados[1]);
    assert.ok(mio, 'el vínculo del residente tiene que figurar en la UF');
    assert.equal(mio.usuario.cuentaActivada, true);
    assert.equal(mio.vigente, true);
  });

  it('el residente puro no tiene organización activa (por qué existe el endpoint)', async () => {
    assert.equal(residente.user.organizacionId, null);
    assert.deepEqual(residente.user.roles, ['inquilino']);

    const { status, data } = await apiFetch(baseUrl, '/api/edificios', {
      token: residente.accessToken,
    });
    assert.equal(status, 403);
    assert.equal(data.error.code, 'SIN_ORGANIZACION_ACTIVA');
  });

  it('devuelve su UF con edificio y organización', async () => {
    const { status, data } = await apiFetch(baseUrl, RUTA, { token: residente.accessToken });
    assert.equal(status, 200);
    assert.equal(data.length, 1);

    const [vinculo] = data;
    assert.equal(vinculo.esInquilino, true);
    assert.equal(vinculo.esPropietario, false);
    assert.equal(vinculo.unidad.id, unidadMia.id);
    assert.equal(vinculo.unidad.numero, '6');
    assert.equal(vinculo.edificio.id, edificioUno.id);
    assert.equal(vinculo.edificio.nombre, edificioUno.nombre);
    assert.equal(vinculo.organizacion.id, orgId);
    assert.ok(vinculo.organizacion.nombre, 'tiene que traer el nombre de la administración');
  });

  it('no ve otras UFs de su edificio ni otros edificios de la misma organización', async () => {
    const { data } = await apiFetch(baseUrl, RUTA, { token: residente.accessToken });
    const unidades = data.map((v) => v.unidad.id);
    assert.ok(!unidades.includes(unidadVecina.id), 'no puede ver la UF vecina');
    assert.ok(!unidades.includes(unidadOtroEdificio.id), 'no puede ver otro edificio de la org');
    assert.deepEqual([...new Set(data.map((v) => v.edificio.id))], [edificioUno.id]);
  });

  it('un staff sin UFs a su nombre recibe una lista vacía', async () => {
    const { data: sesion } = await login(baseUrl, emailsCreados[0], 'password1234');
    const { status, data } = await apiFetch(baseUrl, RUTA, { token: sesion.accessToken });
    assert.equal(status, 200);
    assert.deepEqual(data, []);
  });

  it('el residente multi-consorcio del seed ve sus UFs de las dos organizaciones', async () => {
    const { data: sesion } = await login(baseUrl, 'multiconsorcio@demo.com', 'demo1234');
    const { status, data } = await apiFetch(baseUrl, RUTA, { token: sesion.accessToken });
    assert.equal(status, 200);
    assert.equal(data.length, 2, 'el seed lo hace propietario en Org A y Org B');
    assert.equal(new Set(data.map((v) => v.organizacion.id)).size, 2);
    assert.ok(data.every((v) => v.esPropietario));
    await apiFetch(baseUrl, '/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: sesion.refreshToken },
    });
  });

  it('un vínculo dado de baja deja de figurar', async () => {
    const vinculo = await prisma.unidadUsuario.findFirst({
      where: { unidadId: unidadMia.id },
    });
    await prisma.unidadUsuario.update({
      where: { id: vinculo.id },
      data: { fechaFin: new Date() },
    });

    const { status, data } = await apiFetch(baseUrl, RUTA, { token: residente.accessToken });
    assert.equal(status, 200);
    assert.deepEqual(data, []);

    await prisma.unidadUsuario.update({ where: { id: vinculo.id }, data: { fechaFin: null } });
  });

  it('un edificio dado de baja deja de figurar', async () => {
    await prisma.edificio.update({ where: { id: edificioUno.id }, data: { activo: false } });

    const { status, data } = await apiFetch(baseUrl, RUTA, { token: residente.accessToken });
    assert.equal(status, 200);
    assert.deepEqual(data, []);

    await prisma.edificio.update({ where: { id: edificioUno.id }, data: { activo: true } });
  });
});
