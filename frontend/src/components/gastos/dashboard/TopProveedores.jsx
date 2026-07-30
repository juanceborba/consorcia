// frontend/src/components/gastos/dashboard/TopProveedores.jsx — ConsorcIA
// Top 10 proveedores por monto (S3-16, PRD-04-02 §3.3).
//
// DECISIONES:
//
// 1. RANKING CON BARRA PROPORCIONAL, NO UN CHART DE RECHARTS. Son diez filas con
//    un nombre largo (razón social) y tres números por fila (monto, cantidad,
//    porcentaje): un bar chart obliga a truncar los nombres en el eje y a mandar
//    los números al tooltip, que es donde no se pueden comparar. La barra de
//    fondo da la comparación visual —que es todo lo que aporta el chart— y el
//    resto se lee como texto. También es la razón por la que el backlog del
//    sprint lo lista aparte de los tres charts.
//
// 2. CADA FILA FILTRA POR SU PROVEEDOR (mismo patrón que el rubro y la
//    categoría): "quién se lleva la plata" siempre termina en "mostrame qué le
//    pagamos".
//
// 3. LA BARRA ES RELATIVA AL PRIMERO, no al total. Con un proveedor que se lleva
//    el 60% y nueve que se reparten el resto, las barras sobre el total quedan
//    todas pegadas al cero y el ranking deja de leerse. El porcentaje del total
//    igual está escrito en cada fila, que es donde se lo va a buscar.
import { formatearMonto } from '@/lib/formato';
import { PanelChart } from '@/components/gastos/dashboard/chart-base';

// Ocupa las dos columnas de la grilla del dashboard: son diez filas de texto y,
// con la evolución también a lo ancho, dejarlo en media grilla partía la pantalla
// con una columna vacía al costado.
export default function TopProveedores({ proveedores, proveedorFiltrado, onFiltrarProveedor }) {
  const filas = proveedores ?? [];
  // Decisión 3.
  const maximo = filas.reduce((max, fila) => Math.max(max, Number(fila.total)), 0);

  return (
    <PanelChart
      titulo="Top proveedores"
      descripcion="Los 10 de mayor monto en el filtro activo"
      className="lg:col-span-2"
    >
      {filas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay gastos con proveedor en este filtro
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {filas.map((fila, indice) => {
            const activo = proveedorFiltrado === fila.proveedorId;
            const ancho = maximo > 0 ? (Number(fila.total) / maximo) * 100 : 0;
            return (
              <li key={fila.proveedorId}>
                <button
                  type="button"
                  aria-pressed={activo}
                  aria-label={`Filtrar por el proveedor ${fila.razonSocial}`}
                  className={`relative flex w-full items-baseline justify-between gap-3 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 ${
                    activo ? 'ring-2 ring-ring/40' : ''
                  }`}
                  onClick={() => onFiltrarProveedor(activo ? '' : fila.proveedorId)}
                >
                  {/* Decisión 1: la barra es fondo, no contenido: `aria-hidden`
                      y detrás del texto, que es el que dice el valor. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 rounded-md bg-muted"
                    style={{ width: `${ancho}%` }}
                  />
                  <span className="relative z-10 flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 tabular-nums text-xs text-muted-foreground">
                      {indice + 1}
                    </span>
                    <span className="truncate" title={fila.razonSocial}>
                      {fila.razonSocial}
                    </span>
                  </span>
                  <span className="relative z-10 shrink-0 text-right tabular-nums">
                    <span>{formatearMonto(fila.total)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fila.porcentaje}% · {fila.cantidad === 1 ? '1 gasto' : `${fila.cantidad} gastos`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </PanelChart>
  );
}
