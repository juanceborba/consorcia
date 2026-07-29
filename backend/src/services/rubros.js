// src/services/rubros.js — Merge del árbol de rubros para una organización
// Spec: PRD-04-02 §1.4 (S3-13).
//
// El árbol tiene DOS niveles fijos: rubro (parentId null) → subrubro (hoja). Y
// tres fuentes que hay que mergear para una organización:
//
//   1. el maestro de plataforma (`organizacionId = null`),
//   2. los overrides de `RubroVisibilidad` de la org (visible=false oculta un
//      ítem del maestro; ocultar un rubro oculta también sus subrubros),
//   3. los ítems propios activos de la org (un subrubro propio puede colgar de
//      un rubro maestro visible o de un rubro propio).
//
// Vive en un service y no en la ruta porque S3-02 lo necesita para validar que
// el `rubroId` de un gasto sea una hoja visible para la organización, y S3-12
// para el `rubroHabitual` del proveedor.

import prisma from '../db/prisma.js';

const CAMPOS = {
  id: true,
  organizacionId: true,
  parentId: true,
  nombre: true,
  orden: true,
  activo: true,
};

// Un nodo del árbol tal como lo devuelve la API.
function serializar(rubro, { visible, subrubros = [] }) {
  return {
    id: rubro.id,
    parentId: rubro.parentId,
    nombre: rubro.nombre,
    orden: rubro.orden,
    activo: rubro.activo,
    esMaestro: rubro.organizacionId === null,
    // Solo los ítems del maestro tienen override de visibilidad; los propios se
    // ocultan dándolos de baja (`activo=false`), que es lo que hace su DELETE.
    visible,
    subrubros,
  };
}

const porOrden = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

/**
 * Árbol mergeado de rubros para una organización.
 *
 * @param organizacionId  org activa del JWT
 * @param incluirOcultos  si true, incluye los ítems del maestro ocultados por
 *   la org (con `visible: false`) y los propios inactivos. Lo usa la pantalla de
 *   administración (S3-14) para poder volver a mostrarlos; el árbol por defecto
 *   es el usable para cargar un gasto.
 */
export async function arbolParaOrganizacion(organizacionId, { incluirOcultos = false } = {}) {
  const [items, overrides] = await Promise.all([
    prisma.rubro.findMany({
      where: {
        OR: [
          // Maestro: los ítems desactivados por la plataforma no se ofrecen
          // nunca (a diferencia de los propios, que la org puede rehabilitar).
          { organizacionId: null, activo: true },
          { organizacionId, ...(incluirOcultos ? {} : { activo: true }) },
        ],
      },
      select: CAMPOS,
    }),
    prisma.rubroVisibilidad.findMany({
      where: { organizacionId },
      select: { rubroId: true, visible: true },
    }),
  ]);

  // Override ausente = visible (el maestro se ve salvo que la org lo oculte).
  const visibilidad = new Map(overrides.map((o) => [o.rubroId, o.visible]));
  const esVisible = (rubro) =>
    rubro.organizacionId !== null || (visibilidad.get(rubro.id) ?? true);

  const raices = items.filter((r) => r.parentId === null).sort(porOrden);
  const hijosPorPadre = new Map();
  for (const item of items.filter((r) => r.parentId !== null)) {
    if (!hijosPorPadre.has(item.parentId)) hijosPorPadre.set(item.parentId, []);
    hijosPorPadre.get(item.parentId).push(item);
  }

  const arbol = [];
  for (const raiz of raices) {
    const raizVisible = esVisible(raiz);
    if (!raizVisible && !incluirOcultos) continue;

    const hijos = (hijosPorPadre.get(raiz.id) ?? []).sort(porOrden);
    const subrubros = [];
    for (const hijo of hijos) {
      // Ocultar un rubro oculta sus subrubros (§1.4), incluidos los propios que
      // cuelgan de un rubro maestro oculto: en el árbol quedan inalcanzables.
      const hijoVisible = raizVisible && esVisible(hijo);
      if (!hijoVisible && !incluirOcultos) continue;
      subrubros.push(serializar(hijo, { visible: hijoVisible }));
    }
    arbol.push(serializar(raiz, { visible: raizVisible, subrubros }));
  }
  return arbol;
}

/**
 * Ítems del árbol visible, aplanados por id. Base de las validaciones cruzadas:
 * saber si un `rubroId` es usable por esta organización sin volver a mergear.
 */
export async function indiceVisible(organizacionId) {
  const arbol = await arbolParaOrganizacion(organizacionId);
  const indice = new Map();
  for (const raiz of arbol) {
    indice.set(raiz.id, { ...raiz, esHoja: raiz.subrubros.length === 0 });
    for (const hijo of raiz.subrubros) indice.set(hijo.id, { ...hijo, esHoja: true });
  }
  return indice;
}

/**
 * ¿La organización puede referenciar este rubro? (visible y activo).
 * `soloHojas` exige además que sea hoja: el gasto siempre apunta a un subrubro o
 * a un rubro sin hijos (PRD-04-02 §1.1), mientras que el rubro habitual de un
 * proveedor puede ser cualquier nodo visible.
 */
export async function rubroUsable(organizacionId, rubroId, { soloHojas = false } = {}) {
  if (!rubroId) return true;
  const nodo = (await indiceVisible(organizacionId)).get(rubroId);
  if (!nodo || !nodo.activo) return false;
  return soloHojas ? nodo.esHoja : true;
}
