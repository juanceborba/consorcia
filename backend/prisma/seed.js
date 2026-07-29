// prisma/seed.js — Datos demo ConsorcIA (sprint S1-03)
// Spec: vault/02_Arquitectura y Stack/PRD-02-04 Base de Datos.md
//
// Crea una organización demo con 2 edificios, 20 unidades y 7 usuarios.
// Invariante del dominio: los coeficientes de las unidades de cada edificio
// SUMAN exactamente 1 (Decimal, 6 decimales). El seed la valida antes de
// insertar y aborta si no se cumple.
//
// Re-ejecutable: borra y recrea todos los datos de la organización demo
// (identificada por su CUIT). Solo toca las tablas que el seed escribe.
//
// Password de todos los usuarios demo: "demo1234" (bcrypt).

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

const CUIT_DEMO = '30-71234567-8';
const PASSWORD_DEMO = 'demo1234';

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

async function limpiarDatosDemo() {
  const existente = await prisma.organizacion.findUnique({ where: { cuit: CUIT_DEMO } });
  if (!existente) return;

  const orgId = existente.id;
  // Orden inverso de dependencias; solo tablas que el seed escribe.
  await prisma.unidadUsuario.deleteMany({ where: { organizacionId: orgId } });
  await prisma.gestorEdificio.deleteMany({ where: { edificio: { organizacionId: orgId } } });
  await prisma.unidad.deleteMany({ where: { organizacionId: orgId } });
  await prisma.edificio.deleteMany({ where: { organizacionId: orgId } });
  // Identidad global (S4-01): el Usuario no cuelga de la organización. Se
  // borran solo los que quedarían sin ningún vínculo al eliminar la org demo
  // (una persona con membresía en otra organización se conserva).
  const miembros = await prisma.organizacionUsuario.findMany({
    where: { organizacionId: orgId },
    select: { usuarioId: true },
  });
  await prisma.organizacionUsuario.deleteMany({ where: { organizacionId: orgId } });
  for (const { usuarioId } of miembros) {
    const otrosVinculos = await prisma.organizacionUsuario.count({ where: { usuarioId } });
    const otrasUnidades = await prisma.unidadUsuario.count({ where: { usuarioId } });
    if (otrosVinculos === 0 && otrasUnidades === 0) {
      await prisma.usuario.delete({ where: { id: usuarioId } });
    }
  }
  await prisma.organizacion.delete({ where: { id: orgId } });
  console.log('Datos demo anteriores eliminados.');
}

async function main() {
  await limpiarDatosDemo();

  // Organización demo (tenant raíz)
  const org = await prisma.organizacion.create({
    data: {
      nombre: 'Administración Demo S.A.',
      cuit: CUIT_DEMO,
      matriculaRPA: '12.345-A',
      plan: 'pro',
    },
  });
  console.log(`Organización creada: ${org.nombre} (${org.cuit})`);

  // Edificios
  const torrePalermo = await prisma.edificio.create({
    data: {
      organizacionId: org.id,
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
      organizacionId: org.id,
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
  console.log(`Edificios creados: ${torrePalermo.nombre}, ${sanMartin.nombre}`);

  // Unidades (con validación de la invariante de coeficientes)
  async function crearUnidades(edificio, definiciones) {
    const resueltas = resolverCoeficientes(definiciones, edificio.nombre);
    const creadas = {};
    for (const u of resueltas) {
      creadas[u.numero] = await prisma.unidad.create({
        data: {
          organizacionId: org.id,
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
  console.log(`Unidades creadas: ${UNIDADES_TORRE_PALERMO.length} en ${torrePalermo.nombre}, ${UNIDADES_SAN_MARTIN.length} en ${sanMartin.nombre}`);

  // Usuarios (misma password bcrypt para todos los demo)
  const passwordHash = bcrypt.hashSync(PASSWORD_DEMO, 10);

  // Identidad global (S4-01): el Usuario no tiene organización ni rol; el rol
  // vive en la membresía (`organizacion_usuarios`), que se crea acá mismo para
  // que ningún usuario del seed quede sin contexto de acceso.
  async function crearUsuario({ email, nombre, apellido, telefono, rol }) {
    return prisma.usuario.create({
      data: {
        email,
        passwordHash,
        nombre,
        apellido,
        telefono,
        organizaciones: { create: { organizacionId: org.id, rol } },
      },
    });
  }

  const admin = await crearUsuario({
    email: 'admin@demo.com', nombre: 'María Fernanda', apellido: 'Ruiz',
    telefono: '+54 11 5555-0101', rol: 'ORG_ADMIN',
  });
  const gestor = await crearUsuario({
    email: 'gestor@demo.com', nombre: 'Juan Carlos', apellido: 'Medina',
    telefono: '+54 11 5555-0102', rol: 'GESTOR',
  });
  const propietario1 = await crearUsuario({
    email: 'propietario1@demo.com', nombre: 'Roberto', apellido: 'Álvarez',
    telefono: '+54 11 5555-0103', rol: 'PROPIETARIO',
  });
  const propietario2 = await crearUsuario({
    email: 'propietario2@demo.com', nombre: 'Laura', apellido: 'Gómez',
    telefono: '+54 11 5555-0104', rol: 'PROPIETARIO',
  });
  const propietario3 = await crearUsuario({
    email: 'propietario3@demo.com', nombre: 'Diego', apellido: 'Fernández',
    telefono: '+54 11 5555-0105', rol: 'PROPIETARIO',
  });
  const inquilino = await crearUsuario({
    email: 'inquilino@demo.com', nombre: 'Sofía', apellido: 'Martínez',
    telefono: '+54 11 5555-0106', rol: 'INQUILINO',
  });
  await crearUsuario({
    email: 'encargado@demo.com', nombre: 'José Luis', apellido: 'Pereyra',
    telefono: '+54 11 5555-0107', rol: 'ENCARGADO',
  });

  // El gestor solo tiene asignado Torre Palermo
  await prisma.gestorEdificio.create({
    data: { usuarioId: gestor.id, edificioId: torrePalermo.id },
  });

  // Vínculos usuario ↔ unidad (propietarios e inquilino)
  await prisma.unidadUsuario.createMany({
    data: [
      {
        organizacionId: org.id, unidadId: unidadesPalermo['PB'].id,
        usuarioId: propietario1.id, esPropietario: true, fechaInicio: new Date('2024-03-01'),
      },
      {
        organizacionId: org.id, unidadId: unidadesPalermo['3B'].id,
        usuarioId: propietario2.id, esPropietario: true, fechaInicio: new Date('2025-02-10'),
      },
      {
        organizacionId: org.id, unidadId: unidadesSanMartin['PB'].id,
        usuarioId: propietario3.id, esPropietario: true, fechaInicio: new Date('2025-06-01'),
      },
      {
        organizacionId: org.id, unidadId: unidadesPalermo['1A'].id,
        usuarioId: inquilino.id, esInquilino: true, fechaInicio: new Date('2026-01-15'),
      },
    ],
  });

  console.log('Usuarios creados: 7 (org_admin, gestor, 3 propietarios, inquilino, encargado)');
  console.log(`Password de todos los usuarios demo: "${PASSWORD_DEMO}"`);
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
