// frontend/src/pages/reportes/ReporteGastosPage.jsx — ConsorcIA
// Reporte de gastos consolidados de la organización (S3-16): el dashboard de
// PRD-04-02 §3 con el alcance "todos los edificios", sobre
// `GET /api/organizaciones/me/gastos/dashboard` (S3-15, Business+).
//
// ES LA MISMA PANTALLA QUE EL TAB DEL EDIFICIO, con dos diferencias que salen del
// endpoint y no de una decisión de diseño:
//
// 1. NO HAY LISTADO DEBAJO. Los gastos se listan por edificio
//    (`GET /api/edificios/:id/gastos`) y no existe un listado consolidado: pedir
//    uno acá sería inventar un endpoint. En vez de un listado vacío, el selector
//    de edificio es la salida — elegir uno lleva a su tab con los filtros puestos,
//    que es el drill-down natural de "este número me llamó la atención".
//
// 2. EL ERROR DE PLAN Y EL DE ROL SE MUESTRAN EN LA PANTALLA, no como un 403
//    genérico: los explica `GastosDashboard`. La ruta ya está detrás de
//    `RequireRole org_admin` (el consolidado es de la administración, precisión 9
//    de §3.4), así que en la práctica el caso que se ve acá es el del plan — el de
//    rol queda como red de seguridad si alguien entra por URL con un token viejo.
import { useNavigate, useSearchParams } from 'react-router';
import { useEdificios } from '@/hooks/useEdificios';
import { useFiltrosGastos } from '@/hooks/useFiltrosGastos';
import { useNombreDeRubro } from '@/hooks/useRubros';
import AyudaLink from '@/components/ayuda/AyudaLink';
import GastosDashboard from '@/components/gastos/dashboard/GastosDashboard';
import GastosFiltros, {
  TODOS_LOS_EDIFICIOS,
} from '@/components/gastos/GastosFiltros';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ReporteGastosPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { edificios } = useEdificios();

  const {
    valores,
    modoPeriodo,
    opcionesPeriodo,
    filtrosDashboard,
    setFiltro,
    limpiar,
  } = useFiltrosGastos();

  const rubroNombre = useNombreDeRubro(valores.rubroId);

  // Diferencia 1: elegir un edificio es el drill-down, y se lleva los filtros.
  function irAEdificio(valor) {
    if (!valor || valor === TODOS_LOS_EDIFICIOS) return;
    const query = searchParams.toString();
    navigate(`/edificios/${valor}/gastos${query ? `?${query}` : ''}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Gastos consolidados
            <AyudaLink variant="icon" topic="reportes/gastos-consolidados" />
          </CardTitle>
          <CardDescription>
            Todos los edificios activos de la administración.{' '}
            {edificios.length > 0 &&
              `Elegí un edificio para ver su detalle con los mismos filtros.`}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <GastosFiltros
            valores={valores}
            modoPeriodo={modoPeriodo}
            periodos={opcionesPeriodo}
            // La nómina de staff la lee el org_admin, que es quien llega acá.
            puedeVerAutores
            mostrarTipo={false}
            edificios={edificios}
            edificioSeleccionado={TODOS_LOS_EDIFICIOS}
            consolidado={{ disponible: true }}
            onEdificio={irAEdificio}
            rubroNombre={rubroNombre}
            onFiltro={setFiltro}
            onLimpiar={limpiar}
          />
        </CardContent>
      </Card>

      <GastosDashboard
        alcance={{ organizacion: true }}
        filtros={filtrosDashboard}
        modoPeriodo={modoPeriodo}
        valores={valores}
        onFiltro={setFiltro}
        filtroDeTipo={false}
      />
    </div>
  );
}
