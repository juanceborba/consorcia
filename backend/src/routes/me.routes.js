// src/routes/me.routes.js — Contexto propio del usuario logueado (S4-12, #58)
// Spec: PRD-04-11 §5.5 y §6.
//
//   GET /api/me/unidades → vínculos VIGENTES del usuario con unidad + edificio
//                          + organización, agregados por `usuarioId`
//
// Por qué un endpoint aparte y NO `GET /api/edificios`: el listado de edificios
// es del backoffice y está scopeado por la organización activa del JWT (pasa
// por `tenant`, que responde 403 SIN_ORGANIZACION_ACTIVA cuando el token no
// trae `org_id`). Un residente puro NO tiene organización activa por diseño
// (PRD-04-11 §5.5: el portal agrega por `usuarioId`, no por tenant), así que
// meterlo en /api/edificios obligaría a romper el aislamiento multi-tenant del
// backoffice. Acá el scope es el propio `req.user.id`: no hace falta `tenant`
// ni Cerbos porque el recurso ES el usuario del token — nunca se lee nada que
// no cuelgue de sus vínculos.
//
// Es la base mínima del portal del residente (PRD-04-05, S5): solo lectura.

import { Router } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// GET /unidades — todas las UFs vigentes de la persona, de todos sus
// consorcios y administraciones (multi-pertenencia, §5.3).
//
// Vigente = `fechaFin: null`, la misma definición que usa auth.service.js para
// derivar los roles `propietario`/`inquilino` del JWT: así lo que el token dice
// que sos y lo que este endpoint devuelve nunca se contradicen.
router.get('/unidades', requireAuth, async (req, res, next) => {
  try {
    const vinculos = await prisma.unidadUsuario.findMany({
      where: {
        usuarioId: req.user.id,
        fechaFin: null,
        // Un edificio dado de baja (soft delete, S2-01) se comporta como
        // inexistente también acá.
        unidad: { edificio: { activo: true } },
      },
      select: {
        id: true,
        esPropietario: true,
        esInquilino: true,
        fechaInicio: true,
        unidad: {
          select: {
            id: true,
            numero: true,
            tipo: true,
            edificio: {
              select: {
                id: true,
                nombre: true,
                direccion: true,
                ciudad: true,
                organizacion: { select: { id: true, nombre: true } },
              },
            },
          },
        },
      },
      orderBy: { fechaInicio: 'desc' },
    });

    const data = vinculos.map((v) => {
      const { edificio } = v.unidad;
      return {
        id: v.id,
        esPropietario: v.esPropietario,
        esInquilino: v.esInquilino,
        fechaInicio: v.fechaInicio,
        unidad: { id: v.unidad.id, numero: v.unidad.numero, tipo: v.unidad.tipo },
        edificio: {
          id: edificio.id,
          nombre: edificio.nombre,
          direccion: edificio.direccion,
          ciudad: edificio.ciudad,
        },
        organizacion: edificio.organizacion,
      };
    });

    // Orden estable para la UI: por edificio y después por número de UF.
    data.sort(
      (a, b) =>
        a.edificio.nombre.localeCompare(b.edificio.nombre, 'es') ||
        a.unidad.numero.localeCompare(b.unidad.numero, 'es', { numeric: true })
    );

    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

export default router;
