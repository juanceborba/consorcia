// src/routes/liquidaciones.routes.js — Endpoints de liquidación (S3-04)
// Spec: PRD-04-03 §1 (máquina de estados), §2 (flujo), §3 (contrato), §4.1
// (preview) · motor: src/core/liquidacion.engine.js (S3-03) ·
// policy: cerbos/policies/liquidacion.yaml (S3-01). Contrato:
//   POST /api/edificios/:id/liquidaciones → calcular y persistir BORRADOR → 201
//   GET  /api/edificios/:id/liquidaciones → lista (estado, período, totales)
//   GET  /api/liquidaciones/:id           → preview (totales + detalle por UF)
//   POST /api/liquidaciones/:id/aprobar   → BORRADOR → APROBADA
//   POST /api/liquidaciones/:id/anular    → ANULADA (habilita regenerar)
//
// Exporta DOS routers, igual que gastos (S3-02): `liquidacionesDeEdificioRouter`
// (montado bajo `/api/edificios/:id/liquidaciones` con `mergeParams`) y el
// default sobre `/api/liquidaciones`.
//
// DECISIONES de S3-04:
//
// 1. **El gate de coeficientes vive en la ruta, no en el motor** (AGENTS.md
//    "Invariante de coeficientes"). Antes de correr el engine se llama a
//    `validarParaLiquidacion` con los coeficientes de TODAS las unidades del
//    edificio y, si no cierran exactos en 1.000000, la respuesta es
//    `422 COEFICIENTES_NO_CUADRAN` con `sumaActual` y `delta`
//    (`errorCoeficientes`, el body que ya estaba definido en el servicio).
//    El motor sigue validando lo mismo por su cuenta y tira
//    `SUMA_COEFICIENTES_INVALIDA` — es defensa en profundidad, no el contrato:
//    ese código se MAPEA al mismo `422 COEFICIENTES_NO_CUADRAN` si llegara a
//    escapar (carrera: alguien edita una UF entre el gate y el cálculo). El
//    contrato público tiene UN solo código para "los coeficientes no suman 1",
//    y es el que la UI de S2 ya conoce.
//
// 2. **Todas las unidades del edificio participan**, sin filtrar por `estado`
//    (ACTIVA/INACTIVA/EN_VENTA/ALQUILADA). Es la misma población con la que S2
//    calcula la suma informativa (`estadoEdificio` en unidades.routes.js): si el
//    gate exige que sumen 1 sobre todas las UF, excluir algunas al distribuir
//    dejaría el reparto en menos del 100% del gasto. El `estado` de una UF es
//    comercial (está en venta, está alquilada), no dice que deje de pagar
//    expensas.
//
// 3. **Unicidad del período** (índice único parcial de S3-01, que excluye
//    ANULADA): se chequea antes con un `findFirst` para dar un error claro
//    (`409 PERIODO_YA_LIQUIDADO`, con el id y el estado de la que ya existe) y
//    se vuelve a cubrir en el `catch` del P2002 para la carrera de dos requests
//    simultáneos. Anular libera el período: es exactamente para lo que existe
//    el índice parcial.
//
// 4. **Las transiciones se aplican con un UPDATE condicional** (`updateMany`
//    filtrando por los estados de origen permitidos), no con un read-then-write.
//    Dos "aprobar" en paralelo, con la lectura previa ambos ven BORRADOR; el
//    segundo UPDATE matchea 0 filas y responde `409 ESTADO_INVALIDO`. Sin esto
//    la segunda aprobación sobrescribiría `approvedBy/approvedAt`.
//
// 5. **Divergencias con PRD-04-03 §1** (documentadas, el PRD se actualiza en
//    esta misma tarea):
//    - `PENDIENTE_APROBACION` existe en el enum y en la cadena del PRD, pero
//      ningún endpoint del sprint lo produce: el cálculo persiste BORRADOR y el
//      admin aprueba desde ahí (el "Approval Inbox" del §2 PASO 4 es S6). Se
//      acepta como origen válido de `aprobar` para no bloquear a quien lo
//      introduzca después, pero nada lo escribe hoy.
//    - `anular` NO se permite sobre COBRADA. El diagrama del PRD encadena
//      `COBRADA → ANULADA` ("si hay error grave"), pero una liquidación cobrada
//      tiene `Cobro` asociados: anularla dejaría plata imputada a un documento
//      inexistente y habilitaría regenerar el período por el índice parcial. La
//      reversión de una liquidación ya cobrada es un contra-asiento del módulo
//      de cobranzas (PRD-04-04), no un cambio de estado. Hoy responde
//      `409 ESTADO_INVALIDO`.
//    - Los códigos HTTP son los del backlog de S3, no los del pseudocódigo del
//      §3: `422` para las validaciones de negocio (`SIN_GASTOS`,
//      `GASTOS_SIN_CATEGORIA`, `COEFICIENTES_NO_CUADRAN`) y `409` para los
//      conflictos de estado (`ESTADO_INVALIDO`, `PERIODO_YA_LIQUIDADO`), en vez
//      del `400` genérico del PRD. Y el error viaja en `{ error: { code,
//      message } }`, el formato del contrato (AGENTS.md).
//
// 6. **`matriculaRPA` se hereda edificio → organización** y se COPIA a la
//    liquidación al crearla. Ley 941: la matrícula es del administrador
//    responsable en el momento de emitir; si la organización la cambia después,
//    los recibos ya emitidos tienen que seguir mostrando la que se usó.
//
// 7. Los montos y los coeficientes salen como STRING (`"12345.67"`,
//    `"0.076543"`). Prisma devuelve `Decimal` y `JSON.stringify` lo
//    serializaría como número, reintroduciendo el float en el borde de salida.
//
// DECISIONES de S3-05 (recibos, #35):
//
// 8. **`enviar` NO es idempotente: la segunda llamada responde 409
//    ESTADO_INVALIDO.** Es el mismo criterio que `aprobar` y sale gratis de la
//    máquina de estados (APROBADA → ENVIADA), pero además es lo correcto: los
//    recibos son comprobantes numerados de un acto administrativo, no un
//    artefacto regenerable. Re-emitir el mismo período exige anular y
//    regenerar. Los recibos ya emitidos siguen listándose y descargándose.
//
// 9. **La transición se reclama ANTES de generar los PDFs.** El UPDATE
//    condicional a ENVIADA es el candado contra dos `enviar` en paralelo (el
//    segundo matchea 0 filas y se va con 409 sin escribir un solo archivo). Si
//    la generación falla después, el estado se revierte a APROBADA
//    (best-effort) y la respuesta es 500: mejor volver a APROBADA que dejar una
//    liquidación ENVIADA sin recibos.
//
// 10. Los PDFs se persisten en el **filesystem del contenedor**, no en MinIO.
//     El motivo y el seam para migrar están en `src/services/almacenamiento.js`.

import { Router } from 'express';
import Decimal from 'decimal.js';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { tenant, validarEdificio } from '../middleware/tenant.middleware.js';
import { autorizar } from '../middleware/rbac.middleware.js';
import { validarBody, validarQuery } from '../middleware/validation.middleware.js';
import {
  calcularLiquidacionSchema,
  listarLiquidacionesSchema,
} from '../schemas/liquidacion.schema.js';
import {
  LiquidacionEngine,
  LiquidacionError,
  imputacionDelPeriodo,
} from '../core/liquidacion.engine.js';
import {
  sumarCoeficientes,
  validarParaLiquidacion,
  errorCoeficientes,
} from '../services/coeficientes.js';
import { SELECT_DETALLE, itemDeDetalle, agruparItems } from '../core/detalle-agrupado.js';
import { resolutorDeEsquemas } from '../services/esquemas-reparto.js';
import {
  calcularAporte,
  explicarRegla,
  reglaVigente,
  valorDeLaRegla,
} from '../services/fondo-reserva.js';
import { emitirRecibos, serializarRecibo, ReciboError } from '../services/recibos.js';

// ---------------------------------------------------------------------------
// Máquina de estados (decisión 4 y 5)
// ---------------------------------------------------------------------------

// Estados en los que el período sigue "tomado" para el índice único parcial.
export const ESTADOS_VIGENTES = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'ENVIADA',
  'COBRADA',
];

// Transiciones permitidas por acción. `enviar` (APROBADA → ENVIADA) es de S3-05
// y se declara acá para que la máquina de estados viva en un solo lugar.
export const TRANSICIONES = {
  aprobar: { desde: ['BORRADOR', 'PENDIENTE_APROBACION'], hacia: 'APROBADA' },
  enviar: { desde: ['APROBADA'], hacia: 'ENVIADA' },
  anular: { desde: ['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA'], hacia: 'ANULADA' },
};

// ---------------------------------------------------------------------------
// Helpers de errores y serialización
// ---------------------------------------------------------------------------

const noEncontrada = () => ({
  error: { code: 'LIQUIDACION_NO_ENCONTRADA', message: 'La liquidación no existe' },
});

const sinGastos = (periodo) => ({
  error: {
    code: 'SIN_GASTOS',
    message: `No hay gastos cargados para el período ${periodo}`,
  },
});

const gastosSinCategoria = (cantidad) => ({
  error: {
    code: 'GASTOS_SIN_CATEGORIA',
    message: `${cantidad} gasto(s) del período no tienen categoría asignada (A, B o C)`,
  },
});

const periodoYaLiquidado = (existente) => ({
  error: {
    code: 'PERIODO_YA_LIQUIDADO',
    message: `El período ${existente.periodo} ya tiene una liquidación vigente (${existente.estado}): para regenerarlo hay que anularla`,
    liquidacionId: existente.id,
    estado: existente.estado,
  },
});

const estadoInvalido = (accion, estadoActual) => ({
  error: {
    code: 'ESTADO_INVALIDO',
    message: `No se puede ${accion} una liquidación en estado ${estadoActual} (se permite desde: ${TRANSICIONES[
      accion
    ].desde.join(', ')})`,
    estadoActual,
  },
});

// Una sola definición del árbol del detalle, compartida con la emisión de
// recibos (`core/detalle-agrupado.js`): la preview y el PDF muestran lo mismo.
const dinero = (valor) => new Decimal(valor).toFixed(2);
const coeficiente = (valor) => new Decimal(valor).toFixed(6);

// Cabecera de la liquidación tal como la consumen la lista y las transiciones.
const CAMPOS = {
  id: true,
  organizacionId: true,
  edificioId: true,
  periodo: true,
  estado: true,
  fechaLiquidacion: true,
  totalOrdinarias: true,
  totalExtraordinarias: true,
  // S3-21: el fondo es el tercer subtotal, con el snapshot de la regla que lo
  // produjo (la regla puede cambiar después; lo emitido no).
  totalFondoReserva: true,
  reglaFondoReservaId: true,
  fondoReservaBase: true,
  fondoReservaValor: true,
  totalGeneral: true,
  matriculaRPA: true,
  createdAt: true,
  updatedAt: true,
  approvedBy: true,
  approvedAt: true,
};

const serializar = (l) => ({
  ...l,
  totalOrdinarias: dinero(l.totalOrdinarias),
  totalExtraordinarias: dinero(l.totalExtraordinarias),
  totalFondoReserva: dinero(l.totalFondoReserva),
  totalGeneral: dinero(l.totalGeneral),
  // Cómo se lee el aporte: "5,00% de las expensas ordinarias". Sale del
  // snapshot y no de la regla vigente, por la misma razón que el monto.
  fondoReserva: l.fondoReservaBase
    ? {
        base: l.fondoReservaBase,
        valor: l.fondoReservaValor === null ? null : String(l.fondoReservaValor),
        descripcion: explicarRegla({
          base: l.fondoReservaBase,
          porcentaje: l.fondoReservaValor,
          montoFijo: l.fondoReservaValor,
        }),
      }
    : null,
});

// Recurso Cerbos: scope doble org + edificio (contrato en cerbos/policies/liquidacion.yaml).
const recursoDeEdificio = (req) => ({
  id: req.edificio.id,
  attr: {
    id: req.edificio.id,
    organizacion_id: req.edificio.organizacionId,
    edificio_id: req.edificio.id,
  },
});

const recursoLiquidacion = (req) => ({
  id: req.liquidacion.id,
  attr: {
    id: req.liquidacion.id,
    organizacion_id: req.liquidacion.organizacionId,
    edificio_id: req.liquidacion.edificioId,
  },
});

// ---------------------------------------------------------------------------
// Preview (PRD-04-03 §4.1): totales + detalle por UF
// ---------------------------------------------------------------------------
//
// El detalle se agrega en memoria con decimal.js sobre los `LiquidacionDetalle`
// persistidos, separando ordinarias de extraordinarias por `gasto.esOrdinario`
// (Ley 941: la separación es obligatoria y tiene que poder mostrarse por UF).
//
// Cada UF sale con dos vistas del MISMO dato, y las dos las arma
// `core/detalle-agrupado.js` para que no puedan divergir entre sí ni contra el
// PDF del recibo (decisión 1 de ese módulo):
//
//   `pesos`     — la lista plana, un renglón por gasto con la participación
//                 aplicada. Es la vista de AUDITORÍA del reparto: es lo que el
//                 administrador recorre para ver que ninguna UF paga lo que no
//                 le toca (S3-18).
//   `secciones` — el árbol ordinarias/extraordinarias → rubro → subrubro con
//                 subtotales. Es la vista del PROPIETARIO: la que se dibuja en
//                 la preview y la que imprime el recibo.
//
// Van las dos porque responden preguntas distintas y ninguna se deriva barato
// de la otra en el cliente; los ítems del árbol son los mismos objetos de
// `pesos`, así que no hay dos verdades, hay dos índices sobre una.
async function preview(liquidacion) {
  const detalles = await prisma.liquidacionDetalle.findMany({
    where: { organizacionId: liquidacion.organizacionId, liquidacionId: liquidacion.id },
    select: SELECT_DETALLE,
  });

  const porUnidad = new Map();
  const gastos = new Set();

  for (const d of detalles) {
    if (d.gastoId) gastos.add(d.gastoId);

    if (!porUnidad.has(d.unidadId)) {
      porUnidad.set(d.unidadId, {
        unidadId: d.unidadId,
        numero: d.unidad.numero,
        tipo: d.unidad.tipo,
        m2: new Decimal(d.unidad.m2).toFixed(2),
        coeficiente: coeficiente(d.unidad.coeficiente),
        ordinarias: new Decimal(0),
        extraordinarias: new Decimal(0),
        // S3-21: lo que esta UF aporta al fondo del período.
        fondoReserva: new Decimal(0),
        // S3-18: el peso que el motor aplicó A CADA GASTO de esta UF. No es
        // redundante con `coeficiente`: en un gasto B/C es el coeficiente
        // renormalizado entre las alcanzadas, y cuando existan los esquemas de
        // reparto (S3-20) puede ser cualquier otra cosa que fije el reglamento
        // (exención parcial, coeficiente propio del sector, partes iguales).
        // Mostrarlo es lo que le permite al administrador ver ANTES de aprobar
        // que el reparto es el que su reglamento manda.
        pesos: [],
      });
    }

    const fila = porUnidad.get(d.unidadId);
    const monto = new Decimal(d.montoAsignado);
    if (d.tipo === 'FONDO_RESERVA') fila.fondoReserva = fila.fondoReserva.plus(monto);
    else if (d.gasto.esOrdinario) fila.ordinarias = fila.ordinarias.plus(monto);
    else fila.extraordinarias = fila.extraordinarias.plus(monto);
    // Solo los pesos que participan: un 0 en una UF no alcanzada es ruido.
    if (new Decimal(d.coeficienteAplicado).gt(0)) fila.pesos.push(itemDeDetalle(d));
  }

  const unidades = [...porUnidad.values()]
    .sort((a, b) => a.numero.localeCompare(b.numero, 'es'))
    .map((u) => ({
      ...u,
      ordinarias: u.ordinarias.toFixed(2),
      extraordinarias: u.extraordinarias.toFixed(2),
      fondoReserva: u.fondoReserva.toFixed(2),
      total: u.ordinarias.plus(u.extraordinarias).plus(u.fondoReserva).toFixed(2),
      secciones: agruparItems(u.pesos),
    }));

  return {
    ...serializar(liquidacion),
    resumen: {
      cantidadGastos: gastos.size,
      cantidadUnidades: unidades.length,
      cantidadDetalles: detalles.length,
    },
    unidades,
  };
}

// ---------------------------------------------------------------------------
// Router de edificio: /api/edificios/:id/liquidaciones
// ---------------------------------------------------------------------------

export const liquidacionesDeEdificioRouter = Router({ mergeParams: true });

// GET / — lista del edificio (período desc), con estado y totales
liquidacionesDeEdificioRouter.get(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('liquidacion', 'read', recursoDeEdificio),
  validarQuery(listarLiquidacionesSchema),
  async (req, res, next) => {
    try {
      const { periodo, estado, page, limit } = req.filtros;
      const where = {
        organizacionId: req.organizacionId,
        edificioId: req.edificio.id,
        ...(periodo ? { periodo } : {}),
        ...(estado ? { estado } : {}),
      };

      const [total, liquidaciones] = await Promise.all([
        prisma.liquidacion.count({ where }),
        prisma.liquidacion.findMany({
          where,
          select: CAMPOS,
          // `createdAt` desempata: un período anulado y su regeneración
          // comparten `periodo` y tienen que salir siempre en el mismo orden.
          orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return res.json({
        data: liquidaciones.map(serializar),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST / — calcular el período y persistirlo como BORRADOR (org_admin;
// el gestor cae en el 403 de Cerbos, `liquidacion.yaml` le da solo `read`)
liquidacionesDeEdificioRouter.post(
  '/',
  requireAuth,
  tenant,
  validarEdificio,
  autorizar('liquidacion', 'create', recursoDeEdificio),
  validarBody(calcularLiquidacionSchema),
  async (req, res, next) => {
    const { periodo } = req.body;
    const organizacionId = req.organizacionId;
    const edificioId = req.edificio.id;

    try {
      // Decisión 3: período ya tomado por una liquidación no anulada.
      const vigente = await prisma.liquidacion.findFirst({
        where: { organizacionId, edificioId, periodo, estado: { in: ESTADOS_VIGENTES } },
        select: { id: true, periodo: true, estado: true },
      });
      if (vigente) return res.status(409).json(periodoYaLiquidado(vigente));

      // PASO 1 del §2: validar las IMPUTACIONES del período (los soft-deleted no
      // participan — para la API ya no existen, S3-02 decisión 3).
      //
      // S3-19: lo que se liquida es una imputación, no siempre un gasto entero.
      // El período incluye los gastos de imputación única de ese período MÁS los
      // gastos en cuotas cuya cuota cae ahí, y de esos se reparte el monto de la
      // cuota con la categoría/servicio/sector del gasto padre. Un gasto sin plan
      // se comporta exactamente como antes.
      const gastosDelPeriodo = await prisma.gasto.findMany({
        where: {
          organizacionId,
          edificioId,
          deletedAt: null,
          OR: [{ periodo, cuotas: { none: {} } }, { cuotas: { some: { periodo } } }],
        },
        select: {
          id: true,
          monto: true,
          moneda: true,
          categoria: true,
          servicioEspecifico: true,
          sectorEspecifico: true,
          esOrdinario: true,
          periodo: true,
          // S3-20: el override del gasto es la primera opción de la resolución.
          esquemaRepartoId: true,
          cuotas: {
            where: { periodo },
            select: { id: true, numero: true, cuotasTotal: true, periodo: true, monto: true },
          },
        },
        // Orden estable: el ajuste de centavos del motor depende del orden en
        // que se distribuyen los gastos, así que recalcular el mismo período
        // tiene que dar exactamente los mismos detalles.
        orderBy: [{ fechaGasto: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });

      // `imputacionDelPeriodo` devuelve null si al gasto no le toca nada en el
      // período; con el `where` de arriba eso no debería pasar, y el filtro es la
      // red que evita repartir un gasto que no corresponde si alguna vez difieren.
      // S3-20: el esquema de reparto de cada gasto se resuelve ACÁ (la resolución
      // pega a la DB; el motor recibe el esquema ya elegido, igual que recibe la
      // imputación ya elegida). Un resolutor por liquidación, así los N gastos se
      // resuelven contra la MISMA foto de la configuración del edificio.
      const resolver = await resolutorDeEsquemas(organizacionId, edificioId);

      const gastos = gastosDelPeriodo
        .map((g) => imputacionDelPeriodo(g, periodo))
        .filter((imputacion) => imputacion !== null)
        .map((imputacion) => ({ ...imputacion, esquema: resolver(imputacion) }));

      if (gastos.length === 0) return res.status(422).json(sinGastos(periodo));

      const sinCategoria = gastos.filter((g) => !g.categoria);
      if (sinCategoria.length > 0) {
        return res.status(422).json(gastosSinCategoria(sinCategoria.length));
      }

      // Decisión 2: todas las unidades del edificio, orden estable.
      const unidades = await prisma.unidad.findMany({
        where: { organizacionId, edificioId },
        select: { id: true, coeficiente: true, categoriaB: true, categoriaC: true },
        orderBy: [{ numero: 'asc' }, { id: 'asc' }],
      });

      // Decisión 1: el gate duro de coeficientes es de la ruta.
      const gate = validarParaLiquidacion(unidades.map((u) => u.coeficiente));
      if (!gate.ok) {
        return res.status(422).json(errorCoeficientes(sumarCoeficientes(unidades.map((u) => u.coeficiente))));
      }

      // S3-21: la regla del fondo VIGENTE EN EL PERÍODO (no la actual), con su
      // esquema propio si lo tiene y, si no, el general del edificio — que es lo
      // que ya devuelve el resolutor para un gasto sin esquema propio.
      const regla = await reglaVigente(organizacionId, edificioId, periodo);
      const esquemaDelFondo = regla
        ? resolver({ esquemaRepartoId: regla.esquemaRepartoId, categoria: 'A' })
        : null;

      // PASO 2: el motor determinístico (decimal.js, cero floats).
      const calculada = await LiquidacionEngine.calcularLiquidacion(
        edificioId,
        periodo,
        gastos,
        unidades,
        {
          fondoReserva: regla
            ? {
                aporte: calcularAporte(regla, {
                  totalOrdinarias: gastos
                    .filter((g) => g.esOrdinario)
                    .reduce((suma, g) => suma.plus(new Decimal(g.montoImputado ?? g.monto)), new Decimal(0)),
                  totalExtraordinarias: gastos
                    .filter((g) => !g.esOrdinario)
                    .reduce((suma, g) => suma.plus(new Decimal(g.montoImputado ?? g.monto)), new Decimal(0)),
                }),
                esquema: esquemaDelFondo,
              }
            : undefined,
        }
      );

      // Decisión 6: la matrícula RPA es de la organización y se copia acá.
      const organizacion = await prisma.organizacion.findUnique({
        where: { id: organizacionId },
        select: { matriculaRPA: true },
      });

      const creada = await prisma.liquidacion.create({
        data: {
          organizacionId,
          edificioId,
          periodo,
          fechaLiquidacion: new Date(),
          estado: 'BORRADOR',
          totalOrdinarias: calculada.totalOrdinarias,
          totalExtraordinarias: calculada.totalExtraordinarias,
          totalFondoReserva: calculada.totalFondoReserva,
          // Snapshot de la regla aplicada (S3-21).
          reglaFondoReservaId: regla?.id ?? null,
          fondoReservaBase: regla?.base ?? null,
          fondoReservaValor: valorDeLaRegla(regla),
          totalGeneral: calculada.totalGeneral,
          matriculaRPA: organizacion.matriculaRPA,
          detalles: {
            create: calculada.detalles.map((d) => ({
              organizacionId,
              tipo: d.tipo,
              unidadId: d.unidadId,
              gastoId: d.gastoId,
              // S3-19: snapshot de la cuota imputada (null = imputación única).
              gastoCuotaId: d.gastoCuotaId,
              cuotaNumero: d.cuotaNumero,
              cuotasTotal: d.cuotasTotal,
              // S3-20: snapshot del esquema aplicado (null = por coeficiente).
              esquemaRepartoId: d.esquemaRepartoId,
              esquemaNombre: d.esquemaNombre,
              coeficienteAplicado: d.coeficienteAplicado,
              montoAsignado: d.montoAsignado,
            })),
          },
        },
        select: CAMPOS,
      });

      return res.status(201).json(await preview(creada));
    } catch (err) {
      // Carrera del índice único parcial (decisión 3).
      if (err.code === 'P2002') {
        const existente = await prisma.liquidacion.findFirst({
          where: { organizacionId, edificioId, periodo, estado: { in: ESTADOS_VIGENTES } },
          select: { id: true, periodo: true, estado: true },
        });
        return res
          .status(409)
          .json(periodoYaLiquidado(existente ?? { id: null, periodo, estado: 'BORRADOR' }));
      }
      // Decisión 1: el error del motor se mapea al código del contrato.
      if (err instanceof LiquidacionError && err.codigo === 'SUMA_COEFICIENTES_INVALIDA') {
        return res.status(422).json(errorCoeficientes(new Decimal(err.metadata.sumaActual)));
      }
      if (err instanceof LiquidacionError) {
        return res.status(422).json({ error: { code: err.codigo, message: err.message } });
      }
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Router de liquidación: /api/liquidaciones/:id
// ---------------------------------------------------------------------------

const router = Router();

// Resuelve `:id` con el aislamiento de la organización y del gestor, igual que
// `validarGasto` (S3-02): una liquidación de OTRA organización responde 404 (un
// 403 confirmaría que ese id existe), y el edificio no asignado a un gestor
// responde el 403 `EDIFICIO_NO_ASIGNADO` que ya es contrato de `validarEdificio`.
async function validarLiquidacion(req, res, next) {
  try {
    const liquidacion = await prisma.liquidacion.findUnique({
      where: { id: req.params.id },
      select: CAMPOS,
    });
    if (!liquidacion || liquidacion.organizacionId !== req.organizacionId) {
      return res.status(404).json(noEncontrada());
    }

    const esGestor = req.user.roles.includes('gestor');
    if (esGestor && !req.user.edificiosAsignados.includes(liquidacion.edificioId)) {
      return res.status(403).json({
        error: {
          code: 'EDIFICIO_NO_ASIGNADO',
          message: 'El edificio no está asignado a este gestor',
        },
      });
    }

    req.liquidacion = liquidacion;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Decisión 4: UPDATE condicional por estado de origen. Devuelve la fila
// actualizada, o responde 409 `ESTADO_INVALIDO` con el estado que realmente
// tiene (releído: pudo cambiar entre la lectura del middleware y el UPDATE).
function transicion(accion, datosExtra = () => ({})) {
  return async (req, res, next) => {
    try {
      const { desde, hacia } = TRANSICIONES[accion];
      const { count } = await prisma.liquidacion.updateMany({
        where: {
          id: req.liquidacion.id,
          organizacionId: req.organizacionId,
          estado: { in: desde },
        },
        data: { estado: hacia, ...datosExtra(req) },
      });

      if (count === 0) {
        const actual = await prisma.liquidacion.findUnique({
          where: { id: req.liquidacion.id },
          select: { estado: true },
        });
        if (!actual) return res.status(404).json(noEncontrada());
        return res.status(409).json(estadoInvalido(accion, actual.estado));
      }

      const actualizada = await prisma.liquidacion.findUnique({
        where: { id: req.liquidacion.id },
        select: CAMPOS,
      });
      return res.json(serializar(actualizada));
    } catch (err) {
      return next(err);
    }
  };
}

// GET /:id — preview: totales ord/ext/general + detalle por UF (PRD-04-03 §4.1)
router.get(
  '/:id',
  requireAuth,
  tenant,
  validarLiquidacion,
  autorizar('liquidacion', 'read', recursoLiquidacion),
  async (req, res, next) => {
    try {
      return res.json(await preview(req.liquidacion));
    } catch (err) {
      return next(err);
    }
  }
);

// POST /:id/aprobar — BORRADOR → APROBADA, con approvedBy/approvedAt
router.post(
  '/:id/aprobar',
  requireAuth,
  tenant,
  validarLiquidacion,
  autorizar('liquidacion', 'aprobar', recursoLiquidacion),
  transicion('aprobar', (req) => ({ approvedBy: req.user.id, approvedAt: new Date() }))
);

// POST /:id/anular — → ANULADA. Libera el período para regenerarlo (índice
// único parcial de S3-01). No se permite sobre COBRADA (decisión 5).
router.post(
  '/:id/anular',
  requireAuth,
  tenant,
  validarLiquidacion,
  autorizar('liquidacion', 'anular', recursoLiquidacion),
  transicion('anular')
);

// POST /:id/enviar — APROBADA → ENVIADA: emite un recibo PDF con QR por UF
// (S3-05, PRD-02-05 §4 / PRD-06-01 §3). "Enviar" en el MVP es *emitir y dejar
// disponible para descarga*: el envío por email es AgentMail (post-beta,
// PRD-04-03 §2 PASO 5).
router.post(
  '/:id/enviar',
  requireAuth,
  tenant,
  validarLiquidacion,
  autorizar('liquidacion', 'enviar', recursoLiquidacion),
  async (req, res, next) => {
    const { desde, hacia } = TRANSICIONES.enviar;
    let reclamada = false;

    try {
      // Decisión 9: reclamar el estado ANTES de generar (candado anti doble envío).
      const { count } = await prisma.liquidacion.updateMany({
        where: {
          id: req.liquidacion.id,
          organizacionId: req.organizacionId,
          estado: { in: desde },
        },
        data: { estado: hacia },
      });

      if (count === 0) {
        const actual = await prisma.liquidacion.findUnique({
          where: { id: req.liquidacion.id },
          select: { estado: true },
        });
        if (!actual) return res.status(404).json(noEncontrada());
        return res.status(409).json(estadoInvalido('enviar', actual.estado));
      }
      reclamada = true;

      const recibos = await emitirRecibos(req.liquidacion);
      const actualizada = await prisma.liquidacion.findUnique({
        where: { id: req.liquidacion.id },
        select: CAMPOS,
      });

      return res.json({
        ...serializar(actualizada),
        recibos: { emitidos: recibos.length, data: recibos.map(serializarRecibo) },
      });
    } catch (err) {
      // Decisión 9: volver a APROBADA antes de propagar el error.
      if (reclamada) {
        await prisma.liquidacion
          .updateMany({
            where: { id: req.liquidacion.id, organizacionId: req.organizacionId, estado: hacia },
            data: { estado: 'APROBADA' },
          })
          .catch(() => {});
      }

      if (err instanceof ReciboError) {
        return res.status(422).json({
          error: { code: err.codigo, message: err.message, ...err.metadata },
        });
      }
      return next(err);
    }
  }
);

// GET /:id/recibos — recibos emitidos de la liquidación (UF, número, totales y
// la URL de descarga). Lista vacía mientras la liquidación no se envió.
router.get(
  '/:id/recibos',
  requireAuth,
  tenant,
  validarLiquidacion,
  autorizar('liquidacion', 'read', recursoLiquidacion),
  async (req, res, next) => {
    try {
      const recibos = await prisma.recibo.findMany({
        where: { organizacionId: req.organizacionId, liquidacionId: req.liquidacion.id },
        include: { unidad: { select: { id: true, numero: true, tipo: true } } },
        orderBy: { numero: 'asc' },
      });

      return res.json({
        liquidacionId: req.liquidacion.id,
        periodo: req.liquidacion.periodo,
        estado: req.liquidacion.estado,
        data: recibos.map(serializarRecibo),
      });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
