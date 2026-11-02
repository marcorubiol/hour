/**
 * /public/audience/<clave>/embed: el mismo formulario para el iframe que la
 * compañía pega en su web (plan 2026-11-01-audience § 3.2), canal `embed`. Es
 * la única ruta de la app que se deja enmarcar: hooks.server.ts le pone
 * `frame-ancestors *` ($lib/server/frame).
 */

import { audienceFormActions, audienceFormLoad } from '$lib/server/audience-form';

export const load = audienceFormLoad('embed');
export const actions = audienceFormActions('embed');
