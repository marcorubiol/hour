/**
 * Master View — D-PRE-05 (Phase 0.1 trabajo #11).
 *
 * Tracks one preference: "when I sign in, open the last Project I was working
 * on instead of the default landing". Phase 0 stores it in localStorage,
 * scoped per browser. Phase 1 can promote this to `user_profile.metadata`
 * for cross-device sync without changing the call sites.
 *
 * Two flags:
 *   - `hour_master_view_enabled` — 'true' if the user opted in.
 *   - `hour_master_view_path`    — the last saveable path visited while
 *                                  the feature was on.
 *
 * Save policy: any path under `/h/{workspace}/` is eligible EXCEPT the
 * settings page itself (would otherwise self-loop the redirect). Phase
 * 0.1 only Project URLs are likely to land here; other entities (gig,
 * engagement, ...) become eligible automatically as their routes ship.
 */

const ENABLED_KEY = 'hour_master_view_enabled';
const PATH_KEY = 'hour_master_view_path';

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function isSaveablePath(path: string): boolean {
  if (!path.startsWith('/h/')) return false;
  const parts = path.split('/').filter(Boolean); // ['h', '<ws>', ...]
  if (parts.length < 2) return false;
  if (parts[2] === 'settings') return false;
  return true;
}

export function isMasterViewEnabled(): boolean {
  if (!hasStorage()) return false;
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

export function setMasterViewEnabled(enabled: boolean): void {
  if (!hasStorage()) return;
  if (enabled) {
    localStorage.setItem(ENABLED_KEY, 'true');
  } else {
    // Turning it off resets the saved path too — opt-out should not leave
    // a stale destination ticking for the next time the toggle flips back.
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(PATH_KEY);
  }
}

export function getMasterViewPath(): string | null {
  if (!hasStorage()) return null;
  return localStorage.getItem(PATH_KEY);
}

export function saveMasterViewPath(path: string): void {
  if (!hasStorage()) return;
  if (!isMasterViewEnabled()) return;
  if (!isSaveablePath(path)) return;
  // Avoid a redundant write storm on rapid navigations.
  if (localStorage.getItem(PATH_KEY) === path) return;
  localStorage.setItem(PATH_KEY, path);
}

export function clearMasterViewPath(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(PATH_KEY);
}

/**
 * Where to send the user after a successful sign-in.
 * Falls back to the Phase 0 hardcoded landing (`/h/marco-rubiol/`) when
 * the feature is off, the saved path is missing, or the saved path turns
 * out to be invalid for any reason.
 */
export function resolveLoginTarget(fallback: string = '/h/marco-rubiol/'): string {
  if (!isMasterViewEnabled()) return fallback;
  const saved = getMasterViewPath();
  if (!saved || !isSaveablePath(saved)) return fallback;
  return saved;
}
