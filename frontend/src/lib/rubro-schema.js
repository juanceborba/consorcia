// frontend/src/lib/rubro-schema.js — ConsorcIA
// Espejo del schema Zod del backend (`backend/src/schemas/rubro.schema.js`,
// S3-13) para los ítems PROPIOS de la organización. El maestro de plataforma no
// se edita desde acá: se oculta con el toggle de visibilidad.
//
// `orden` es un number en la API pero un input de texto en el form: RHF entrega
// strings, así que se coerce. `parentId` no está en el schema de edición porque
// mover un rubro de padre cambiaría la segmentación de los gastos ya cargados
// (el backend tampoco lo acepta).

import { z } from 'zod';

export const rubroSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre necesita al menos 2 caracteres')
    .max(100, 'Máximo 100 caracteres'),
  orden: z.coerce
    .number({ message: 'El orden tiene que ser un número' })
    .int('El orden tiene que ser un número entero')
    .min(0, 'El orden no puede ser negativo')
    .max(9999, 'Máximo 9999'),
});

export const RUBRO_VACIO = { nombre: '', orden: 0 };

// Aplana el árbol a `[{ id, nombre, esMaestro, activo, visible, esHoja, subrubros }]`
// de nivel 1 — lo que necesita el select de "colgar de" al crear un subrubro y el
// selector en cascada del form de gasto.
export function rubrosNivel1(arbol) {
  return arbol.map((rubro) => ({ ...rubro, esHoja: rubro.subrubros.length === 0 }));
}

// Todos los nodos visibles como opciones planas de un `<select>`, con el padre
// en la etiqueta ("Mantenimiento › Plomería"). Un rubro nivel 1 no puede ser a la
// vez `<optgroup>` y `<option>`, y el rubro habitual de un proveedor puede ser
// cualquier nodo visible (no solo hoja), así que la jerarquía va en el texto.
export function opcionesPlanas(arbol) {
  const opciones = [];
  for (const rubro of arbol) {
    opciones.push({ id: rubro.id, etiqueta: rubro.nombre });
    for (const subrubro of rubro.subrubros) {
      opciones.push({
        id: subrubro.id,
        etiqueta: `${rubro.nombre} › ${subrubro.nombre}`,
      });
    }
  }
  return opciones;
}

// Hojas del árbol: subrubros + rubros nivel 1 sin hijos. Son los únicos que un
// gasto puede referenciar (PRD-04-02 §1.1, validado por el backend en S3-02).
export function hojasDelArbol(arbol) {
  const hojas = [];
  for (const rubro of arbol) {
    if (rubro.subrubros.length === 0) {
      hojas.push({ ...rubro, rubroPadre: null });
      continue;
    }
    for (const subrubro of rubro.subrubros) {
      hojas.push({ ...subrubro, rubroPadre: rubro });
    }
  }
  return hojas;
}
