// frontend/src/pages/reportes/ReporteGastosPage.jsx — ConsorcIA
// Reporte de gastos (S3-16, rescopeado en S3-22): el dashboard interactivo de
// PRD-04-02 §3 —KPIs, evolución mensual, distribución por rubro con drill-down,
// por categoría y top de proveedores— sobre los dos endpoints de S3-15:
//
//   GET /api/edificios/:id/gastos/dashboard          → un edificio
//   GET /api/organizaciones/me/gastos/dashboard      → toda la administración
//
// ES LA ÚNICA CASA DEL TABLERO. Hasta S3-22 el mismo dashboard vivía además
// arriba del listado en el tab `gastos` del edificio: §3 lo definía como "la
// entrada al módulo (el tab `gastos`)". Eso fusionaba dos cosas distintas —la
// pantalla con la que se CARGAN gastos y la que se usa para ANALIZARLOS— en una
// sola UI. Acá se analiza; el tab quedó operativo (filtros, totalizador del
// filtro activo y listado con su alta/edición).
//
// DECISIONES:
//
// 1. EL ALCANCE ES UN FILTRO MÁS, EN LA URL (`?edificioId=`). El selector ofrece
//    cada edificio del usuario y "Todos los edificios"; elegir uno cambia el
//    endpoint y nada más, porque la respuesta tiene la misma forma para los dos
//    alcances. Antes el selector NAVEGABA al tab del edificio, que era la única
//    forma de ver un edificio solo mientras el tablero vivía allá; ahora irse de
//    la pantalla para cambiar de alcance sería perder el análisis en curso.
//
// 2. EL DEFAULT ES EL CONSOLIDADO CUANDO SE PUEDE, Y EL PRIMER EDIFICIO CUANDO
//    NO. "Todos los edificios" es Business+ y de org_admin (precisión 9 de §3.4):
//    abrirle el reporte a un gestor —o a un plan starter— en el alcance que le va
//    a responder 403 es mandarlo a un error evitable en la primera pantalla. La
//    opción sigue visible y deshabilitada con el motivo (decisión 6 de S3-16):
//    esconderla dejaría al plan menor sin saber que existe.
//
// 3. SIN LISTADO DEBAJO, EN NINGÚN ALCANCE. Consolidado no existe endpoint de
//    listado (los gastos se listan por edificio), y aun para un solo edificio
//    repetir acá la tabla sería volver a fusionar las dos pantallas. El link al
//    tab lleva los MISMOS filtros: es el drill-down de "este número me llamó la
//    atención".
//
// 4. EL FILTRO DE TIPO NO SE OFRECE. El dashboard ignora `esOrdinario` por
//    contrato (precisión 3 de §3.4) y acá no hay listado que sí lo aplique, así
//    que las tarjetas de ordinarias/extraordinarias son solo lectura.
import { Link, useSearchParams } from 'react-router';
import { useEdificios } from '@/hooks/useEdificios';
import { useFiltrosGastos } from '@/hooks/useFiltrosGastos';
import { useNombreDeRubro } from '@/hooks/useRubros';
import { useOrganizacion } from '@/hooks/useOrganizacion';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import { motivoConsolidado, permiteConsolidado } from '@/lib/planes';
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
  const { edificios } = useEdificios();
  const { organizacion } = useOrganizacion();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);

  const contextoDePlan = { plan: organizacion?.plan, roles };
  const consolidado = {
    disponible: permiteConsolidado(contextoDePlan),
    motivo: motivoConsolidado(contextoDePlan),
  };

  const {
    valores,
    modoPeriodo,
    opcionesPeriodo,
    filtrosDashboard,
    setFiltro,
    limpiar,
  } = useFiltrosGastos();

  // Decisión 1: el alcance viaja en la URL. Decisión 2: el default depende de lo
  // que el usuario puede pedir sin comerse un 403.
  const edificioIdDeLaUrl = searchParams.get('edificioId') ?? '';
  const alcanceElegido =
    edificioIdDeLaUrl ||
    (consolidado.disponible ? TODOS_LOS_EDIFICIOS : (edificios[0]?.id ?? ''));
  const esConsolidado = alcanceElegido === TODOS_LOS_EDIFICIOS;
  const edificioElegido = edificios.find((e) => e.id === alcanceElegido);

  const rubroNombre = useNombreDeRubro(valores.rubroId);

  // Decisión 3: el drill-down se lleva los filtros menos el alcance (el edificio
  // ya lo dice la ruta destino).
  const queryDelDetalle = (() => {
    const params = new URLSearchParams(searchParams);
    params.delete('edificioId');
    const query = params.toString();
    return query ? `?${query}` : '';
  })();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Gastos
            <AyudaLink variant="icon" topic="reportes/gastos" />
          </CardTitle>
          <CardDescription>
            {esConsolidado
              ? 'Todos los edificios activos de la administración.'
              : `Indicadores de ${edificioElegido?.nombre ?? 'el edificio elegido'}.`}{' '}
            Los gastos se cargan y se editan en la pestaña Gastos de cada
            edificio.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <GastosFiltros
            valores={valores}
            modoPeriodo={modoPeriodo}
            periodos={opcionesPeriodo}
            // La nómina de staff la lee el org_admin; al gestor el combo de
            // autores le respondería 403.
            puedeVerAutores={consolidado.disponible}
            // Decisión 4.
            mostrarTipo={false}
            edificios={edificios}
            edificioSeleccionado={alcanceElegido}
            consolidado={consolidado}
            onEdificio={(valor) => setFiltro({ edificioId: valor })}
            rubroNombre={rubroNombre}
            onFiltro={setFiltro}
            onLimpiar={limpiar}
          />

          {/* Decisión 3: el detalle vive en el tab, con los mismos filtros. */}
          {!esConsolidado && edificioElegido && (
            <p className="text-sm">
              <Link
                to={`/edificios/${edificioElegido.id}/gastos${queryDelDetalle}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Ver el detalle de {edificioElegido.nombre} con estos filtros
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <GastosDashboard
        alcance={
          esConsolidado ? { organizacion: true } : { edificioId: alcanceElegido }
        }
        filtros={filtrosDashboard}
        modoPeriodo={modoPeriodo}
        valores={valores}
        onFiltro={setFiltro}
        filtroDeTipo={false}
      />
    </div>
  );
}
