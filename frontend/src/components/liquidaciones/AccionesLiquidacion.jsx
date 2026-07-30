// frontend/src/components/liquidaciones/AccionesLiquidacion.jsx — ConsorcIA
// Acciones del workflow de una liquidación (S3-10, PRD-04-03 §1/§2 PASO 4-5):
// Aprobar, Generar recibos y Anular, según el estado en el que esté.
//
// DECISIONES:
//
// 1. LAS ACCIONES SALEN DEL ESTADO, NO DE UNA LISTA FIJA CON `disabled`. Los
//    botones que se dibujan son los que `accionesDeLiquidacion` habilita para el
//    estado actual (espejo de `TRANSICIONES` del backend). Un botón "Aprobar"
//    grisado sobre una liquidación ya enviada no informa nada — el badge ya dice
//    en qué estado está — y sí invita a preguntarse por qué no se puede.
//
// 2. LAS TRES PASAN POR ConfirmDialog (PRD-07-02 §6.3), incluidas las que no son
//    destructivas. Aprobar no borra nada pero congela el período (después no se
//    editan los gastos) y generar recibos emite documentos con valor legal
//    (Ley 941). Las tres son actos del administrador responsable, no ediciones:
//    el diálogo es el que explica QUÉ deja de poder hacerse después.
//
// 3. OPTIMISTIC UPDATE SOBRE EL ESTADO, con rollback (PRD-07-04 §2.5). Lo que se
//    pinta al toque es el badge y qué acciones ofrece la pantalla: es un cambio
//    de una sola propiedad que el backend confirma o rechaza. Los TOTALES no se
//    tocan nunca — ninguna transición los cambia — así que el optimismo no puede
//    mostrar un importe que no existe.
//
// 4. "GENERAR RECIBOS" NO ES OPTIMISTA aunque comparta el mecanismo. Emitir 40
//    PDFs con QR tarda, y pintar ENVIADA antes de que el backend termine dejaría
//    una pantalla que promete recibos que todavía no están y una lista vacía
//    debajo. Se espera la respuesta —que ya trae los recibos emitidos— y con eso
//    se siembra la cache de la lista: el usuario ve el estado nuevo y los recibos
//    al mismo tiempo. El backend además reclama el estado antes de generar y lo
//    revierte si falla (decisión 9 de las rutas), así que un optimismo acá
//    podría contradecir al servidor.
//
// 5. EL 409 `ESTADO_INVALIDO` NO ES UN ERROR DE LA PERSONA. Significa que la
//    liquidación cambió en otra pestaña o la tocó otro administrador, así que el
//    toast lo dice en esos términos y se refetchea el detalle para que la
//    pantalla muestre el estado real en vez de dejar al usuario reintentando.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { accionesDeLiquidacion } from '@/lib/liquidacion';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Ícono e intención visual por acción. El mapa vive acá y no en `lib/liquidacion`
// porque son decisiones de presentación: el módulo de dominio no importa React.
const PRESENTACION = {
  aprobar: { Icono: CheckCircle2, variant: 'default' },
  enviar: { Icono: Receipt, variant: 'default' },
  anular: { Icono: Ban, variant: 'outline' },
};

const MENSAJES_OK = {
  aprobar: {
    titulo: 'Liquidación aprobada',
    descripcion: 'Ya podés generar los recibos de cada unidad.',
  },
  anular: {
    titulo: 'Liquidación anulada',
    descripcion: 'El período volvió a quedar libre para generar una nueva.',
  },
};

export default function AccionesLiquidacion({ liquidacion }) {
  const queryClient = useQueryClient();
  const [pendiente, setPendiente] = useState(null);

  const acciones = accionesDeLiquidacion(liquidacion.estado);
  const detailKey = queryKeys.liquidaciones.detail(liquidacion.id);

  // Toda la lista del edificio queda desactualizada tras una transición (el badge
  // de la fila y, en el caso de anular, qué períodos están libres para el
  // diálogo de generación). Se invalida por prefijo: son todas sus páginas.
  const invalidarLista = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.liquidaciones.all,
    });

  const mutacion = useMutation({
    mutationFn: (accion) => api.post(`/api/liquidaciones/${liquidacion.id}/${accion}`),

    // Decisión 3 y 4: solo `aprobar` y `anular` se adelantan.
    onMutate: async (accion) => {
      if (accion === 'enviar') return {};
      await queryClient.cancelQueries({ queryKey: detailKey });
      const anterior = queryClient.getQueryData(detailKey);
      const { hacia } = acciones.find((a) => a.id === accion);
      queryClient.setQueryData(detailKey, (old) =>
        old ? { ...old, estado: hacia } : old,
      );
      return { anterior };
    },

    onError: (err, accion, context) => {
      if (context?.anterior) queryClient.setQueryData(detailKey, context.anterior);

      // Decisión 5: el conflicto de estado se explica como lo que es.
      if (err.status === 409) {
        toast.error('La liquidación ya no está en ese estado', {
          description: `Alguien la modificó mientras la mirabas: ahora está en ${err.detalle?.estadoActual ?? 'otro estado'}. La pantalla se actualizó.`,
        });
        return;
      }
      toast.error(`No se pudo ${accion} la liquidación`, {
        description: err.message ?? 'Error inesperado',
      });
    },

    onSuccess: (actualizada, accion) => {
      // La respuesta es la cabecera (sin `unidades` ni `resumen`): se mergea
      // sobre la preview en cache en vez de reemplazarla, o la tabla por unidad
      // desaparecería hasta que termine el refetch.
      const { recibos, ...cabecera } = actualizada;
      queryClient.setQueryData(detailKey, (old) =>
        old ? { ...old, ...cabecera } : old,
      );

      if (accion === 'enviar') {
        // Decisión 4: los recibos vienen en la respuesta del POST, así que la
        // lista se siembra en vez de esperar un refetch.
        queryClient.setQueryData(queryKeys.liquidaciones.recibos(liquidacion.id), {
          liquidacionId: liquidacion.id,
          periodo: cabecera.periodo,
          estado: cabecera.estado,
          data: recibos?.data ?? [],
        });
        toast.success('Recibos generados', {
          description: `Se emitieron ${recibos?.emitidos ?? 0} recibo(s), uno por unidad. Ya se pueden descargar.`,
        });
      } else {
        toast.success(MENSAJES_OK[accion].titulo, {
          description: MENSAJES_OK[accion].descripcion,
        });
      }

      setPendiente(null);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      invalidarLista();
    },
  });

  if (acciones.length === 0) return null;

  const enCurso = mutacion.isPending ? mutacion.variables : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {acciones.map((accion) => {
          const { Icono, variant } = PRESENTACION[accion.id];
          return (
            <Button
              key={accion.id}
              type="button"
              variant={variant}
              disabled={Boolean(enCurso)}
              onClick={() => setPendiente(accion)}
            >
              <Icono className="size-4" />
              {accion.label}
            </Button>
          );
        })}
      </div>

      {pendiente && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!mutacion.isPending) setPendiente(null);
          }}
          onConfirm={() => mutacion.mutate(pendiente.id)}
          title={pendiente.titulo}
          description={pendiente.confirmacion}
          confirmText={pendiente.confirmText}
          variant={pendiente.variante}
          loading={mutacion.isPending}
        />
      )}
    </>
  );
}
