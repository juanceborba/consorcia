// frontend/src/components/gastos/dashboard/EvolucionMensualChart.jsx — ConsorcIA
// Evolución mensual del gasto (S3-16, PRD-04-02 §3.3). Line chart de la serie
// `evolucionMensual` del endpoint de S3-15.
//
// LO QUE HAY QUE SABER PARA LEER ESTE CHART (precisión 5 de §3.4, decidido en el
// backend): la serie NO es la ventana del filtro activo.
//
//   - Con un período filtrado son los 12 períodos que TERMINAN en ese período, y
//     su último punto es igual al KPI total. Un chart de evolución de un solo
//     punto no es un chart, así que el backend le da su propia ventana.
//   - Con un rango de fechas o todo el histórico, la serie va de la imputación
//     más vieja a la más nueva y SUMA el KPI total (las cuotas de un gasto se ven
//     en los períodos que les tocan).
//
// De ahí el subtítulo del panel: sin él, un usuario que filtró "julio" y ve doce
// meses cree que el filtro no se aplicó.
//
// DECISIONES:
//
// 1. LÍNEA, NO ÁREA NI BARRAS. Es una serie temporal continua de un solo valor:
//    el área agrega tinta sin agregar información y las barras sugieren que cada
//    mes es una categoría independiente, que es justo lo contrario de lo que este
//    chart vino a mostrar.
//
// 2. EL ÚLTIMO PUNTO VA MARCADO cuando el modo es `periodo`: es el mes que el
//    usuario filtró y el que coincide con el KPI total. Sin la marca, el chart y
//    los KPIs se leen como dos cosas que no se hablan.
//
// 3. UN MES SIN GASTOS ES UN 0.00, no un hueco (lo garantiza el backend
//    densificando la serie). El chart no interpola nada.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatearMonto,
  formatearMontoCorto,
  formatearPeriodo,
  formatearPeriodoCorto,
} from '@/lib/formato';
import {
  ALTO_CHART,
  COLOR_EJE,
  COLOR_GRILLA,
  COLOR_SERIE,
  PanelChart,
  SinDatosChart,
  TablaAccesible,
  TooltipChart,
} from '@/components/gastos/dashboard/chart-base';

const DESCRIPCION = {
  periodo: 'Los 12 períodos que terminan en el filtrado; el último es el total de arriba',
  rango: 'Los períodos imputados del rango filtrado; su suma es el total de arriba',
  todo: 'Todo el histórico imputado; su suma es el total de arriba',
};

export default function EvolucionMensualChart({ serie, modoPeriodo, periodoFiltrado }) {
  const datos = (serie ?? []).map((punto) => ({
    ...punto,
    total: Number(punto.total),
    etiqueta: formatearPeriodoCorto(punto.periodo),
  }));

  const hayGasto = datos.some((punto) => punto.total > 0);

  return (
    <PanelChart
      titulo="Evolución mensual"
      descripcion={DESCRIPCION[modoPeriodo]}
      className="lg:col-span-2"
    >
      {datos.length === 0 || !hayGasto ? (
        <SinDatosChart mensaje="Todavía no hay gastos imputados para graficar" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={ALTO_CHART}>
            <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} accessibilityLayer>
              <CartesianGrid stroke={COLOR_GRILLA} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="etiqueta"
                stroke={COLOR_EJE}
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={COLOR_EJE}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={70}
                tickFormatter={formatearMontoCorto}
              />
              <TooltipChart etiquetaDe={(fila) => formatearPeriodo(fila.periodo)} />
              <Line
                type="monotone"
                dataKey="total"
                name="Gasto del mes"
                stroke={COLOR_SERIE}
                strokeWidth={2}
                // Decisión 2: solo el punto del período filtrado lleva marca.
                dot={({ key, cx, cy, payload }) =>
                  modoPeriodo === 'periodo' && payload.periodo === periodoFiltrado ? (
                    <circle
                      key={key}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={COLOR_SERIE}
                      stroke="var(--color-background)"
                      strokeWidth={2}
                    />
                  ) : (
                    // Recharts espera un elemento SVG por punto; un `false`
                    // rompe el render de la serie entera.
                    <circle key={key} cx={cx} cy={cy} r={0} />
                  )
                }
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>

          <TablaAccesible
            titulo="Evolución mensual del gasto"
            filas={datos.map((punto) => ({
              etiqueta: formatearPeriodo(punto.periodo),
              valor: formatearMonto(punto.total),
            }))}
          />
        </>
      )}
    </PanelChart>
  );
}
