// frontend/src/pages/edificio/UnidadCategoriasTab.jsx — ConsorcIA
// Tab "Categorías de gastos" del alta individual de unidad (S2-09, #57): las
// categorías A/B/C (Ley 941, PRD-04-01 §1.4) dejan de ser un fieldset
// comprimido al final del form y pasan a un tab propio con una tarjeta
// explicativa por categoría — qué es, ejemplos y cómo afecta la liquidación
// futura (S3-03: A reparte entre TODAS las UF, B solo entre las UF con ese
// servicio, C solo entre las del sector). Arriba de las tarjetas, AyudaLink
// abre el drawer de ayuda contextual con el tema completo — va primero (y no
// al pie) porque con las 3 tarjetas el contenido supera el alto del modal y
// un link al final quedaría oculto bajo el fold.
//
// Los controles son los mismos de siempre y cuelgan del MISMO form RHF del
// dialog (los recibe por prop): cambiar de tab desmonta los inputs pero RHF
// conserva los valores (shouldUnregister default false), así que se puede
// guardar desde cualquiera de los dos tabs sin perder nada.
import { SERVICIOS_B } from '@/lib/unidad-schema';
import AyudaLink from '@/components/ayuda/AyudaLink';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Tarjeta explicativa de una categoría: nombre, qué es, ejemplos y cómo
// afecta después, con el control de la categoría abajo.
function TarjetaCategoria({ titulo, queEs, ejemplos, comoAfecta, children }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-sm text-muted-foreground">{queEs}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Ejemplos: </span>
        {ejemplos}
      </p>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Cómo afecta después:{' '}
        </span>
        {comoAfecta}
      </p>
      <div className="pt-1">{children}</div>
    </section>
  );
}

export default function UnidadCategoriasTab({ form }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Ayuda contextual profunda: abre el drawer con el tema completo.
          Va arriba de las tarjetas para que quede visible sin scrollear. */}
      <AyudaLink topic="edificios/unidades/categorias-gastos" />

      <TarjetaCategoria
        titulo="A — Gastos generales"
        queEs="Los gastos que afectan a todo el consorcio, sin importar la ubicación o el uso de la unidad. Casi siempre queda marcada en todas las unidades."
        ejemplos="sueldos del encargado, seguros, ABL, limpieza común."
        comoAfecta="al liquidar, estos gastos se reparten entre TODAS las unidades, cada una según su coeficiente."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            {...form.register('categoriaA')}
          />
          Esta unidad paga gastos generales
        </label>
      </TarjetaCategoria>

      <TarjetaCategoria
        titulo="B — Servicios específicos"
        queEs="Servicios que solo usan algunas unidades. Se tilda servicio por servicio: la unidad paga únicamente los que tiene marcados."
        ejemplos="ascensor, calefacción central, agua caliente central."
        comoAfecta="al liquidar, un gasto de un servicio se reparte solo entre las unidades que lo tienen tildado, según su coeficiente."
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {SERVICIOS_B.map((servicio) => (
            <label key={servicio.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                value={servicio.value}
                className="size-4 accent-primary"
                {...form.register('categoriaB')}
              />
              {servicio.label}
            </label>
          ))}
        </div>
      </TarjetaCategoria>

      <TarjetaCategoria
        titulo="C — Sectores"
        queEs="Agrupa unidades que comparten un gasto propio de su sector. Todas las unidades con el mismo nombre de sector pagan juntas esos gastos."
        ejemplos="pileta, torre-a, sector comercial."
        comoAfecta="al liquidar, un gasto de un sector se reparte solo entre las unidades de ese sector, según su coeficiente."
      >
        <div className="flex items-center gap-2">
          <Label htmlFor="unidad-categoriaC" className="text-muted-foreground">
            Sector:
          </Label>
          <Input
            id="unidad-categoriaC"
            placeholder="Opcional (ej. pileta, torre-a)"
            className="max-w-xs"
            {...form.register('categoriaC')}
          />
        </div>
      </TarjetaCategoria>
    </div>
  );
}
