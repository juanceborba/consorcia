// tests/gastos.test.js — CRUD de gastos (S3-02)
// Spec: PRD-04-02 §1.1/§2 · policy cerbos/policies/gasto.yaml
//
// Corre contra el stack dockerizado con el seed S1-03/S4-10. Los tres
// principales que hacen falta: `admin@demo.com` (org_admin de Org A),
// `gestor@demo.com` (gestor de Org A, SOLO Torre Palermo) y `admin.sur@demo.com`
// (org_admin de Org B) para el aislamiento entre organizaciones.
//
// Los fixtures se descubren del seed (edificios por nombre, rubros del maestro)
// y todo lo creado lleva el sufijo de la corrida: la DB de desarrollo es
// compartida con el smoke y los specs E2E.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { levantarApp, cerrarApp, apiFetch, login, prisma } from './helpers.js';

const SUFIJO = randomUUID().slice(0, 8);
// Períodos fuera del rango en que trabajan el smoke y el seed, para no chocar
// con el índice único parcial de liquidaciones ni con los filtros de otros tests.
const PERIODO = '2019-03';
const PERIODO_ALT = '2019-04';
const PERIODO_LIQUIDADO = '2019-05';
const PERIODO_BORRADOR = '2019-06';

describe('gastos (S3-02)', () => {
  let server;
  let baseUrl;
  let admin;
  let gestor;
  let adminSur;
  let orgA;
  let orgB;
  let torre; // Torre Palermo — asignada al gestor
  let sanMartin; // Edificio San Martín — de Org A, NO asignado al gestor
  let lomas; // Edificio Lomas — de Org B
  let proveedor; // propio de Org A, activo
  let proveedorInactivo;
  let proveedorDeOrgB;
  let rubroHoja; // subrubro del maestro
  let rubroHojaAlt; // otra hoja del maestro (filtro por rubro)
  let rubroNivel1; // rubro del maestro CON hijos → no es hoja
  const gastosCreados = []; // ids para el cleanup (el DELETE de la API es soft)

  before(async () => {
    ({ server, baseUrl } = await levantarApp());
    ({ data: admin } = await login(baseUrl, 'admin@demo.com', 'demo1234'));
    ({ data: gestor } = await login(baseUrl, 'gestor@demo.com', 'demo1234'));
    ({ data: adminSur } = await login(baseUrl, 'admin.sur@demo.com', 'demo1234'));

    orgA = admin.user.organizacionId;
    orgB = adminSur.user.organizacionId;
    assert.ok(orgA && orgB && orgA !== orgB, 'el seed debe dar dos organizaciones distintas');

    const buscarEdificio = (organizacionId, nombre) =>
      prisma.edificio.findFirst({ where: { organizacionId, nombre }, select: { id: true } });

    torre = await buscarEdificio(orgA, 'Torre Palermo');
    sanMartin = await buscarEdificio(orgA, 'Edificio San Martín');
    lomas = await buscarEdificio(orgB, 'Edificio Lomas');
    assert.ok(torre && sanMartin && lomas, 'el seed debe traer los tres edificios');
    assert.ok(
      gestor.user.edificiosAsignados.includes(torre.id) &&
        !gestor.user.edificiosAsignados.includes(sanMartin.id),
      'gestor@demo.com debe tener asignada solo Torre Palermo'
    );

    // Rubros del maestro (seed S3-13): uno nivel 1 con hijos (no hoja) y una hoja.
    rubroNivel1 = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: null, activo: true, hijos: { some: {} } },
      select: { id: true },
    });
    rubroHoja = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: rubroNivel1.id, activo: true },
      select: { id: true },
    });
    // Segunda hoja del maestro (cualquier padre) para el filtro por rubro.
    rubroHojaAlt = await prisma.rubro.findFirst({
      where: {
        organizacionId: null,
        parentId: { not: null },
        activo: true,
        id: { not: rubroHoja?.id },
      },
      select: { id: true },
    });
    assert.ok(rubroNivel1 && rubroHoja && rubroHojaAlt, 'el maestro de rubros debe estar seedeado');

    proveedor = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Mantenimiento ${SUFIJO}` },
    });
    proveedorInactivo = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `De baja ${SUFIJO}`, activo: false },
    });
    proveedorDeOrgB = await prisma.proveedor.create({
      data: { organizacionId: orgB, razonSocial: `Sur ${SUFIJO}` },
    });
  });

  after(async () => {
    // Los detalles de liquidación referencian gastos: se borran primero.
    const liquidaciones = await prisma.liquidacion.findMany({
      where: { periodo: { in: [PERIODO, PERIODO_ALT, PERIODO_LIQUIDADO, PERIODO_BORRADOR] } },
      select: { id: true },
    });
    const ids = liquidaciones.map((l) => l.id);
    await prisma.liquidacionDetalle.deleteMany({ where: { liquidacionId: { in: ids } } });
    await prisma.liquidacion.deleteMany({ where: { id: { in: ids } } });

    await prisma.gasto.deleteMany({
      where: {
        OR: [{ id: { in: gastosCreados } }, { concepto: { contains: SUFIJO } }],
      },
    });
    await prisma.proveedor.deleteMany({ where: { razonSocial: { contains: SUFIJO } } });
    await prisma.rubro.deleteMany({ where: { nombre: { contains: SUFIJO } } });

    for (const sesion of [admin, gestor, adminSur]) {
      await apiFetch(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: sesion.refreshToken },
      });
    }
    await cerrarApp(server);
  });

  // ─── Helpers ───

  const gastoBase = (extra = {}) => ({
    proveedorId: proveedor.id,
    rubroId: rubroHoja.id,
    concepto: `Reparación ${SUFIJO}`,
    monto: '1500.50',
    categoria: 'A',
    fechaGasto: '2019-03-15',
    periodo: PERIODO,
    ...extra,
  });

  async function crear(token, edificioId, body) {
    const res = await apiFetch(baseUrl, `/api/edificios/${edificioId}/gastos`, {
      method: 'POST',
      body,
      token,
    });
    if (res.status === 201) gastosCreados.push(res.data.id);
    return res;
  }

  const listar = (token, edificioId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(baseUrl, `/api/edificios/${edificioId}/gastos${qs ? `?${qs}` : ''}`, { token });
  };

  // Estado mínimo para probar el congelado: una liquidación APROBADA con un
  // detalle que referencia al gasto.
  async function liquidar(gastoId, estado, periodo) {
    const unidad = await prisma.unidad.findFirst({
      where: { organizacionId: orgA, edificioId: torre.id },
      select: { id: true },
    });
    const liquidacion = await prisma.liquidacion.create({
      data: {
        organizacionId: orgA,
        edificioId: torre.id,
        periodo,
        fechaLiquidacion: new Date(`${periodo}-28`),
        estado,
        totalOrdinarias: '100.00',
        totalExtraordinarias: '0.00',
        totalGeneral: '100.00',
        matriculaRPA: `RPA-${SUFIJO}`,
      },
    });
    await prisma.liquidacionDetalle.create({
      data: {
        organizacionId: orgA,
        liquidacionId: liquidacion.id,
        unidadId: unidad.id,
        gastoId,
        coeficienteAplicado: '1.000000',
        montoAsignado: '100.00',
      },
    });
    return liquidacion;
  }

  // ─── CRUD feliz ───

  it('el org_admin crea, lee, edita y da de baja un gasto', async () => {
    const alta = await crear(admin.accessToken, torre.id, gastoBase());
    assert.equal(alta.status, 201);
    assert.equal(alta.data.organizacionId, orgA);
    assert.equal(alta.data.edificioId, torre.id);
    // Decisión 6: el monto sale como string, nunca como float.
    assert.equal(alta.data.monto, '1500.50');
    assert.equal(alta.data.moneda, 'ARS');
    assert.equal(alta.data.esOrdinario, true);
    assert.equal(alta.data.createdBy, admin.user.id);
    assert.equal(alta.data.proveedor.razonSocial, `Mantenimiento ${SUFIJO}`);
    assert.ok(alta.data.rubro.nombre);

    const detalle = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      token: admin.accessToken,
    });
    assert.equal(detalle.status, 200);
    assert.deepEqual(detalle.data.liquidaciones, []);
    assert.equal(detalle.data.editable, true);

    const edicion = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { monto: 2000, descripcion: 'Cambio de bomba', esOrdinario: false },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 200);
    assert.equal(edicion.data.monto, '2000.00');
    assert.equal(edicion.data.descripcion, 'Cambio de bomba');
    assert.equal(edicion.data.esOrdinario, false);
    // Lo que no se manda no se toca (el PUT es parcial).
    assert.equal(edicion.data.categoria, 'A');

    const baja = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 204);

    // Soft delete: la API ya no lo ve, la fila sigue en la DB con deletedAt.
    const post = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      token: admin.accessToken,
    });
    assert.equal(post.status, 404);
    assert.equal(post.data.error.code, 'GASTO_NO_ENCONTRADO');

    const enDb = await prisma.gasto.findUnique({ where: { id: alta.data.id } });
    assert.ok(enDb, 'el soft delete conserva el registro (Ley 941)');
    assert.ok(enDb.deletedAt instanceof Date);

    const lista = await listar(admin.accessToken, torre.id, { periodo: PERIODO });
    assert.equal(lista.status, 200);
    assert.ok(
      !lista.data.data.some((g) => g.id === alta.data.id),
      'el gasto dado de baja no se lista'
    );
  });

  it('acepta un gasto B con servicio y uno C con sector', async () => {
    const b = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ categoria: 'B', servicioEspecifico: 'ascensor', concepto: `Ascensor ${SUFIJO}` })
    );
    assert.equal(b.status, 201);
    assert.equal(b.data.servicioEspecifico, 'ascensor');
    assert.equal(b.data.sectorEspecifico, null);

    const c = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ categoria: 'C', sectorEspecifico: 'torre_a', concepto: `Pileta ${SUFIJO}` })
    );
    assert.equal(c.status, 201);
    assert.equal(c.data.sectorEspecifico, 'torre_a');
  });

  // ─── Validaciones Zod (PRD-04-02 §1.1) ───

  it('rechaza los gastos que no cumplen el schema', async () => {
    const casos = [
      ['categoría B sin servicio', { categoria: 'B' }],
      ['categoría C sin sector', { categoria: 'C' }],
      ['categoría A con servicio', { servicioEspecifico: 'ascensor' }],
      ['fecha futura', { fechaGasto: '2099-01-01' }],
      ['concepto corto', { concepto: 'ab' }],
      ['monto cero', { monto: 0 }],
      ['monto negativo', { monto: '-10.00' }],
      ['monto con 3 decimales', { monto: '1234.565' }],
      ['periodo con mes 13', { periodo: '2019-13' }],
      ['periodo mal formado', { periodo: '2019-3' }],
      ['proveedorId ausente', { proveedorId: undefined }],
      ['rubroId ausente', { rubroId: undefined }],
      ['campo desconocido', { inventado: 1 }],
    ];

    for (const [nombre, patch] of casos) {
      const body = gastoBase(patch);
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete body[k];
      const res = await crear(admin.accessToken, torre.id, body);
      assert.equal(res.status, 422, `${nombre} → esperaba 422, dio ${res.status}`);
      assert.equal(res.data.error.code, 'VALIDACION_FALLIDA', nombre);
    }
  });

  it('acepta la fecha de hoy (el corte de "no futura" es el fin del día UTC)', async () => {
    const res = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ fechaGasto: new Date().toISOString().slice(0, 10), concepto: `Hoy ${SUFIJO}` })
    );
    assert.equal(res.status, 201);
  });

  // ─── Validaciones cruzadas (proveedor / rubro) ───

  it('rechaza el proveedor inexistente, inactivo o de otra organización', async () => {
    for (const [nombre, proveedorId] of [
      ['inexistente', randomUUID()],
      ['inactivo', proveedorInactivo.id],
      ['de otra organización', proveedorDeOrgB.id],
    ]) {
      const res = await crear(admin.accessToken, torre.id, gastoBase({ proveedorId }));
      assert.equal(res.status, 422, `proveedor ${nombre}`);
      assert.equal(res.data.error.code, 'PROVEEDOR_INVALIDO', `proveedor ${nombre}`);
    }
  });

  it('rechaza el rubro que no es hoja, el inexistente y el oculto para la org', async () => {
    const noHoja = await crear(admin.accessToken, torre.id, gastoBase({ rubroId: rubroNivel1.id }));
    assert.equal(noHoja.status, 422);
    assert.equal(noHoja.data.error.code, 'RUBRO_INVALIDO');

    const inexistente = await crear(admin.accessToken, torre.id, gastoBase({ rubroId: randomUUID() }));
    assert.equal(inexistente.status, 422);
    assert.equal(inexistente.data.error.code, 'RUBRO_INVALIDO');

    // Un rubro propio de OTRA organización tampoco es usable.
    const deOrgB = await prisma.rubro.create({
      data: { organizacionId: orgB, nombre: `Propio Sur ${SUFIJO}`, orden: 900 },
    });
    const ajeno = await crear(admin.accessToken, torre.id, gastoBase({ rubroId: deOrgB.id }));
    assert.equal(ajeno.status, 422);
    assert.equal(ajeno.data.error.code, 'RUBRO_INVALIDO');
  });

  it('el PUT valida el gasto RESULTANTE, no solo lo que viene en el body', async () => {
    const alta = await crear(admin.accessToken, torre.id, gastoBase({ concepto: `Mixto ${SUFIJO}` }));
    assert.equal(alta.status, 201);

    // A → B sin mandar el servicio: el resultante queda incoherente.
    const sinServicio = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { categoria: 'B' },
      token: admin.accessToken,
    });
    assert.equal(sinServicio.status, 422);
    assert.equal(sinServicio.data.error.code, 'VALIDACION_FALLIDA');

    const conServicio = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { categoria: 'B', servicioEspecifico: 'calefaccion' },
      token: admin.accessToken,
    });
    assert.equal(conServicio.status, 200);
    assert.equal(conServicio.data.categoria, 'B');

    // Y el proveedor nuevo también se valida en la edición.
    const proveedorAjeno = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { proveedorId: proveedorDeOrgB.id },
      token: admin.accessToken,
    });
    assert.equal(proveedorAjeno.status, 422);
    assert.equal(proveedorAjeno.data.error.code, 'PROVEEDOR_INVALIDO');
  });

  // ─── Congelado por liquidación ───

  it('rechaza editar y borrar un gasto de una liquidación APROBADA (409)', async () => {
    const alta = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ concepto: `Liquidado ${SUFIJO}`, periodo: PERIODO_LIQUIDADO })
    );
    assert.equal(alta.status, 201);
    await liquidar(alta.data.id, 'APROBADA', PERIODO_LIQUIDADO);

    const edicion = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { monto: '999.00' },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 409);
    assert.equal(edicion.data.error.code, 'LIQUIDACION_APROBADA');

    // Decisión 3: el soft delete tiene el mismo candado que el PUT.
    const baja = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
    });
    assert.equal(baja.status, 409);
    assert.equal(baja.data.error.code, 'LIQUIDACION_APROBADA');

    // El detalle lo expone para que la UI deshabilite las acciones.
    const detalle = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      token: admin.accessToken,
    });
    assert.equal(detalle.data.editable, false);
    assert.equal(detalle.data.liquidaciones.length, 1);
    assert.equal(detalle.data.liquidaciones[0].estado, 'APROBADA');
  });

  it('una liquidación en BORRADOR no congela el gasto', async () => {
    const alta = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ concepto: `Borrador ${SUFIJO}`, periodo: PERIODO_BORRADOR })
    );
    await liquidar(alta.data.id, 'BORRADOR', PERIODO_BORRADOR);

    const edicion = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { monto: '111.00' },
      token: admin.accessToken,
    });
    assert.equal(edicion.status, 200);
    assert.equal(edicion.data.monto, '111.00');
    assert.equal(edicion.data.editable, undefined, 'el PUT devuelve el gasto, no el detalle');
  });

  // ─── Filtros, orden, paginación y totales ───

  it('filtra, ordena por fechaGasto desc, pagina y totaliza el filtro activo', async () => {
    const proveedorAlt = await prisma.proveedor.create({
      data: { organizacionId: orgA, razonSocial: `Alterno ${SUFIJO}` },
    });
    const fixtures = [
      { concepto: `F1 ${SUFIJO}`, monto: '100.00', fechaGasto: '2019-04-01', categoria: 'A' },
      {
        concepto: `F2 ${SUFIJO}`,
        monto: '200.25',
        fechaGasto: '2019-04-20',
        categoria: 'B',
        servicioEspecifico: 'ascensor',
        esOrdinario: false,
      },
      {
        concepto: `F3 ${SUFIJO}`,
        monto: '300.75',
        fechaGasto: '2019-04-10',
        categoria: 'A',
        proveedorId: proveedorAlt.id,
        rubroId: rubroHojaAlt.id,
      },
    ];
    for (const f of fixtures) {
      const res = await crear(admin.accessToken, torre.id, gastoBase({ ...f, periodo: PERIODO_ALT }));
      assert.equal(res.status, 201, f.concepto);
    }

    const todos = await listar(admin.accessToken, torre.id, { periodo: PERIODO_ALT });
    assert.equal(todos.status, 200);
    assert.equal(todos.data.pagination.total, 3);
    assert.equal(todos.data.totales.cantidad, 3);
    // 100.00 + 200.25 + 300.75 — suma exacta, sin float.
    assert.equal(todos.data.totales.monto, '601.00');
    assert.deepEqual(
      todos.data.data.map((g) => g.concepto),
      [`F2 ${SUFIJO}`, `F3 ${SUFIJO}`, `F1 ${SUFIJO}`],
      'orden fechaGasto desc'
    );

    const soloA = await listar(admin.accessToken, torre.id, {
      periodo: PERIODO_ALT,
      categoria: 'A',
    });
    assert.equal(soloA.data.pagination.total, 2);
    assert.equal(soloA.data.totales.monto, '400.75');

    const extraordinarios = await listar(admin.accessToken, torre.id, {
      periodo: PERIODO_ALT,
      esOrdinario: 'false',
    });
    assert.equal(extraordinarios.data.pagination.total, 1);
    assert.equal(extraordinarios.data.data[0].concepto, `F2 ${SUFIJO}`);

    const porProveedor = await listar(admin.accessToken, torre.id, {
      periodo: PERIODO_ALT,
      proveedorId: proveedorAlt.id,
    });
    assert.equal(porProveedor.data.pagination.total, 1);
    assert.equal(porProveedor.data.data[0].concepto, `F3 ${SUFIJO}`);

    const porRubro = await listar(admin.accessToken, torre.id, {
      periodo: PERIODO_ALT,
      rubroId: rubroHojaAlt.id,
    });
    assert.equal(porRubro.data.pagination.total, 1);

    const rango = await listar(admin.accessToken, torre.id, {
      desde: '2019-04-05',
      hasta: '2019-04-15',
    });
    assert.equal(rango.data.pagination.total, 1);
    assert.equal(rango.data.data[0].concepto, `F3 ${SUFIJO}`);

    const pagina2 = await listar(admin.accessToken, torre.id, {
      periodo: PERIODO_ALT,
      page: 2,
      limit: 2,
    });
    assert.equal(pagina2.data.data.length, 1);
    assert.equal(pagina2.data.pagination.totalPages, 2);
    // Los totales son del filtro completo, no de la página (decisión 5).
    assert.equal(pagina2.data.totales.monto, '601.00');

    const rangoInvertido = await listar(admin.accessToken, torre.id, {
      desde: '2019-04-20',
      hasta: '2019-04-01',
    });
    assert.equal(rangoInvertido.status, 422);
  });

  // ─── Permisos: gestor ───

  it('el gestor lee los gastos de sus edificios pero no los escribe', async () => {
    const alta = await crear(
      admin.accessToken,
      torre.id,
      gastoBase({ concepto: `DelGestor ${SUFIJO}` })
    );
    assert.equal(alta.status, 201);

    const lista = await listar(gestor.accessToken, torre.id, { periodo: PERIODO });
    assert.equal(lista.status, 200);
    assert.ok(lista.data.data.some((g) => g.id === alta.data.id));

    const detalle = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      token: gestor.accessToken,
    });
    assert.equal(detalle.status, 200);

    // Decisión 1: cargar un gasto es un acto de administración de la caja.
    const intentoAlta = await crear(gestor.accessToken, torre.id, gastoBase({ concepto: `Nope ${SUFIJO}` }));
    assert.equal(intentoAlta.status, 403);
    assert.equal(intentoAlta.data.error.code, 'ACCESO_DENEGADO');

    const intentoEdicion = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'PUT',
      body: { monto: '1.00' },
      token: gestor.accessToken,
    });
    assert.equal(intentoEdicion.status, 403);
    assert.equal(intentoEdicion.data.error.code, 'ACCESO_DENEGADO');

    const intentoBaja = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      method: 'DELETE',
      token: gestor.accessToken,
    });
    assert.equal(intentoBaja.status, 403);
    assert.equal(intentoBaja.data.error.code, 'ACCESO_DENEGADO');
  });

  it('el gestor no lee los gastos de un edificio que no tiene asignado', async () => {
    const alta = await crear(
      admin.accessToken,
      sanMartin.id,
      gastoBase({ concepto: `SanMartin ${SUFIJO}` })
    );
    assert.equal(alta.status, 201);

    const lista = await listar(gestor.accessToken, sanMartin.id, {});
    assert.equal(lista.status, 403);
    assert.equal(lista.data.error.code, 'EDIFICIO_NO_ASIGNADO');

    const detalle = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
      token: gestor.accessToken,
    });
    assert.equal(detalle.status, 403);
    assert.equal(detalle.data.error.code, 'EDIFICIO_NO_ASIGNADO');
  });

  // ─── Aislamiento entre organizaciones ───

  it('la Org B no ve ni toca los gastos de la Org A', async () => {
    const alta = await crear(admin.accessToken, torre.id, gastoBase({ concepto: `Ajeno ${SUFIJO}` }));
    assert.equal(alta.status, 201);

    const lista = await listar(adminSur.accessToken, torre.id, {});
    assert.equal(lista.status, 403);
    assert.equal(lista.data.error.code, 'FUERA_DE_ORGANIZACION');

    const alta_ = await crear(adminSur.accessToken, torre.id, gastoBase({ concepto: `Intruso ${SUFIJO}` }));
    assert.equal(alta_.status, 403);

    // Un gasto de otra organización responde 404, no 403: el 403 confirmaría el id.
    for (const [metodo, body] of [
      ['GET', undefined],
      ['PUT', { monto: '1.00' }],
      ['DELETE', undefined],
    ]) {
      const res = await apiFetch(baseUrl, `/api/gastos/${alta.data.id}`, {
        method: metodo,
        body,
        token: adminSur.accessToken,
      });
      assert.equal(res.status, 404, metodo);
      assert.equal(res.data.error.code, 'GASTO_NO_ENCONTRADO', metodo);
    }

    // Y su propio edificio sí lo puede usar (control positivo).
    const propio = await apiFetch(baseUrl, `/api/edificios/${lomas.id}/gastos`, {
      token: adminSur.accessToken,
    });
    assert.equal(propio.status, 200);
  });

  it('un edificio inexistente responde 404 y sin token 401', async () => {
    const inexistente = await listar(admin.accessToken, randomUUID(), {});
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.data.error.code, 'EDIFICIO_NO_ENCONTRADO');

    const sinToken = await apiFetch(baseUrl, `/api/edificios/${torre.id}/gastos`);
    assert.equal(sinToken.status, 401);
  });
});
