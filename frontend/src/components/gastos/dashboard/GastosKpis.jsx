// frontend/src/components/gastos/dashboard/GastosKpis.jsx — ConsorcIA
// Los KPI cards del dashboard de gastos (S3-16, PRD-04-02 §3.1). Reemplazan el
// totalizador segmentado del listado de S3-08b, que era su antecesor: los mismos
// tres números salen ahora del endpoint del dashboard (S3-15) junto con el gasto
// por UF, la cantidad y la variación.
//
// DECISIONES:
//
// 1. LAS TARJETAS DE ORDINARIAS Y EXTRAORDINARIAS SON EL CONTROL DEL FILTRO DE
//    TIPO. El dashboard IGNORA `esOrdinario` a propósito (precisión 3 de §3.4):
//    ese desglose ES el corte por ese eje y filtrarlo dejaría el otro subtotal en
//    cero. Pero el listado de abajo sí lo aplica, así que el filtro tiene que
//    poder ponerse desde algún lado: la tarjeta que muestra el subtotal es el
//    lugar natural para pedir "mostrame esos gastos". Es el mismo patrón que las
//    tarjetas por categoría de S3-08b.
//
// 2. CUANDO EL FILTRO DE TIPO ESTÁ ACTIVO SE AVISA, no se disimula. Es el único
//    filtro que mueve la tabla sin mover los KPIs, y un total que no coincide con
//    la fila TOTAL de abajo sin explicación es exactamente el bug fantasma que
//    reporta un administrador. La nota dice qué está pasando y el chip del filtro
//    sigue permitiendo quitarlo.
//
// 3. LA VARIACIÓN SE OCULTA CUANDO ES `null`. El backend la devuelve así cuando
//    no hay ventana anterior comparable o cuando está vacía (precisión 8 de
//    §3.4): un "+∞%" o un "sin datos" en el lugar del número es ruido. El color
//    va al revés que en una métrica de negocio: en gastos, SUBIR es la mala
//    noticia (warning) y bajar es la buena (success).
//
// 4. EL GASTO POR UF DICE SOBRE CUÁNTAS UNIDADES DIVIDE. Es el número que un
//    administrador compara contra la expensa que va a emitir, y en el consolidado
//    de la organización el divisor son todas las UFs de todos los edificios: sin
//    el denominador a la vista, el número no se puede verificar.
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { formatearMonto } from '@/lib/formato';
import { Badge } from '@/components/ui/badge';

const ROTULO_TOTAL = {
  periodo: 'Total del período',
  rango: 'Total del rango',
  todo: 'Total histórico',
};

// Decisión 3: el signo del string ES el dato ("+12.4%" / "-8.0%").
function VariacionBadge({ variacion }) {
  if (!variacion) return null;
  const sube = variacion.startsWith('+');
  const plano = variacion === '+0.0%' || variacion === '-0.0%';
  const Icono = plano ? Minus : sube ? TrendingUp : TrendingDown;
  return (
    <Badge variant={plano ? 'secondary' : sube ? 'warning' : 'success'} className="gap-1">
      <Icono aria-hidden="true" />
      {variacion}
    </Badge>
  );
}

// Tarjeta base. `onClick` la convierte en el control de un filtro (decisión 1);
// sin `onClick` es un `<div>`, porque un botón que no hace nada es una promesa
// incumplida para el teclado.
function Kpi({ titulo, monto, detalle, extra, destacada, activa, onClick, aria }) {
  const contenido = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          {titulo}
        </span>
        {extra}
      </span>
      <span
        className={`tabular-nums ${destacada ? 'text-2xl font-semibold' : 'text-xl font-semibold'}`}
      >
        {monto}
      </span>
      {detalle && <span className="text-xs text-muted-foreground">{detalle}</span>}
    </>
  );

  const clases = `flex flex-col gap-1 rounded-lg border p-4 text-left ${
    destacada ? 'bg-muted/40' : ''
  }`;

  // Sin `onClick` la tarjeta es una región con nombre, no un botón: `role="group"`
  // + `aria-label` le da al lector de pantalla (y a un spec de Playwright) una
  // forma de referirse a "la tarjeta del total" sin depender del árbol de divs.
  if (!onClick) {
    return (
      <div role="group" aria-label={titulo} className={clases}>
        {contenido}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={activa}
      aria-label={aria}
      className={`${clases} transition-colors hover:bg-accent/50 ${
        activa ? 'border-ring ring-3 ring-ring/30' : ''
      }`}
      onClick={onClick}
    >
      {contenido}
    </button>
  );
}

export default function GastosKpis({
  kpis,
  filtro,
  modoPeriodo,
  tipoActivo,
  onFiltrarTipo,
}) {
  const unidades = filtro?.unidades ?? 0;
  const cantidad = kpis?.cantidadGastos ?? 0;

  // Decisión 1: cada tarjeta de tipo togglea su filtro. Sin `onFiltrarTipo` no
  // hay filtro que poner (es el caso del reporte consolidado, que no tiene
  // listado debajo): las tarjetas quedan como texto y no como botones que no
  // hacen nada.
  const alternarTipo = (valor) =>
    onFiltrarTipo ? () => onFiltrarTipo(tipoActivo === valor ? '' : valor) : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          destacada
          titulo={ROTULO_TOTAL[modoPeriodo] ?? 'Total'}
          monto={formatearMonto(kpis?.total ?? '0.00')}
          detalle="Ordinarias + extraordinarias"
          extra={<VariacionBadge variacion={kpis?.variacionVsPeriodoAnterior} />}
        />

        <Kpi
          titulo="Ordinarias"
          monto={formatearMonto(kpis?.totalOrdinarias ?? '0.00')}
          detalle="Gasto corriente del mes a mes"
          activa={tipoActivo === 'ordinario'}
          aria="Filtrar la lista por gastos ordinarios"
          onClick={alternarTipo('ordinario')}
        />

        <Kpi
          titulo="Extraordinarias"
          monto={formatearMonto(kpis?.totalExtraordinarias ?? '0.00')}
          detalle="Se liquidan aparte"
          activa={tipoActivo === 'extraordinario'}
          aria="Filtrar la lista por gastos extraordinarios"
          onClick={alternarTipo('extraordinario')}
        />

        {/* Decisión 4. */}
        <Kpi
          titulo="Gasto por UF"
          monto={kpis?.gastoPorUF ? formatearMonto(kpis.gastoPorUF) : '—'}
          detalle={
            kpis?.gastoPorUF
              ? `Promedio sobre ${unidades === 1 ? '1 unidad' : `${unidades} unidades`}`
              : 'El alcance no tiene unidades cargadas'
          }
        />

        <Kpi
          titulo="Cantidad de gastos"
          monto={cantidad.toLocaleString('es-AR')}
          detalle={
            cantidad === 0
              ? 'Ningún gasto con este filtro'
              : 'Comprobantes alcanzados por el filtro'
          }
        />
      </div>

      {/* Decisión 2. */}
      {tipoActivo && (
        <p className="text-xs text-muted-foreground">
          El filtro de tipo solo se aplica a la lista de abajo: los KPIs y los
          gráficos siguen mostrando el total, porque el desglose de ordinarias y
          extraordinarias es justamente ese corte.
        </p>
      )}
    </div>
  );
}
