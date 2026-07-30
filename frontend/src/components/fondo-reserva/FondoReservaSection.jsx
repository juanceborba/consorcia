// frontend/src/components/fondo-reserva/FondoReservaSection.jsx — ConsorcIA
// Reglas del fondo de reserva del edificio (S3-21), en el tab Configuración
// junto a los esquemas de reparto. Contrato en PRD-04-03 §5 y diseño en
// `docs/investigacion/ledger-y-fondo-de-reserva.md`.
//
// DECISIONES:
//
// 1. NO HAY "EDITAR": HAY UNA REGLA NUEVA CON SU VIGENCIA. Es lo que hace el
//    backend (las reglas se suceden, no se pisan) y la UI no lo disimula: el
//    formulario dice "desde qué período" y la lista es un historial. Un botón
//    "editar" prometería cambiar el 5% de marzo, que ya se liquidó.
//
// 2. LA LISTA MARCA CUÁL RIGE HOY, que no siempre es la primera: una regla con
//    vigencia futura encabeza el historial y todavía no se aplica. Sin esa
//    marca, el administrador que acaba de cargar la de septiembre cree que ya
//    está cobrando ese porcentaje.
//
// 3. SE MUESTRA LO QUE VA A PASAR, no solo el dato: la descripción ("5,00% de
//    las expensas ordinarias") la arma el backend y es la MISMA que imprime el
//    recibo. Dos redacciones del mismo número es como empiezan las diferencias
//    entre lo que el administrador configuró y lo que el propietario lee.
//
// 4. EL GESTOR LEE, ADMINISTRA EL ORG_ADMIN — igual que los esquemas: el fondo
//    es plata del consorcio y su porcentaje lo fija una asamblea.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatearMonto, formatearPeriodo, ultimosPeriodos } from '@/lib/formato';
import { useAuthStore, SIN_ROLES } from '@/stores/auth.store';
import AyudaLink from '@/components/ayuda/AyudaLink';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const BASES = [
  { value: 'ORDINARIAS', label: '% de las expensas ordinarias' },
  { value: 'TOTAL', label: '% del total del período' },
  { value: 'MONTO_FIJO', label: 'Monto fijo por período' },
];

// Los períodos ofrecidos van del mes corriente hacia adelante: una regla nueva
// rige desde ahora o desde una fecha futura (la que votó la asamblea). Retroceder
// sería reescribir períodos ya liquidados, que es justo lo que el versionado
// vino a impedir.
function periodosDeVigencia() {
  const [corriente] = ultimosPeriodos(1);
  const [anio, mes] = corriente.split('-').map(Number);
  return Array.from({ length: 13 }, (_, i) => {
    const fecha = new Date(Date.UTC(anio, mes - 1 + i, 1));
    return fecha.toISOString().slice(0, 7);
  });
}

function FormularioRegla({ edificioId, abierto, onCerrar }) {
  const queryClient = useQueryClient();
  const periodos = periodosDeVigencia();
  const [vigenciaDesde, setVigenciaDesde] = useState(periodos[0]);
  const [base, setBase] = useState('ORDINARIAS');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState(null);

  const crear = useMutation({
    mutationFn: () =>
      api.post(`/api/edificios/${edificioId}/fondo-reserva`, {
        vigenciaDesde,
        base,
        ...(base === 'MONTO_FIJO'
          ? { montoFijo: Number(valor.replace(',', '.')) }
          : { porcentaje: Number(valor.replace(',', '.')) }),
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      }),
    onSuccess: (regla) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fondoReserva.all });
      toast.success('Regla del fondo guardada', {
        description: `${regla.descripcion}, desde ${formatearPeriodo(regla.vigenciaDesde)}.`,
      });
      onCerrar();
    },
    onError: (err) => {
      // El 409 de vigencia ocupada es el error esperable y se explica en el
      // formulario, no en un toast que tapa el campo que hay que corregir.
      setError(err.message ?? 'No se pudo guardar la regla');
    },
  });

  return (
    <Dialog
      isOpen={abierto}
      onClose={onCerrar}
      title="Nueva regla del fondo de reserva"
      description="Rige desde el período que elijas. Las liquidaciones anteriores conservan la regla con la que se emitieron."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          crear.mutate();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="fondo-vigencia">Vigente desde</Label>
          <Select
            id="fondo-vigencia"
            value={vigenciaDesde}
            onChange={(e) => setVigenciaDesde(e.target.value)}
          >
            {periodos.map((p) => (
              <option key={p} value={p}>
                {formatearPeriodo(p)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fondo-base">Cómo se calcula</Label>
          <Select id="fondo-base" value={base} onChange={(e) => setBase(e.target.value)}>
            {BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fondo-valor">
            {base === 'MONTO_FIJO' ? 'Importe por período' : 'Porcentaje'}
          </Label>
          <Input
            id="fondo-valor"
            inputMode="decimal"
            placeholder={base === 'MONTO_FIJO' ? '50000' : '5'}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            {base === 'ORDINARIAS'
              ? 'En la práctica se usa entre 5% y 10% de la expensa ordinaria.'
              : base === 'TOTAL'
                ? 'Incluye las extraordinarias del período en la base de cálculo.'
                : 'El mismo importe todos los meses, sin importar los gastos.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fondo-motivo">Respaldo (opcional)</Label>
          <Input
            id="fondo-motivo"
            placeholder="Asamblea del 12/07/2026"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={crear.isPending || !valor}>
            {crear.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar regla
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function FondoReservaSection({ edificio }) {
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles ?? SIN_ROLES);
  // Decisión 4.
  const puedeAdministrar = roles.some((r) => ['org_admin', 'superadmin'].includes(r));

  const [formAbierto, setFormAbierto] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.fondoReserva.porEdificio(edificio.id),
    queryFn: () => api.get(`/api/edificios/${edificio.id}/fondo-reserva`),
  });

  const reglas = data?.data ?? [];
  const vigente = data?.vigente ?? null;

  const eliminar = useMutation({
    mutationFn: (id) => api.del(`/api/fondo-reserva/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fondoReserva.all });
      setAEliminar(null);
      toast.success('Regla eliminada');
    },
    onError: (err) => {
      setAEliminar(null);
      // El 409 de regla en uso es información, no una falla: se explica.
      toast.error('No se pudo eliminar la regla', {
        description: err.message ?? 'Error inesperado',
      });
    },
  });

  const valorDe = (regla) =>
    regla.base === 'MONTO_FIJO'
      ? formatearMonto(regla.montoFijo ?? '0.00')
      : `${Number(regla.porcentaje ?? 0).toFixed(2).replace('.', ',')}%`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-5 shrink-0" />
          Fondo de reserva
          <AyudaLink variant="icon" topic="edificios/fondo-reserva" />
        </CardTitle>
        <CardDescription>
          {vigente
            ? `Hoy se aporta ${vigente.descripcion.toLowerCase()}, desde ${formatearPeriodo(vigente.vigenciaDesde)}.`
            : 'Todavía no hay ninguna regla: las liquidaciones no incluyen aporte al fondo.'}
        </CardDescription>
        {puedeAdministrar && (
          <CardAction>
            <Button size="sm" onClick={() => setFormAbierto(true)}>
              <Plus className="size-4" />
              Nueva regla
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {isPending ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">No se pudieron cargar las reglas.</p>
        ) : reglas.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            El aporte al fondo de reserva es una contribución de todos los
            propietarios (art. 2046 inc. d del Código Civil y Comercial). Cargá la
            regla que haya votado la asamblea y se va a incluir en las
            liquidaciones desde el período que indiques.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reglas.map((regla) => {
              const esVigente = vigente?.id === regla.id;
              const esFutura = regla.vigenciaDesde > (data?.periodoActual ?? '');
              return (
                <li
                  key={regla.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
                    esVigente ? 'border-ring bg-muted/40' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">{valorDe(regla)}</span>
                      <span className="text-sm text-muted-foreground">
                        {regla.descripcion}
                      </span>
                      {/* Decisión 2. */}
                      {esVigente && <Badge variant="success">Vigente</Badge>}
                      {esFutura && <Badge variant="secondary">Desde el futuro</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Desde {formatearPeriodo(regla.vigenciaDesde)}
                      {regla.esquemaReparto
                        ? ` · se reparte con "${regla.esquemaReparto.nombre}"`
                        : ' · se reparte por coeficiente'}
                      {regla.motivo ? ` · ${regla.motivo}` : ''}
                    </span>
                  </div>

                  {puedeAdministrar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Eliminar la regla desde ${regla.vigenciaDesde}`}
                      onClick={() => setAEliminar(regla)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Lo que la capa A todavía NO hace, dicho acá y no descubierto por el
            usuario: el fondo se acumula pero no se puede usar hasta que exista
            el ledger del edificio (ver docs/investigacion). */}
        {reglas.length > 0 && (
          <p className="text-xs text-muted-foreground">
            El fondo se acumula con cada liquidación aprobada. Usarlo para
            financiar una obra extraordinaria requiere la cuenta corriente del
            edificio, que todavía no está disponible.
          </p>
        )}
      </CardContent>

      {puedeAdministrar && formAbierto && (
        <FormularioRegla
          edificioId={edificio.id}
          abierto={formAbierto}
          onCerrar={() => setFormAbierto(false)}
        />
      )}

      <ConfirmDialog
        isOpen={aEliminar !== null}
        onClose={() => setAEliminar(null)}
        onConfirm={() => eliminar.mutate(aEliminar.id)}
        loading={eliminar.isPending}
        title="Eliminar la regla del fondo"
        variant="danger"
        confirmText="Eliminar"
        description={
          aEliminar
            ? `La regla vigente desde ${formatearPeriodo(aEliminar.vigenciaDesde)} deja de existir. Si ya se liquidó algún período con ella, no se puede borrar: en ese caso cargá una regla nueva con la vigencia que corresponda.`
            : ''
        }
      />
    </Card>
  );
}
