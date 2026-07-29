// frontend/src/stores/ayuda.store.js — ConsorcIA
// Store global de ayuda contextual (patrón nuevo de PRD-07-02): guarda el
// topic abierto (ID del registro de lib/ayuda.js) o null si el drawer está
// cerrado. Un solo AyudaDrawer en AppLayout lee este store → cualquier
// componente abre ayuda sin prop drilling: abrirAyuda('modulo/pantalla/tema').
import { create } from 'zustand';

export const useAyudaStore = create()((set) => ({
  topic: null,
  abrirAyuda: (topic) => set({ topic }),
  cerrarAyuda: () => set({ topic: null }),
}));
