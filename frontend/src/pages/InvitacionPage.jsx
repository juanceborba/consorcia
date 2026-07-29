// frontend/src/pages/InvitacionPage.jsx — ConsorcIA
// Pantalla PÚBLICA de activación por invitación (S4-08, PRD-04-11 §4.5 y §5.4).
// Es la única credencial que tiene el invitado: el token del link prueba
// posesión del buzón (§7), así que la ruta va fuera de RequireAuth.
//
// GET /api/invitaciones/:token → a qué organización y con qué rol lo invitaron
// (email enmascarado: el link puede terminar en manos de un tercero, Ley
// 25.326). 410 INVITACION_INVALIDA no distingue entre inexistente, usada y
// vencida — la pantalla muestra un solo mensaje y manda a login.
//
// POST /api/invitaciones/:token/aceptar → define la password (mínimo 8, con
// confirmación) y devuelve la sesión ya emitida: se guarda en el auth.store y
// se entra sin pasar por el login.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, MailX } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/auth.store';
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

// Mínimo 8 caracteres, igual que el contrato del backend (aceptarSchema).
const schema = z
  .object({
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres'),
    confirmacion: z.string().min(1, 'Repetí la contraseña'),
  })
  .refine((d) => d.password === d.confirmacion, {
    path: ['confirmacion'],
    message: 'Las contraseñas no coinciden',
  });

const TIPO_TEXTO = {
  STAFF: 'como parte del equipo de administración',
  RESIDENTE: 'como residente de una unidad',
};

function Pantalla({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">{children}</Card>
    </main>
  );
}

export default function InvitacionPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const establecerSesion = useAuthStore((s) => s.establecerSesion);

  const { data: invitacion, isLoading, error } = useQuery({
    queryKey: queryKeys.invitaciones.porToken(token),
    queryFn: () => api.get(`/api/invitaciones/${token}`),
    // Un token inválido no se arregla reintentando (410 definitivo).
    retry: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { password: '', confirmacion: '' },
  });

  const aceptar = useMutation({
    mutationFn: (valores) =>
      api.post(`/api/invitaciones/${token}/aceptar`, {
        password: valores.password,
        confirmacion: valores.confirmacion,
      }),
    onSuccess: (sesion) => {
      // El endpoint ya devuelve la sesión emitida: se entra sin login.
      establecerSesion(sesion);
      toast.success('Cuenta activada', {
        description: `¡Bienvenido/a, ${sesion.user.nombre || sesion.user.email}!`,
      });
      navigate('/', { replace: true });
    },
    onError: (err) => {
      toast.error('No se pudo activar la cuenta', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  if (isLoading) {
    return (
      <Pantalla>
        <CardHeader>
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded bg-muted" />
        </CardHeader>
      </Pantalla>
    );
  }

  // 410 INVITACION_INVALIDA (o cualquier otro fallo de lectura del token):
  // pantalla de invitación inválida, sin pistas de por qué.
  if (error) {
    return (
      <Pantalla>
        <CardHeader>
          <MailX className="size-8 text-muted-foreground" />
          <CardTitle>Invitación inválida o vencida</CardTitle>
          <CardDescription>
            Este link ya fue usado, venció o no existe. Pedile a tu
            administración que te envíe una invitación nueva.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link to="/login" />} variant="outline">
            Ir a iniciar sesión
          </Button>
        </CardContent>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <CardHeader>
        <CardTitle className="text-2xl">Activá tu cuenta</CardTitle>
        <CardDescription>
          <strong>{invitacion.organizacion.nombre}</strong> te invitó{' '}
          {TIPO_TEXTO[invitacion.tipo] ?? 'a ConsorcIA'}. Definí tu contraseña
          para entrar con <strong>{invitacion.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((valores) => aceptar.mutate(valores))}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Mínimo 8 caracteres.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmacion">Repetí la contraseña</Label>
            <Input
              id="confirmacion"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmacion}
              {...register('confirmacion')}
            />
            {errors.confirmacion && (
              <p className="text-sm text-destructive">
                {errors.confirmacion.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={!isValid || aceptar.isPending}>
            {aceptar.isPending && <Loader2 className="size-4 animate-spin" />}
            {aceptar.isPending ? 'Activando…' : 'Activar cuenta y entrar'}
          </Button>
        </form>
      </CardContent>
    </Pantalla>
  );
}
