// Se entra directo en Desk (ADR-137): /h fue el Hall, una portada antes de la
// portada. Una carga completa la redirige el hook (`hooks.server.ts`); una
// navegación dentro de la app, aquí. La query viaja con ella (`?scope=`).
import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  redirect(302, `/h/desk${url.search}`);
}
