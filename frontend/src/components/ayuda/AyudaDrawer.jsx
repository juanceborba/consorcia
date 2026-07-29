// frontend/src/components/ayuda/AyudaDrawer.jsx — ConsorcIA
// Drawer global de ayuda contextual (patrón nuevo de PRD-07-02). Se monta una
// única vez en AppLayout: lee el topic del store de ayuda, lo resuelve contra
// el registro de lib/ayuda.js y lo muestra en el Drawer lateral (breadcrumb
// con › + secciones). Un topic inexistente muestra un fallback, nunca crashea.
//
// El Drawer tiene portal propio, así que puede abrirse ENCIMA de un Dialog
// de dominio (p. ej. el alta de unidad) sin cerrarlo: Base UI apila el último
// dialog abierto encima y devuelve el foco al trigger al cerrar.
import { getAyudaTopic } from '@/lib/ayuda';
import { useAyudaStore } from '@/stores/ayuda.store';
import { Drawer } from '@/components/ui/drawer';

export default function AyudaDrawer() {
  const topic = useAyudaStore((s) => s.topic);
  const cerrarAyuda = useAyudaStore((s) => s.cerrarAyuda);
  const contenido = topic ? getAyudaTopic(topic) : null;

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
