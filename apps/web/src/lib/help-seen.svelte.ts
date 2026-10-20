/**
 * Lo visto de la ayuda contextual, en la sesión: una lectura por arranque de
 * `GET /api/me/help`, compartida por todas las tarjetas y avisos (como
 * `ensureSession`). Marcar escribe en la sesión al momento y en la base
 * después; si la escritura falla, la tarjeta no vuelve en esta visita y sí en
 * la siguiente, que es el fallo menos molesto.
 *
 * La regla de cuándo sale cada cosa es pura y está en `$lib/help`.
 */

import { mutateJSON } from '$lib/api';
import type { HelpSeen, HelpState } from '$lib/help';

export const help = $state<HelpState>({ seen: {}, ready: false, reopened: null });

let probe: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    const res = await fetch('/api/me/help');
    if (!res.ok) return;
    const body = (await res.json()) as { seen?: HelpSeen };
    help.seen = { ...(body.seen ?? {}), ...help.seen };
    help.ready = true;
  } catch {
    // Sin lo visto no sale nada solo; el «?» sigue funcionando.
  }
}

/** Lee lo visto como mucho una vez por arranque. */
export function ensureHelp(): Promise<void> {
  probe ??= load();
  return probe;
}

/** Cierra una tarjeta o un aviso para siempre (hasta «Volver a ver las ayudas»). */
export function markHelpSeen(key: string): void {
  if (help.reopened === key) help.reopened = null;
  if (key in help.seen) return;
  help.seen = { ...help.seen, [key]: new Date().toISOString() };
  mutateJSON('POST', '/api/me/help', { key }).catch(() => {});
}

/** El «?» de sección: vuelve a abrir su tarjeta, o la cierra si ya está abierta por él. */
export function toggleCard(key: string): void {
  help.reopened = help.reopened === key ? null : key;
}

/** «Volver a ver las ayudas» (Ajustes → Perfil). Lanza si la escritura falla. */
export async function resetHelp(): Promise<void> {
  await mutateJSON('DELETE', '/api/me/help');
  help.seen = {};
  help.ready = true;
}
