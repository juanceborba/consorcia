// prisma/seed.js — Datos demo ConsorcIA (S1-03, ampliado en S4-10)
// Spec: vault/04_Módulos Core/PRD-04-11 §10 (los 7 casos de seed),
//       vault/02_Arquitectura y Stack/PRD-02-04 Base de Datos.md
//
// Cubre los 8 casos de PRD-04-11 §10:
//   1. Org A con 2 edificios: org_admin + gestor limitado a Torre Palermo.
//   2. Staff adicional: un segundo gestor de Org A con AMBOS edificios.
//   3. Org B (segunda administración) con 1 edificio, sus UFs y su org_admin.
//   4. Residente multi-consorcio: un solo Usuario propietario de una UF en
//      Org A y otra en Org B.
//   5. Inquilino simple en una UF de Org A.
//   6. Propietario con 2 UFs en el mismo edificio.
//   7. Invitación STAFF PENDIENTE (sin aceptar) con token fijo, para probar el
//      flujo de activación sin tener que ir a la DB a buscarlo.
//   8. Staff MULTI-ORGANIZACIÓN: un Usuario con membresía activa en Org A y en
//      Org B, que es la precondición del selector de organización del header.
//
// Identidad global (S4-01, PRD-04-11 §2): el Usuario NO cuelga de la
// organización. Los permisos son vínculos, y el seed los mantiene separados:
//   - staff     → `OrganizacionUsuario` (+ `GestorEdificio` si es gestor)
//   - residente → SOLO `UnidadUsuario` (nunca membresía de organización: una
//     membresía con rol PROPIETARIO lo metería en la nómina de staff)
//
// Invariante del dominio: los coeficientes de las unidades de cada edificio
// SUMAN exactamente 1 (Decimal, 6 decimales). El seed la valida antes de
// insertar y aborta si no se cumple.
//
// Re-ejecutable: borra y recrea los datos de las dos organizaciones demo
// (identificadas por su CUIT) y limpia el residuo que dejan los specs E2E.
// Solo toca las tablas que el seed escribe.
//
// Password de todos los usuarios demo: "demo1234" (bcrypt). Credenciales y
// casos documentados en AGENTS.md → "Credenciales demo (seed)".

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { sembrarRubrosMaestro, RUBROS_MAESTRO } from './rubros-maestro.js';

const prisma = new PrismaClient();

const CUIT_ORG_A = '30-71234567-8';
const CUIT_ORG_B = '30-71234569-4';
const CUITS_DEMO = [CUIT_ORG_A, CUIT_ORG_B];
const PASSWORD_DEMO = 'demo1234';

// Token FIJO de la invitación pendiente (caso 7). Es una columna String, no
// hace falta que sea un uuid: legible a propósito para poder abrir
// `/invitacion/seed-invitacion-pendiente` sin consultar la DB.
const TOKEN_INVITACION_PENDIENTE = 'seed-invitacion-pendiente';

// Prefijos de los usuarios desechables que dejan los specs de Playwright
// (frontend/e2e/*.spec.js). El vínculo se da de baja lógica en el propio spec,
// pero el `Usuario` global sobrevive porque no hay endpoint de borrado de
// personas: el reseed es el punto donde se limpian.
const PREFIJOS_RESIDUO_E2E = ['e2e-staff-', 'e2e-residente-'];

// ---------------------------------------------------------------------------
// Definición de unidades. El coeficiente de la ÚLTIMA unidad de cada edificio
// se calcula como resto (1 - suma de las anteriores) para cerrar la suma en 1.
// ---------------------------------------------------------------------------

const UNIDADES_TORRE_PALERMO = [
  { numero: 'PB',      tipo: 'departamento', m2: '78.50',  coeficiente: '0.092000' },
  { numero: '1A',      tipo: 'departamento', m2: '52.00',  coeficiente: '0.078000' },
  { numero: '1B',      tipo: 'departamento', m2: '74.00',  coeficiente: '0.090000' },
  { numero: '2A',      tipo: 'departamento', m2: '52.00',  coeficiente: '0.078000' },
  { numero: '2B',      tipo: 'departamento', m2: '74.00',  coeficiente: '0.090000' },
  { numero: '3A',      tipo: 'departamento', m2: '53.50',  coeficiente: '0.080000' },
  { numero: '3B',      tipo: 'departamento', m2: '76.00',  coeficiente: '0.092000' },
  { numero: '4A',      tipo: 'departamento', m2: '53.50',  coeficiente: '0.080000' },
  { numero: '4B',      tipo: 'departamento', m2: '76.00',  coeficiente: '0.092000' },
  { numero: 'Local-1', tipo: 'local',        m2: '120.00', coeficiente: '0.098000' },
  { numero: 'Coch-1',  tipo: 'cochera',      m2: '12.50',  coeficiente: '0.015000' },
  { numero: 'Coch-2',  tipo: 'cochera',      m2: '12.50',  coeficiente: '0.015000' },
  // PH del último piso: absorbe el resto para cerrar la suma en 1.000000
  { numero: '5A',      tipo: 'departamento', m2: '95.00',  coeficiente: null },
];

const UNIDADES_SAN_MARTIN = [
  { numero: 'PB', tipo: 'departamento', m2: '80.00', coeficiente: '0.150000' },
  { numero: '1A', tipo: 'departamento', m2: '55.00', coeficiente: '0.138000' },
  { numero: '1B', tipo: 'departamento', m2: '79.00', coeficiente: '0.148000' },
  { numero: '2A', tipo: 'departamento', m2: '55.00', coeficiente: '0.138000' },
  { numero: '2B', tipo: 'departamento', m2: '79.00', coeficiente: '0.148000' },
  { numero: '3A', tipo: 'departamento', m2: '54.00', coeficiente: '0.136000' },
  // Absorbe el resto para cerrar la suma en 1.000000
  { numero: '3B', tipo: 'departamento', m2: '78.00', coeficiente: null },
];

// Edificio de la Org B (S4-10): chico a propósito, alcanza para probar el
// aislamiento entre organizaciones y el residente multi-consorcio.
const UNIDADES_LOMAS = [
  { numero: 'PB', tipo: 'departamento', m2: '68.00', coeficiente: '0.220000' },
  { numero: '1A', tipo: 'departamento', m2: '62.00', coeficiente: '0.200000' },
  { numero: '1B', tipo: 'departamento', m2: '62.00', coeficiente: '0.200000' },
  { numero: '2A', tipo: 'departamento', m2: '59.00', coeficiente: '0.190000' },
  // Absorbe el resto para cerrar la suma en 1.000000
  { numero: '2B', tipo: 'departamento', m2: '59.00', coeficiente: null },
];

// Resuelve los coeficientes null como resto y valida que la suma sea 1.
function resolverCoeficientes(unidades, nombreEdificio) {
  const sumaParcial = unidades
    .filter((u) => u.coeficiente !== null)
    .reduce((acc, u) => acc.plus(u.coeficiente), new Decimal(0));

  const resueltas = unidades.map((u) => ({
    ...u,
    coeficiente: u.coeficiente ?? new Decimal(1).minus(sumaParcial).toFixed(6),
  }));

  const suma = resueltas.reduce((acc, u) => acc.plus(u.coeficiente), new Decimal(0));
  if (!suma.equals(1)) {
    throw new Error(`Coeficientes de ${nombreEdificio} no suman 1: ${suma.toFixed(6)}`);
  }
  return resueltas;
}

// ---------------------------------------------------------------------------
// Limpieza (idempotencia)
// ---------------------------------------------------------------------------

// Borra los usuarios de la lista que quedaron sin ningún vínculo. Con identidad
// global el Usuario sobrevive a la organización: una persona con membresía o
// unidades en otra org (p.ej. la que crea el spec del selector) se conserva.
async function borrarUsuariosHuerfanos(usuarioIds) {
  for (const usuarioId of new Set(usuarioIds)) {
    const membresias = await prisma.organizacionUsuario.count({ where: { usuarioId } });
    const unidades = await prisma.unidadUsuario.count({ where: { usuarioId } });
    if (membresias === 0 && unidades === 0) {
      await prisma.gestorEdificio.deleteMany({ where: { usuarioId } });
      await prisma.usuario.delete({ where: { id: usuarioId } });
    }
  }
}

async function limpiarOrganizacionDemo(cuit) {
  const existente = await prisma.organizacion.findUnique({ where: { cuit } });
  if (!existente) return;

  const orgId = existente.id;
  // Orden inverso de dependencias; solo tablas que el seed escribe.
  //
  // Los insumos de gastos de la org (S3) van PRIMERO y son obligatorios en la
  // limpieza aunque el seed no cargue gastos: las FKs de `proveedores.
  // organizacion_id` y `rubros.organizacion_id` son ON DELETE SET NULL, así que
  // borrar la organización sin borrarlos convertiría sus proveedores y rubros
  // propios en ítems GLOBALES/MAESTROS de plataforma visibles para todo el
  // mundo. Los gastos y liquidaciones se borran antes porque referencian
  // proveedor y rubro con FK RESTRICT.
  await prisma.liquidacionDetalle.deleteMany({
    where: { liquidacion: { organizacionId: orgId } },
  });
  await prisma.liquidacion.deleteMany({ where: { organizacionId: orgId } });
  await prisma.gasto.deleteMany({ where: { organizacionId: orgId } });
  await prisma.rubroVisibilidad.deleteMany({ where: { organizacionId: orgId } });
  await prisma.proveedor.deleteMany({ where: { organizacionId: orgId } });
  // Subrubros antes que sus padres (FK parent_id).
  await prisma.rubro.deleteMany({ where: { organizacionId: orgId, parentId: { not: null } } });
  await prisma.rubro.deleteMany({ where: { organizacionId: orgId } });

  await prisma.invitacion.deleteMany({ where: { organizacionId: orgId } });
  await prisma.unidadUsuario.deleteMany({ where: { organizacionId: orgId } });
  await prisma.gestorEdificio.deleteMany({ where: { edificio: { organizacionId: orgId } } });
  await prisma.unidad.deleteMany({ where: { organizacionId: orgId } });
  // Esquemas de reparto (S3-20) DESPUÉS de gastos y liquidaciones —que los
  // referencian con FK RESTRICT— y ANTES de los edificios, que también los
  // referencian con RESTRICT. La configuración cae por CASCADE con el edificio,
  // pero se borra explícita porque referencia al esquema general con RESTRICT.
  await prisma.configuracionLiquidacion.deleteMany({ where: { organizacionId: orgId } });
  await prisma.esquemaReparto.deleteMany({ where: { organizacionId: orgId } });
  await prisma.edificio.deleteMany({ where: { organizacionId: orgId } });

  const miembros = await prisma.organizacionUsuario.findMany({
    where: { organizacionId: orgId },
    select: { usuarioId: true },
  });
  await prisma.organizacionUsuario.deleteMany({ where: { organizacionId: orgId } });
  await borrarUsuariosHuerfanos(miembros.map((m) => m.usuarioId));

  await prisma.organizacionConfig.deleteMany({ where: { organizacionId: orgId } });
  await prisma.organizacion.delete({ where: { id: orgId } });
  console.log(`Datos demo anteriores eliminados: ${existente.nombre} (${cuit})`);
}

// Residuo de los specs de Playwright: usuarios `e2e-staff-*` / `e2e-residente-*`
// con sus vínculos e invitaciones. La organización "E2E Administración B" y su
// admin NO se tocan: el spec del selector la REUSA entre corridas (CUIT fijo) y
// borrarla lo dejaría sin poder registrarla ni loguearse.
async function limpiarResiduoE2E() {
  const usuarios = await prisma.usuario.findMany({
    where: { OR: PREFIJOS_RESIDUO_E2E.map((prefijo) => ({ email: { startsWith: prefijo } })) },
    select: { id: true, email: true },
  });
  if (usuarios.length === 0) return;

  const ids = usuarios.map((u) => u.id);
  const emails = usuarios.map((u) => u.email);
  await prisma.invitacion.deleteMany({ where: { email: { in: emails } } });
  await prisma.unidadUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.gestorEdificio.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  console.log(`Residuo E2E eliminado: ${usuarios.length} usuario(s) de prueba`);
}

// Deja a los usuarios del seed con SOLO sus membresías demo activas. El spec
// del selector de organización (S4-09) invita a `admin@demo.com` a su propia
// organización de prueba; si esa membresía queda activa, el admin arranca con
// dos organizaciones y el smoke deja de ser determinístico. Baja lógica: el
// spec la reactiva solo cuando la necesita.
async function desactivarMembresiasAjenas(emails) {
  const { count } = await prisma.organizacionUsuario.updateMany({
    where: {
      usuario: { email: { in: emails } },
      organizacion: { cuit: { notIn: CUITS_DEMO } },
      activo: true,
    },
    data: { activo: false },
  });
  if (count > 0) {
    console.log(`Membresías ajenas al seed desactivadas: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  for (const cuit of CUITS_DEMO) await limpiarOrganizacionDemo(cuit);
  await limpiarResiduoE2E();

  // --- Maestro de rubros de plataforma (S3-13) ------------------------------
  // No es dato demo: es el catálogo compartido por todas las organizaciones
  // (`organizacionId = null`). Idempotente y NO se borra en la limpieza — un
  // ítem del maestro puede tener gastos de cualquier org apuntándolo.
  const maestro = await sembrarRubrosMaestro(prisma);
  const hojas = RUBROS_MAESTRO.reduce((n, r) => n + r.subrubros.length, 0);
  console.log(
    `Maestro de rubros: ${RUBROS_MAESTRO.length} rubros + ${hojas} subrubros ` +
      `(${maestro.creados} creados, ${maestro.existentes} ya existían)`
  );

  // --- Organizaciones (tenant raíz) ----------------------------------------
  const orgA = await prisma.organizacion.create({
    data: {
      nombre: 'Administración Demo S.A.',
      cuit: CUIT_ORG_A,
      matriculaRPA: '12.345-A',
      plan: 'pro',
    },
  });
  const orgB = await prisma.organizacion.create({
    data: {
      nombre: 'Administración Sur S.R.L.',
      cuit: CUIT_ORG_B,
      matriculaRPA: '67.890-B',
      plan: 'starter',
    },
  });
  console.log(`Organizaciones creadas: ${orgA.nombre}, ${orgB.nombre}`);

  // --- Edificios ------------------------------------------------------------
  const torrePalermo = await prisma.edificio.create({
    data: {
      organizacionId: orgA.id,
      nombre: 'Torre Palermo',
      direccion: 'Av. Santa Fe 3456',
      ciudad: 'Buenos Aires',
      provincia: 'CABA',
      codigoPostal: 'C1425BGW',
      antiguedad: 25,
      totalM2: '1250.50',
      amenities: ['pileta', 'sum', 'gimnasio'],
      fechaInicioAdmin: new Date('2024-03-01'),
    },
  });

  const sanMartin = await prisma.edificio.create({
    data: {
      organizacionId: orgA.id,
      nombre: 'Edificio San Martín',
      direccion: 'San Martín 850',
      ciudad: 'Buenos Aires',
      provincia: 'CABA',
      codigoPostal: 'C1004AAR',
      antiguedad: 40,
      totalM2: '620.00',
      amenities: ['sum'],
      fechaInicioAdmin: new Date('2025-06-01'),
    },
  });

  const lomas = await prisma.edificio.create({
    data: {
      organizacionId: orgB.id,
      nombre: 'Edificio Lomas',
      direccion: 'Av. Hipólito Yrigoyen 1200',
      ciudad: 'Lomas de Zamora',
      provincia: 'Buenos Aires',
      codigoPostal: 'B1832',
      antiguedad: 15,
      totalM2: '310.00',
      amenities: [],
      fechaInicioAdmin: new Date('2025-09-01'),
    },
  });
  console.log(`Edificios creados: ${torrePalermo.nombre}, ${sanMartin.nombre} (Org A) · ${lomas.nombre} (Org B)`);

  // --- Unidades (con validación de la invariante de coeficientes) -----------
  async function crearUnidades(edificio, definiciones) {
    const resueltas = resolverCoeficientes(definiciones, edificio.nombre);
    const creadas = {};
    for (const u of resueltas) {
      creadas[u.numero] = await prisma.unidad.create({
        data: {
          organizacionId: edificio.organizacionId,
          edificioId: edificio.id,
          numero: u.numero,
          tipo: u.tipo,
          m2: u.m2,
          coeficiente: u.coeficiente,
          // Cocheras no usan ascensor; el resto sí (categoría B)
          categoriaB: u.tipo === 'cochera' ? [] : ['ascensor'],
        },
      });
    }
    return creadas;
  }

  const unidadesPalermo = await crearUnidades(torrePalermo, UNIDADES_TORRE_PALERMO);
  const unidadesSanMartin = await crearUnidades(sanMartin, UNIDADES_SAN_MARTIN);
  const unidadesLomas = await crearUnidades(lomas, UNIDADES_LOMAS);
  console.log(
    `Unidades creadas: ${UNIDADES_TORRE_PALERMO.length} + ${UNIDADES_SAN_MARTIN.length} (Org A), ${UNIDADES_LOMAS.length} (Org B)`
  );

  // --- Esquemas de reparto (S3-20) ------------------------------------------
  //
  // UN esquema en UN edificio, a propósito: Torre Palermo tiene la exención
  // parcial del art. 12 de su reglamento (PB abona el 50% del ascensor) y San
  // Martín no tiene nada configurado. Así el seed muestra las dos mitades del
  // diseño: el edificio configurado y el que liquida por coeficiente sin que
  // nadie haya tocado un setup — que es el default y el caso mayoritario.
  //
  // Tampoco se configura `ConfiguracionLiquidacion`: dejar el esquema general en
  // NULL es lo que demuestra que no hace falta configurar nada para liquidar.
  const esquemaAscensor = await prisma.esquemaReparto.create({
    data: {
      organizacionId: torrePalermo.organizacionId,
      edificioId: torrePalermo.id,
      nombre: 'Ascensor (PB al 50%)',
      base: 'COEFICIENTE',
      alcance: 'SERVICIO',
      alcanceValor: 'ascensor',
      clausulaReglamento: 'art. 12 del reglamento de copropiedad',
      pesos: {
        create: [
          {
            organizacionId: torrePalermo.organizacionId,
            unidadId: unidadesPalermo.PB.id,
            peso: '0.500000',
          },
        ],
      },
    },
  });
  console.log(
    `Esquemas de reparto: "${esquemaAscensor.nombre}" en ${torrePalermo.nombre} (CCyC art. 2049) · ${sanMartin.nombre} sin configurar (default)`
  );

  // --- Usuarios -------------------------------------------------------------
  // Misma password bcrypt para todos los demo, salvo el invitado pendiente
  // (caso 7), que no tiene password hasta aceptar la invitación.
  const passwordHash = bcrypt.hashSync(PASSWORD_DEMO, 10);

  // `upsert` por email: con identidad global el Usuario puede haber sobrevivido
  // a la limpieza (tiene vínculos en una organización ajena al seed), y un
  // `create` reventaría contra el unique de email.
  async function crearUsuario({ email, nombre, apellido, telefono, activada = true }) {
    const datos = {
      passwordHash: activada ? passwordHash : null,
      nombre,
      apellido,
      telefono,
      activo: true,
      deletedAt: null,
    };
    return prisma.usuario.upsert({
      where: { email },
      update: datos,
      create: { email, ...datos },
    });
  }

  const staff = (organizacionId, usuarioId, rol) =>
    prisma.organizacionUsuario.create({ data: { organizacionId, usuarioId, rol } });

  const asignarEdificios = (usuarioId, edificios) =>
    prisma.gestorEdificio.createMany({
      data: edificios.map((e) => ({ usuarioId, edificioId: e.id })),
      skipDuplicates: true,
    });

  // Caso 1 — Org A: org_admin + gestor limitado a Torre Palermo
  const admin = await crearUsuario({
    email: 'admin@demo.com', nombre: 'María Fernanda', apellido: 'Ruiz',
    telefono: '+54 11 5555-0101',
  });
  await staff(orgA.id, admin.id, 'ORG_ADMIN');

  const gestor = await crearUsuario({
    email: 'gestor@demo.com', nombre: 'Juan Carlos', apellido: 'Medina',
    telefono: '+54 11 5555-0102',
  });
  await staff(orgA.id, gestor.id, 'GESTOR');
  await asignarEdificios(gestor.id, [torrePalermo]);

  // Caso 2 — staff adicional: segundo gestor de Org A con AMBOS edificios
  const gestor2 = await crearUsuario({
    email: 'gestor2@demo.com', nombre: 'Verónica', apellido: 'Salas',
    telefono: '+54 11 5555-0108',
  });
  await staff(orgA.id, gestor2.id, 'GESTOR');
  await asignarEdificios(gestor2.id, [torrePalermo, sanMartin]);

  // Caso 3 — Org B con su propio org_admin (no ve nada de Org A)
  const adminSur = await crearUsuario({
    email: 'admin.sur@demo.com', nombre: 'Alejandro', apellido: 'Sosa',
    telefono: '+54 11 5555-0201',
  });
  await staff(orgB.id, adminSur.id, 'ORG_ADMIN');

  // Caso 7 — invitación STAFF pendiente: el Usuario existe SIN password (así lo
  // deja `POST /api/organizaciones/me/usuarios`) y la membresía nace activa
  // (PRD-04-11 §4.3). El link es lo que le da password.
  const invitado = await crearUsuario({
    email: 'invitado@demo.com', nombre: 'Camila', apellido: 'Ferrer',
    telefono: null, activada: false,
  });
  await staff(orgA.id, invitado.id, 'GESTOR');
  await asignarEdificios(invitado.id, [sanMartin]);
  await prisma.invitacion.create({
    data: {
      email: invitado.email,
      organizacionId: orgA.id,
      tipo: 'STAFF',
      payload: {
        rol: 'GESTOR',
        nombre: invitado.nombre,
        apellido: invitado.apellido,
        edificioIds: [sanMartin.id],
      },
      token: TOKEN_INVITACION_PENDIENTE,
      expiraAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitadoPorId: admin.id,
      // Esta invitación es la que aprovisionó la identidad: sin la marca, el
      // accept responde 409 ACTIVACION_NO_DISPONIBLE (S4-11 / SEC-02).
      creaUsuario: true,
    },
  });

  // Caso 8 — staff con membresía ACTIVA en las dos organizaciones (S4-11 /
  // QA-02): es lo único que hace aparecer el selector de organización del
  // header, y sin él la DoD del selector había que probarla fabricando la
  // membresía a mano (que además el reseed desactivaba).
  const multiOrg = await crearUsuario({
    email: 'multiorg@demo.com', nombre: 'Pablo', apellido: 'Iriarte',
    telefono: '+54 11 5555-0110',
  });
  await staff(orgA.id, multiOrg.id, 'GESTOR');
  await asignarEdificios(multiOrg.id, [torrePalermo]);
  await staff(orgB.id, multiOrg.id, 'ORG_ADMIN');

  // Residentes: NUNCA membresía de organización (no son staff), solo
  // `UnidadUsuario` scopeado a la org de la unidad.
  const propietario1 = await crearUsuario({
    email: 'propietario1@demo.com', nombre: 'Roberto', apellido: 'Álvarez',
    telefono: '+54 11 5555-0103',
  });
  // Caso 6 — propietario con 2 UFs en el mismo edificio
  const propietario2 = await crearUsuario({
    email: 'propietario2@demo.com', nombre: 'Laura', apellido: 'Gómez',
    telefono: '+54 11 5555-0104',
  });
  const propietario3 = await crearUsuario({
    email: 'propietario3@demo.com', nombre: 'Diego', apellido: 'Fernández',
    telefono: '+54 11 5555-0105',
  });
  // Caso 5 — inquilino simple en una UF de Org A
  const inquilino = await crearUsuario({
    email: 'inquilino@demo.com', nombre: 'Sofía', apellido: 'Martínez',
    telefono: '+54 11 5555-0106',
  });
  // Caso 4 — residente multi-consorcio: UN Usuario, una UF en cada organización
  const multiConsorcio = await crearUsuario({
    email: 'multiconsorcio@demo.com', nombre: 'Andrea', apellido: 'Quiroga',
    telefono: '+54 11 5555-0109',
  });
  const propietarioSur = await crearUsuario({
    email: 'propietario.sur@demo.com', nombre: 'Nicolás', apellido: 'Bianchi',
    telefono: '+54 11 5555-0202',
  });
  // El encargado no tiene modelo de vínculo en el MVP (rol de scope edificio,
  // llega con tickets/portal): queda como identidad sin vínculos, así que
  // loguea pero Cerbos le niega todo (fail-closed).
  await crearUsuario({
    email: 'encargado@demo.com', nombre: 'José Luis', apellido: 'Pereyra',
    telefono: '+54 11 5555-0107',
  });

  await prisma.unidadUsuario.createMany({
    data: [
      // Org A
      {
        organizacionId: orgA.id, unidadId: unidadesPalermo['PB'].id,
        usuarioId: propietario1.id, esPropietario: true, fechaInicio: new Date('2024-03-01'),
      },
      {
        organizacionId: orgA.id, unidadId: unidadesPalermo['3B'].id,
        usuarioId: propietario2.id, esPropietario: true, fechaInicio: new Date('2025-02-10'),
      },
      {
        organizacionId: orgA.id, unidadId: unidadesPalermo['4B'].id,
        usuarioId: propietario2.id, esPropietario: true, fechaInicio: new Date('2025-02-10'),
      },
      {
        organizacionId: orgA.id, unidadId: unidadesSanMartin['PB'].id,
        usuarioId: propietario3.id, esPropietario: true, fechaInicio: new Date('2025-06-01'),
      },
      {
        organizacionId: orgA.id, unidadId: unidadesPalermo['1A'].id,
        usuarioId: inquilino.id, esInquilino: true, fechaInicio: new Date('2026-01-15'),
      },
      {
        organizacionId: orgA.id, unidadId: unidadesPalermo['2A'].id,
        usuarioId: multiConsorcio.id, esPropietario: true, fechaInicio: new Date('2024-08-01'),
      },
      // Org B
      {
        organizacionId: orgB.id, unidadId: unidadesLomas['1A'].id,
        usuarioId: multiConsorcio.id, esPropietario: true, fechaInicio: new Date('2025-09-01'),
      },
      {
        organizacionId: orgB.id, unidadId: unidadesLomas['PB'].id,
        usuarioId: propietarioSur.id, esPropietario: true, fechaInicio: new Date('2025-09-01'),
      },
    ],
  });

  await desactivarMembresiasAjenas([
    admin.email, gestor.email, gestor2.email, adminSur.email, invitado.email,
    multiOrg.email,
  ]);

  // --- Resumen --------------------------------------------------------------
  console.log('\nStaff: admin@demo.com (org_admin A) · gestor@demo.com (gestor A, Torre Palermo)');
  console.log('       gestor2@demo.com (gestor A, ambos edificios) · admin.sur@demo.com (org_admin B)');
  console.log('       invitado@demo.com (gestor A, PENDIENTE de activar)');
  console.log('       multiorg@demo.com (gestor A + org_admin B → selector de organización)');
  console.log('Residentes (sin membresía staff): propietario1/2/3@demo.com, inquilino@demo.com,');
  console.log('       multiconsorcio@demo.com (Org A + Org B), propietario.sur@demo.com, encargado@demo.com');
  console.log(`Password de todos los usuarios demo activados: "${PASSWORD_DEMO}"`);
  console.log(`Invitación pendiente (caso 7): /invitacion/${TOKEN_INVITACION_PENDIENTE}`);
  console.log('Seed completado.');
}

main()
  .catch((e) => {
    console.error('Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
