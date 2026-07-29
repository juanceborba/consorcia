// frontend/src/pages/MisUnidadesPage.jsx — ConsorcIA
// Vista de solo lectura del residente (S4-12, #58). Base mínima del portal
// (PRD-04-05, S5): "sos inquilino de la UF 6 del edificio Torre Palermo".
//
// Alcance deliberadamente chico: el residente NO tiene acciones acá. Todo lo
// que se muestra sale de GET /api/me/unidades, que agrega por `usuarioId` y
// cruza organizaciones (multi-pertenencia, PRD-04-11 §5.3).
import { Building2, MapPin } from 'lucide-react';
import { useMisUnidades } from '@/hooks/useMisUnidades';
import { etiquetaVinculo } from '@/lib/acceso';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function MisUnidadesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <div className="h-5 w-2/3 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="h-4 w-1/3 rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Los vínculos vienen ordenados por edificio desde el backend; acá solo se
// agrupan para que cada edificio tenga una card con sus UFs.
function agruparPorEdificio(vinculos) {
  const grupos = [];
  for (const vinculo of vinculos) {
    let grupo = grupos.find((g) => g.edificio.id === vinculo.edificio.id);
    if (!grupo) {
      grupo = {
        edificio: vinculo.edificio,
        organizacion: vinculo.organizacion,
        vinculos: [],
      };
      grupos.push(grupo);
    }
    grupo.vinculos.push(vinculo);
  }
  return grupos;
}

export default function MisUnidadesPage() {
  const { vinculos, cargando, error } = useMisUnidades();
  const grupos = agruparPorEdificio(vinculos);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mis unidades</h1>
        <p className="text-sm text-muted-foreground">
          Las unidades que tenés a tu nombre, en todos tus consorcios.
        </p>
      </div>

      {cargando && <MisUnidadesSkeleton />}

      {!cargando && error && (
        <p className="text-sm text-destructive">
          No se pudieron cargar tus unidades. Intentá de nuevo más tarde.
        </p>
      )}

      {!cargando && !error && grupos.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <Building2 className="size-8 text-muted-foreground" />
          <p className="font-medium">Todavía no tenés unidades a tu nombre</p>
          <p className="text-sm text-muted-foreground">
            Cuando tu administración te vincule a una unidad, va a aparecer acá.
          </p>
        </div>
      )}

      {!cargando && !error && grupos.length > 0 && (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => (
            <Card key={grupo.edificio.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="size-5 shrink-0" />
                  {grupo.edificio.nombre}
                </CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <MapPin className="size-4 shrink-0" />
                  {grupo.edificio.direccion}, {grupo.edificio.ciudad}
                </CardDescription>
                <CardDescription>
                  Administra {grupo.organizacion.nombre}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {grupo.vinculos.map((vinculo) => (
                    <li
                      key={vinculo.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                    >
                      <span className="font-medium">
                        UF {vinculo.unidad.numero}
                      </span>
                      {vinculo.esPropietario && (
                        <Badge variant="info">Propietario</Badge>
                      )}
                      {vinculo.esInquilino && (
                        <Badge variant="secondary">Inquilino</Badge>
                      )}
                      <span className="w-full text-sm text-muted-foreground">
                        Sos {etiquetaVinculo(vinculo).toLowerCase()} de la UF{' '}
                        {vinculo.unidad.numero} de {grupo.edificio.nombre}.
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Expectativa explícita: el portal completo (expensas, recibos, pagos)
          es S5 — PRD-04-05. Sin esta línea la pantalla parece incompleta. */}
      {!cargando && !error && grupos.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Por ahora es solo lectura. Las expensas, los recibos y los pagos van a
          estar disponibles próximamente.
        </p>
      )}
    </div>
  );
}
