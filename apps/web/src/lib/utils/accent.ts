export const ACCENT_COUNT = 7;

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

/**
 * Workspaces / projects can store an explicit accent override:
 *   - '1'..'7'     → palette index → var(--accent-N) (out-of-range wraps in)
 *   - 'h<0-360>'   → custom hue → oklch(<palette L> <palette C> <hue>), so a
 *                    free-picked hue stays soft and adapts to light/dark
 *   - hex / oklch  → literal color (accepted; the picker only ever emits h<hue>)
 *   - null/empty   → fall back to hash(slug)
 */
export function accentVarFor(entity: {
	slug: string | null | undefined;
	accent?: string | null;
}): string {
	const a = entity.accent?.trim();
	if (!a) return accentVar(entity.slug);
	// Palette index — wrap into 1..ACCENT_COUNT so an override stored under the
	// old 12-colour palette never dangles at an undefined token now there are 7.
	if (/^\d+$/.test(a))
		return `var(--accent-${(((Number(a) - 1) % ACCENT_COUNT) + ACCENT_COUNT) % ACCENT_COUNT + 1})`;
	// Custom hue ('h<0-360>') — render with the palette-fixed L/C tokens so the
	// picked hue stays inside the softness envelope and adapts per theme.
	const hue = /^h(\d{1,3})$/.exec(a);
	if (hue) return `oklch(var(--accent-custom-l) var(--accent-custom-c) ${hue[1]})`;
	// Literal color (hex, oklch, …) — wrap so existing var(--c) consumers
	// keep working without a separate code path.
	return a;
}

/** Stored value for a custom-hue accent (hue 0-360, wrapped and rounded). */
export function customAccent(hue: number): string {
	return `h${Math.round(((hue % 360) + 360) % 360)}`;
}

/** True when the stored accent is a custom-hue token ('h<0-360>'). */
export function isCustomAccent(accent: string | null | undefined): boolean {
	return !!accent && /^h\d{1,3}$/.test(accent.trim());
}

/** Hue (0-360) parsed from a custom accent token, or null if it isn't one. */
export function customHue(accent: string | null | undefined): number | null {
	const m = accent?.trim().match(/^h(\d{1,3})$/);
	return m ? Number(m[1]) % 360 : null;
}
