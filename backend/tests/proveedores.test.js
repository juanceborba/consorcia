// tests/proveedores.test.js — CRUD del directorio de proveedores (S3-12)
// Spec: PRD-04-02 §1.3 · policy cerbos/policies/proveedor.yaml
//
// Corre contra el stack dockerizado con el seed S1-03/S4-10: `admin@demo.com`
// (org_admin de Org A), `gestor@demo.com` (gestor de Org A) y
// `admin.sur@demo.com` (org_admin de Org B) son los tres principales que hacen
// falta para cubrir permisos + aislamiento entre organizaciones.
//
// Todo lo que crea lleva el sufijo aleatorio de la corrida y se limpia en
// after(): la DB de desarrollo es compartida con el smoke y los specs E2E.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

const SUFIJO = randomUUID().slice(0, 8);
// CUITs de prueba con el formato que exige el schema (30-12345678-9). Los 8
// dígitos del medio salen del sufijo hexadecimal convertido a decimal para que
// dos corridas simultáneas no choquen entre sí ni con el seed.
const base = parseInt(SUFIJO, 16) % 100000000;
const cuitPropio = `30-${String(base).padStart(8, '0')}-1`;
const cuitGlobal = `30-${String((base + 1) % 100000000).padStart(8, '0')}-2`;
const cuitLibre = `30-${String((base + 2) % 100000000).padStart(8, '0')}-3`;

describe('proveedores (S3-12)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let adminSur;
  let orgA;
  let orgB;
  let proveedorGlobal; // proveedor del catálogo global de plataforma
  let deOrgB; // proveedor propio de Org B (Org A no debe verlo)
  const creados = []; // ids de proveedores creados vía API, para el cleanup

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    // El catálogo global no se crea por API (decisión de S3-12: la API solo
    // crea propios), así que el fixture va con Prisma.
    proveedorGlobal = await prisma.proveedor.create({
      data: {
        organizacionId: null,
        razonSocial: `Ascensores Global ${SUFIJO}`,
        cuit: cuitGlobal,
      },
    });
    deOrgB = await prisma.proveedor.create({
      data: {
        organizacionId: orgB,
        razonSocial: `Plomería Sur ${SUFIJO}`,
      },
    });
  });

  after(async () => {
    await prisma.proveedor.deleteMany({
      where: {
        OR: [
          { id: { in: [proveedorGlobal.id, deOrgB.id, ...creados] } },
          { razonSocial: { contains: SUFIJO } },
        ],
      },
    });
    for (const sesion of [admin, gestor, adminSur]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  // Alta por API con cleanup registrado.
  async function crear(token, body) {
    const res = await apiFetch(baseUrl, '/api/proveedores', { method: 'POST', body, token });
    if (res.status === 201) creados.push(res.data.id);
    return res;
  }

  // `params` se serializa con URLSearchParams: los sufijos de prueba llevan
  // espacios y sin encodear el `q` viajaría partido.
  const listar = (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(baseUrl, `/api/proveedores${qs ? `?${qs}` : ''}`, { token });
  };

  // ─── CRUD feliz ───

  it('el org_admin crea, lee, edita y borra un proveedor propio', async () => {
    const alta = await crear(admin.accessToken, {
      razonSocial: `Limpieza Integral ${SUFIJO}`,
      cuit: cuitPropio,
      email: 'contacto@limpieza.test',
      telefono: '+54 11 4444-1000',
      direccion: 'Corrientes 1234',
      notas: 'Factura a 30 días',
    });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.organizacionId, orgA);
    assert.equal(alta.data.esGlobal, false);
    assert.equal(alta.data.activo, true);
    assert.equal(alta.data.cuit, cuitPropio);

    const detalle = await apiFetch(baseUrl, `/api/proveedores/${alta.data.id}`, {
      token: admin.accessToken,
    });
    assert.equal(detalle.status, 200);
    assert.equal(detalle.data.razonSocial, `Limpieza Integral ${SUFIJO}`);

    const edicion = await apiFetch(baseUrl, `/api/proveedores/${alta.data.id}`, {
      method: 'PUT',
      body: { telefono: '+54 11 4444-2000', notas: null },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 200);
    assert.equal(edicion.data.telefono, '+54 11 4444-2000');
    assert.equal(edicion.data.notas, null);

    // Sin gastos asociados → borrado físico
    const baja = await apiFetch(baseUrl, `/api/proveedores/${alta.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.deepEqual(
      { eliminado: baja.data.eliminado, desactivado: baja.data.desactivado },
      { eliminado: true, desactivado: false }
    );

    const post = await apiFetch(baseUrl, `/api/proveedores/${alta.data.id}`, {
      token: admin.accessToken,
    });
    assert.equal(post.status, 404);
    assert.equal(post.data.error.code, 'PROVEEDOR_NO_ENCONTRADO');
  });

  it('rechaza el alta con razón social corta o CUIT mal formado (422)', async () => {
    const corta = await crear(admin.accessToken, { razonSocial: 'X' });
    assert.equal(corta.status, 422);
    assert.equal(corta.data.error.code, 'VALIDACION_FALLIDA');

    const cuitMalo = await crear(admin.accessToken, {
      razonSocial: `Sin formato ${SUFIJO}`,
      cuit: '30123456789',
    });
    assert.equal(cuitMalo.status, 422);
    assert.match(cuitMalo.data.error.message, /CUIT/);
  });

  it('el CUIT es opcional (PRD-04-02 §1.3)', async () => {
    const alta = await crear(admin.accessToken, { razonSocial: `Plomero sin CUIT ${SUFIJO}` });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.cuit, null);
  });

  // ─── Dedup de CUIT ───

  it('dedup de CUIT dentro de la organización → 409 CUIT_DUPLICADO', async () => {
    const primera = await crear(admin.accessToken, {
      razonSocial: `Pinturería ${SUFIJO}`,
      cuit: cuitLibre,
    });
    assert.equal(primera.status, 201);

    const segunda = await crear(admin.accessToken, {
      razonSocial: `Pinturería bis ${SUFIJO}`,
      cuit: cuitLibre,
    });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.data.error.code, 'CUIT_DUPLICADO');

    // Otra organización sí puede usar ese CUIT (el dedup es por org).
    const enOrgB = await crear(adminSur.accessToken, {
      razonSocial: `Pinturería Sur ${SUFIJO}`,
      cuit: cuitLibre,
    });
    assert.equal(enOrgB.status, 201);
  });

  it('dedup contra el catálogo global → 409 CUIT_DUPLICADO', async () => {
    // Decisión de S3-12: el CUIT tampoco se repite contra un global, porque la
    // org elige sobre el directorio mergeado y vería dos filas iguales.
    const choque = await crear(admin.accessToken, {
      razonSocial: `Ascensores propio ${SUFIJO}`,
      cuit: cuitGlobal,
    });
    assert.equal(choque.status, 409);
    assert.equal(choque.data.error.code, 'CUIT_DUPLICADO');
  });

  // ─── Lista: merge global + propios, buscador, paginación ───

  it('la lista mergea globales y propios activos, con paginación', async () => {
    const propio = await crear(admin.accessToken, {
      razonSocial: `Vidriería ${SUFIJO}`,
    });
    assert.equal(propio.status, 201);

    const { status, data } = await listar(admin.accessToken, { limit: 100 });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.data));
    assert.equal(typeof data.pagination.total, 'number');
    assert.equal(data.pagination.page, 1);
    assert.equal(data.pagination.limit, 100);

    const ids = data.data.map((p) => p.id);
    assert.ok(ids.includes(proveedorGlobal.id), 'el global de plataforma aparece en el directorio');
    assert.ok(ids.includes(propio.data.id), 'el propio de la org aparece');
    assert.equal(data.data.find((p) => p.id === proveedorGlobal.id).esGlobal, true);
  });

  it('el buscador ?q= filtra por razón social y por CUIT', async () => {
    const porNombre = await listar(admin.accessToken, { q: `Ascensores Global ${SUFIJO}` });
    assert.equal(porNombre.status, 200);
    assert.equal(porNombre.data.data.length, 1);
    assert.equal(porNombre.data.data[0].id, proveedorGlobal.id);

    const porCuit = await listar(admin.accessToken, { q: cuitGlobal });
    assert.equal(porCuit.status, 200);
    assert.ok(porCuit.data.data.some((p) => p.id === proveedorGlobal.id));
  });

  it('org B no ve los proveedores propios de org A (y viceversa)', async () => {
    const propioA = await crear(admin.accessToken, { razonSocial: `Exclusivo A ${SUFIJO}` });
    assert.equal(propioA.status, 201);

    const listaB = await listar(adminSur.accessToken, { q: SUFIJO, limit: 100 });
    assert.equal(listaB.status, 200);
    const idsB = listaB.data.data.map((p) => p.id);
    assert.ok(!idsB.includes(propioA.data.id), 'org B no debe ver el propio de org A');
    assert.ok(idsB.includes(proveedorGlobal.id), 'pero sí ve el catálogo global');

    // Y el acceso directo por id responde 404, no 403 (no confirma que exista).
    const detalle = await apiFetch(baseUrl, `/api/proveedores/${propioA.data.id}`, {
      token: adminSur.accessToken,
    });
    assert.equal(detalle.status, 404);
    assert.equal(detalle.data.error.code, 'PROVEEDOR_NO_ENCONTRADO');

    // Simétrico: org A no ve el propio de org B.
    const detalleB = await apiFetch(baseUrl, `/api/proveedores/${deOrgB.id}`, {
      token: admin.accessToken,
    });
    assert.equal(detalleB.status, 404);
  });

  // ─── Permisos (Cerbos) ───

  it('el gestor lee el directorio pero no lo escribe', async () => {
    const lista = await listar(gestor.accessToken);
    assert.equal(lista.status, 200);

    const detalle = await apiFetch(baseUrl, `/api/proveedores/${proveedorGlobal.id}`, {
      token: gestor.accessToken,
    });
    assert.equal(detalle.status, 200);

    const alta = await crear(gestor.accessToken, { razonSocial: `Gestor intruso ${SUFIJO}` });
    assert.equal(alta.status, 403);
    assert.equal(alta.data.error.code, 'ACCESO_DENEGADO');
  });

  it('el gestor no edita ni borra un proveedor propio de su organización', async () => {
    const propio = await crear(admin.accessToken, { razonSocial: `Solo admin ${SUFIJO}` });
    assert.equal(propio.status, 201);

    const edicion = await apiFetch(baseUrl, `/api/proveedores/${propio.data.id}`, {
      method: 'PUT',
      body: { telefono: '+54 11 0000-0000' },
      token: gestor.accessToken,
    });
    assert.equal(edicion.status, 403);
    assert.equal(edicion.data.error.code, 'ACCESO_DENEGADO');

    const baja = await apiFetch(baseUrl, `/api/proveedores/${propio.data.id}`, {
      method: 'DELETE',
      token: gestor.accessToken,
    });
    assert.equal(baja.status, 403);
  });

  it('un proveedor global no se edita ni se borra desde la organización', async () => {
    const edicion = await apiFetch(baseUrl, `/api/proveedores/${proveedorGlobal.id}`, {
      method: 'PUT',
      body: { razonSocial: `Secuestrado ${SUFIJO}` },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 403);
    assert.equal(edicion.data.error.code, 'PROVEEDOR_GLOBAL_NO_EDITABLE');

    const baja = await apiFetch(baseUrl, `/api/proveedores/${proveedorGlobal.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 403);
    assert.equal(baja.data.error.code, 'PROVEEDOR_GLOBAL_NO_EDITABLE');

    const intacto = await prisma.proveedor.findUnique({ where: { id: proveedorGlobal.id } });
    assert.equal(intacto.razonSocial, `Ascensores Global ${SUFIJO}`);
  });

  // ─── Soft delete con gastos asociados ───

  it('un proveedor con gastos se desactiva en vez de borrarse', async () => {
    const proveedor = await crear(admin.accessToken, {
      razonSocial: `Con gastos ${SUFIJO}`,
    });
    assert.equal(proveedor.status, 201);

    // Un gasto necesita edificio y rubro; se arman con Prisma (el CRUD de
    // gastos es S3-02).
    const edificios = await apiFetch(baseUrl, '/api/edificios', { token: admin.accessToken });
    const edificioId = edificios.data.find((e) => e.nombre === 'Torre Palermo').id;
    const rubro = await prisma.rubro.create({
      data: { organizacionId: orgA, nombre: `Rubro gasto ${SUFIJO}` },
    });
    const gasto = await prisma.gasto.create({
      data: {
        organizacionId: orgA,
        edificioId,
        proveedorId: proveedor.data.id,
        rubroId: rubro.id,
        concepto: `Gasto de prueba ${SUFIJO}`,
        monto: '1000.00',
        categoria: 'A',
        fechaGasto: new Date('2026-07-01T00:00:00Z'),
        periodo: '2026-07',
        createdBy: admin.user.id,
      },
    });

    const baja = await apiFetch(baseUrl, `/api/proveedores/${proveedor.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 200);
    assert.equal(baja.data.eliminado, false);
    assert.equal(baja.data.desactivado, true);
    assert.equal(baja.data.gastosAsociados, 1);
    assert.equal(baja.data.proveedor.activo, false);

    // La fila sigue existiendo (el gasto histórico la referencia)...
    const persistido = await prisma.proveedor.findUnique({ where: { id: proveedor.data.id } });
    assert.ok(persistido);
    assert.equal(persistido.activo, false);

    // ...pero sale de la lista usable para cargar gastos.
    const lista = await listar(admin.accessToken, { q: `Con gastos ${SUFIJO}` });
    assert.equal(lista.data.data.length, 0);

    // Y reaparece con incluirInactivos=1 (la pantalla de administración lo
    // necesita para poder rehabilitarlo).
    const conInactivos = await listar(admin.accessToken, { q: `Con gastos ${SUFIJO}`, incluirInactivos: 1 });
    assert.equal(conInactivos.data.data.length, 1);
    assert.equal(conInactivos.data.data[0].activo, false);

    const rehabilitado = await apiFetch(baseUrl, `/api/proveedores/${proveedor.data.id}`, {
      method: 'PUT',
      body: { activo: true },
      token: admin.accessToken,
    });
    assert.equal(rehabilitado.status, 200);
    assert.equal(rehabilitado.data.activo, true);

    await prisma.gasto.delete({ where: { id: gasto.id } });
    await prisma.rubro.delete({ where: { id: rubro.id } });
  });

  // ─── Rubro habitual ───

  it('el rubro habitual tiene que ser visible para la organización (422)', async () => {
    const ajeno = await prisma.rubro.create({
      data: { organizacionId: orgB, nombre: `Rubro ajeno ${SUFIJO}` },
    });

    const alta = await crear(admin.accessToken, {
      razonSocial: `Con rubro ajeno ${SUFIJO}`,
      rubroHabitualId: ajeno.id,
    });
    assert.equal(alta.status, 422);
    assert.equal(alta.data.error.code, 'RUBRO_INVALIDO');

    const propio = await prisma.rubro.create({
      data: { organizacionId: orgA, nombre: `Rubro propio ${SUFIJO}` },
    });
    const ok = await crear(admin.accessToken, {
      razonSocial: `Con rubro propio ${SUFIJO}`,
      rubroHabitualId: propio.id,
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.rubroHabitualId, propio.id);

    // Limpieza: el proveedor referencia el rubro (FK SET NULL, pero mejor
    // ordenado) — se borra primero el proveedor.
    await prisma.proveedor.deleteMany({ where: { rubroHabitualId: { in: [propio.id] } } });
    await prisma.rubro.deleteMany({ where: { id: { in: [ajeno.id, propio.id] } } });
  });

  it('sin token no hay directorio (401)', async () => {
    const { status } = await listar(undefined);
    assert.equal(status, 401);
  });
});
