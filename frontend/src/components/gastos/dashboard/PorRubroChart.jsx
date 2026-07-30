// frontend/src/components/gastos/dashboard/PorRubroChart.jsx — ConsorcIA
// Distribución por rubro con drill-down a subrubros (S3-16, PRD-04-02 §3.3).
//
// EL DRILL-DOWN NO PIDE NADA AL SERVIDOR: `porRubro` ya viene rollup-eado a rubro
// raíz con sus `subrubros` adentro (precisión 6 de §3.4), justamente para que
// bajar un nivel sea estado local y no un segundo request. Entrar y salir de un
// rubro es instantáneo.
//
// DECISIONES:
//
// 1. TRES GESTOS DISTINTOS SOBRE LA MISMA BARRA, según lo que hay abajo:
//    - Rubro raíz CON subrubros → entra al drill-down (mostrar el desglose es
//      más informativo que filtrar por el rubro entero).
//    - Rubro raíz SIN subrubros → filtra todo el dashboard por ese rubro (no hay
//      nivel al que bajar; el gasto apunta siempre a una hoja).
//    - Subrubro dentro del drill-down → filtra por esa hoja.
//    El filtro es de la pantalla entera (vive en la URL), así que también mueve
//    los KPIs, los otros charts y la lista: es la lectura correcta de "quiero ver
//    solo esto".
//
// 2. BARRAS HORIZONTALES. Los nombres de rubro son palabras ("Mantenimiento",
//    "Servicios públicos"), y en vertical hay que rotarlas o truncarlas. En
//    horizontal el eje de categorías tiene todo el ancho que necesita y el orden
//    descendente que ya trae el backend se lee de arriba hacia abajo.
//
// 3. MONOCROMÁTICO. Diez rubros en diez colores sugieren una categorización que
//    no existe; el largo de la barra ya es la comparación. La única barra con
//    otro color es la del rubro filtrado, cuando hay uno.
import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChevronLeft } from 'lucide-react';
import { formatearMonto, formatearMontoCorto } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import {
  ALTO_CHART,
  COLOR_EJE,
  COLOR_SERIE,
  COLOR_SERIE_TENUE,
  PanelChart,
  SinDatosChart,
  TooltipChart,
} from '@/components/gastos/dashboard/chart-base';

export default function PorRubroChart({ porRubro, rubroFiltrado, onFiltrarRubro }) {
  // Rubro raíz en el que está entrado el drill-down (decisión 1).
  const [abierto, setAbierto] = useState(null);

  const raices = porRubro ?? [];
  const raiz = raices.find((r) => r.rubroId === abierto) ?? null;

  // Un cambio de filtro puede dejar sin gastos al rubro abierto y el panel
  // quedaría en un drill-down vacío sin forma obvia de volver.
  useEffect(() => {
    if (abierto && !raices.some((r) => r.rubroId === abierto)) setAbierto(null);
  }, [abierto, raices]);

  const filas = raiz ? raiz.subrubros : raices;
  const datos = filas.map((fila) => ({ ...fila, valor: Number(fila.total) }));

  function alClickear(fila) {
    if (!fila) return;
    const esRaiz = !raiz;
    const tieneHijos = esRaiz && fila.subrubros?.length > 0;
    if (tieneHijos) {
      setAbierto(fila.rubroId);
      return;
    }
    // Decisión 1: sin nivel al que bajar, la barra filtra (y vuelve a
    // desfiltrar si ya era el rubro activo).
    onFiltrarRubro(rubroFiltrado === fila.rubroId ? '' : fila.rubroId);
  }

  return (
    <PanelChart
      titulo={raiz ? `Rubro: ${raiz.nombre}` : 'Distribución por rubro'}
      descripcion={
        raiz
          ? 'Subrubros de este rubro. Clickeá uno para filtrar todo el dashboard'
          : 'Clickeá un rubro para ver sus subrubros o filtrar por él'
      }
      acciones={
        raiz && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-fit"
            onClick={() => setAbierto(null)}
          >
            <ChevronLeft className="size-4" />
            Todos los rubros
          </Button>
        )
      }
    >
      {datos.length === 0 ? (
        <SinDatosChart
          mensaje={
            raiz
              ? 'Este rubro no tiene subrubros con gastos en el filtro'
              : 'No hay gastos con rubro para agrupar'
          }
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={ALTO_CHART}>
            {/* Decisión 2: `layout="vertical"` es el de barras horizontales. */}
            <BarChart
              data={datos}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              accessibilityLayer
            >
              <XAxis
                type="number"
                stroke={COLOR_EJE}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatearMontoCorto}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                stroke={COLOR_EJE}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={128}
              />
              <TooltipChart etiquetaDe={(fila) => fila.nombre} />
              <Bar
                dataKey="valor"
                name="Gasto del rubro"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(_, indice) => alClickear(datos[indice])}
              >
                {datos.map((fila) => (
                  // Decisión 3: color solo para distinguir el rubro filtrado.
                  <Cell
                    key={fila.rubroId}
                    fill={
                      rubroFiltrado && rubroFiltrado !== fila.rubroId
                        ? COLOR_SERIE_TENUE
                        : COLOR_SERIE
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Los mismos valores como lista de botones. Es lo que hace usable el
              drill-down con teclado —las barras de un SVG no son focusables— y
              por eso este chart NO lleva `TablaAccesible`: la lista ya dice los
              valores como texto y la tabla oculta los anunciaría dos veces. */}
          <ul className="mt-3 flex flex-col gap-1">
            {datos.map((fila) => (
              <li key={fila.rubroId}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent/50"
                  aria-pressed={rubroFiltrado === fila.rubroId}
                  onClick={() => alClickear(fila)}
                >
                  <span className="truncate">
                    {fila.nombre}
                    {!raiz && fila.subrubros?.length > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        ({fila.subrubros.length})
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatearMonto(fila.total)} · {fila.porcentaje}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelChart>
  );
}
