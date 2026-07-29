// frontend/src/pages/edificio/UnidadBulkDialog.jsx — ConsorcIA
// Carga rápida de unidades (S2-09): grilla de N filas editables (número,
// tipo, m², coeficiente) en su propio modal (PRD-07-02 §3.6), sin tabs. Hasta
// #57 vivía como segundo modo del UnidadAltaDialog; se separó porque mezclar
// dos flujos distintos en tabs forzaba al alta individual a cargar con un tab
// ajeno. Envía el array de filas al endpoint bulk POST
// /api/edificios/:id/unidades; el backend aplica los defaults de categorías
// (categoriaA=true, categoriaB=[], categoriaC=null).
//
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: el
// feedback inline y el coeficiente sugerido por m² vienen de
// unidad-form-utils.jsx (compartidos con el alta individual). **Guardar NUNCA
// se deshabilita por la suma** — solo por la validación de campos o mientras
// el submit está en vuelo.
import { useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { crearBulkFormSchema, TIPOS_UNIDAD } from '@/lib/unidad-schema';
import {
  avisarUnidadesCreadas,
  calcularInvariante,
  FeedbackInvariante,
  FILA_VACIA,
  registrarM2,
  sumarDecimales,
} from '@/pages/edificio/unidad-form-utils';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function UnidadBulkDialog({
  edificioId,
  edificioTotalM2,
  unidadesExistentes,
  isOpen,
  onClose,
}) {
  const queryClient = useQueryClient();

  const numerosExistentes = useMemo(
    () => unidadesExistentes.map((u) => u.numero),
    [unidadesExistentes],
  );
  // Coeficientes existentes vienen como strings (Decimal de Prisma
  // serializado); decimal.js los suma sin error de float.
  const sumaExistente = useMemo(
    () => sumarDecimales(unidadesExistentes.map((u) => u.coeficiente)),
    [unidadesExistentes],
  );

  const form = useForm({
    resolver: zodResolver(crearBulkFormSchema(numerosExistentes)),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { unidades: [{ ...FILA_VACIA }, { ...FILA_VACIA }, { ...FILA_VACIA }] },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'unidades',
  });
  const filas = form.watch('unidades');
  const invariante = calcularInvariante(
    sumaExistente,
    (filas ?? []).map((f) => f?.coeficiente),
  );

  const mutation = useMutation({
    mutationFn: (unidades) =>
      api.post(`/api/edificios/${edificioId}/unidades`, unidades),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.edificios.unidades(edificioId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.edificios.detail(edificioId),
      });
      avisarUnidadesCreadas(data);
      form.reset();
      onClose();
    },
    onError: (err) => {
      // Duplicados / validación de campos (la suma nunca rechaza, #57).
      toast.error('No se pudieron guardar las unidades', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const submit = form.handleSubmit((values) => {
    mutation.mutate(
      values.unidades.map((u) => ({
        numero: u.numero,
        tipo: u.tipo,
        m2: u.m2,
        coeficiente: u.coeficiente,
      })),
    );
  });

  // Confirmación antes de cerrar con cambios sin guardar (§6.1.8).
  const cerrar = () => {
    if (
      form.formState.isDirty &&
      !mutation.isSuccess &&
      !window.confirm('Tenés cambios sin guardar. ¿Cerrar de todas formas?')
    ) {
      return;
    }
    onClose();
  };

  // La suma de coeficientes NO condiciona el guardado (#57): solo la
  // validación de campos y el submit en vuelo.
  const guardarDeshabilitado = !form.formState.isValid || mutation.isPending;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={cerrar}
      title="Carga rápida de unidades"
      description={
        sumaExistente.gt(0)
          ? `El edificio ya tiene ${sumaExistente.toFixed(6)} de coeficiente asignado. Podés cargar de a poco: la suma total tiene que llegar a 1.000000.`
          : 'Cargá las unidades funcionales del edificio. Podés cargarlas de a poco: la suma total tiene que llegar a 1.000000.'
      }
      size="xl"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {/* Grilla de carga rápida: una fila por UF */}
        <div className="grid grid-cols-[1fr_1.2fr_0.7fr_1fr_auto] items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>Número</span>
          <span>Tipo</span>
          <span>m²</span>
          <span>Coeficiente</span>
          <span className="sr-only">Quitar</span>
        </div>
        {fields.map((field, index) => {
          const errorsFila = form.formState.errors.unidades?.[index] ?? {};
          return (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_1.2fr_0.7fr_1fr_auto] items-start gap-2"
            >
              <div className="flex flex-col gap-1">
                <Input
                  placeholder="3A"
                  aria-label={`Número de la fila ${index + 1}`}
                  aria-invalid={!!errorsFila.numero}
                  {...form.register(`unidades.${index}.numero`)}
                />
                {errorsFila.numero && (
                  <p className="text-xs text-destructive">
                    {errorsFila.numero.message}
                  </p>
                )}
              </div>
              <Select
                aria-label={`Tipo de la fila ${index + 1}`}
                {...form.register(`unidades.${index}.tipo`)}
              >
                {TIPOS_UNIDAD.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </Select>
              <div className="flex flex-col gap-1">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="85"
                  aria-label={`m² de la fila ${index + 1}`}
                  aria-invalid={!!errorsFila.m2}
                  {...registrarM2(
                    form,
                    `unidades.${index}.m2`,
                    `unidades.${index}.coeficiente`,
                    edificioTotalM2,
                  )}
                />
                {errorsFila.m2 && (
                  <p className="text-xs text-destructive">
                    {errorsFila.m2.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Input
                  placeholder="0.027742"
                  inputMode="decimal"
                  aria-label={`Coeficiente de la fila ${index + 1}`}
                  aria-invalid={!!errorsFila.coeficiente}
                  {...form.register(`unidades.${index}.coeficiente`)}
                />
                {errorsFila.coeficiente && (
                  <p className="text-xs text-destructive">
                    {errorsFila.coeficiente.message}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar fila ${index + 1}`}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => append({ ...FILA_VACIA })}
        >
          <Plus className="size-4" />
          Agregar fila
        </Button>

        <div className="flex flex-col gap-3 pt-1">
          <FeedbackInvariante invariante={invariante} />
          <div className="flex gap-2">
            <Button type="submit" disabled={guardarDeshabilitado}>
              {mutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {mutation.isPending
                ? 'Guardando…'
                : `Guardar ${fields.length === 1 ? '1 unidad' : `${fields.length} unidades`}`}
            </Button>
            <Button type="button" variant="outline" onClick={cerrar}>
              Cancelar
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
