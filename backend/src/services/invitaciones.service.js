// src/services/invitaciones.service.js — Creación de invitaciones (S4-03/S4-04)
// Spec: PRD-04-11 §2.3, §4, §6.
//
// Piezas compartidas por los dos workflows de alta (staff y residentes). El
// consumo del token vive en `routes/invitaciones.routes.js` (S4-02).
//
// Regla del modelo: una sola invitación PENDIENTE por (email, organizacionId,
// tipo) — índice único parcial `WHERE usada_at IS NULL`. Reenviar NO crea una
// fila nueva: regenera token y expiración de la misma (y su payload, porque el
// admin puede haber corregido rol o edificios).

import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

// Días de validez del link (PRD-04-11 §2.3). Fuente única para los endpoints
// de alta, el consumo del token y los tests.
export const DIAS_VALIDEZ_INVITACION = 7;

export function calcularExpiracion(desde = new Date()) {
  return new Date(desde.getTime() + DIAS_VALIDEZ_INVITACION * 24 * 60 * 60 * 1000);
}

// Link que el backoffice muestra para copiar (MVP sin envío de email, §4.4).
// Apunta al frontend, no a la API: `/invitacion/:token` es una ruta pública de
// la SPA (PRD-07-03).
export function construirInvitacionUrl(token) {
  return `${config.app.baseUrl}/invitacion/${token}`;
}

// Invitación pendiente para esa terna, o null. Pendiente = sin usar y vigente:
// una vencida no bloquea (el admin vuelve a invitar y se regenera).
export function buscarPendiente(client, { email, organizacionId, tipo }) {
  return client.invitacion.findFirst({
    where: { email, organizacionId, tipo, usadaAt: null },
  });
}

export const errorInvitacionPendiente = () => ({
  error: {
    code: 'INVITACION_PENDIENTE',
    message:
      'Ya hay una invitación pendiente para ese email en esta organización; reenviala con reenviar: true',
  },
});

// Crea la invitación o, si ya existe una pendiente, la reemplaza in situ
// (token + expiración + payload nuevos). Devuelve la fila.
//
// El `token` se genera acá y no con el default del schema para que el reenvío
// también rote (un update no dispara `@default`).
//
// `creaUsuario` (S4-11 / SEC-02) marca que este alta creó la identidad global:
// es lo que habilita a la invitación a definir la password de una cuenta que
// todavía no fue activada. En el REENVÍO se conserva el valor original con un
// OR: la persona ya existe (porque la creó la invitación anterior de esta misma
// organización), así que recalcularlo lo pondría en false y el link nuevo
// dejaría de poder activar la cuenta que su propio origen aprovisionó.
export async function crearOReenviarInvitacion(
  client,
  { email, organizacionId, tipo, payload, invitadoPorId, creaUsuario = false, pendiente = null }
) {
  const datos = {
    token: randomUUID(),
    expiraAt: calcularExpiracion(),
    payload,
    invitadoPorId,
  };

  if (pendiente) {
    return client.invitacion.update({
      where: { id: pendiente.id },
      data: { ...datos, creaUsuario: pendiente.creaUsuario || creaUsuario },
    });
  }
  return client.invitacion.create({
    data: { email, organizacionId, tipo, creaUsuario, ...datos },
  });
}
