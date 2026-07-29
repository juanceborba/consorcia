// frontend/src/components/ayuda/AyudaDrawer.jsx — ConsorcIA
// Drawer global de ayuda contextual (patrón nuevo de PRD-07-02). Se monta una
// única vez en AppLayout: lee el topic del store de ayuda, lo resuelve contra
// el registro de lib/ayuda.js y lo muestra en el Drawer lateral (breadcrumb
// con › + secciones + temas relacionados). Un topic inexistente muestra un
// fallback, nunca crashea.
//
// Los temas relacionados navegan DENTRO del mismo drawer (abrirAyuda con el
// id del relacionado): el usuario puede recorrer los conceptos sin perder el
// contexto de la pantalla en la que está.
//
// El Drawer tiene portal propio, así que puede abrirse ENCIMA de un Dialog
// de dominio (p. ej. el alta de unidad) sin cerrarlo: Base UI apila el último
// dialog abierto encima y devuelve el foco al trigger al cerrar.
import { ArrowRight } from 'lucide-react';
import { getAyudaTopic } from '@/lib/ayuda';
import { useAyudaStore } from '@/stores/ayuda.store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';

export default function AyudaDrawer() {
  const topic = useAyudaStore((s) => s.topic);
  const abrirAyuda = useAyudaStore((s) => s.abrirAyuda);
  const cerrarAyuda = useAyudaStore((s) => s.cerrarAyuda);
  const contenido = topic ? getAyudaTopic(topic) : null;

  // Relacionados que existen en el registro (un id roto no rompe el drawer).
  const relacionados = (contenido?.relacionados ?? [])
    .map((id) => ({ id, topic: getAyudaTopic(id) }))
    .filter(({ topic: t }) => t !== null);

  return (
    <Drawer
      isOpen={topic !== null}
      onClose={cerrarAyuda}
      title={contenido?.titulo ?? 'Ayuda'}
      size="lg"
    >
      {contenido ? (
        <div className="flex flex-col gap-5">
          {/* Breadcrumb del topic: Edificios › Unidades › Categorías de gastos */}
          <p className="text-xs text-muted-foreground">
            {contenido.ruta.join(' › ')}
          </p>
          {contenido.secciones.map((seccion) => (
            <section key={seccion.titulo} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{seccion.titulo}</h3>
              {seccion.cuerpo && (
                <p className="text-sm text-muted-foreground">
                  {seccion.cuerpo}
                </p>
              )}
              {seccion.items && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  {seccion.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {relacionados.length > 0 && (
            <nav
              aria-label="Temas relacionados"
              className="flex flex-col gap-1 border-t pt-4"
            >
              <h3 className="pb-1 text-sm font-semibold">Temas relacionados</h3>
              {relacionados.map(({ id, topic: relacionado }) => (
                <Button
                  key={id}
                  type="button"
                  variant="link"
                  size="sm"
                  className="w-fit px-0"
                  onClick={() => abrirAyuda(id)}
                >
                  {relacionado.titulo}
                  <ArrowRight className="size-4" />
                </Button>
              ))}
            </nav>
          )}
        </div>
      ) : (
        // Fallback (criterio de aceptación: topic inexistente nunca crashea)
        <p className="text-sm text-muted-foreground">
          Tema de ayuda no encontrado{topic ? `: ${topic}` : ''}.
        </p>
      )}
    </Drawer>
  );
}
