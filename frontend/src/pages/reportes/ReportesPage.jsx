// frontend/src/pages/reportes/ReportesPage.jsx — ConsorcIA
// Hub del módulo Reportes (S3-16): la grilla desde la que se entra a cada
// reporte del negocio. Ruta `/reportes` de PRD-07-03 §2.1, con la entrada
// "Reportes" del sidebar de §4.1.
//
// HOY TIENE UN SOLO REPORTE —gastos consolidados— y aun así es un hub y no la
// pantalla del reporte: el módulo se va a poblar (morosidad, liquidaciones,
// benchmarking de PRD-04-10) y una ruta `/reportes` que muestre directamente el
// reporte de gastos obligaría a mover la URL del primero cuando llegue el
// segundo. El costo de la indirección hoy es una pantalla de una tarjeta.
//
// DECISIONES:
//
// 1. UN REPORTE NO DISPONIBLE SE MUESTRA, NO SE ESCONDE. El consolidado de
//    gastos es Business+ (PRD-04-02 §3.2): con un plan menor, la tarjeta aparece
//    con el badge del plan y el motivo, en vez de desaparecer. Un módulo que se
//    ve vacío en el plan starter no comunica qué se compra al subir de plan; y el
//    caso opuesto —ofrecerlo sin señal— manda a un 403.
//
// 2. LOS REPORTES SE DECLARAN EN UNA LISTA, no en JSX suelto: agregar el próximo
//    es una entrada más, con su `disponible` y su gate. Es la misma forma que
//    tienen los módulos del sidebar en AppLayout.
import { Link } from 'react-router';
import { BarChart3, ChevronRight, Lock } from 'lucide-react';
import { useAuthStore, SIN_ROLES } from '@/stores/auth.store';
import { useOrganizacion } from '@/hooks/useOrganizacion';
import { motivoConsolidado, permiteConsolidado } from '@/lib/planes';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ReportesPage() {
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  const { organizacion } = useOrganizacion();
  const contexto = { plan: organizacion?.plan, roles };

  // Decisión 2.
  const reportes = [
    {
      id: 'gastos',
      titulo: 'Gastos consolidados',
      descripcion:
        'Todos los edificios de la administración en un solo tablero: total del período, evolución mensual, distribución por rubro y por categoría, y los proveedores que se llevan la mayor parte.',
      href: '/reportes/gastos',
      icono: BarChart3,
      disponible: permiteConsolidado(contexto),
      motivo: motivoConsolidado(contexto),
      plan: 'Business',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Reportes</CardTitle>
          <CardDescription>
            Los reportes del negocio, con el alcance de toda la administración.
            Para ver un edificio en particular, entrá a su pestaña Gastos.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {reportes.map((reporte) => {
          const Icono = reporte.icono;
          const contenido = (
            <>
              <span className="flex items-start justify-between gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Icono className="size-4" aria-hidden="true" />
                </span>
                {reporte.disponible ? (
                  <ChevronRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <Badge variant="warning" className="gap-1">
                    <Lock aria-hidden="true" />
                    {reporte.plan}
                  </Badge>
                )}
              </span>
              <span className="font-medium">{reporte.titulo}</span>
              <span className="text-sm text-muted-foreground">
                {/* Decisión 1: cuando no está disponible, el motivo reemplaza a
                    la descripción — es la información útil en ese estado. */}
                {reporte.disponible ? reporte.descripcion : reporte.motivo}
              </span>
            </>
          );

          const clases =
            'flex flex-col gap-2 rounded-xl border bg-card p-5 text-left transition-colors';

          return reporte.disponible ? (
            <Link
              key={reporte.id}
              to={reporte.href}
              className={`${clases} hover:bg-accent/50`}
            >
              {contenido}
            </Link>
          ) : (
            // Sin link: un ancla que no navega es una promesa incumplida para el
            // teclado y para el lector de pantalla.
            <div key={reporte.id} className={`${clases} opacity-70`}>
              {contenido}
            </div>
          );
        })}
      </div>
    </div>
  );
}
