import { browser } from '$app/environment';
import { appLocale, loadLocale } from '$lib/i18n';

// The browser's dictionary arrives before the first render: `t()` is
// synchronous and a component never asks twice (lib/i18n).
export const load = async () => {
  if (browser) await loadLocale(appLocale());
};
