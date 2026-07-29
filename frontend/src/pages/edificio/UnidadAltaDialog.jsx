// frontend/src/pages/edificio/UnidadAltaDialog.jsx — ConsorcIA
// Alta individual de unidad (S2-09) desde el tab Unidades: modal (PRD-07-02
// §3.6) con dos tabs sobre el MISMO form RHF — "Datos de la unidad" (número,
// tipo, m², coeficiente) y "Categorías de gastos" (A/B/C con explicaciones,
// Ley 941 §1.4 de PRD-04-01). El footer con la invariante y Guardar queda
// visible en ambos tabs: cambiar de tab desmonta los inputs pero RHF conserva
// los valores (shouldUnregister default false), así que guardar desde
// cualquiera de los dos conserva lo cargado en el otro.
//
// Desde #57 el modal ya NO mezcla flujos: la carga rápida vive en su propio
// dialog (UnidadBulkDialog) y cada uno tiene su botón en el listado. Tampoco
// recuerda el tab del uso anterior: al abrirse arranca siempre en "Datos".
//
// Invariante de coeficientes (PRD-04-01 §1.3) — INFORMATIVA desde #57: el
// backend guarda aunque la suma resultante del edificio no cierre en 1.000000.
// La cuenta en cliente y el feedback inline viven en unidad-form-utils.jsx
// (compartidos con el bulk). **Guardar NUNCA se deshabilita por la suma** —
// solo por la validación de campos o mientras el submit está en vuelo.
//
// Coeficiente sugerido (#57): al tipear los m² se autocompleta
// `coeficiente = m² / totalM2 del edificio` (6 decimales, PRD-04-01 §1.3);
// editable después.
//
// Patrones de formularios según PRD-07-02 §6.1: validación onBlur, errores
// inline, submit deshabilitado solo si el form es inválido, loading en el
// botón, toast de éxito/error, confirmación al cerrar con cambios.
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { crearUnidadFormSchema, TIPOS_UNIDAD } from '@/lib/unidad-schema';
import {
  avisarUnidadesCreadas,
  calcularInvariante,
  Campo,
  FeedbackInvariante,
  registrarM2,
  sumarDecimales,
} from '@/pages/edificio/unidad-form-utils';
import UnidadCategoriasTab from '@/pages/edificio/UnidadCategoriasTab';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

export default function UnidadAltaDialog({
  edificioId,
  edificioTotalM2,
  unidadesExistentes,
  isOpen,
  onClose,
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('datos'); // 'datos' | 'categorias'

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
    resolver: zodResolver(crearUnidadFormSchema(numerosExistentes)),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      numero: '',
      tipo: 'departamento',
      m2: '',
      coeficiente: '',
      categoriaA: true,
      categoriaB: [],
      categoriaC: '',
    },
  });
  const coeficiente = form.watch('coeficiente');
  const invariante = calcularInvariante(sumaExistente, [coeficiente]);

  // Al abrirse arranca siempre en el tab de datos: el modal ya no recuerda
  // el estado del uso anterior (#57).
  useEffect(() => {
    if (isOpen) setTab('datos');
  }, [isOpen]);

  // Envía un array de una sola UF al endpoint bulk POST
  // /api/edificios/:id/unidades (mismo contrato que la carga rápida).
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
    mutation.mutate([
      {
        numero: values.numero,
        tipo: values.tipo,
        m2: values.m2,
        coeficiente: values.coeficiente,
        categoriaA: values.categoriaA,
        categoriaB: values.categoriaB,
        categoriaC: values.categoriaC || null,
      },
    ]);
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
      title="Agregar unidad"
      description={
        sumaExistente.gt(0)
          ? `El edificio ya tiene ${sumaExistente.toFixed(6)} de coeficiente asignado. Podés cargar de a poco: la suma total tiene que llegar a 1.000000.`
          : 'Cargá la unidad funcional con sus datos y sus categorías de gastos. Podés cargar de a poco: la suma total tiene que llegar a 1.000000.'
      }
      size="xl"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Dos tabs, UN solo form: RHF conserva los valores del tab
            desmontado, así Guardar funciona igual desde cualquiera. */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTab type="button" value="datos">
              Datos de la unidad
            </TabsTab>
            <TabsTab type="button" value="categorias">
              Categorías de gastos
            </TabsTab>
          </TabsList>

          <TabsPanel value="datos">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                id="unidad-numero"
                label="Número"
                error={form.formState.errors.numero}
              >
                <Input
                  id="unidad-numero"
                  placeholder="3A"
                  aria-invalid={!!form.formState.errors.numero}
                  {...form.register('numero')}
                />
              </Campo>

              <Campo
                id="unidad-tipo"
                label="Tipo"
                error={form.formState.errors.tipo}
              >
                <Select
                  id="unidad-tipo"
                  aria-invalid={!!form.formState.errors.tipo}
                  {...form.register('tipo')}
                >
                  {TIPOS_UNIDAD.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>
                      {tipo.label}
                    </option>
                  ))}
                </Select>
              </Campo>

              <Campo
                id="unidad-m2"
                label="Superficie (m²)"
                error={form.formState.errors.m2}
              >
                <Input
                  id="unidad-m2"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="85"
                  aria-invalid={!!form.formState.errors.m2}
                  {...registrarM2(form, 'm2', 'coeficiente', edificioTotalM2)}
                />
              </Campo>

              <Campo
                id="unidad-coeficiente"
                label="Coeficiente"
                error={form.formState.errors.coeficiente}
              >
                <Input
                  id="unidad-coeficiente"
                  placeholder="0.027742"
                  inputMode="decimal"
                  aria-invalid={!!form.formState.errors.coeficiente}
                  {...form.register('coeficiente')}
                />
                <p className="text-xs text-muted-foreground">
                  Se sugiere al cargar los m² (m² / {Number(edificioTotalM2)} m²
                  totales del edificio). Podés editarlo.
                </p>
              </Campo>
            </div>
          </TabsPanel>

          <TabsPanel value="categorias">
            <UnidadCategoriasTab form={form} />
          </TabsPanel>
        </Tabs>

        {/* Footer fuera de los tabs: invariante + Guardar visibles en ambos */}
        <div className="flex flex-col gap-3">
          <FeedbackInvariante invariante={invariante} />
          <div className="flex gap-2">
            <Button type="submit" disabled={guardarDeshabilitado}>
              {mutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {mutation.isPending ? 'Guardando…' : 'Guardar unidad'}
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
