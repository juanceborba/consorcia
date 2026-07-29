// tests/rubros.test.js — Árbol de rubros: merge maestro + propios (S3-13)
// Spec: PRD-04-02 §1.4 · policy cerbos/policies/rubro.yaml
//
// Corre contra el stack dockerizado con el seed S1-03/S4-10 + el maestro de
// plataforma que siembra `prisma/rubros-maestro.js`. Principales: `admin@demo.com`
// (org_admin Org A), `gestor@demo.com` (gestor Org A) y `admin.sur@demo.com`
// (org_admin Org B, para el aislamiento).
//
// Nada de lo que crea sobrevive al after(): la DB de desarrollo es compartida
// con el smoke y los specs E2E. Los overrides de visibilidad se limpian
// explícitamente porque son filas de la ORGANIZACIÓN DEMO (no de una org de
// prueba desechable) y dejarlos ocultaría rubros del maestro para siempre.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';
import { RUBROS_MAESTRO } from '../prisma/rubros-maestro.js';

const SUFIJO = randomUUID().slice(0, 8);

describe('rubros (S3-13)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let adminSur;
  let orgA;
  let orgB;
  let maestroLimpieza; // rubro nivel 1 del maestro, para colgar/ocultar

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));
    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;

    maestroLimpieza = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: null, nombre: 'Limpieza' },
    });
    assert.ok(maestroLimpieza, 'el seed del maestro (S3-13) tiene que estar corrido: make db-seed');
  });

  after(async () => {
    // Overrides de visibilidad de las dos orgs demo (los crean los tests).
    await prisma.rubroVisibilidad.deleteMany({
      where: { organizacionId: { in: [orgA, orgB] } },
    });
    // Rubros de prueba: subrubros primero (FK parent_id).
    await prisma.rubro.deleteMany({
      where: { nombre: { contains: SUFIJO }, parentId: { not: null } },
    });
    await prisma.rubro.deleteMany({ where: { nombre: { contains: SUFIJO } } });
    for (const sesion of [admin, gestor, adminSur]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  const arbol = (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(baseUrl, `/api/rubros${qs ? `?${qs}` : ''}`, { token });
  };

  const crear = (token, body) =>
    apiFetch(baseUrl, '/api/rubros', { method: 'POST', body, token });

  const visibilidad = (token, id, visible) =>
    apiFetch(baseUrl, `/api/rubros/${id}/visibilidad`, {
      method: 'PUT',
      body: { visible },
      token,
    });

  const buscar = (data, nombre) => data.find((r) => r.nombre === nombre);

  // ─── Maestro sembrado ───

  it('el maestro trae los 10 rubros del PRD con sus subrubros', async () => {
    const { status, data } = await arbol(admin.accessToken);
    assert.equal(status, 200);

    for (const esperado of RUBROS_MAESTRO) {
      const nodo = buscar(data.data, esperado.nombre);
      assert.ok(nodo, `falta el rubro maestro "${esperado.nombre}"`);
      assert.equal(nodo.esMaestro, true);
      assert.equal(nodo.visible, true);
      const nombres = nodo.subrubros.map((s) => s.nombre);
      for (const sub of esperado.subrubros) {
        assert.ok(nombres.includes(sub), `falta el subrubro "${sub}" en "${esperado.nombre}"`);
      }
    }
    // Comodín: el gasto exige rubro obligatorio, siempre tiene que haber hoja.
    assert.ok(buscar(data.data, 'Otros').subrubros.some((s) => s.nombre === 'Varios'));
  });

  it('el árbol está ordenado por `orden` y solo tiene 2 niveles', async () => {
    const { data } = await arbol(admin.accessToken);
    const ordenes = data.data.map((r) => r.orden);
    assert.deepEqual(ordenes, [...ordenes].sort((a, b) => a - b));
    for (const raiz of data.data) {
      assert.equal(raiz.parentId, null);
      for (const hijo of raiz.subrubros) {
        assert.equal(hijo.parentId, raiz.id);
        assert.equal(hijo.subrubros.length, 0, 'el árbol es de 2 niveles fijos: no hay nietos');
      }
    }
  });

  // ─── Alta de propios ───

  it('el org_admin crea un rubro propio nivel 1 y lo edita', async () => {
    const alta = await crear(admin.accessToken, { nombre: `Fideicomiso ${SUFIJO}`, orden: 500 });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.esMaestro, false);
    assert.equal(alta.data.parentId, null);
    assert.equal(alta.data.activo, true);

    const { data } = await arbol(admin.accessToken);
    assert.ok(buscar(data.data, `Fideicomiso ${SUFIJO}`), 'el propio aparece en el árbol');

    const edicion = await apiFetch(baseUrl, `/api/rubros/${alta.data.id}`, {
      method: 'PUT',
      body: { nombre: `Fideicomiso editado ${SUFIJO}`, orden: 510 },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 200);
    assert.equal(edicion.data.nombre, `Fideicomiso editado ${SUFIJO}`);
    assert.equal(edicion.data.orden, 510);

    const baja = await apiFetch(baseUrl, `/api/rubros/${alta.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.eliminado, true);
  });

  it('un subrubro propio cuelga de un rubro MAESTRO y aparece mergeado', async () => {
    const alta = await crear(admin.accessToken, {
      nombre: `Lavado de tanques ${SUFIJO}`,
      parentId: maestroLimpieza.id,
      orden: 900,
    });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.parentId, maestroLimpieza.id);
    assert.equal(alta.data.esMaestro, false);

    const { data } = await arbol(admin.accessToken);
    const limpieza = buscar(data.data, 'Limpieza');
    const propio = buscar(limpieza.subrubros, `Lavado de tanques ${SUFIJO}`);
    assert.ok(propio, 'el subrubro propio cuelga del rubro maestro en el merge');
    assert.equal(propio.esMaestro, false);
    // Y los subrubros del maestro siguen ahí (es un merge, no un reemplazo).
    assert.ok(buscar(limpieza.subrubros, 'Control de plagas'));

    // Org B no lo ve: es un ítem propio de Org A colgado de un padre compartido.
    const deB = await arbol(adminSur.accessToken);
    const limpiezaB = buscar(deB.data.data, 'Limpieza');
    assert.ok(!buscar(limpiezaB.subrubros, `Lavado de tanques ${SUFIJO}`));
    assert.ok(buscar(limpiezaB.subrubros, 'Control de plagas'), 'pero sí ve el maestro');
  });

  it('rechaza colgar un subrubro de un subrubro (2 niveles fijos)', async () => {
    const { data } = await arbol(admin.accessToken);
    const nieto = buscar(data.data, 'Limpieza').subrubros.find((s) => s.esMaestro);

    const alta = await crear(admin.accessToken, {
      nombre: `Nieto ${SUFIJO}`,
      parentId: nieto.id,
    });
    assert.equal(alta.status, 422);
    assert.equal(alta.data.error.code, 'RUBRO_PADRE_INVALIDO');
  });

  it('rechaza un padre que no es visible para la organización', async () => {
    const deOtraOrg = await prisma.rubro.create({
      data: { organizacionId: orgB, nombre: `Padre ajeno ${SUFIJO}` },
    });
    const alta = await crear(admin.accessToken, {
      nombre: `Hijo imposible ${SUFIJO}`,
      parentId: deOtraOrg.id,
    });
    assert.equal(alta.status, 422);
    assert.equal(alta.data.error.code, 'RUBRO_PADRE_INVALIDO');
  });

  it('rechaza un nombre ya usado entre los hermanos visibles (incluido el maestro)', async () => {
    // Contra un rubro nivel 1 del maestro
    const contraMaestro = await crear(admin.accessToken, { nombre: 'Limpieza' });
    assert.equal(contraMaestro.status, 409);
    assert.equal(contraMaestro.data.error.code, 'RUBRO_DUPLICADO');

    // Contra un subrubro maestro del mismo padre
    const contraSubrubro = await crear(admin.accessToken, {
      nombre: 'Control de plagas',
      parentId: maestroLimpieza.id,
    });
    assert.equal(contraSubrubro.status, 409);

    // Contra un propio
    const primero = await crear(admin.accessToken, { nombre: `Único ${SUFIJO}` });
    assert.equal(primero.status, 201);
    const segundo = await crear(admin.accessToken, { nombre: `Único ${SUFIJO}` });
    assert.equal(segundo.status, 409);

    // El mismo nombre bajo OTRO padre sí se puede (la unicidad es entre hermanos).
    const bajoOtroPadre = await crear(admin.accessToken, {
      nombre: `Único ${SUFIJO}`,
      parentId: maestroLimpieza.id,
    });
    assert.equal(bajoOtroPadre.status, 201);
  });

  // ─── Visibilidad del maestro ───

  it('ocultar un rubro maestro lo saca del árbol junto con sus subrubros', async () => {
    const ascensores = buscar((await arbol(admin.accessToken)).data.data, 'Ascensores');
    assert.ok(ascensores);

    const off = await visibilidad(admin.accessToken, ascensores.id, false);
    assert.equal(off.status, 200);
    assert.equal(off.data.visible, false);

    const oculto = await arbol(admin.accessToken);
    assert.equal(buscar(oculto.data.data, 'Ascensores'), undefined);

    // Con ?incluirOcultos=1 reaparece marcado, con sus subrubros también en false
    // (ocultar un rubro oculta sus subrubros, PRD-04-02 §1.4).
    const conOcultos = await arbol(admin.accessToken, { incluirOcultos: 1 });
    const marcado = buscar(conOcultos.data.data, 'Ascensores');
    assert.ok(marcado);
    assert.equal(marcado.visible, false);
    assert.ok(marcado.subrubros.length > 0);
    assert.ok(marcado.subrubros.every((s) => s.visible === false));

    // Es un override POR ORGANIZACIÓN: org B sigue viéndolo.
    const deB = await arbol(adminSur.accessToken);
    assert.ok(buscar(deB.data.data, 'Ascensores'), 'ocultarlo en Org A no lo oculta en Org B');

    // Y se puede volver a mostrar (upsert del override).
    const on = await visibilidad(admin.accessToken, ascensores.id, true);
    assert.equal(on.status, 200);
    assert.ok(buscar((await arbol(admin.accessToken)).data.data, 'Ascensores'));
  });

  it('ocultar un solo subrubro maestro no toca a sus hermanos', async () => {
    const { data } = await arbol(admin.accessToken);
    const agua = buscar(buscar(data.data, 'Servicios públicos').subrubros, 'Agua');
    assert.ok(agua);

    assert.equal((await visibilidad(admin.accessToken, agua.id, false)).status, 200);

    const despues = buscar((await arbol(admin.accessToken)).data.data, 'Servicios públicos');
    assert.equal(buscar(despues.subrubros, 'Agua'), undefined);
    assert.ok(buscar(despues.subrubros, 'Gas'), 'el hermano sigue visible');
    assert.ok(despues.visible, 'y el padre también');
  });

  it('la visibilidad no aplica a un rubro propio (422)', async () => {
    const propio = await crear(admin.accessToken, { nombre: `Sin visibilidad ${SUFIJO}` });
    assert.equal(propio.status, 201);

    const res = await visibilidad(admin.accessToken, propio.data.id, false);
    assert.equal(res.status, 422);
    assert.equal(res.data.error.code, 'RUBRO_PROPIO_SIN_VISIBILIDAD');

    // El camino correcto para ocultar un propio es la baja lógica.
    const baja = await apiFetch(baseUrl, `/api/rubros/${propio.data.id}`, {
      method: 'PUT',
      body: { activo: false },
      token: admin.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.activo, false);
    assert.equal(
      buscar((await arbol(admin.accessToken)).data.data, `Sin visibilidad ${SUFIJO}`),
      undefined
    );
    const conOcultos = await arbol(admin.accessToken, { incluirOcultos: 1 });
    assert.ok(buscar(conOcultos.data.data, `Sin visibilidad ${SUFIJO}`));
  });

  // ─── Protección del maestro ───

  it('el maestro no se edita ni se borra desde la organización', async () => {
    const edicion = await apiFetch(baseUrl, `/api/rubros/${maestroLimpieza.id}`, {
      method: 'PUT',
      body: { nombre: `Secuestrado ${SUFIJO}` },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 403);
    assert.equal(edicion.data.error.code, 'RUBRO_MAESTRO_NO_EDITABLE');

    const baja = await apiFetch(baseUrl, `/api/rubros/${maestroLimpieza.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 403);
    assert.equal(baja.data.error.code, 'RUBRO_MAESTRO_NO_EDITABLE');

    const intacto = await prisma.rubro.findUnique({ where: { id: maestroLimpieza.id } });
    assert.equal(intacto.nombre, 'Limpieza');
  });

  // ─── Aislamiento entre organizaciones ───

  it('org B no ve ni toca los rubros propios de org A', async () => {
    const propioA = await crear(admin.accessToken, { nombre: `Exclusivo A ${SUFIJO}` });
    assert.equal(propioA.status, 201);

    const deB = await arbol(adminSur.accessToken, { incluirOcultos: 1 });
    assert.equal(buscar(deB.data.data, `Exclusivo A ${SUFIJO}`), undefined);

    // Por id responde 404 (no 403: el 403 confirmaría que existe).
    const edicion = await apiFetch(baseUrl, `/api/rubros/${propioA.data.id}`, {
      method: 'PUT',
      body: { nombre: 'Robado' },
      token: adminSur.accessToken,
    });
    assert.equal(edicion.status, 404);
    assert.equal(edicion.data.error.code, 'RUBRO_NO_ENCONTRADO');

    const baja = await apiFetch(baseUrl, `/api/rubros/${propioA.data.id}`, {
      method: 'DELETE',
      token: adminSur.accessToken,
    });
    assert.equal(baja.status, 404);
  });

  // ─── Permisos (Cerbos) ───

  it('el gestor lee el árbol pero no lo escribe', async () => {
    const lectura = await arbol(gestor.accessToken);
    assert.equal(lectura.status, 200);
    assert.ok(lectura.data.data.length > 0);

    const alta = await crear(gestor.accessToken, { nombre: `Gestor intruso ${SUFIJO}` });
    assert.equal(alta.status, 403);
    assert.equal(alta.data.error.code, 'ACCESO_DENEGADO');

    const toggle = await visibilidad(gestor.accessToken, maestroLimpieza.id, false);
    assert.equal(toggle.status, 403);
    assert.equal(toggle.data.error.code, 'ACCESO_DENEGADO');
  });

  it('el gestor no edita ni borra un rubro propio de su organización', async () => {
    const propio = await crear(admin.accessToken, { nombre: `Solo admin ${SUFIJO}` });
    assert.equal(propio.status, 201);

    const edicion = await apiFetch(baseUrl, `/api/rubros/${propio.data.id}`, {
      method: 'PUT',
      body: { nombre: `Tocado ${SUFIJO}` },
      token: gestor.accessToken,
    });
    assert.equal(edicion.status, 403);
    assert.equal(edicion.data.error.code, 'ACCESO_DENEGADO');

    const baja = await apiFetch(baseUrl, `/api/rubros/${propio.data.id}`, {
      method: 'DELETE',
      token: gestor.accessToken,
    });
    assert.equal(baja.status, 403);
  });

  it('sin token no hay árbol (401)', async () => {
    assert.equal((await arbol(undefined)).status, 401);
  });

  // ─── Borrado protegido ───

  it('un rubro propio con gastos se desactiva en vez de borrarse', async () => {
    const rubro = await crear(admin.accessToken, { nombre: `Con gastos ${SUFIJO}` });
    assert.equal(rubro.status, 201);

    const edificios = await apiFetch(baseUrl, '/api/edificios', { token: admin.accessToken });
    const edificioId = edificios.data.find((e) => e.nombre === 'Torre Palermo').id;
    const proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Proveedor rubro ${SUFIJO}` },
    });
    const gasto = await prisma.gasto.create({
      data: {
        organizacionId: orgA,
        edificioId,
        proveedorId: proveedor.id,
        rubroId: rubro.data.id,
        concepto: `Gasto de prueba ${SUFIJO}`,
        monto: '2500.00',
        categoria: 'A',
        fechaGasto: new Date('2026-07-01T00:00:00Z'),
        periodo: '2026-07',
        createdBy: admin.user.id,
      },
    });

    const baja = await apiFetch(baseUrl, `/api/rubros/${rubro.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.eliminado, false);
    assert.equal(baja.data.desactivado, true);
    assert.equal(baja.data.gastosAsociados, 1);

    const persistido = await prisma.rubro.findUnique({ where: { id: rubro.data.id } });
    assert.ok(persistido, 'la fila se conserva: el gasto histórico la referencia');
    assert.equal(persistido.activo, false);

    await prisma.gasto.delete({ where: { id: gasto.id } });
    await prisma.proveedor.delete({ where: { id: proveedor.id } });
  });

  it('un rubro propio con subrubros no se borra (409 RUBRO_CON_SUBRUBROS)', async () => {
    const padre = await crear(admin.accessToken, { nombre: `Padre ${SUFIJO}` });
    assert.equal(padre.status, 201);
    const hijo = await crear(admin.accessToken, {
      nombre: `Hijo ${SUFIJO}`,
      parentId: padre.data.id,
    });
    assert.equal(hijo.status, 201);

    const baja = await apiFetch(baseUrl, `/api/rubros/${padre.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 409);
    assert.equal(baja.data.error.code, 'RUBRO_CON_SUBRUBROS');

    // Borrando el hijo primero, el padre sí se va (y el hijo no quedó huérfano
    // ascendido a nivel 1, que es lo que haría el SET NULL de la FK).
    assert.equal(
      (await apiFetch(baseUrl, `/api/rubros/${hijo.data.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      })).status,
      200
    );
    assert.equal(
      (await apiFetch(baseUrl, `/api/rubros/${padre.data.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      })).status,
      200
    );
  });
});
