import { browser } from '$app/environment';
import { loadLocale } from '$lib/i18n';
import type { PageLoad } from './$types';

// The server's pick may differ from the browser's (the root layout loads
// that one): its dictionary arrives before hydration, so the text matches.
export const load: PageLoad = async ({ data }) => {
  if (browser) await loadLocale(data.locale);
  return data;
};
