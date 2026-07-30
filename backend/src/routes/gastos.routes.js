// src/routes/gastos.routes.js — CRUD de gastos (S3-02)
// Spec: PRD-04-02 §1.1/§2 · policy cerbos/policies/gasto.yaml. Contrato:
//   POST   /api/edificios/:id/gastos → alta → 201
//   GET    /api/edificios/:id/gastos → lista paginada (fechaGasto desc) + totales
//   GET    /api/gastos/:id           → detalle con sus liquidaciones
//   PUT    /api/gastos/:id           → edición (409 si está liquidado)
//   DELETE /api/gastos/:id           → soft delete (`deletedAt`)
//
// Exporta DOS routers: `gastosDeEdificioRouter` (montado en edificios.routes.js
// bajo `/:id/gastos`, con `mergeParams` para heredar el edificio, igual que
// residentes bajo unidades) y el default sobre `/api/gastos`.
//
// DECISIONES de S3-02:
//
// 1. El gestor NO carga gastos. `gasto.yaml` (S3-01) le da solo `read` en sus
//    edificios asignados y el backlog de S3 lo dice explícito ("gestor: lectura
//    de gastos/liquidaciones de sus edificios"): cargar un gasto es mover la
//    caja del consorcio. Se respeta la policy tal cual — POST/PUT/DELETE de un
//    gestor caen en el `403 ACCESO_DENEGADO` de Cerbos, sin guard previo. A
//    diferencia de S3-12/S3-13 acá no hay código específico que agregar: el
//    motivo real *es* "te faltan permisos", no "el recurso es de otro dueño".
//
// 2. Congelado por liquidación (§6 "no modificar gastos liquidados"): el gasto
//    que participa de una liquidación en un estado NO reversible se rechaza con
//    `409 LIQUIDACION_APROBADA`. El conjunto congelado es
//    {APROBADA, ENVIADA, COBRADA} — el backlog nombra las dos primeras, y
//    COBRADA se suma porque es posterior a ENVIADA: si editar un gasto ya
//    enviado corrompe el recibo, editar uno ya cobrado corrompe además la
//    cuenta corriente. BORRADOR y ANULADA no congelan: el borrador se
//    recalcula y la anulada existe justamente para regenerar el período
//    (decisión de S3-01).
//
// 3. El DELETE aplica el MISMO candado que el PUT. El backlog solo lo pide para
//    el PUT, pero el soft delete es un cambio semántico igual de fuerte: un
//    gasto con `deletedAt` desaparece de la lista y de los próximos cálculos
//    mientras sigue referenciado por los `LiquidacionDetalle` ya emitidos, así
//    que la liquidación aprobada quedaría apuntando a un gasto que la UI no
//    muestra. Para "sacar" un gasto de una liquidación aprobada hay que anular
//    la liquidación (S3-04).
//
// 4. Validaciones cruzadas con códigos propios: `422 PROVEEDOR_INVALIDO` y
//    `422 RUBRO_INVALIDO`. Un proveedor o un rubro de OTRA organización no se
//    distingue de uno inexistente (mismo 422 con el mismo mensaje): el gasto no
//    es lugar para sondear el directorio ajeno. El rubro se valida con
//    `rubroUsable(..., { soloHojas: true })` porque §1.1 exige que el gasto
//    apunte a un subrubro o rubro hoja; el proveedor tiene que estar ACTIVO
//    (un proveedor dado de baja sigue legible en los gastos históricos, pero no
//    se le cargan nuevos).
//
// 5. La lista devuelve `totales: { cantidad, monto }` del filtro activo, además
//    de `pagination`. La fila TOTAL de la pantalla de gastos (PRD-04-02 §4.1,
//    S3-07) es del filtro completo, no de la página: sin esto el frontend
//    tendría que paginar todo el período para sumarlo, o inventar un segundo
//    endpoint. Es una suma, no analítica — el dashboard agregado es S3-15.
//
// 6. `monto` viaja como STRING en las respuestas (`"12345.67"`). Prisma
//    devuelve un `Decimal` que `JSON.stringify` serializaría como número,
//    reintroduciendo el float justo en el borde de salida.
//
// 7. AGREGADO EN S3-08: cada fila de la lista trae `editable`, el mismo flag que
//    el `GET /:id` (decisión 2). El DoD del sprint pide que la acción de editar
//    un gasto liquidado esté DESHABILITADA en la UI, no que falle con 409 al
//    intentarlo — y la lista es donde vive esa acción. Sin el flag por fila, el
//    frontend tendría que pedir el detalle de cada gasto de la página (N+1) para
//    saber qué botones apagar. Se resuelve con UNA query por página
//    (`gastosCongelados`), no una por gasto.
//
// 8. AGREGADO EN S3-08b: `totales` suma `ordinarios` y `extraordinarios` además
//    del total. La pantalla los muestra segmentados arriba de la lista, y la
//    distinción es del dominio, no cosmética: las expensas ordinarias y las
//    extraordinarias se liquidan y se leen por separado (PRD-04-03). Sale de un
//    `groupBy` sobre el MISMO `where` que el total, así que los tres números
//    siempre reconcilian (total = ordinarios + extraordinarios).
//
// 10. AGREGADO EN S3-08b: `totales.porCategoria` con { A, B, C }. Es la MISMA
//     plata partida por otro eje que `ordinarios`/`extraordinarios`, y los dos
//     ejes son independientes: la categoría A/B/C decide QUIÉNES pagan el gasto
//     (art. 2049 CCyC, último párrafo: el reglamento puede eximir a las UF sin
//     acceso al servicio o sector) y `esOrdinario` decide en qué subtotal cae
//     (art. 10 inc. i de la Ley 941 CABA: ordinarias y extraordinarias van
//     "separadas y diferenciadas"). Ver
//     `docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.
//
// 9. AGREGADO EN S3-08b: cada fila trae `creadoPor: { id, nombre, apellido }`
//    (o null) y la lista acepta `?createdBy=`. Es la trazabilidad que pide la
//    columna "Cargado por" del listado: con varios gestores cargando gastos del
//    mismo edificio, "quién cargó esto" es la primera pregunta cuando un monto
//    no cierra. Ver `autoresDe` para por qué no es un `include`.
//
// 11. AGREGADO EN S3-19 — CUOTAS. Un gasto extraordinario puede declarar
//     `cuotasTotal`: el alta genera su plan con `planDeCuotas` (montos derivados,
//     Σ = el total de la factura) y el gasto pasa a imputarse una cuota por
//     período. Consecuencias en este archivo:
//
//     a. `?periodo=` deja de ser `gasto.periodo = P`. Un gasto en cuotas
//        pertenece a los N períodos de su plan, así que el filtro es "de
//        imputación única en P, O con una cuota en P" (ver `filtroDePeriodo`).
//        Sin esto, la obra desaparecería de todos los meses menos el primero.
//
//     b. Con `?periodo=` activo, la fila trae `montoImputado` = el monto de la
//        cuota de ese período (y `cuota: { numero, cuotasTotal }` para el rótulo
//        "cuota k/N"), y los `totales` suman IMPUTADOS. Es lo que hace que el
//        total del filtro sea el mismo número que va a repartir la liquidación de
//        ese período; el total de la factura sigue disponible en `monto`. Sin
//        `?periodo=` no hay imputación que mostrar: la fila es la factura y los
//        totales suman `monto`, como antes de S3-19.
//
//     c. El candado del PUT/DELETE no cambia y ya cubre las cuotas: los
//        `LiquidacionDetalle` referencian el `gastoId`, así que un gasto con
//        CUALQUIER cuota liquidada cae en el mismo `409 LIQUIDACION_APROBADA`.
//        Editar el plan (o el monto, o el período) REGENERA las cuotas enteras:
//        un plan a medio editar es peor que uno recalculado.

import { Router } from 'express';
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import {
  crearGastoSchema,
  editarGastoSchema,
  listarGastosSchema,
  incoherenciaCategoria,
  incoherenciaCuotas,
} from '../schemas/gasto.schema.js';
import { rubroUsable } from '../services/rubros.js';
import { planDeCuotas, LiquidacionError } from '../core/liquidacion.engine.js';

// ---------------------------------------------------------------------------
// Constantes y helpers
// ---------------------------------------------------------------------------

// Decisión 2: estados de liquidación que congelan al gasto.
export const ESTADOS_CONGELANTES = ['APROBADA', 'ENVIADA', 'COBRADA'];

const CAMPOS = {
  id: true,
  organizacionId: true,
  edificioId: true,
  proveedorId: true,
  rubroId: true,
  concepto: true,
  descripcion: true,
  monto: true,
  moneda: true,
  categoria: true,
  servicioEspecifico: true,
  sectorEspecifico: true,
  esOrdinario: true,
  esquemaRepartoId: true,
  comprobanteUrl: true,
  fechaGasto: true,
  periodo: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  proveedor: { select: { id: true, razonSocial: true, activo: true } },
  rubro: { select: { id: true, nombre: true, parentId: true, activo: true } },
  // S3-20: el esquema elegido a mano, para que la UI muestre con qué se va a
  // repartir sin pedir el detalle del esquema aparte. `null` = el del edificio.
  esquemaReparto: {
    select: { id: true, nombre: true, base: true, alcance: true, alcanceValor: true, activo: true },
  },
  // Decisión 11: el plan de cuotas viaja con el gasto (son a lo sumo 120 filas
  // chicas y la UI necesita los períodos para mostrar el plan completo).
  cuotas: {
    select: { id: true, numero: true, cuotasTotal: true, periodo: true, monto: true },
    orderBy: { numero: 'asc' },
  },
};

// Decisión 6: el monto sale como string, nunca como número.
// Decisión 11: `cuotasTotal` es null cuando el gasto es de imputación única, que
// es lo que la UI necesita para decidir si dibuja el rótulo "cuota k/N".
const serializar = (g) => ({
  ...g,
  monto: new Decimal(g.monto).toFixed(2),
  ...(g.cuotas
    ? {
        cuotasTotal: g.cuotas.length > 0 ? g.cuotas[0].cuotasTotal : null,
        cuotas: g.cuotas.map((c) => ({ ...c, monto: new Decimal(c.monto).toFixed(2) })),
      }
    : {}),
});

const noEncontrado = () => ({
  error: { code: 'GASTO_NO_ENCONTRADO', message: 'El gasto no existe' },
});

const validacionFallida = (message) => ({ error: { code: 'VALIDACION_FALLIDA', message } });

const proveedorInvalido = () => ({
  error: {
    code: 'PROVEEDOR_INVALIDO',
    message: 'El proveedor no existe, está inactivo o no es visible para tu organización',
  },
});

// S3-20: el override tiene que apuntar a un esquema de ESTE edificio. Un esquema
// de otro edificio o de otra organización no se distingue de uno inexistente,
// igual que el proveedor y el rubro.
const esquemaInvalido = () => ({
  error: {
    code: 'ESQUEMA_INVALIDO',
    message: 'El esquema de reparto no existe o no es de este edificio',
  },
});

const rubroInvalido = () => ({
  error: {
    code: 'RUBRO_INVALIDO',
    message:
      'El rubro no existe, está inactivo, no es visible para tu organización o no es una hoja del árbol',
  },
});

// Carrera: el proveedor o el rubro se borraron entre la validación y el write.
// La FK que falló no dice cuál de los dos fue sin parsear el mensaje de Postgres.
const referenciaCaida = () =>
  validacionFallida(
    'El proveedor o el rubro referenciados dejaron de estar disponibles: volvé a elegirlos'
  );

const liquidacionAprobada = (liquidaciones) => ({
  error: {
    code: 'LIQUIDACION_APROBADA',
    message: `El gasto forma parte de una liquidación ${liquidaciones
      .map((l) => `${l.periodo} (${l.estado})`)
      .join(', ')}: para modificarlo hay que anular la liquidación`,
  },
});

// Decisión 4: proveedor visible para la org (propio o global) y activo.
async function proveedorUsable(organizacionId, proveedorId) {
  const proveedor = await prisma.proveedor.findFirst({
    where: {
      id: proveedorId,
      activo: true,
      OR: [{ organizacionId }, { organizacionId: null }],
    },
    select: { id: true },
  });
  return proveedor !== null;
}

// S3-20: el esquema del override, de ESTE edificio.
//
// `exigirActivo` es true solo cuando el esquema VIENE en este request: elegir un
// esquema desactivado es un error de la UI. Cuando el gasto ya lo tenía y el PUT
// toca otra cosa, no se exige — si no, desactivar un esquema bloquearía editarle
// el concepto a todos los gastos que lo eligieron (y el reparto de esos gastos no
// cambia al desactivarlo: ver la decisión b de services/esquemas-reparto.js).
async function esquemaUsable(organizacionId, edificioId, esquemaRepartoId, { exigirActivo }) {
  const esquema = await prisma.esquemaReparto.findFirst({
    where: {
      id: esquemaRepartoId,
      organizacionId,
      edificioId,
      ...(exigirActivo ? { activo: true } : {}),
    },
    select: { id: true },
  });
  return esquema !== null;
}

// Corre las validaciones que no puede hacer Zod (dependen de la DB y de la
// organización). Devuelve la respuesta de error o null si todo cierra.
async function validacionesCruzadas(
  organizacionId,
  edificioId,
  gasto,
  { exigirEsquemaActivo = true } = {}
) {
  const incoherencia = incoherenciaCategoria(gasto) ?? incoherenciaCuotas(gasto);
  if (incoherencia) return { status: 422, body: validacionFallida(incoherencia) };

  if (!(await proveedorUsable(organizacionId, gasto.proveedorId))) {
    return { status: 422, body: proveedorInvalido() };
  }
  if (!(await rubroUsable(organizacionId, gasto.rubroId, { soloHojas: true }))) {
    return { status: 422, body: rubroInvalido() };
  }
  if (
    gasto.esquemaRepartoId &&
    !(await esquemaUsable(organizacionId, edificioId, gasto.esquemaRepartoId, {
      exigirActivo: exigirEsquemaActivo,
    }))
  ) {
    return { status: 422, body: esquemaInvalido() };
  }
  return null;
}

// Decisión 11: las filas de `gasto_cuotas` de un plan, derivadas por el motor.
// `cuotasTotal` nulo/ausente = imputación única = ningún registro (el default).
function filasDeCuotas({ cuotasTotal, monto, periodo }, organizacionId) {
  if (!cuotasTotal) return [];
  // `monto` puede llegar como string (body validado) o como el Decimal de Prisma
  // (gasto persistido): el motor usa SU decimal.js, así que el puente es el string.
  return planDeCuotas(String(monto), cuotasTotal, periodo).map((c) => ({
    organizacionId,
    numero: c.numero,
    cuotasTotal: c.cuotasTotal,
    periodo: c.periodo,
    monto: c.monto,
  }));
}

// Liquidaciones del gasto en un estado congelante (decisión 2).
async function liquidacionesCongelantes(gastoId) {
  const detalles = await prisma.liquidacionDetalle.findMany({
    where: { gastoId, liquidacion: { estado: { in: ESTADOS_CONGELANTES } } },
    select: { liquidacion: { select: { id: true, periodo: true, estado: true } } },
  });
  // Un gasto tiene un detalle por UF dentro de la misma liquidación.
  const porId = new Map(detalles.map((d) => [d.liquidacion.id, d.liquidacion]));
  return [...porId.values()];
}

// Decisión 7: ids congelados de un lote de gastos, en una sola query. El GET
// /:id resuelve esto por gasto; la lista lo necesita para toda la página.
async function gastosCongelados(ids) {
  if (ids.length === 0) return new Set();
  const detalles = await prisma.liquidacionDetalle.findMany({
    where: { gastoId: { in: ids }, liquidacion: { estado: { in: ESTADOS_CONGELANTES } } },
    select: { gastoId: true },
    distinct: ['gastoId'],
  });
  return new Set(detalles.map((d) => d.gastoId));
}

// Decisión 8: el groupBy por `esOrdinario` devuelve 0, 1 o 2 filas (un tipo sin
// gastos no aparece). Se normaliza a los dos segmentos siempre presentes: el
// totalizador de la pantalla no puede mostrar un hueco donde va un "$ 0,00".
function segmentarPorTipo(filas) {
  const vacio = () => ({ cantidad: 0, monto: '0.00' });
  const segmentos = { ordinarios: vacio(), extraordinarios: vacio() };
  for (const fila of filas) {
    segmentos[fila.esOrdinario ? 'ordinarios' : 'extraordinarios'] = {
      cantidad: fila._count._all,
      monto: new Decimal(fila._sum.monto ?? 0).toFixed(2),
    };
  }
  return segmentos;
}

// Decisión 10: mismo criterio que `segmentarPorTipo`, sobre las tres categorías.
// Las tres están siempre presentes (una categoría sin gastos es un cero, no un
// hueco) porque la pantalla dibuja una tarjeta fija por categoría.
function segmentarPorCategoria(filas) {
  const segmentos = {
    A: { cantidad: 0, monto: '0.00' },
    B: { cantidad: 0, monto: '0.00' },
    C: { cantidad: 0, monto: '0.00' },
  };
  for (const fila of filas) {
    segmentos[fila.categoria] = {
      cantidad: fila._count._all,
      monto: new Decimal(fila._sum.monto ?? 0).toFixed(2),
    };
  }
  return segmentos;
}

// ─── Decisión 11: el período de un gasto en cuotas ───

// Un gasto "pertenece" a un período si se imputa entero ahí (sin plan de cuotas)
// o si alguna de sus cuotas cae en ese período. Va en `AND` y no en `OR` para no
// pisar el `OR` del buscador `q`.
const filtroDePeriodo = (periodo) => ({
  AND: [{ OR: [{ periodo, cuotas: { none: {} } }, { cuotas: { some: { periodo } } }] }],
});

// La imputación de un gasto a un período: la cuota que le toca, o el gasto
// entero. Espejo de `imputacionDelPeriodo` del motor, sobre la fila ya
// serializada (el motor trabaja con Decimal, esto con los strings de salida).
function imputacionDeFila(gasto, periodo) {
  if (!periodo) return { montoImputado: null, cuota: null };
  const cuota = (gasto.cuotas ?? []).find((c) => c.periodo === periodo);
  if (!cuota) return { montoImputado: gasto.monto, cuota: null };
  return {
    montoImputado: cuota.monto,
    cuota: { id: cuota.id, numero: cuota.numero, cuotasTotal: cuota.cuotasTotal },
  };
}

// Acumulador de los tres cortes de `totales` (total, por tipo, por categoría)
// sobre una lista de imputaciones { monto, esOrdinario, categoria }. Existe
// porque con `?periodo=` los totales suman MONTOS IMPUTADOS, y el monto imputado
// de un gasto en cuotas vive en `gasto_cuotas`: no hay un `groupBy` de Prisma que
// agrupe por un campo del gasto sumando una columna de la relación. La cantidad
// de filas es la de un período de un edificio (decenas), así que sumarlas con
// decimal.js en memoria es exacto y barato.
function acumular(imputaciones) {
  const cero = () => ({ cantidad: 0, monto: new Decimal(0) });
  const acc = {
    total: cero(),
    porTipo: { ordinarios: cero(), extraordinarios: cero() },
    porCategoria: { A: cero(), B: cero(), C: cero() },
  };

  for (const { monto, esOrdinario, categoria } of imputaciones) {
    const valor = new Decimal(monto);
    for (const celda of [
      acc.total,
      acc.porTipo[esOrdinario ? 'ordinarios' : 'extraordinarios'],
      acc.porCategoria[categoria],
    ]) {
      celda.cantidad += 1;
      celda.monto = celda.monto.plus(valor);
    }
  }
  return acc;
}

const cerrar = (celda) => ({ cantidad: celda.cantidad, monto: celda.monto.toFixed(2) });

/**
 * Los `totales` del filtro completo (decisión 5), en sus tres cortes.
 *
 * Dos caminos, por una razón de tamaño y no de gusto:
 *
 * - SIN `?periodo=`: el conjunto no está acotado (puede ser el histórico entero
 *   del edificio) y no hay imputación que resolver — la fila ES la factura. Se
 *   agrega en SQL, igual que antes de S3-19.
 * - CON `?periodo=`: los totales suman MONTOS IMPUTADOS, y el de un gasto en
 *   cuotas está en `gasto_cuotas`. El conjunto es un período de un edificio
 *   (decenas de filas), así que se traen las tres columnas que hacen falta y se
 *   suman con decimal.js. Los tres cortes salen del mismo recorrido, así que
 *   reconcilian por construcción (total = ordinarios + extraordinarios = A+B+C).
 */
async function totalesDelFiltro(where, periodo) {
  if (!periodo) {
    const [agregado, porTipo, porCategoria] = await Promise.all([
      prisma.gasto.aggregate({ where, _count: { _all: true }, _sum: { monto: true } }),
      // Decisión 8: el mismo total, partido en ordinarios y extraordinarios.
      prisma.gasto.groupBy({
        by: ['esOrdinario'],
        where,
        _count: { _all: true },
        _sum: { monto: true },
      }),
      // Decisión 10: y el mismo total, partido por categoría A/B/C.
      prisma.gasto.groupBy({
        by: ['categoria'],
        where,
        _count: { _all: true },
        _sum: { monto: true },
      }),
    ]);

    return {
      cantidad: agregado._count._all,
      monto: new Decimal(agregado._sum.monto ?? 0).toFixed(2),
      ...segmentarPorTipo(porTipo),
      porCategoria: segmentarPorCategoria(porCategoria),
    };
  }

  const filas = await prisma.gasto.findMany({
    where,
    select: {
      monto: true,
      esOrdinario: true,
      categoria: true,
      // Solo la cuota del período: es la que se imputa.
      cuotas: { where: { periodo }, select: { monto: true } },
    },
  });

  const acc = acumular(
    filas.map((g) => ({
      monto: g.cuotas.length > 0 ? g.cuotas[0].monto : g.monto,
      esOrdinario: g.esOrdinario,
      categoria: g.categoria,
    }))
  );

  return {
    ...cerrar(acc.total),
    ordinarios: cerrar(acc.porTipo.ordinarios),
    extraordinarios: cerrar(acc.porTipo.extraordinarios),
    porCategoria: {
      A: cerrar(acc.porCategoria.A),
      B: cerrar(acc.porCategoria.B),
      C: cerrar(acc.porCategoria.C),
    },
  };
}

// Decisión 9: quién cargó cada gasto, resuelto en una query por página.
//
// `Gasto.createdBy` es un String suelto, SIN relación Prisma a `Usuario` (el PRD
// lo documenta como FK pero el schema nunca la declaró), así que no se puede
// `include`. Se resuelven los nombres de la página en un `findMany` por ids, con
// el mismo criterio que `gastosCongelados`. La identidad es global: el usuario
// que cargó el gasto puede no ser staff de la organización HOY (se le dio de
// baja la membresía), y su nombre sigue siendo el dato correcto para la
// trazabilidad — de ahí que la búsqueda no se scopee por organización.
async function autoresDe(ids) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nombre: true, apellido: true },
  });
  return new Map(usuarios.map((u) => [u.id, u]));
}

// Recurso Cerbos: scope doble org + edificio (contrato en cerbos/policies/gasto.yaml).
const recursoDeEdificio = (req) => ({
  id: req.edificio.id,
  attr: {
    id: req.edificio.id,
    organizacion_id: req.edificio.organizacionId,
    edificio_id: req.edificio.id,
  },
});

const recursoGasto = (req) => ({
  id: req.gasto.id,
  attr: {
    id: req.gasto.id,
    organizacion_id: req.gasto.organizacionId,
    edificio_id: req.gasto.edificioId,
  },
});

// ---------------------------------------------------------------------------
// Router de edificio: /api/edificios/:id/gastos
// ---------------------------------------------------------------------------
//
// `validarEdificio` resuelve el edificio y aplica el aislamiento antes de todo:
// 404 si no existe, 403 `FUERA_DE_ORGANIZACION` si es de otra org y 403
// `EDIFICIO_NO_ASIGNADO` si el gestor no lo tiene asignado.

export const gastosDeEdificioRouter = Router({ mergeParams: true });

// GET / — lista paginada del edificio, orden fechaGasto desc
gastosDeEdificioRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('gasto', 'read', recursoDeEdificio),
  validarQuery(listarGastosSchema),
  async (req, res, next) => {
    try {
      const {
        periodo,
        categoria,
        esOrdinario,
        proveedorId,
        rubroId,
        createdBy,
        desde,
        hasta,
        q,
        page,
        limit,
      } = req.filtros;

      const where = {
        organizacionId: req.organizacionId,
        edificioId: req.edificio.id,
        // Los soft-deleted no se listan nunca (siguen en la DB por Ley 941).
        deletedAt: null,
        // Decisión 11: un gasto en cuotas pertenece a los N períodos de su plan.
        ...(periodo ? filtroDePeriodo(periodo) : {}),
        ...(categoria ? { categoria } : {}),
        ...(esOrdinario !== undefined ? { esOrdinario } : {}),
        ...(proveedorId ? { proveedorId } : {}),
        ...(rubroId ? { rubroId } : {}),
        ...(createdBy ? { createdBy } : {}),
        ...(desde || hasta
          ? {
              fechaGasto: {
                ...(desde ? { gte: desde } : {}),
                ...(hasta ? { lte: hasta } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { concepto: { contains: q, mode: 'insensitive' } },
                { descripcion: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [totales, gastos] = await Promise.all([
        totalesDelFiltro(where, periodo),
        prisma.gasto.findMany({
          where,
          select: CAMPOS,
          // `createdAt` desempata: dos gastos del mismo día tienen que salir
          // siempre en el mismo orden o la paginación repite/saltea filas.
          orderBy: [{ fechaGasto: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      // Decisión 7: `editable` por fila, en UNA query para toda la página.
      // Decisión 9: los nombres de quienes cargaron, en otra query para la página.
      const [congelados, autores] = await Promise.all([
        gastosCongelados(gastos.map((g) => g.id)),
        autoresDe(gastos.map((g) => g.createdBy)),
      ]);
      return res.json({
        data: gastos.map((g) => {
          const fila = serializar(g);
          return {
            ...fila,
            // Decisión 11: con `?periodo=`, lo que esta fila aporta a ESE período.
            ...imputacionDeFila(fila, periodo),
            editable: !congelados.has(g.id),
            creadoPor: autores.get(g.createdBy) ?? null,
          };
        }),
        pagination: {
          page,
          limit,
          total: totales.cantidad,
          totalPages: Math.ceil(totales.cantidad / limit),
        },
        totales,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST / — alta del gasto (org_admin; el gestor cae en el 403 de Cerbos)
gastosDeEdificioRouter.post(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('gasto', 'create', recursoDeEdificio),
  validarBody(crearGastoSchema),
  async (req, res, next) => {
    try {
      const invalido = await validacionesCruzadas(
        req.organizacionId,
        req.edificio.id,
        req.body
      );
      if (invalido) return res.status(invalido.status).json(invalido.body);

      // Decisión 11: `cuotasTotal` no es una columna del gasto — es la entrada
      // del plan, y las cuotas se crean en la misma transacción implícita del
      // `create` anidado (un gasto con plan a medias no debe existir).
      const { cuotasTotal, ...campos } = req.body;
      const cuotas = filasDeCuotas({ ...campos, cuotasTotal }, req.organizacionId);

      const gasto = await prisma.gasto.create({
        data: {
          ...campos,
          organizacionId: req.organizacionId,
          edificioId: req.edificio.id,
          createdBy: req.user.id,
          ...(cuotas.length > 0 ? { cuotas: { create: cuotas } } : {}),
        },
        select: CAMPOS,
      });
      return res.status(201).json(serializar(gasto));
    } catch (err) {
      if (err.code === 'P2003') return res.status(422).json(referenciaCaida());
      if (err instanceof LiquidacionError) {
        return res.status(422).json(validacionFallida(err.message));
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Router de gasto: /api/gastos/:id
// ---------------------------------------------------------------------------

const router = Router();

// Resuelve `:id` con el aislamiento de la organización y del gestor. Un gasto de
// OTRA organización responde 404, no 403 (el 403 confirmaría que ese id existe);
// el edificio no asignado a un gestor SÍ responde 403 `EDIFICIO_NO_ASIGNADO`,
// que es el contrato ya establecido por `validarEdificio` para un edificio de la
// propia organización.
async function validarGasto(req, res, next) {
  try {
    // El soft-deleted es 404: para la API ya no existe (sigue en la DB por Ley 941).
    const gasto = await prisma.gasto.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: CAMPOS,
    });
    if (!gasto || gasto.organizacionId !== req.organizacionId) {
      return res.status(404).json(noEncontrado());
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(gasto.edificioId)) {
      return res.status(403).json({
        error: { code: 'EDIFICIO_NO_ASIGNADO', message: 'El edificio no está asignado a este gestor' },
      });
    }

    req.gasto = gasto;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Decisión 2 y 3: candado compartido por PUT y DELETE.
async function rechazarSiEstaLiquidado(req, res, next) {
  try {
    const liquidaciones = await liquidacionesCongelantes(req.gasto.id);
    if (liquidaciones.length > 0) {
      return res.status(409).json(liquidacionAprobada(liquidaciones));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /:id — detalle con las liquidaciones asociadas (PRD-04-02 §2)
router.get(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'read', recursoGasto),
  async (req, res, next) => {
    try {
      const detalles = await prisma.liquidacionDetalle.findMany({
        where: { gastoId: req.gasto.id },
        select: { liquidacion: { select: { id: true, periodo: true, estado: true } } },
      });
      const porId = new Map(detalles.map((d) => [d.liquidacion.id, d.liquidacion]));
      const liquidaciones = [...porId.values()];

      return res.json({
        ...serializar(req.gasto),
        liquidaciones,
        // La UI deshabilita editar/borrar con esto (DoD del sprint) en vez de
        // descubrirlo con un 409 después de abrir el formulario.
        editable: !liquidaciones.some((l) => ESTADOS_CONGELANTES.includes(l.estado)),
      });
    } catch (err) {
      return next(err);
    }
  }
);

// PUT /:id — edición parcial. 409 si el gasto ya está liquidado.
router.put(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'update', recursoGasto),
  // El candado va ANTES de validar el body: un gasto congelado se rechaza con
  // 409 sea lo que venga en el payload, sin que un 422 tape el motivo real.
  rechazarSiEstaLiquidado,
  validarBody(editarGastoSchema),
  async (req, res, next) => {
    try {
      // Las validaciones cruzadas corren sobre el gasto RESULTANTE: cambiar
      // solo `categoria` a B tiene que exigir el `servicioEspecifico` que ya
      // estaba (o el que venga en el mismo PUT).
      // Decisión 11: `cuotasTotal` del gasto persistido sale de sus cuotas, no de
      // una columna, así que el "gasto resultante" tiene que armarlo a mano para
      // que `incoherenciaCuotas` vea el plan que va a quedar (p. ej. pasar a
      // ordinario un gasto que ya tiene plan tiene que fallar).
      const cuotasTotalActual = req.gasto.cuotas?.[0]?.cuotasTotal ?? null;
      const resultante = {
        ...req.gasto,
        cuotasTotal: cuotasTotalActual,
        ...req.body,
      };
      const invalido = await validacionesCruzadas(
        req.organizacionId,
        req.gasto.edificioId,
        resultante,
        { exigirEsquemaActivo: 'esquemaRepartoId' in req.body }
      );
      if (invalido) return res.status(invalido.status).json(invalido.body);

      const { cuotasTotal: _ignorado, ...campos } = req.body;

      // Decisión 11: el plan se REGENERA cuando cambia cualquiera de sus tres
      // entradas (monto, período o cantidad de cuotas). Un plan a medio editar
      // —con la primera mitad al monto viejo— es peor que uno recalculado, y las
      // cuotas ya liquidadas no llegan acá: las frena el 409 del candado.
      const regenerar =
        'cuotasTotal' in req.body || 'monto' in req.body || 'periodo' in req.body;

      const cuotas = regenerar ? filasDeCuotas(resultante, req.organizacionId) : null;

      const gasto = await prisma.$transaction(async (tx) => {
        if (regenerar) {
          await tx.gastoCuota.deleteMany({ where: { gastoId: req.gasto.id } });
        }
        return tx.gasto.update({
          where: { id: req.gasto.id },
          data: {
            ...campos,
            ...(cuotas && cuotas.length > 0 ? { cuotas: { create: cuotas } } : {}),
          },
          select: CAMPOS,
        });
      });
      return res.json(serializar(gasto));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      if (err.code === 'P2003') return res.status(422).json(referenciaCaida());
      if (err instanceof LiquidacionError) {
        return res.status(422).json(validacionFallida(err.message));
      }
      return next(err);
    }
  }
);

// DELETE /:id — soft delete (Ley 941: el registro se conserva). 409 si está liquidado.
router.delete(
  '/:id',
  requireAuth,
  tenant,
  validarGasto,
  autorizar('gasto', 'delete', recursoGasto),
  rechazarSiEstaLiquidado,
  async (req, res, next) => {
    try {
      await prisma.gasto.update({
        where: { id: req.gasto.id },
        data: { deletedAt: new Date() },
      });
      return res.status(204).send();
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json(noEncontrado());
      return next(err);
    }
  }
);

export default router;
