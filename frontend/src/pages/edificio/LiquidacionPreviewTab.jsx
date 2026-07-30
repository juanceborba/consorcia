// frontend/src/pages/edificio/LiquidacionPreviewTab.jsx — ConsorcIA
// Preview de una liquidación (S3-09, PRD-04-03 §4.1): cards de resumen,
// detalle por unidad con la variación contra la liquidación anterior, y el
// desglose del reparto de cada UF.
//
// DECISIONES:
//
// 1. LA PREVIEW ES LA PANTALLA DONDE SE VERIFICA EL REPARTO, no un resumen
//    bonito. Es el último momento antes de aprobar en el que el administrador
//    puede detectar que una unidad está pagando lo que no le toca, y después de
//    aprobar el número se convierte en un recibo con valor legal (Ley 941). Por
//    eso cada fila se puede expandir para ver, gasto por gasto, con qué peso se
//    repartió y qué esquema del reglamento lo fijó (`esquemaNombre`, S3-20) —
//    los datos que el backend ya venía devolviendo en `unidades[].pesos[]` y que
//    hasta ahora no tenían dónde mostrarse.
//
// 2. EL PESO QUE SE MUESTRA ES EL NORMALIZADO, que es lo que el motor persiste
//    en `coeficienteAplicado` (`peso ÷ Σpesos`, ver `distribuir()` en
//    liquidacion.engine.js). Se rotula como "participación" y no como
//    "coeficiente" justamente porque en un gasto B/C o con esquema de reparto NO
//    es el coeficiente de la UF: es la porción de ESE gasto que le tocó. Los
//    pesos de un mismo gasto suman 1.
//
// 3. LA VARIACIÓN ES POR UNIDAD, no solo del total (§4.1 la dibuja como columna
//    de la tabla). "Las expensas subieron 8%" no es lo que pregunta un
//    propietario: pregunta cuánto subió LA SUYA, y con gastos de categoría B/C
//    las dos cosas se despegan. Se compara contra la liquidación vigente
//    anterior (ver `liquidacionAnterior`), y si no hay ninguna la columna
//    directamente no se dibuja en vez de mostrar una columna de guiones.
//
// 4. LA FILA TOTAL DE LA TABLA TIENE QUE RECONCILIAR CON LAS CARDS AL CENTAVO.
//    Es el DoD del sprint ("la suma de los detalles = totalGeneral al centavo").
//    Los totales de las cards son los del backend y el pie de la tabla suma las
//    filas con decimal.js: si alguna vez difieren, la pantalla lo muestra en vez
//    de esconderlo — un descuadre acá es un bug del motor, no un detalle de
//    presentación.
//
// 5. LAS ACCIONES DEL WORKFLOW VIVEN EN LA CABECERA, JUNTO AL BADGE DE ESTADO
//    (S3-10). Es el mismo bloque que dice en qué estado está la liquidación, así
//    que es donde se lee "está en borrador" y se decide "la apruebo". El mockup
//    del PRD las dibuja en un pie fijo; acá van arriba porque la tabla por unidad
//    puede tener 40 filas y el administrador que ya verificó el reparto no
//    debería tener que scrollear hasta el final para aprobar.
//    Qué botones aparecen lo decide `accionesDeLiquidacion` (espejo del backend)
//    y solo se ofrecen al org_admin: `cerbos/policies/liquidacion.yaml` le da al
//    gestor únicamente `read`, igual que con "Generar liquidación" en la lista.
//
// 6. LAS ALERTAS DE ANOMALÍAS DEL MOCKUP (§4.1, "este gasto es 50% mayor que el
//    promedio histórico") NO se implementan: son análisis de IA sobre la serie
//    histórica del edificio (PRD-03-*, S6). La comparación contra el período
//    anterior de la decisión 3 es la parte de esa idea que se puede sostener hoy
//    con datos ciertos.
import { useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { ArrowLeft, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearMonto, formatearPeriodo } from '@/lib/formato';
import {
  estadoDeLiquidacion,
  formatearVariacion,
  liquidacionAnterior,
  variacionPorcentual,
  variantDeVariacion,
} from '@/lib/liquidacion';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import AccionesLiquidacion from '@/components/liquidaciones/AccionesLiquidacion';
import RecibosCard from '@/components/liquidaciones/RecibosCard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const FILTROS_LISTA = { page: 1, limit: 50 };

// Card de un total. `variacion` es opcional: solo aparece si hay período previo.
function CardTotal({ titulo, monto, detalle, variacion }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{titulo}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {formatearMonto(monto)}
        </CardTitle>
      </CardHeader>
      {(detalle || variacion !== null) && (
        <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          {variacion !== null && variacion !== undefined && (
            <Badge variant={variantDeVariacion(variacion)}>
              {formatearVariacion(variacion)}
            </Badge>
          )}
          {detalle}
        </CardContent>
      )}
    </Card>
  );
}

// Desglose del reparto de una UF: en qué se le fue cada peso (decisión 1).
function DesgloseDeUnidad({ pesos, colSpan }) {
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="px-6 py-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Cómo se compone el total de esta unidad: un renglón por gasto del
            período, con la porción de ese gasto que le tocó.
          </p>
          <ul className="flex flex-col gap-1 text-xs">
            {pesos.map((p) => (
              <li
                key={`${p.gastoId}-${p.cuotaNumero ?? 'unica'}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span className="text-muted-foreground">
                  {/* S3-19: el rótulo de la cuota sale del snapshot del detalle. */}
                  {p.cuotaNumero
                    ? `Cuota ${p.cuotaNumero}/${p.cuotasTotal}`
                    : 'Imputación única'}
                  {' · '}
                  {/* Decisión 2: participación, no coeficiente. */}
                  participación {p.pesoAplicado}
                  {/* S3-20: null = repartido por coeficiente según la categoría. */}
                  {p.esquemaNombre ? ` · esquema "${p.esquemaNombre}"` : ''}
                </span>
                <span className="font-medium tabular-nums">
                  {formatearMonto(p.montoAsignado)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function LiquidacionPreviewTab() {
  const { edificio } = useOutletContext();
  const { liquidacionId } = useParams();
  const [expandida, setExpandida] = useState(null);
  // Decisión 5: aprobar/anular/emitir son del administrador de la organización.
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const puedeOperar = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.liquidaciones.detail(liquidacionId),
    queryFn: () => api.get(`/api/liquidaciones/${liquidacionId}`),
  });

  // Lista del edificio: de acá sale la liquidación anterior con la que comparar.
  const { data: lista } = useQuery({
    queryKey: queryKeys.liquidaciones.porEdificio(edificio.id, FILTROS_LISTA),
    queryFn: () =>
      api.get(
        `/api/edificios/${edificio.id}/liquidaciones?page=${FILTROS_LISTA.page}&limit=${FILTROS_LISTA.limit}`,
      ),
    enabled: Boolean(data),
  });

  const anterior = useMemo(
    () => (data ? liquidacionAnterior(lista?.data, data.periodo) : null),
    [lista, data],
  );

  // Decisión 3: el detalle por UF del período anterior, para la columna de
  // variación. Solo se pide si existe una liquidación anterior.
  const { data: previewAnterior } = useQuery({
    queryKey: queryKeys.liquidaciones.detail(anterior?.id),
    queryFn: () => api.get(`/api/liquidaciones/${anterior.id}`),
    enabled: Boolean(anterior?.id),
  });

  const totalesAnteriores = useMemo(() => {
    const mapa = new Map();
    for (const u of previewAnterior?.unidades ?? []) mapa.set(u.unidadId, u.total);
    return mapa;
  }, [previewAnterior]);

  // Decisión 4: el pie de la tabla se suma con decimal.js, no con Number.
  const sumaDeFilas = useMemo(() => {
    const cero = new Decimal(0);
    return (data?.unidades ?? []).reduce(
      (acc, u) => ({
        ordinarias: acc.ordinarias.plus(u.ordinarias),
        extraordinarias: acc.extraordinarias.plus(u.extraordinarias),
        total: acc.total.plus(u.total),
      }),
      { ordinarias: cero, extraordinarias: cero, total: cero },
    );
  }, [data]);

  const descuadre = useMemo(
    () =>
      data ? !sumaDeFilas.total.equals(new Decimal(data.totalGeneral)) : false,
    [data, sumaDeFilas],
  );

  const volver = (
    <Link
      to={`/edificios/${edificio.id}/liquidaciones`}
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Volver a liquidaciones
    </Link>
  );

  if (isPending) {
    return (
      <div className="flex animate-pulse flex-col gap-4">
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  if (isError) {
    const noExiste = error instanceof ApiError && error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        {volver}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {noExiste
              ? 'Esta liquidación no existe o pertenece a otro edificio'
              : 'No se pudo cargar la liquidación'}
          </p>
          {!noExiste && (
            <p className="text-sm text-muted-foreground">{error.message}</p>
          )}
        </div>
      </div>
    );
  }

  const estado = estadoDeLiquidacion(data.estado);
  const hayComparacion = Boolean(previewAnterior);
  const columnas = hayComparacion ? 6 : 5;

  return (
    <div className="flex flex-col gap-4">
      {volver}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileText className="size-5 shrink-0" />
            Liquidación de {formatearPeriodo(data.periodo)}
            <Badge variant={estado.variant}>{estado.label}</Badge>
            <AyudaLink variant="icon" topic="liquidaciones/preview" />
          </CardTitle>
          <CardDescription>
            {estado.descripcion}
            {data.matriculaRPA && ` · Matrícula RPA ${data.matriculaRPA}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              {data.resumen.cantidadGastos} gasto(s) repartidos entre{' '}
              {data.resumen.cantidadUnidades} unidad(es).
              {anterior &&
                ` Se compara contra la liquidación de ${formatearPeriodo(anterior.periodo)}.`}
            </p>
            {data.estado === 'BORRADOR' && (
              <p>
                Es un borrador: todavía no se emitió nada. Revisá el detalle por
                unidad antes de aprobarla.
              </p>
            )}
          </div>
          {/* Decisión 5: las acciones del workflow, según el estado y el rol. */}
          {puedeOperar && <AccionesLiquidacion liquidacion={data} />}
        </CardContent>
      </Card>

      {/* Decisión 4: si el pie no reconcilia con el total, se dice. */}
      {descuadre && (
        <Alert variant="danger" title="Los totales no reconcilian">
          La suma del detalle por unidad ({formatearMonto(sumaDeFilas.total.toFixed(2))})
          no coincide con el total general de la liquidación (
          {formatearMonto(data.totalGeneral)}). No la apruebes y avisá al
          soporte: es un error de cálculo, no de visualización.
        </Alert>
      )}

      {/* Resumen (§4.1) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardTotal
          titulo="Expensas ordinarias"
          monto={data.totalOrdinarias}
          detalle="Gastos habituales del período"
          variacion={
            previewAnterior
              ? variacionPorcentual(
                  data.totalOrdinarias,
                  previewAnterior.totalOrdinarias,
                )
              : null
          }
        />
        <CardTotal
          titulo="Expensas extraordinarias"
          monto={data.totalExtraordinarias}
          detalle="Obras y gastos no recurrentes"
          variacion={
            previewAnterior
              ? variacionPorcentual(
                  data.totalExtraordinarias,
                  previewAnterior.totalExtraordinarias,
                )
              : null
          }
        />
        <CardTotal
          titulo="Total general"
          monto={data.totalGeneral}
          detalle={`${data.resumen.cantidadGastos} gastos · ${data.resumen.cantidadUnidades} unidades`}
          variacion={
            previewAnterior
              ? variacionPorcentual(data.totalGeneral, previewAnterior.totalGeneral)
              : null
          }
        />
      </div>

      {/* Detalle por unidad (§4.1) */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle por unidad</CardTitle>
          <CardDescription>
            Lo que le toca pagar a cada unidad funcional. Tocá una fila para ver
            cómo se compone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UF</TableHead>
                <TableHead className="text-right">Coeficiente</TableHead>
                <TableHead className="text-right">Ordinarias</TableHead>
                <TableHead className="text-right">Extraordinarias</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {hayComparacion && (
                  <TableHead
                    className="text-right"
                    title={`Variación del total contra ${formatearPeriodo(anterior.periodo)}`}
                  >
                    Variación
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unidades.map((u) => {
                const abierta = expandida === u.unidadId;
                const pct = hayComparacion
                  ? variacionPorcentual(u.total, totalesAnteriores.get(u.unidadId))
                  : null;
                return [
                  <TableRow
                    key={u.unidadId}
                    className="cursor-pointer"
                    aria-expanded={abierta}
                    onClick={() => setExpandida(abierta ? null : u.unidadId)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1">
                        {abierta ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        {u.numero}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {u.coeficiente}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatearMonto(u.ordinarias)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatearMonto(u.extraordinarias)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatearMonto(u.total)}
                    </TableCell>
                    {hayComparacion && (
                      <TableCell className="text-right">
                        <Badge variant={variantDeVariacion(pct)}>
                          {formatearVariacion(pct)}
                        </Badge>
                      </TableCell>
                    )}
                  </TableRow>,
                  abierta && (
                    <DesgloseDeUnidad
                      key={`${u.unidadId}-desglose`}
                      pesos={u.pesos}
                      colSpan={columnas}
                    />
                  ),
                ];
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  TOTAL
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatearMonto(sumaDeFilas.ordinarias.toFixed(2))}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatearMonto(sumaDeFilas.extraordinarias.toFixed(2))}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatearMonto(sumaDeFilas.total.toFixed(2))}
                </TableCell>
                {hayComparacion && <TableCell />}
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* Recibos emitidos (S3-10). La card se oculta sola mientras la
          liquidación no llegó a un estado donde puedan existir. El gestor no
          los emite pero sí los descarga (`cerbos/policies/recibo.yaml`). */}
      <RecibosCard liquidacion={data} puedeEmitir={puedeOperar} />
    </div>
  );
}
