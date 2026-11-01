import { browser } from '$app/environment';
import { loadLocale } from '$lib/i18n';
import type { PageLoad } from './$types';

// This page speaks the reader's language, which the server chose: its
// dictionary must be here before hydration, as the root layout's is.
export const load: PageLoad = async ({ data }) => {
  if (browser) await loadLocale(data.locale);
  return data;
};
