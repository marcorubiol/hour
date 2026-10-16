// ADR-067: lens routes are space-less now. Old bookmarks and master-view
// paths land here; send them to the real lens (scope rides in pins).
// Cuentas vive en /h/books desde ADR-119.
import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  redirect(308, `/h/books${url.search}`);
}
