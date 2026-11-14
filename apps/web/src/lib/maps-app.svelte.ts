/**
 * The map app this device opens «Mapa» with (ADR-206). A preference of the
 * DEVICE, not of the account: it lives in localStorage (`hour_maps_app`), so
 * it works the same on the public road sheet, where nobody is signed in, and
 * a phone with Waze and a laptop with Google keep their own.
 *
 * Null means «ask»: the first «Mapa» opens the chooser, and what is picked
 * there is saved. Settings (Profile) changes it, or sets it back to ask.
 *
 * Module state is safe here, unlike the stores that carry a person's data:
 * the server never writes it (`restore` and `set` only run on a click or in
 * onMount), so nothing of one visitor can reach another's render.
 */

import { isMapsApp, type MapsApp } from './ahora';

const STORAGE_KEY = 'hour_maps_app';

export const mapsPref = $state<{ app: MapsApp | null }>({ app: null });

let restored = false;

/** Read what this device saved. Once; later calls are no-ops. */
export function restoreMapsApp(): void {
  if (restored || typeof localStorage === 'undefined') return;
  restored = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    mapsPref.app = isMapsApp(saved) ? saved : null;
  } catch {
    // Storage disabled: ask every time.
  }
}

/** Save the app (or null: ask again). In-session state works even if storage does not. */
export function setMapsApp(app: MapsApp | null): void {
  mapsPref.app = app;
  restored = true;
  if (typeof localStorage === 'undefined') return;
  try {
    if (app) localStorage.setItem(STORAGE_KEY, app);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or disabled.
  }
}
