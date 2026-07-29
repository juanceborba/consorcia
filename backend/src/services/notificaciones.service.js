// src/services/notificaciones.service.js — Salida de notificaciones (stub MVP)
// Spec: PRD-04-11 §4.4 · PRD-05-01 AgentMail (post-beta).
//
// En el MVP el backoffice muestra el `invitacionUrl` para copiar y el email NO
// se envía. Este módulo existe para que ese día sea un cambio de una sola
// implementación: los endpoints de alta ya llaman a `notificarInvitacion` y
// leen `enviado` de la respuesta, así que sumar AgentMail no toca las rutas.
//
// Nunca lanza: una notificación caída no puede voltear un alta ya committeada.

// Canal efectivo de la notificación:
//   'link'  → MVP, el admin copia y comparte el link a mano
//   'email' → AgentMail (post-beta, cuando ENABLE_AGENTMAIL y la API key estén)
const CANAL_MVP = 'link';

export async function notificarInvitacion({ email, tipo, invitacionUrl, organizacion }) {
  // El link es una credencial de un solo uso: se loguea el destinatario y el
  // tipo, nunca la URL con el token.
  console.info(
    `[notificaciones] invitación ${tipo} para ${email} en org ${organizacion?.id ?? '?'} — canal ${CANAL_MVP} (link para copiar)`
  );
  return { enviado: false, canal: CANAL_MVP, invitacionUrl };
}
