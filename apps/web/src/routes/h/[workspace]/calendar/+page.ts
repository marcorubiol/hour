// ADR-067: lens routes are space-less now. Old bookmarks and master-view
// paths land here; send them to the real lens (scope rides in pins). The
// query string travels along — ?view= (ADR-078 §10) and ?scope= survive.
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  redirect(308, `/h/calendar${url.search}`);
};
