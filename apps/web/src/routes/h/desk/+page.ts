// La casa vive en /h/today (ADR-220). Una carga completa de /h/desk la
// redirige el hook (`hooks.server.ts`); una navegación dentro de la app, aquí.
// La query viaja con ella (`?scope=`).
import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  redirect(301, `/h/today${url.search}`);
}
