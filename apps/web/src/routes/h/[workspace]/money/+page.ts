// ADR-067: lens routes are space-less now. Old bookmarks and master-view
// paths land here; send them to the real lens (scope rides in pins).
import { redirect } from '@sveltejs/kit';

export function load() {
  redirect(308, '/h/money');
}
