// frontend/src/components/ui/alert.jsx — ConsorcIA
// Alert inline (PRD-07-02 §4: estados de feedback no bloqueante). Banda de
// aviso que se muestra dentro del contenido, no como toast: para condiciones
// persistentes que el usuario tiene que resolver cuando pueda. Variantes con
// los tokens de estado de S2-05 (`success` / `warning` / `danger` / `info`),
// mismo criterio de color que Badge.
//
// Primer uso (#57): la suma de coeficientes de un edificio que no cierra en
// 1.000000 — informativa, nunca bloqueante.
import { cva } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex items-start gap-3 rounded-lg border p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        info: 'border-info/40 bg-info/10 text-info',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-warning/40 bg-warning/10 text-warning-hover dark:text-warning',
        danger: 'border-danger/40 bg-danger/10 text-danger',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

const ICONOS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

function Alert({ variant = 'info', title, className, children, ...props }) {
  const Icono = ICONOS[variant];
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icono />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
