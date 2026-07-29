// frontend/src/pages/edificio/EdificioGastosTab.jsx — ConsorcIA
// Tab "Gastos" del detalle de edificio (S3-07), según el mockup de
// PRD-04-02 §4.1: columnas concepto / monto / categoría / tipo / período, fila
// TOTAL del filtro activo, filtros de período + categoría + tipo y paginación
// server-side. Sigue los patrones de tabla de S2-08 (EdificioUnidadesTab) y las
// reglas de listados de PRD-07-02 §6.2 (empty state y skeleton siempre).
//
// DECISIONES de S3-07:
//
// 1. RUTA: el tab vive en `/edificios/:id/gastos`, no en la sección top-level
//    `/gastos` que dibuja el árbol de rutas de PRD-07-03 §2.1. PRD-04-02 §3 es
//    explícito ("el tab `gastos` del detalle de edificio"), el endpoint está
//    scopeado por edificio (`/api/edificios/:id/gastos`) y el DoD del sprint
//    arranca en "login admin → tab gastos". Se aplica la convención "tabs como
//    rutas hijas" de PRD-07-03 §2.2; el árbol de §2.1 queda desactualizado y se
//    anota en el PRD como los casos de S2-07/S4-07. La vista consolidada de
//    `/gastos` a nivel organización es Business+ y llega con el dashboard
//    (S3-15/S3-16).
//
// 2. FILTROS EN LA URL (`useSearchParams`), no en estado local: PRD-07-03 §2.2
//    lo pide para los filtros de lista (`/gastos?periodo=2026-07&categoria=A`),
//    hace compartible/recargable la vista, y es el punto de enganche de S3-16,
//    que va a colgar el dashboard arriba de esta lista "compartiendo filtros vía
//    URL/search params". El default de período es el mes corriente (§4.1).
//    `periodo=todos` es el centinela de "sin filtro de período": la ausencia del
//    param significa "el default", no "todos", así que hacía falta distinguirlos.
//
// 3. SIN SORT POR COLUMNA. El backend fija el orden (`fechaGasto desc`, decisión
//    de S3-02) y pagina del lado del servidor: un sort client-side reordenaría
//    solo las 50 filas de la página en curso y mentiría sobre el conjunto. Es la
//    diferencia con la tabla de unidades de S2-08, que trae todo en una página y
//    por eso sí ordena en el cliente. El sort real es trabajo de backend
//    (`orderBy` en el contrato) y no está en el alcance de esta tarea.
//
// 4. La fila TOTAL usa `totales.monto` del backend (suma del filtro COMPLETO,
//    decisión 5 de S3-02), no la suma de la página. Por eso el pie no necesita
//    el disclaimer de "totales parciales" que sí tiene la tabla de unidades.
//
// 5. Moneda mixta: `totales.monto` suma sin discriminar `moneda` (el schema
//    admite ARS y USD y el agregado del backend no agrupa por moneda). Mientras
//    el filtro no tenga `moneda`, la fila TOTAL se rotula en ARS y, si la página
//    trae algún gasto en otra moneda, se muestra una nota advirtiendo que el
//    total mezcla monedas. Es lo honesto que se puede hacer sin tocar el
//    endpoint; el fix de fondo (agregado por moneda) es del dashboard, S3-15.
import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import { useGastos } from '@/hooks/useGastos';
import {
  formatearMonto,
  formatearPeriodo,
  periodoActual,
  ultimosPeriodos,
} from '@/lib/formato';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Página del contrato de `listarGastosSchema` (default 50, máx 100).
const LIMIT = 50;

// Centinela de "sin filtro de período" (decisión 2).
const TODOS_LOS_PERIODOS = 'todos';

const CATEGORIAS = [
  { value: '', label: 'Todas' },
  { value: 'A', label: 'A — Generales' },
  { value: 'B', label: 'B — Servicio específico' },
  { value: 'C', label: 'C — Sector específico' },
];

const TIPOS = [
  { value: '', label: 'Todos' },
  { value: 'ordinario', label: 'Ordinario' },
  { value: 'extraordinario', label: 'Extraordinario' },
];

// Badge de la categoría con su detalle: A se reparte a todas las UF, B lleva el
// servicio y C el sector (invariantes de `incoherenciaCategoria` en el backend).
// Mismos tokens de dominio que las categorías de unidades (S2-05).
function CategoriaGasto({ gasto }) {
  const detalle =
    gasto.categoria === 'B'
      ? gasto.servicioEspecifico
      : gasto.categoria === 'C'
        ? gasto.sectorEspecifico
        : null;
  return (
    <Badge variant={`categoria${gasto.categoria}`}>
      {detalle ? `${gasto.categoria}: ${detalle}` : gasto.categoria}
    </Badge>
  );
}

// Skeleton de carga inicial (PRD-07-02 §6.2/§6.4): replica la estructura de la
// tabla, igual que el de unidades.
function GastosSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-10 rounded bg-muted" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

// Empty state (§6.2): nunca tabla vacía sin mensaje. El copy distingue "no hay
// gastos todavía" de "los filtros no matchean", que son dos problemas distintos.
function EmptyState({ hayFiltros, onLimpiar }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Receipt className="size-8 text-muted-foreground" />
      <p className="font-medium">
        {hayFiltros
          ? 'Ningún gasto coincide con los filtros'
          : 'Este edificio todavía no tiene gastos'}
      </p>
      <p className="text-sm text-muted-foreground">
        {hayFiltros
          ? 'Probá con otro período o quitá los filtros de categoría y tipo.'
          : 'Cargá los gastos del período para poder liquidar las expensas.'}
      </p>
      {hayFiltros && (
        <Button variant="outline" size="sm" onClick={onLimpiar}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}

function EstadoError() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <Receipt className="size-8 text-muted-foreground" />
      <p className="font-medium">No se pudieron cargar los gastos</p>
      <p className="text-sm text-muted-foreground">Intentá de nuevo más tarde.</p>
    </div>
  );
}

export default function EdificioGastosTab() {
  const { edificio } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();

  // El default del período es el mes corriente; los períodos ofrecidos son los
  // últimos 12 (PRD-04-02 §3.2). Se memoiza para que un re-render no genere una
  // lista nueva (y una key de query nueva) a medianoche o en cada paginación.
  const periodos = useMemo(() => ultimosPeriodos(12), []);
  const periodoDefault = periodos[0] ?? periodoActual();

  const periodo = searchParams.get('periodo') ?? periodoDefault;
  const categoria = searchParams.get('categoria') ?? '';
  const tipo = searchParams.get('tipo') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  // Un período elegido a mano que no esté entre los últimos 12 (link viejo,
  // filtro compartido) tiene que seguir siendo seleccionable en el combo.
  const opcionesPeriodo =
    periodo === TODOS_LOS_PERIODOS || periodos.includes(periodo)
      ? periodos
      : [periodo, ...periodos];

  const filtros = {
    periodo: periodo === TODOS_LOS_PERIODOS ? undefined : periodo,
    categoria: categoria || undefined,
    esOrdinario: tipo === '' ? undefined : tipo === 'ordinario',
    page,
    limit: LIMIT,
  };

  const { gastos, pagination, totales, cargando, refrescando, error } = useGastos(
    edificio.id,
    filtros,
  );

  // Todo cambio de filtro vuelve a la página 1: quedarse en la 3 tras filtrar
  // deja la tabla vacía sin que el usuario entienda por qué.
  function setFiltro(cambios) {
    setSearchParams((previos) => {
      const next = new URLSearchParams(previos);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === '' || valor === undefined) next.delete(clave);
        else next.set(clave, String(valor));
      }
      if (!('page' in cambios)) next.delete('page');
      return next;
    });
  }

  function limpiarFiltros() {
    setSearchParams(new URLSearchParams());
  }

  if (cargando) return <GastosSkeleton />;
  if (error) return <EstadoError />;

  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  // "Con filtros" a los efectos del empty state: cualquier recorte por sobre el
  // default (el período corriente solo no cuenta como filtro elegido).
  const hayFiltros =
    categoria !== '' || tipo !== '' || periodo !== periodoDefault;
  const hayMonedaExtranjera = gastos.some((g) => g.moneda !== 'ARS');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gastos ({total})</CardTitle>
        <CardDescription>
          {periodo === TODOS_LOS_PERIODOS
            ? 'Todos los períodos'
            : formatearPeriodo(periodo)}
          {' · '}
          {total === 1 ? '1 gasto' : `${total} gastos`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Filtros (§4.1). Reactivos: cada cambio reescribe la URL y la query. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="filtro-periodo">Período</Label>
            <Select
              id="filtro-periodo"
              className="w-44"
              value={periodo}
              onChange={(e) => setFiltro({ periodo: e.target.value })}
            >
              {opcionesPeriodo.map((p) => (
                <option key={p} value={p}>
                  {formatearPeriodo(p)}
                </option>
              ))}
              <option value={TODOS_LOS_PERIODOS}>Todos los períodos</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="filtro-categoria">Categoría</Label>
            <Select
              id="filtro-categoria"
              className="w-52"
              value={categoria}
              onChange={(e) => setFiltro({ categoria: e.target.value })}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="filtro-tipo">Tipo</Label>
            <Select
              id="filtro-tipo"
              className="w-40"
              value={tipo}
              onChange={(e) => setFiltro({ tipo: e.target.value })}
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          {hayFiltros && (
            <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
              Limpiar
            </Button>
          )}
        </div>

        {gastos.length === 0 ? (
          <EmptyState hayFiltros={hayFiltros} onLimpiar={limpiarFiltros} />
        ) : (
          <>
            {/* `refrescando` = está trayendo otra página con la anterior en
                pantalla (keepPreviousData): se atenúa para que el cambio se note. */}
            <div className={refrescando ? 'opacity-60 transition-opacity' : undefined}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Período</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gastos.map((gasto) => (
                    <TableRow key={gasto.id}>
                      <TableCell className="font-medium">
                        {gasto.concepto}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatearMonto(gasto.monto, gasto.moneda)}
                      </TableCell>
                      <TableCell>
                        <CategoriaGasto gasto={gasto} />
                      </TableCell>
                      <TableCell>
                        {gasto.esOrdinario ? 'Ordinario' : 'Extraordinario'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {gasto.periodo}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Decisión 4: el TOTAL es del filtro completo (backend). */}
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold">TOTAL</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatearMonto(totales?.monto ?? '0.00')}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {/* Decisión 5: el agregado del backend no discrimina moneda. */}
            {hayMonedaExtranjera && (
              <p className="text-xs text-warning-hover">
                Hay gastos en más de una moneda: el TOTAL las suma sin convertir.
              </p>
            )}

            {/* Paginación server-side (§4.1) */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Página {page} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setFiltro({ page: page - 1 })}
                  >
                    <ChevronLeft className="size-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setFiltro({ page: page + 1 })}
                  >
                    Siguiente
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
