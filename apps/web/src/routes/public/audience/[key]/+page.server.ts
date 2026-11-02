/**
 * /public/audience/<clave>: el formulario público de una lista (plan
 * 2026-11-01-audience § 3.2). La lógica es la de $lib/server/audience-form;
 * esta ruta es el canal `form`.
 */

import { audienceFormActions, audienceFormLoad } from '$lib/server/audience-form';

export const load = audienceFormLoad('form');
export const actions = audienceFormActions('form');
