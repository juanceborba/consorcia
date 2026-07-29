// prisma/rubros-maestro.js — Árbol maestro de rubros de plataforma (S3-13)
// Spec: PRD-04-02 §1.4 ("Árbol maestro propuesto (seed)"): 10 rubros de nivel 1
// con sus subrubros hoja.
//
// El maestro NO pertenece a ninguna organización (`organizacionId = null`): lo
// comparten todas y cada una decide qué ver con `RubroVisibilidad`. Por eso vive
// en su propio módulo y no dentro del bloque de datos demo del seed: sembrarlo
// es parte del aprovisionamiento de la plataforma, no del dataset de prueba.

export const RUBROS_MAESTRO = [
  {
    nombre: 'Administración',
    subrubros: [
      'Honorarios administración',
      'Asesoría contable',
      'Asesoría legal',
      'Seguros (incendio/RC)',
      'Gastos bancarios',
      'Papelería y gestiones',
      'Asambleas',
    ],
  },
  {
    nombre: 'Personal',
    subrubros: [
      'Sueldos y cargas sociales (CCT 589/10)',
      'Suplencias',
      'Horas extras',
      'Uniformes e indumentaria',
      'Indemnizaciones',
    ],
  },
  {
    nombre: 'Limpieza',
    subrubros: [
      'Limpieza general',
      'Insumos de limpieza',
      'Control de plagas',
      'Higiene y desinfección',
      'Manejo de residuos',
    ],
  },
  {
    nombre: 'Mantenimiento',
    subrubros: [
      'Plomería',
      'Electricidad',
      'Albañilería',
      'Pintura',
      'Herrería',
      'Techos e impermeabilización',
      'Carpintería',
    ],
  },
  {
    nombre: 'Seguridad',
    subrubros: [
      'Vigilancia física',
      'Cámaras y monitoreo',
      'Alarmas',
      'Control de accesos',
      'Portero eléctrico',
    ],
  },
  {
    nombre: 'Servicios públicos',
    subrubros: [
      'Energía eléctrica',
      'Agua',
      'Gas',
      'ABL y tasas municipales',
      'Telecomunicaciones',
    ],
  },
  {
    nombre: 'Ascensores',
    subrubros: ['Mantenimiento preventivo', 'Reparaciones', 'Inspecciones y certificaciones'],
  },
  {
    nombre: 'Climatización',
    subrubros: ['Calderas y calefacción central', 'Aire acondicionado', 'Ventilación'],
  },
  {
    nombre: 'Espacios comunes',
    subrubros: ['Pileta', 'SUM y parrilla', 'Gimnasio', 'Jardines y espacios verdes', 'Cocheras'],
  },
  {
    // Comodín: el gasto exige rubro obligatorio (§1.1), así que siempre tiene
    // que haber una hoja donde caer.
    nombre: 'Otros',
    subrubros: ['Varios'],
  },
];

/**
 * Siembra (o repara) el árbol maestro. IDEMPOTENTE: matchea por
 * (organizacionId null, parentId, nombre) y solo corrige `orden`/`activo`.
 *
 * No se puede usar `upsert` de Prisma: la unicidad del maestro la sostienen
 * índices únicos PARCIALES (`rubros_maestro_raiz_unique` /
 * `rubros_maestro_hijo_unique`) porque en Postgres un UNIQUE con columnas
 * NULLables no restringe las filas con NULL — el `upsert` no encontraría la fila
 * existente y el create chocaría con el índice parcial.
 *
 * Tampoco borra: un ítem que se saque de esta lista puede tener gastos
 * asociados (FK RESTRICT). Retirar un rubro del maestro es desactivarlo a mano.
 */
export async function sembrarRubrosMaestro(prisma) {
  let creados = 0;
  let existentes = 0;

  async function asegurar({ nombre, parentId, orden }) {
    const encontrado = await prisma.rubro.findFirst({
      where: { organizacionId: null, parentId: parentId ?? null, nombre },
      select: { id: true, orden: true, activo: true },
    });
    if (encontrado) {
      existentes += 1;
      if (encontrado.orden !== orden || encontrado.activo !== true) {
        await prisma.rubro.update({
          where: { id: encontrado.id },
          data: { orden, activo: true },
        });
      }
      return encontrado.id;
    }
    const creado = await prisma.rubro.create({
      data: { organizacionId: null, parentId: parentId ?? null, nombre, orden },
      select: { id: true },
    });
    creados += 1;
    return creado.id;
  }

  for (const [i, rubro] of RUBROS_MAESTRO.entries()) {
    const padreId = await asegurar({ nombre: rubro.nombre, parentId: null, orden: (i + 1) * 10 });
    for (const [j, subrubro] of rubro.subrubros.entries()) {
      await asegurar({ nombre: subrubro, parentId: padreId, orden: (j + 1) * 10 });
    }
  }

  return { creados, existentes };
}
