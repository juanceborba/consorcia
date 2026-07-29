// tests/schema-gastos.test.js — Constraints de schema de S3-01
// Spec: PRD-04-02 §1.1/§1.3/§1.4/§6 · PRD-02-04 §2
//
// Verifica a nivel base de datos las reglas que la migración
// 20260729140000_s3_gastos_proveedores_rubros expresa con SQL que Prisma no
// puede declarar (índices únicos parciales) o que sostienen invariantes del
// sprint: soft delete del gasto, proveedor/rubro obligatorios, dedup de CUIT
// por organización, nombre de rubro único entre hermanos del maestro, y la
// unicidad de período de liquidación que permite anular → regenerar.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/db/prisma.js';

const SUFIJO = randomUUID().slice(0, 8);
const CREADO_POR = randomUUID(); // gastos.created_by no tiene FK

let orgA;
let orgB;
let edificio;
let proveedor;
let rubro;

// Datos mínimos válidos de un gasto del edificio de prueba.
function datosGasto(extra = {}) {
  return {
    organizacionId: orgA.id,
    edificioId: edificio.id,
    proveedorId: proveedor.id,
    rubroId: rubro.id,
    concepto: 'Sueldo encargado',
    monto: '450000.00',
    categoria: 'A',
    fechaGasto: new Date('2026-07-01T00:00:00Z'),
    periodo: '2026-07',
    createdBy: CREADO_POR,
    ...extra,
  };
}

// Datos mínimos válidos de una liquidación del edificio de prueba.
function datosLiquidacion(extra = {}) {
  return {
    organizacionId: orgA.id,
    edificioId: edificio.id,
    periodo: '2026-07',
    fechaLiquidacion: new Date('2026-07-31T00:00:00Z'),
    totalOrdinarias: '450000.00',
    totalExtraordinarias: '0.00',
    totalGeneral: '450000.00',
    matriculaRPA: 'RPA-TEST-941',
    ...extra,
  };
}

before(async () => {
  orgA = await prisma.organizacion.create({
    data: {
      nombre: `Test S3-01 A ${SUFIJO}`,
      cuit: `30-9${SUFIJO.slice(0, 7)}-1`,
      matriculaRPA: 'RPA-TEST-A',
    },
  });
  orgB = await prisma.organizacion.create({
    data: {
      nombre: `Test S3-01 B ${SUFIJO}`,
      cuit: `30-8${SUFIJO.slice(0, 7)}-2`,
      matriculaRPA: 'RPA-TEST-B',
    },
  });
  edificio = await prisma.edificio.create({
    data: {
      organizacionId: orgA.id,
      nombre: `Edificio S3-01 ${SUFIJO}`,
      direccion: 'Av. Siempreviva 742',
      ciudad: 'CABA',
      provincia: 'CABA',
      codigoPostal: '1425',
      totalM2: '1000.00',
      amenities: [],
    },
  });
  proveedor = await prisma.proveedor.create({
    data: { organizacionId: orgA.id, razonSocial: `Proveedor ${SUFIJO}` },
  });
  rubro = await prisma.rubro.create({
    data: { organizacionId: orgA.id, nombre: `Rubro ${SUFIJO}` },
  });
});

after(async () => {
  await prisma.liquidacion.deleteMany({ where: { edificioId: edificio.id } });
  await prisma.gasto.deleteMany({ where: { edificioId: edificio.id } });
  await prisma.edificio.delete({ where: { id: edificio.id } });
  await prisma.rubroVisibilidad.deleteMany({
    where: { organizacionId: { in: [orgA.id, orgB.id] } },
  });
  await prisma.proveedor.deleteMany({
    where: { OR: [{ organizacionId: { in: [orgA.id, orgB.id] } }, { cuit: `20-${SUFIJO}-9` }] },
  });
  await prisma.rubro.deleteMany({ where: { organizacionId: { in: [orgA.id, orgB.id] } } });
  await prisma.rubro.deleteMany({ where: { nombre: { startsWith: `Maestro ${SUFIJO}` } } });
  await prisma.organizacion.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

// ─── Gasto: soft delete y FKs obligatorias ───

test('el gasto se da de baja con deletedAt sin borrar la fila (Ley 941)', async () => {
  const gasto = await prisma.gasto.create({ data: datosGasto() });

  await prisma.gasto.update({
    where: { id: gasto.id },
    data: { deletedAt: new Date() },
  });

  const vigentes = await prisma.gasto.findMany({
    where: { edificioId: edificio.id, deletedAt: null },
  });
  assert.equal(vigentes.length, 0, 'el gasto borrado no debe aparecer entre los vigentes');

  const persistido = await prisma.gasto.findUnique({ where: { id: gasto.id } });
  assert.ok(persistido, 'la fila se conserva para auditoría');
  assert.ok(persistido.deletedAt instanceof Date);

  await prisma.gasto.delete({ where: { id: gasto.id } });
});

test('la DB rechaza un gasto sin proveedor', async () => {
  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO gastos (id, organizacion_id, edificio_id, rubro_id, concepto, monto,
           categoria, fecha_gasto, periodo, created_by, updated_at)
         VALUES ($1, $2, $3, $4, 'Sin proveedor', 1000, 'A', NOW(), '2026-07', $5, NOW())`,
        randomUUID(),
        orgA.id,
        edificio.id,
        rubro.id,
        CREADO_POR
      ),
    // 23502 = not_null_violation: proveedor_id es NOT NULL (PRD-04-02 §1.1)
    (err) => /23502/.test(err.message)
  );
});

test('la DB rechaza un gasto sin rubro', async () => {
  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO gastos (id, organizacion_id, edificio_id, proveedor_id, concepto, monto,
           categoria, fecha_gasto, periodo, created_by, updated_at)
         VALUES ($1, $2, $3, $4, 'Sin rubro', 1000, 'A', NOW(), '2026-07', $5, NOW())`,
        randomUUID(),
        orgA.id,
        edificio.id,
        proveedor.id,
        CREADO_POR
      ),
    // 23502 = not_null_violation: rubro_id es NOT NULL (PRD-04-02 §1.1)
    (err) => /23502/.test(err.message)
  );
});

// ─── Proveedor: dedup de CUIT por organización (índice único parcial) ───

test('el CUIT de proveedor no se repite dentro de la misma organización', async () => {
  const cuit = `20-${SUFIJO}-9`;
  await prisma.proveedor.create({
    data: { organizacionId: orgA.id, razonSocial: 'Ascensores SA', cuit },
  });

  await assert.rejects(
    () =>
      prisma.proveedor.create({
        data: { organizacionId: orgA.id, razonSocial: 'Ascensores SA (duplicado)', cuit },
      }),
    (err) => err.code === 'P2002',
    'segundo proveedor con el mismo CUIT en la org → unique violation'
  );

  // Otra organización puede tener su propio proveedor con ese CUIT...
  const enOrgB = await prisma.proveedor.create({
    data: { organizacionId: orgB.id, razonSocial: 'Ascensores SA', cuit },
  });
  assert.equal(enOrgB.cuit, cuit);

  // ...y el catálogo global también (el dedup de globales es aparte).
  const global = await prisma.proveedor.create({
    data: { organizacionId: null, razonSocial: 'Ascensores SA (global)', cuit },
  });
  assert.equal(global.organizacionId, null);

  // Pero un segundo global con el mismo CUIT sí choca.
  await assert.rejects(
    () =>
      prisma.proveedor.create({
        data: { organizacionId: null, razonSocial: 'Ascensores SA (global bis)', cuit },
      }),
    (err) => err.code === 'P2002'
  );
});

test('los proveedores sin CUIT no chocan entre sí', async () => {
  const a = await prisma.proveedor.create({
    data: { organizacionId: orgA.id, razonSocial: 'Plomero del barrio' },
  });
  const b = await prisma.proveedor.create({
    data: { organizacionId: orgA.id, razonSocial: 'Plomero del barrio (otro)' },
  });
  assert.notEqual(a.id, b.id);
});

// ─── Rubro: nombre único entre hermanos, incluido el maestro (parentId null) ───

test('el maestro de rubros no admite dos rubros nivel 1 con el mismo nombre', async () => {
  const nombre = `Maestro ${SUFIJO}`;
  await prisma.rubro.create({ data: { organizacionId: null, nombre } });

  await assert.rejects(
    () => prisma.rubro.create({ data: { organizacionId: null, nombre } }),
    (err) => err.code === 'P2002',
    'índice parcial rubros_maestro_raiz_unique'
  );

  // Una organización sí puede tener un rubro propio con ese nombre.
  const propio = await prisma.rubro.create({ data: { organizacionId: orgA.id, nombre } });
  assert.equal(propio.organizacionId, orgA.id);

  // Pero no dos veces en la misma organización.
  await assert.rejects(
    () => prisma.rubro.create({ data: { organizacionId: orgA.id, nombre } }),
    (err) => err.code === 'P2002',
    'índice parcial rubros_org_raiz_unique'
  );
});

test('un subrubro propio puede colgar de un rubro del maestro', async () => {
  const padreMaestro = await prisma.rubro.create({
    data: { organizacionId: null, nombre: `Maestro ${SUFIJO} padre` },
  });
  const subrubro = await prisma.rubro.create({
    data: { organizacionId: orgA.id, parentId: padreMaestro.id, nombre: 'Subrubro propio' },
  });
  assert.equal(subrubro.parentId, padreMaestro.id);

  // La visibilidad del maestro se overridea por organización.
  const override = await prisma.rubroVisibilidad.create({
    data: { organizacionId: orgA.id, rubroId: padreMaestro.id, visible: false },
  });
  assert.equal(override.visible, false);
});

// ─── Liquidación: unicidad de período que excluye ANULADA ───

test('no se puede tener dos liquidaciones vigentes del mismo período', async () => {
  await prisma.liquidacion.create({ data: datosLiquidacion() });

  await assert.rejects(
    () => prisma.liquidacion.create({ data: datosLiquidacion() }),
    (err) => err.code === 'P2002',
    'índice parcial liquidaciones_periodo_activo_unique'
  );

  await prisma.liquidacion.deleteMany({ where: { edificioId: edificio.id } });
});

test('anular una liquidación permite regenerar el mismo período', async () => {
  const primera = await prisma.liquidacion.create({ data: datosLiquidacion() });

  await prisma.liquidacion.update({
    where: { id: primera.id },
    data: { estado: 'ANULADA' },
  });

  const segunda = await prisma.liquidacion.create({ data: datosLiquidacion() });
  assert.equal(segunda.periodo, primera.periodo);
  assert.equal(segunda.estado, 'BORRADOR');

  // Y varias anuladas del mismo período pueden convivir como historial.
  await prisma.liquidacion.update({ where: { id: segunda.id }, data: { estado: 'ANULADA' } });
  const tercera = await prisma.liquidacion.create({ data: datosLiquidacion() });

  const delPeriodo = await prisma.liquidacion.findMany({
    where: { edificioId: edificio.id, periodo: '2026-07' },
  });
  assert.equal(delPeriodo.length, 3);
  assert.equal(delPeriodo.filter((l) => l.estado !== 'ANULADA').length, 1);

  await prisma.liquidacion.deleteMany({ where: { edificioId: edificio.id } });
  assert.ok(tercera.id);
});
