// frontend/src/components/gastos/dashboard/PorCategoriaChart.jsx — ConsorcIA
// Distribución por categoría A/B/C (S3-16, PRD-04-02 §3.3). Reemplaza las tres
// tarjetas de S3-08b, que eran su antecesor.
//
// DECISIONES:
//
// 1. LOS COLORES SON LOS DE LOS BADGES de categoría (`--color-cat-a|b|c`,
//    PRD-07-02 §2.1). Es lo que permite leer el pie sin decodificar una leyenda:
//    el mismo violeta que la fila "B: Ascensor" de la tabla de abajo.
//
// 2. LA LEYENDA MANTIENE EL COPY DE "QUIÉN PAGA" que traían las tarjetas de
//    S3-08b. El eje A/B/C decide QUIÉNES pagan el gasto (art. 2049 CCyC último
//    párrafo), y sin esa línea la categoría se confunde con el rubro o con
//    ordinario/extraordinario — el malentendido esperable del módulo.
//
// 3. CADA CATEGORÍA FILTRA. Es lo que uno quiere hacer justo después de leer el
//    número, y el filtro vive en la URL, así que mueve toda la pantalla. Con una
//    categoría filtrada el pie queda de un solo gajo: es la consecuencia correcta
//    de "mostrame solo esto" y el chip del filtro dice cómo salir.
//
// 4. UNA CATEGORÍA EN CERO SE MUESTRA IGUAL en la leyenda (aunque no tenga gajo):
//    "este edificio no tiene gastos de sector" es información, y ocultar la fila
//    haría parecer que la categoría no existe.
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatearMonto } from '@/lib/formato';
import { Badge } from '@/components/ui/badge';
import {
  ALTO_CHART,
  COLOR_CATEGORIA,
  PanelChart,
  SinDatosChart,
  TooltipChart,
} from '@/components/gastos/dashboard/chart-base';

// Decisión 2: el mismo copy de dominio que las tarjetas de S3-08b.
const CATEGORIAS = [
  { value: 'A', titulo: 'Generales', quienPaga: 'las pagan todas las UF' },
  { value: 'B', titulo: 'Servicios', quienPaga: 'solo las UF con el servicio' },
  { value: 'C', titulo: 'Sectores', quienPaga: 'solo las UF del sector' },
];

export default function PorCategoriaChart({
  porCategoria,
  total,
  categoriaFiltrada,
  onFiltrarCategoria,
}) {
  const filas = CATEGORIAS.map((categoria) => {
    const monto = porCategoria?.[categoria.value] ?? '0.00';
    const valor = Number(monto);
    const totalNumero = Number(total ?? 0);
    return {
      ...categoria,
      monto,
      valor,
      porcentaje: totalNumero > 0 ? ((valor / totalNumero) * 100).toFixed(1) : '0.0',
    };
  });

  // El pie solo grafica lo que tiene monto; la leyenda muestra las tres
  // (decisión 4).
  const gajos = filas.filter((fila) => fila.valor > 0);

  return (
    <PanelChart
      titulo="Distribución por categoría"
      descripcion="Quiénes pagan cada peso del filtro"
    >
      {gajos.length === 0 ? (
        <SinDatosChart mensaje="No hay gastos para distribuir por categoría" />
      ) : (
        <ResponsiveContainer width="100%" height={ALTO_CHART}>
          <PieChart accessibilityLayer>
            <TooltipChart etiquetaDe={(fila) => `${fila.value} — ${fila.titulo}`} />
            <Pie
              data={gajos}
              dataKey="valor"
              nameKey="titulo"
              innerRadius="52%"
              outerRadius="80%"
              paddingAngle={2}
              // Las etiquetas sobre los gajos se pisan cuando uno es chico: los
              // montos van en la leyenda de abajo, que además es el control.
              label={false}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(gajo) => onFiltrarCategoria(gajo?.payload?.value ?? '')}
            >
              {gajos.map((fila) => (
                <Cell
                  key={fila.value}
                  fill={COLOR_CATEGORIA[fila.value]}
                  // Decisión 3: con una categoría filtrada, el resto se apaga.
                  fillOpacity={
                    !categoriaFiltrada || categoriaFiltrada === fila.value ? 1 : 0.25
                  }
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* Leyenda = tabla de valores + control del filtro (decisiones 2 y 3). */}
      <ul className="mt-3 flex flex-col gap-1">
        {filas.map((fila) => {
          const activa = categoriaFiltrada === fila.value;
          return (
            <li key={fila.value}>
              <button
                type="button"
                aria-pressed={activa}
                aria-label={`Filtrar por categoría ${fila.value}`}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent/50 ${
                  activa ? 'bg-accent/60' : ''
                }`}
                onClick={() => onFiltrarCategoria(activa ? '' : fila.value)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant={`categoria${fila.value}`}>{fila.value}</Badge>
                  <span className="truncate">
                    {fila.titulo}
                    <span className="text-xs text-muted-foreground">
                      {' · '}
                      {fila.quienPaga}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatearMonto(fila.monto)} · {fila.porcentaje}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelChart>
  );
}
