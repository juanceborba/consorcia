// frontend/src/pages/edificio/EdificioLiquidacionesTab.jsx — ConsorcIA
// Tab "Liquidaciones" del detalle de edificio (S3-09, PRD-04-03 §2/§4.1):
// listado de liquidaciones del edificio y botón "Generar liquidación".
//
// DECISIONES:
//
// 1. TAB PROPIO, NO UNA SECCIÓN DEL TAB DE GASTOS. Una liquidación no es un
//    gasto ni un filtro sobre los gastos: es el acto por el que la
//    administración reparte lo del período y emite los recibos (Ley 941).
//    Además tiene su propia vida — estados, aprobación, recibos (S3-10) — que
//    no cabe debajo de una lista de gastos ya bastante cargada. Se aplica la
//    convención "tabs como rutas hijas" de PRD-07-03 §2.2, igual que S3-07.
//
// 2. LA LISTA ES LA PANTALLA DE ENTRADA Y LA PREVIEW ES UNA RUTA APARTE
//    (`/edificios/:id/liquidaciones/:liquidacionId`). Una preview es un
//    documento que se comparte, se recarga y se vuelve a abrir; con la
//    liquidación en un estado local no se podría linkear ni desde el diálogo de
//    generación (que necesita mandar a la que ya ocupa el período) ni desde el
//    error de un período tomado.
//
// 3. GENERAR ES SOLO DEL ORG_ADMIN. `cerbos/policies/liquidacion.yaml` le da al
//    gestor únicamente `read`: mostrarle el botón sería ofrecerle un 403. Ve la
//    lista y las previews completas, que es lo que necesita para trabajar.
//
// 4. SIN FILTROS. El endpoint acepta `periodo` y `estado`, pero un edificio
//    tiene una liquidación por mes: con 50 por página son cuatro años de
//    historia en una sola pantalla. Agregar una toolbar de filtros acá sería
//    infraestructura para un problema que este dominio no tiene.
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearMonto, formatearPeriodo } from '@/lib/formato';
import { estadoDeLiquidacion } from '@/lib/liquidacion';
import { SIN_ROLES, useAuthStore } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
import GenerarLiquidacionDialog from '@/components/liquidaciones/GenerarLiquidacionDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const FILTROS = { page: 1, limit: 50 };

export default function EdificioLiquidacionesTab() {
  const { edificio } = useOutletContext();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  // Decisión 3: liquidar es del administrador de la organización.
  const puedeLiquidar = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  const [dialogAbierto, setDialogAbierto] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.liquidaciones.porEdificio(edificio.id, FILTROS),
    queryFn: () =>
      api.get(
        `/api/edificios/${edificio.id}/liquidaciones?page=${FILTROS.page}&limit=${FILTROS.limit}`,
      ),
  });

  const liquidaciones = data?.data ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 shrink-0" />
            Liquidaciones
            <AyudaLink variant="icon" topic="liquidaciones" />
          </CardTitle>
          <CardDescription>
            El reparto de los gastos de cada período entre las unidades. Se
            genera como borrador para revisarlo antes de aprobarlo y emitir los
            recibos.
          </CardDescription>
          {puedeLiquidar && (
            <CardAction>
              <Button type="button" onClick={() => setDialogAbierto(true)}>
                <Plus className="size-4" />
                Generar liquidación
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {isPending && (
            <div className="flex animate-pulse flex-col gap-2">
              <div className="h-9 rounded bg-muted" />
              <div className="h-9 rounded bg-muted" />
              <div className="h-9 rounded bg-muted" />
            </div>
          )}

          {isError && (
            <p className="text-sm text-destructive">
              No se pudieron cargar las liquidaciones: {error.message}
            </p>
          )}

          {!isPending && !isError && liquidaciones.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <p className="font-medium">Todavía no liquidaste ningún período</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {puedeLiquidar
                  ? 'Cargá los gastos del mes en el tab Gastos y después generá la liquidación: la app reparte cada gasto entre las unidades que lo pagan y te muestra el detalle antes de aprobar nada.'
                  : 'Cuando la administración liquide un período, vas a verlo acá con su detalle por unidad.'}
              </p>
            </div>
          )}

          {!isPending && !isError && liquidaciones.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Ordinarias</TableHead>
                  <TableHead className="text-right">Extraordinarias</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {liquidaciones.map((l) => {
                  const estado = estadoDeLiquidacion(l.estado);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        {formatearPeriodo(l.periodo)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={estado.variant} title={estado.descripcion}>
                          {estado.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatearMonto(l.totalOrdinarias)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatearMonto(l.totalExtraordinarias)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatearMonto(l.totalGeneral)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <Link
                              to={`/edificios/${edificio.id}/liquidaciones/${l.id}`}
                              aria-label={`Ver liquidación de ${formatearPeriodo(l.periodo)}`}
                            />
                          }
                        >
                          Ver detalle
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialogAbierto && (
        <GenerarLiquidacionDialog
          edificio={edificio}
          liquidaciones={liquidaciones}
          isOpen={dialogAbierto}
          onClose={() => setDialogAbierto(false)}
        />
      )}
    </>
  );
}
