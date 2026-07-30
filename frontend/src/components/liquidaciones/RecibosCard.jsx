// frontend/src/components/liquidaciones/RecibosCard.jsx — ConsorcIA
// Recibos emitidos de una liquidación (S3-10, PRD-04-03 §2 PASO 5 · PRD-06-01
// §3): un renglón por unidad funcional con su número de recibo, sus totales y la
// descarga del PDF.
//
// DECISIONES:
//
// 1. LA CARD APARECE RECIÉN CUANDO HAY ALGO QUE EMITIR. Antes de aprobar no
//    existe ni la posibilidad, así que dibujar una sección "Recibos (0)" en un
//    borrador sería ruido; desde APROBADA sí se muestra, vacía y diciendo que el
//    botón "Generar recibos" es el que la llena. Ese estado vacío es el que
//    conecta la acción con su resultado.
//
// 2. SE MUESTRA EL NÚMERO DE RECIBO, no un id. Es el dato con el que un
//    propietario o un inspector referencia el comprobante (Ley 941), y es lo
//    primero que se pide cuando alguien reclama por lo que se le cobró.
//
// 3. LA DESCARGA ES UN FETCH CON BEARER, NO UN LINK. El endpoint exige el token
//    y el token vive en memoria (ver `api.descargar`): un `<a href>` al
//    `descargaUrl` bajaría un 401 en un archivo. Por eso es un botón, y por eso
//    tiene estado de carga propio por fila — un PDF puede tardar y la persona
//    tiene que ver que su click hizo algo.
//
// 4. UN 404 `ARCHIVO_NO_DISPONIBLE` NO ES LO MISMO QUE UN RECIBO INEXISTENTE. El
//    recibo puede estar registrado y el PDF no estar en el almacenamiento (un
//    volumen que se perdió, un backup a medias). Se avisa con esa distinción
//    porque la salida no es la misma: ahí hay que reemitir, no buscar el número.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearMonto } from '@/lib/formato';
import AyudaLink from '@/components/ayuda/AyudaLink';
import { Button } from '@/components/ui/button';
import {
  Card,
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

// Estados en los que ya tiene sentido hablar de recibos (decisión 1).
const ESTADOS_CON_RECIBOS = ['APROBADA', 'ENVIADA', 'COBRADA'];

export default function RecibosCard({ liquidacion, puedeEmitir = false }) {
  // Cuál se está bajando: el spinner es por fila, no de la card.
  const [bajando, setBajando] = useState(null);

  const habilitada = ESTADOS_CON_RECIBOS.includes(liquidacion.estado);

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.liquidaciones.recibos(liquidacion.id),
    queryFn: () => api.get(`/api/liquidaciones/${liquidacion.id}/recibos`),
    enabled: habilitada,
  });

  if (!habilitada) return null;

  const recibos = data?.data ?? [];

  const descargar = async (recibo) => {
    setBajando(recibo.id);
    try {
      await api.descargar(recibo.descargaUrl, `recibo-${recibo.numero}.pdf`);
    } catch (err) {
      // Decisión 4.
      const falta = err.code === 'ARCHIVO_NO_DISPONIBLE';
      toast.error(
        falta
          ? 'El PDF de este recibo no está disponible'
          : 'No se pudo descargar el recibo',
        {
          description: falta
            ? 'El recibo está registrado pero su archivo no está en el almacenamiento. Anulá la liquidación y volvé a emitirla.'
            : (err.message ?? 'Error inesperado'),
        },
      );
    } finally {
      setBajando(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-5 shrink-0" />
          Recibos
          <AyudaLink variant="icon" topic="liquidaciones/recibos" />
        </CardTitle>
        <CardDescription>
          El comprobante de cada unidad funcional, con el QR de verificación y la
          matrícula RPA del administrador (Ley 941).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && (
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">
            No se pudieron cargar los recibos: {error.message}
          </p>
        )}

        {/* Decisión 1: el vacío de APROBADA nombra la acción que lo llena. */}
        {!isPending && !isError && recibos.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <Receipt className="size-8 text-muted-foreground" />
            <p className="font-medium">Todavía no se emitieron los recibos</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {puedeEmitir
                ? 'La liquidación está aprobada. Con "Generar recibos" se emite un PDF por unidad y quedan disponibles acá para descargar.'
                : 'La liquidación está aprobada. Cuando la administración emita los recibos, vas a poder descargar el PDF de cada unidad desde acá.'}
            </p>
          </div>
        )}

        {!isPending && !isError && recibos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UF</TableHead>
                <TableHead>Recibo</TableHead>
                <TableHead className="text-right">Ordinarias</TableHead>
                <TableHead className="text-right">Extraordinarias</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recibos.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.unidad?.numero ?? '—'}
                  </TableCell>
                  {/* Decisión 2. */}
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.numero}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatearMonto(r.totalOrdinarias)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatearMonto(r.totalExtraordinarias)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatearMonto(r.totalGeneral)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={bajando === r.id}
                      onClick={() => descargar(r)}
                      aria-label={`Descargar el recibo de la unidad ${r.unidad?.numero ?? r.numero}`}
                    >
                      {bajando === r.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
