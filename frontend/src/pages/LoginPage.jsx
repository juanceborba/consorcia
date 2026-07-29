// frontend/src/pages/LoginPage.jsx — ConsorcIA
// Login (S1-11): React Hook Form + Zod contra POST /api/auth/login.
// En modo dev muestra las credenciales demo del seed; errores del server van a toast.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
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

const schema = z.object({
  email: z.email('Ingresá un email válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const accessToken = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Ya hay sesión activa → directo a la app.
  if (accessToken) return <Navigate to="/edificios" replace />;

  const onSubmit = async ({ email, password }) => {
    try {
      await login(email, password);
      // Vuelve a la ruta original si RequireAuth redirigió, si no a /edificios.
      const destino = location.state?.from?.pathname ?? '/edificios';
      navigate(destino, { replace: true });
    } catch (err) {
      toast.error('No se pudo iniciar sesión', {
        description: err.message ?? 'Error inesperado',
      });
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">ConsorcIA</CardTitle>
          <CardDescription>Ingresá con tu cuenta de administración</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@demo.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
          {/* Alta de una administración nueva (S4-08) */}
          <p className="mt-4 text-sm text-muted-foreground">
            ¿Administrás consorcios y todavía no tenés cuenta?{' '}
            <Link to="/register" className="text-primary hover:underline">
              Creá tu administración
            </Link>
          </p>
          {import.meta.env.DEV && (
            <p className="mt-4 text-xs text-muted-foreground">
              Demo — admin@demo.com / demo1234 (org_admin) · gestor@demo.com /
              demo1234 (gestor)
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
