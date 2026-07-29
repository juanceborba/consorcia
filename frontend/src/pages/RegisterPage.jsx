// frontend/src/pages/RegisterPage.jsx — ConsorcIA
// Alta de una administración nueva (S4-08, punto (c): pendiente de S1, el
// endpoint ya existía). POST /api/auth/register crea la organización (tenant
// raíz) + su primer org_admin y devuelve la sesión: se entra sin pasar por el
// login.
//
// Es el ÚNICO auto-registro del MVP y es para el staff que contrata el SaaS.
// Los residentes no se auto-registran (PRD-04-11 §5: la administración es quien
// conoce la titularidad de cada UF — Ley 25.326, minimización de datos).
//
// Errores del contrato con mensaje propio, no un toast genérico:
//   422 EMAIL_YA_REGISTRADO → el email es la identidad global (§7): la persona
//       ya tiene cuenta y debe entrar con su password; sumar otra organización
//       es por invitación staff, no por register.
//   422 CUIT_YA_REGISTRADO → esa administración ya está en ConsorcIA.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, Navigate, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
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

// Espejo de registerSchema en backend/src/routes/auth.routes.js: password
// mínimo 8, CUIT con formato 30-12345678-9 y matrícula RPA obligatoria
// (Ley 941 CABA).
const schema = z
  .object({
    nombre: z.string().trim().min(1, 'Ingresá tu nombre'),
    apellido: z.string().trim().min(1, 'Ingresá tu apellido'),
    email: z.email('Ingresá un email válido'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres'),
    confirmacion: z.string().min(1, 'Repetí la contraseña'),
    organizacionNombre: z
      .string()
      .trim()
      .min(1, 'Ingresá el nombre de la administración'),
    cuit: z
      .string()
      .trim()
      .regex(/^\d{2}-\d{8}-\d$/, 'CUIT con formato 30-12345678-9'),
    matriculaRPA: z.string().trim().min(1, 'Ingresá la matrícula RPA'),
  })
  .refine((d) => d.password === d.confirmacion, {
    path: ['confirmacion'],
    message: 'Las contraseñas no coinciden',
  });

// Campo con label + error inline (patrón PRD-07-02 §6.1).
function Campo({ id, label, error, ayuda, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        <span className="text-destructive">*</span>
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : (
        ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const establecerSesion = useAuthStore((s) => s.establecerSesion);
  const navigate = useNavigate();

  const {
    register,
    setError,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      nombre: '',
      apellido: '',
      email: '',
      password: '',
      confirmacion: '',
      organizacionNombre: '',
      cuit: '',
      matriculaRPA: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (valores) =>
      api.post('/api/auth/register', {
        email: valores.email.trim().toLowerCase(),
        password: valores.password,
        nombre: valores.nombre,
        apellido: valores.apellido,
        organizacion: {
          nombre: valores.organizacionNombre,
          cuit: valores.cuit,
          matriculaRPA: valores.matriculaRPA,
        },
      }),
    onSuccess: (sesion) => {
      establecerSesion(sesion);
      toast.success('Administración creada', {
        description: 'Ya podés cargar tus edificios y unidades.',
      });
      navigate('/edificios', { replace: true });
    },
    onError: (err) => {
      // Los 422 del contrato apuntan a un campo concreto: el error va inline,
      // que es donde el usuario puede corregirlo.
      if (err.code === 'EMAIL_YA_REGISTRADO') {
        setError('email', {
          message:
            'Ese email ya tiene una cuenta en ConsorcIA: iniciá sesión con tu contraseña.',
        });
        return;
      }
      if (err.code === 'CUIT_YA_REGISTRADO') {
        setError('cuit', {
          message: 'Ya existe una administración registrada con ese CUIT.',
        });
        return;
      }
      toast.error('No se pudo crear la administración', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  // Ya hay sesión activa → directo a la app.
  if (accessToken) return <Navigate to="/edificios" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl">Crear tu administración</CardTitle>
          <CardDescription>
            Registrás la administración y tu usuario administrador. Al resto del
            equipo lo invitás después desde Configuración → Usuarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((valores) => mutation.mutate(valores))}
            className="flex flex-col gap-6"
          >
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-medium">
                Tus datos de acceso
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="nombre" label="Nombre" error={errors.nombre}>
                  <Input
                    id="nombre"
                    autoComplete="given-name"
                    aria-invalid={!!errors.nombre}
                    {...register('nombre')}
                  />
                </Campo>
                <Campo id="apellido" label="Apellido" error={errors.apellido}>
                  <Input
                    id="apellido"
                    autoComplete="family-name"
                    aria-invalid={!!errors.apellido}
                    {...register('apellido')}
                  />
                </Campo>
              </div>
              <Campo id="email" label="Email" error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="password"
                  label="Contraseña"
                  error={errors.password}
                  ayuda="Mínimo 8 caracteres."
                >
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={!!errors.password}
                    {...register('password')}
                  />
                </Campo>
                <Campo
                  id="confirmacion"
                  label="Repetí la contraseña"
                  error={errors.confirmacion}
                >
                  <Input
                    id="confirmacion"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={!!errors.confirmacion}
                    {...register('confirmacion')}
                  />
                </Campo>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-medium">
                Datos de la administración
              </legend>
              <Campo
                id="organizacionNombre"
                label="Nombre"
                error={errors.organizacionNombre}
              >
                <Input
                  id="organizacionNombre"
                  placeholder="Administración Palermo SRL"
                  aria-invalid={!!errors.organizacionNombre}
                  {...register('organizacionNombre')}
                />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="cuit"
                  label="CUIT"
                  error={errors.cuit}
                  ayuda="Formato 30-12345678-9."
                >
                  <Input
                    id="cuit"
                    inputMode="numeric"
                    placeholder="30-12345678-9"
                    aria-invalid={!!errors.cuit}
                    {...register('cuit')}
                  />
                </Campo>
                <Campo
                  id="matriculaRPA"
                  label="Matrícula RPA"
                  error={errors.matriculaRPA}
                  ayuda="Registro Público de Administradores (Ley 941 CABA)."
                >
                  <Input
                    id="matriculaRPA"
                    placeholder="RPA-12345"
                    aria-invalid={!!errors.matriculaRPA}
                    {...register('matriculaRPA')}
                  />
                </Campo>
              </div>
            </fieldset>

            <div className="flex flex-col gap-3">
              <Button type="submit" disabled={!isValid || mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {mutation.isPending ? 'Creando…' : 'Crear administración'}
              </Button>
              <p className="text-sm text-muted-foreground">
                ¿Ya tenés cuenta?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Iniciá sesión
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
