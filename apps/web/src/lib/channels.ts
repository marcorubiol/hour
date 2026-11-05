/**
 * Los canales por los que una conversación habla con fuera (ADR-184).
 *
 * El campo de escribir no sabe de correo ni de WhatsApp: dibuja esta lista.
 * Cada canal dice su nombre y su glifo (la pestaña del campo y la primera
 * palabra del hilo), a qué dirección del contacto va (sin ella sale apagado y
 * dice qué falta) y si está conectado en el espacio (si no, no aparece: Hour
 * no promete lo que no hace). Hoy hay uno, el correo, por el buzón conectado
 * (ADR-099, ADR-100). Telegram, WhatsApp o el que pida una compañía entran
 * aquí con su conector, sin tocar la pantalla.
 *
 * Lo que se queda en casa (la nota del equipo, apuntar algo que pasó) no es
 * un canal: existe siempre y va aparte, a la derecha de la fila.
 */

import type { ThreadIconName } from '$lib/components/ThreadIcon.svelte';

/** A qué dato del contacto va un canal. */
export type ChannelAddress = 'email';

export interface Channel {
  id: 'mail';
  icon: ThreadIconName;
  /** La palabra de la pestaña (clave de i18n). */
  label: string;
  address: ChannelAddress;
}

/** En el orden de la fila. El primero conectado es el de por defecto. */
export const CHANNELS: readonly Channel[] = [{ id: 'mail', icon: 'mail', label: 'thread.channel_mail', address: 'email' }];

export type ChannelId = Channel['id'];

