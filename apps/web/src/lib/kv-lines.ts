/**
 * The lines of a performance's logistics, hospitality and technical jsonb
 * (Marco, 2026-10-20): a key and a value each, written in place. The shapes
 * are still undecided (ADR-023), so this edits only what a person can type,
 * a flat object of words; anything nested that is already there travels
 * untouched and is read, not edited, by `JsonKV`.
 *
 * Pure: the component asks it what the next object is, and sends that whole
 * object in one PATCH.
 */
import type { Json } from './db-types';

export type KVObject = Record<string, Json>;

/** A key's length cap: a label, never a paragraph. The PATCH schema repeats it. */
export const KV_KEY_MAX = 80;
/** A value's length cap, the same one the schema enforces. */
export const KV_VALUE_MAX = 2000;
/** How many lines one column may hold. */
export const KV_LINES_MAX = 100;

/** The object behind a jsonb value, or null when it is not one (an array, a scalar): that is read, not edited. */
export function kvObject(value: Json | null | undefined): KVObject | null {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as KVObject;
}

/** A value a person can edit on one line. */
export function kvIsScalar(v: Json): boolean {
  return v === null || typeof v !== 'object';
}

/** The words a scalar value shows in its input. */
export function kvText(v: Json): string {
  return v === null || v === undefined ? '' : String(v);
}

/** The object with `key` set to what was typed, or null when nothing changed (no write for a focus event). */
export function kvSet(obj: KVObject, key: string, typed: string): KVObject | null {
  const next = typed.trim();
  if (kvText(obj[key] ?? null) === next) return null;
  return { ...obj, [key]: next };
}

/** The object without `key`. */
export function kvRemove(obj: KVObject, key: string): KVObject {
  const next = { ...obj };
  delete next[key];
  return next;
}

export type KVAddResult =
  | { ok: true; key: string; next: KVObject }
  | { ok: false; error: 'key_required' | 'duplicate' | 'too_many' };

/** A new line. The key is trimmed; an empty or repeated key is said under the field, never written. */
export function kvAdd(obj: KVObject, key: string, value: string): KVAddResult {
  const k = key.trim();
  if (!k) return { ok: false, error: 'key_required' };
  if (Object.hasOwn(obj, k)) return { ok: false, error: 'duplicate' };
  if (Object.keys(obj).length >= KV_LINES_MAX) return { ok: false, error: 'too_many' };
  return { ok: true, key: k, next: { ...obj, [k]: value.trim() } };
}
