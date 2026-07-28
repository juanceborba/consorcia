// frontend/src/pages/edificio/EdificioOverviewTab.jsx — ConsorcIA
// Tab "Resumen" del detalle de edificio (S2-07): datos generales y stats
// básicas (unidades, superficie, antigüedad). Recibe el edificio por
// Outlet context desde EdificioDetallePage.
import { useOutletContext } from 'react-router';
import { Building2, Ruler, CalendarDays, LayoutGrid } from 'lucide-react';
import { etiquetaTipoEdificio } from '@/lib/tipos-edificio';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function Stat({ icon: Icon, label, valor }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-2xl font-semibold">{valor}</span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Dato({ label, valor }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{valor ?? '—'}</dd>
    </div>
  );
}

function formatearFecha(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function EdificioOverviewTab() {
  const { edificio } = useOutletContext();

  return (
    <div className="flex flex-col gap-6">
      {/* Stats básicas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={LayoutGrid}
          label={edificio.unidades.length === 1 ? 'Unidad' : 'Unidades'}
          valor={edificio.unidades.length}
        />
        <Stat icon={Ruler} label="Superficie total" valor={`${edificio.totalM2} m²`} />
        <Stat
          icon={Building2}
          label="Tipo"
          valor={etiquetaTipoEdificio(edificio.tipo)}
        />
        <Stat
          icon={CalendarDays}
          label="Antigüedad"
          valor={
            edificio.antiguedad != null ? `${edificio.antiguedad} años` : '—'
          }
        />
      </div>

      {/* Datos generales */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Datos del edificio</CardTitle>
          <CardDescription>Información general del consorcio</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Dato label="Dirección" valor={edificio.direccion} />
            <Dato label="Ciudad" valor={edificio.ciudad} />
            <Dato label="Provincia" valor={edificio.provincia} />
            <Dato label="Código postal" valor={edificio.codigoPostal} />
            <Dato
              label="Tipo de edificio"
              valor={etiquetaTipoEdificio(edificio.tipo)}
            />
            <Dato
              label="Inicio de la administración"
              valor={formatearFecha(edificio.fechaInicioAdmin)}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
