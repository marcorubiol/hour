const ACCENT_COUNT = 8;

function hashSlug(slug: string): number {
	let h = 2166136261;
	for (let i = 0; i < slug.length; i++) {
		h ^= slug.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function accentIndex(slug: string | null | undefined): number {
	if (!slug) return 1;
	return (hashSlug(slug) % ACCENT_COUNT) + 1;
}

export function accentVar(slug: string | null | undefined): string {
	return `var(--accent-${accentIndex(slug)})`;
}

export function accentStyle(slug: string | null | undefined): string {
	return `--c: ${accentVar(slug)}`;
}

/**
 * Workspaces / projects can store an explicit accent override:
 *   - '1'..'8'     → palette index → var(--accent-N)
 *   - hex / oklch  → literal color (future: when the UI ships a free-form
 *                    picker; the DB CHECK relaxes to allow these forms)
 *   - null/empty   → fall back to hash(slug)
 *
 * The branching here is intentionally permissive: the regex for literal
 * colors is dead code today, but pre-wired so that flipping on free-form
 * colors is a DB-only change.
 */
export function accentVarFor(entity: {
	slug: string | null | undefined;
	accent?: string | null;
}): string {
	const a = entity.accent?.trim();
	if (!a) return accentVar(entity.slug);
	if (/^[1-8]$/.test(a)) return `var(--accent-${a})`;
	// Literal color (hex, oklch, …) — wrap so existing var(--c) consumers
	// keep working without a separate code path.
	return a;
}

export function accentStyleFor(entity: {
	slug: string | null | undefined;
	accent?: string | null;
}): string {
	return `--c: ${accentVarFor(entity)}`;
}
