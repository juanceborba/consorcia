// frontend/src/components/gastos/dashboard/GastosDashboard.jsx — ConsorcIA
// El dashboard de gastos completo (S3-16, PRD-04-02 §3): KPIs, evolución
// mensual, distribución por rubro con drill-down, distribución por categoría y
// top de proveedores, todo sobre la respuesta única del endpoint de S3-15.
//
// LO MONTAN DOS PANTALLAS y por eso es un componente y no una página: el tab
// `gastos` del edificio (con el listado debajo) y el reporte consolidado de la
// organización (`/reportes/gastos`, Business+). La única diferencia es el
// `alcance`, que decide el endpoint; la respuesta tiene la misma forma.
//
// DECISIONES:
//
// 1. LOS ERRORES DE AUTORIZACIÓN SE EXPLICAN, NO SE MUESTRAN COMO FALLA. Los dos
//    esperables tienen copy propio: `PLAN_INSUFICIENTE` (el consolidado es
//    Business+) dice qué plan tiene y cuál necesita —el backend los manda en el
//    error justamente para eso—, y `ACCESO_DENEGADO` (un gestor pidiendo el
//    consolidado) explica que su alcance son sus edificios asignados. Un "no se
//    pudo cargar" en cualquiera de los dos casos manda a alguien a revisar la red
//    por un problema de permisos.
//
// 2. TODO FILTRO PASA POR LA URL. Los charts no tienen estado de filtro propio:
//    reciben el valor activo y un `onFiltro`, así que clickear un gajo del pie es
//    lo mismo que elegir la categoría en la toolbar, y la vista sigue siendo
//    compartible y recargable (la excepción es el drill-down de rubros, que es
//    navegación dentro del chart y no un filtro de la pantalla).
//
// 3. `refrescando` ATENÚA en vez de desmontar. Con `keepPreviousData` los números
//    anteriores siguen en pantalla mientras llega el filtro nuevo; sin la
//    atenuación, un filtro que tarda se lee como un filtro que no hizo nada.
import { useGastosDashboard } from '@/hooks/useGastosDashboard';
import { Alert } from '@/components/ui/alert';
import EvolucionMensualChart from '@/components/gastos/dashboard/EvolucionMensualChart';
import GastosKpis from '@/components/gastos/dashboard/GastosKpis';
import PorCategoriaChart from '@/components/gastos/dashboard/PorCategoriaChart';
import PorRubroChart from '@/components/gastos/dashboard/PorRubroChart';
import TopProveedores from '@/components/gastos/dashboard/TopProveedores';

// Skeleton con la MISMA estructura del dashboard (PRD-07-02 §6.4): cinco KPIs y
// cuatro paneles, para que la pantalla no salte cuando llegan los datos.
export function DashboardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-80 rounded-xl bg-muted lg:col-span-2" />
        <div className="h-80 rounded-xl bg-muted" />
        <div className="h-80 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

// Decisión 1.
function ErrorDelDashboard({ error }) {
  if (error.code === 'PLAN_INSUFICIENTE') {
    const { planActual, planRequerido } = error.detalle ?? {};
    return (
      <Alert variant="warning" title="El consolidado de la organización necesita otro plan">
        {planActual && planRequerido ? (
          <>
            Tu plan es <strong>{planActual}</strong> y este reporte está disponible
            desde el plan <strong>{planRequerido}</strong>. Los gastos de cada
            edificio se siguen viendo en su pestaña Gastos.
          </>
        ) : (
          error.message
        )}
      </Alert>
    );
  }

  if (error.code === 'ACCESO_DENEGADO') {
    return (
      <Alert variant="warning" title="Este reporte es de la administración">
        El consolidado abarca todos los edificios de la organización. Tu alcance
        son los edificios que tenés asignados: sus gastos están en la pestaña
        Gastos de cada uno.
      </Alert>
    );
  }

  return (
    <Alert variant="danger" title="No se pudieron cargar los indicadores">
      {error.message ?? 'Intentá de nuevo más tarde.'}
    </Alert>
  );
}

export default function GastosDashboard({
  alcance,
  filtros,
  modoPeriodo,
  valores,
  onFiltro,
  // El filtro de tipo solo tiene sentido donde hay un listado abajo que lo
  // aplique: el dashboard lo ignora por contrato. En el reporte consolidado, que
  // no tiene listado, las tarjetas de ordinarias/extraordinarias son solo lectura.
  filtroDeTipo = true,
}) {
  const { dashboard, cargando, refrescando, error } = useGastosDashboard(
    alcance,
    filtros,
  );

  if (cargando) return <DashboardSkeleton />;
  if (error) return <ErrorDelDashboard error={error} />;
  if (!dashboard) return null;

  const { kpis, filtro, evolucionMensual, porRubro, porCategoria, topProveedores } =
    dashboard;

  return (
    // Decisión 3.
    <div
      className={`flex flex-col gap-4 ${
        refrescando ? 'opacity-60 transition-opacity' : ''
      }`}
    >
      <GastosKpis
        kpis={kpis}
        filtro={filtro}
        modoPeriodo={modoPeriodo}
        tipoActivo={filtroDeTipo ? valores.tipo : ''}
        onFiltrarTipo={filtroDeTipo ? (tipo) => onFiltro({ tipo }) : undefined}
      />

      {/* NO va acá el aviso de moneda mixta: el agregado suma sin discriminar
          `moneda`, pero el dashboard no sabe qué monedas hay (el contrato no las
          devuelve) y ponerlo siempre sería ruido en el 99% de los casos, que son
          todos en pesos. El listado de abajo lo avisa cuando ve una fila en otra
          moneda, que es cuando el aviso es verdad. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EvolucionMensualChart
          serie={evolucionMensual}
          modoPeriodo={modoPeriodo}
          periodoFiltrado={filtro?.periodo}
        />

        {/* Decisión 2: el valor activo entra por prop, el cambio sale por la URL. */}
        <PorRubroChart
          porRubro={porRubro}
          rubroFiltrado={valores.rubroId}
          onFiltrarRubro={(rubroId) => onFiltro({ rubroId })}
        />

        <PorCategoriaChart
          porCategoria={porCategoria}
          total={kpis?.total}
          categoriaFiltrada={valores.categoria}
          onFiltrarCategoria={(categoria) => onFiltro({ categoria })}
        />

        <TopProveedores
          proveedores={topProveedores}
          proveedorFiltrado={valores.proveedorId}
          onFiltrarProveedor={(proveedorId) => onFiltro({ proveedorId })}
        />
      </div>
    </div>
  );
}
