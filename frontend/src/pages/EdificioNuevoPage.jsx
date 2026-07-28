// frontend/src/pages/EdificioNuevoPage.jsx — ConsorcIA
// Alta de edificio (S2-06) contra POST /api/edificios. Patrones de
// formularios según PRD-07-02 §6.1: validación onBlur por campo, errores
// inline, submit deshabilitado hasta válido, loading en el botón, toast de
// éxito/error y confirmación al salir con cambios sin guardar (useBlocker +
// beforeunload). Campos según crearEdificioSchema del backend (PRD-04-01 §2);
// al crear, redirige al detalle del edificio.
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useBlocker, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { edificioFormSchema } from '@/lib/edificio-schema';
import { TIPOS_EDIFICIO } from '@/lib/tipos-edificio';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

function Campo({ id, label, obligatorio = true, error, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {obligatorio && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function EdificioNuevoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isDirty },
  } = useForm({
    resolver: zodResolver(edificioFormSchema),
    // PRD-07-02 §6.1: validación onBlur por campo; revalida onChange una vez
    // tocado para que el botón se habilite apenas el form queda válido.
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      nombre: '',
      direccion: '',
      codigoPostal: '',
      ciudad: 'CABA',
      provincia: 'Buenos Aires',
      tipo: 'ph',
      totalM2: '',
      fechaInicioAdmin: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (payload) => api.post('/api/edificios', payload),
    onSuccess: (edificio) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.edificios.lists() });
      toast.success('Edificio creado', {
        description: `${edificio.nombre} ya está disponible.`,
      });
      navigate(`/edificios/${edificio.id}/unidades`);
    },
    onError: (err) => {
      toast.error('No se pudo crear el edificio', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // Confirmación al salir con cambios sin guardar (PRD-07-02 §6.1.8):
  // navegación interna (useBlocker, requiere data router) + cierre/recarga
  // del navegador (beforeunload). Se libera cuando la creación fue exitosa.
  const hayCambiosSinGuardar = isDirty && !mutation.isSuccess;
  const blocker = useBlocker(hayCambiosSinGuardar);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Tenés cambios sin guardar. ¿Salir de todas formas?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (!hayCambiosSinGuardar) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hayCambiosSinGuardar]);

  const onSubmit = (values) => {
    const payload = { ...values };
    // El backend espera una fecha coercible; string vacío rompe coerce.date().
    if (!payload.fechaInicioAdmin) delete payload.fechaInicioAdmin;
    mutation.mutate(payload);
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/edificios"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a edificios
      </Link>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Nuevo edificio</CardTitle>
          <CardDescription>
            Datos generales del consorcio. Las unidades se cargan después,
            desde el detalle del edificio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <Campo id="nombre" label="Nombre" error={errors.nombre}>
                <Input
                  id="nombre"
                  placeholder="Torre Palermo"
                  aria-invalid={!!errors.nombre}
                  {...register('nombre')}
                />
              </Campo>
            </div>

            <div className="sm:col-span-2">
              <Campo id="direccion" label="Dirección" error={errors.direccion}>
                <Input
                  id="direccion"
                  placeholder="Av. Córdoba 1234"
                  aria-invalid={!!errors.direccion}
                  {...register('direccion')}
                />
              </Campo>
            </div>

            <Campo id="ciudad" label="Ciudad" error={errors.ciudad}>
              <Input
                id="ciudad"
                aria-invalid={!!errors.ciudad}
                {...register('ciudad')}
              />
            </Campo>

            <Campo id="provincia" label="Provincia" error={errors.provincia}>
              <Input
                id="provincia"
                aria-invalid={!!errors.provincia}
                {...register('provincia')}
              />
            </Campo>

            <Campo
              id="codigoPostal"
              label="Código postal"
              error={errors.codigoPostal}
            >
              <Input
                id="codigoPostal"
                placeholder="C1425BGW"
                aria-invalid={!!errors.codigoPostal}
                {...register('codigoPostal')}
              />
            </Campo>

            <Campo id="tipo" label="Tipo de edificio" error={errors.tipo}>
              <Select id="tipo" aria-invalid={!!errors.tipo} {...register('tipo')}>
                {TIPOS_EDIFICIO.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </Select>
            </Campo>

            <Campo id="totalM2" label="Superficie total (m²)" error={errors.totalM2}>
              <Input
                id="totalM2"
                type="number"
                min="0"
                step="any"
                placeholder="3064"
                aria-invalid={!!errors.totalM2}
                {...register('totalM2')}
              />
            </Campo>

            <Campo
              id="fechaInicioAdmin"
              label="Inicio de la administración"
              obligatorio={false}
              error={errors.fechaInicioAdmin}
            >
              <Input
                id="fechaInicioAdmin"
                type="date"
                aria-invalid={!!errors.fechaInicioAdmin}
                {...register('fechaInicioAdmin')}
              />
            </Campo>

            <div className="flex gap-2 pt-2 sm:col-span-2">
              <Button
                type="submit"
                disabled={!isValid || mutation.isPending}
              >
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                {mutation.isPending ? 'Creando…' : 'Crear edificio'}
              </Button>
              <Button
                type="button"
                variant="outline"
                render={<Link to="/edificios" />}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
