// Cuentas vive en /h/books (ADR-119). Los enlaces viejos, los marcadores y
// Desk aterrizan aquí: 301 con su query. El ancla `#bolo-<id>` no llega al
// servidor; el navegador la conserva al seguir la redirección.
import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  redirect(301, `/h/books${url.search}`);
}
