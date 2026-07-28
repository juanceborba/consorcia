// frontend/src/stores/edificio.store.js — ConsorcIA
// Edificio de trabajo seleccionado en el header (S1-12), persistido en localStorage.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useEdificioStore = create()(
  persist(
    (set) => ({
      edificioId: null,
      setEdificioId: (edificioId) => set({ edificioId }),
    }),
    { name: 'consorcia-edificio' },
  ),
);
