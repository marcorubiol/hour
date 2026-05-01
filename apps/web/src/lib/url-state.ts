/**
 * View-state serialization for the Master View URL sharing pattern (D-PRE-05).
 * Truncated at 400 chars per ADR-022 to keep links pasteable in chat clients
 * that wrap long URLs awkwardly.
 *
 * Not encryption — just a compact JSON encoder. Anything sensitive should
 * never go in viewState.
 */

const MAX_VIEW_STATE_CHARS = 400;

export interface ViewState {
  filters?: Record<string, string | string[] | number | boolean>;
  sort?: string;
  q?: string;
  page?: number;
  [key: string]: unknown;
}

/**
 * Serialize a viewState into a query-string-safe string. Drops empty values,
 * encodes via JSON+base64url, and truncates to 400 chars (returns null if
 * the encoded payload exceeds the limit so the caller can warn the user).
 * Returns an empty string when there's no state to share.
 */
export function serializeViewState(state: ViewState): string | null {
  const cleaned = Object.fromEntries(
    Object.entries(state).filter(([, v]) => {
      if (v == null) return false;
      if (Array.isArray(v) && v.length === 0) return false;
      if (typeof v === 'string' && v === '') return false;
      return true;
    }),
  );

  if (Object.keys(cleaned).length === 0) return '';

  const json = JSON.stringify(cleaned);
  const encoded = base64UrlEncode(json);

  if (encoded.length > MAX_VIEW_STATE_CHARS) return null;
  return encoded;
}

/**
 * Inverse of serializeViewState. Returns an empty object on parse error so
 * the caller falls back to defaults instead of crashing.
 */
export function hydrateViewState(encoded: string | null | undefined): ViewState {
  if (!encoded) return {};
  try {
    const json = base64UrlDecode(encoded);
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ViewState;
    }
  } catch {
    /* parse failed — fall through to defaults */
  }
  return {};
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
