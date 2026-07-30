// frontend/src/components/gastos/dashboard/chart-base.jsx — ConsorcIA
// Piezas compartidas por los charts del dashboard de gastos (S3-16): el panel
// que los envuelve, el tooltip, el empty state y la tabla accesible.
//
// Es la primera vez que entran gráficos a la app (recharts), así que las
// decisiones de presentación se toman UNA vez acá en vez de repetirse en cada
// chart:
//
// 1. LOS COLORES SALEN DE LOS TOKENS, NO DE UNA PALETA DE RECHARTS. El SVG
//    acepta `fill="var(--color-…)"`, así que los charts usan los mismos tokens
//    que el resto de la app y siguen el tema claro/oscuro sin una segunda
//    definición de color. Las categorías A/B/C usan `--color-cat-a|b|c`, los
//    MISMOS colores que sus badges (PRD-07-02 §2.1): el pie no necesita que el
//    usuario decodifique una leyenda si ya vio esos colores en la tabla. Los
//    charts sin semántica de color propia (evolución, rubros) usan el
//    monocromático `--chart-*` del style base-nova: pintar diez rubros de diez
//    colores distintos sugiere una categorización que no existe.
//
// 2. EL TOOLTIP ES PROPIO. El de recharts trae fondo blanco y borde fijos, que en
//    modo oscuro queda ilegible, y formatea los números con `toString()`. Este
//    usa los tokens de `popover` y `formatearMonto`, así que el monto del tooltip
//    es idéntico al de los KPIs y al de la tabla.
//
// 3. CADA CHART LLEVA SU TABLA `sr-only`. Un `<svg>` de barras no dice nada a un
//    lector de pantalla, y el dato ya está en memoria: renderizar la serie como
//    tabla oculta cuesta nada y hace que la pantalla sea legible sin ver
//    (PRD-07-02 §6.6). Es también lo que hace que un spec de Playwright pueda
//    afirmar sobre los valores del chart sin leer el SVG.
//
// 4. UN CHART VACÍO ES UN MENSAJE, NO UN GRÁFICO VACÍO. Con el filtro sin
//    resultados, recharts dibuja los ejes y un área en blanco que se lee como un
//    error de carga. `SinDatosChart` ocupa el mismo alto y dice por qué.
import { Tooltip } from 'recharts';
import { formatearMonto } from '@/lib/formato';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Decisión 1: tokens, no hexas sueltos.
export const COLOR_CATEGORIA = {
  A: 'var(--color-cat-a)',
  B: 'var(--color-cat-b)',
  C: 'var(--color-cat-c)',
};
export const COLOR_SERIE = 'var(--color-chart-4)';
export const COLOR_SERIE_TENUE = 'var(--color-chart-1)';
export const COLOR_EJE = 'var(--color-muted-foreground)';
export const COLOR_GRILLA = 'var(--color-border)';

// Alto fijo de los charts: `ResponsiveContainer` necesita un alto concreto del
// padre y los tres charts comparten el mismo para que la fila no quede despareja.
export const ALTO_CHART = 260;

/** Panel de un componente del dashboard: título, ayuda opcional y contenido. */
export function PanelChart({ titulo, descripcion, acciones, children, className }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        {descripcion && <CardDescription>{descripcion}</CardDescription>}
        {acciones}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Decisión 4. */
export function SinDatosChart({ mensaje = 'No hay gastos que mostrar con este filtro' }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
      style={{ height: ALTO_CHART }}
    >
      {mensaje}
    </div>
  );
}

/** Decisión 2: tooltip con los tokens de la app y montos formateados. */
function ContenidoTooltip({ active, payload, label, etiquetaDe }) {
  if (!active || !payload?.length) return null;
  const punto = payload[0];
  const fila = punto.payload ?? {};
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{etiquetaDe ? etiquetaDe(fila, label) : label}</p>
      <p className="tabular-nums">{formatearMonto(punto.value)}</p>
      {fila.cantidad !== undefined && (
        <p className="text-muted-foreground">
          {fila.cantidad === 1 ? '1 gasto' : `${fila.cantidad} gastos`}
          {fila.porcentaje !== undefined && ` · ${fila.porcentaje}% del total`}
        </p>
      )}
    </div>
  );
}

/**
 * El `<Tooltip>` de recharts ya configurado. Se exporta como componente y no
 * como prop suelta para que los tres charts no repitan el cursor ni el estilo.
 */
export function TooltipChart({ etiquetaDe }) {
  return (
    <Tooltip
      content={<ContenidoTooltip etiquetaDe={etiquetaDe} />}
      cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.5 }}
    />
  );
}

/**
 * Decisión 3: la serie del chart como tabla oculta.
 *
 * @param {string} titulo  caption de la tabla (lo que anuncia el lector)
 * @param {Array<{etiqueta: string, valor: string}>} filas
 */
export function TablaAccesible({ titulo, filas }) {
  return (
    <table className="sr-only">
      <caption>{titulo}</caption>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila.etiqueta}>
            <th scope="row">{fila.etiqueta}</th>
            <td>{fila.valor}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
