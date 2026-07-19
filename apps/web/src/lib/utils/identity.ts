/**
 * Identity monogram helpers.
 *
 * A project (and, derived, a workspace/line) carries an *identity mark*: a
 * short monogram on its accent color. The monogram text is a stored,
 * free-form field of up to 3 characters (mixed case allowed, diacritics
 * kept) — `deriveInitials` is only the *suggestion* used when nothing is
 * stored. The stored value is the truth; auto-derivation never overrides it.
 *
 * Collision is defined at the call site (the identity editor), case-sensitive
 * and exact — "MdM" and "MDM" are two distinct monograms, not a clash.
 */

export const MONOGRAM_MAX = 3;

/**
 * Suggest a monogram from a name. Fallback only — used when a project has no
 * stored `initials`. Multi-word → first char of up to `max` words, upper.
 * Single word → its first two chars (first upper). Diacritics preserved.
 */
export function deriveInitials(name?: string | null, max = MONOGRAM_MAX): string {
	const v = name?.trim();
	if (!v) return '·';
	const words = v.split(/\s+/).filter(Boolean);
	if (words.length === 1) {
		const w = words[0];
		return (w[0].toLocaleUpperCase() + (w[1] ?? '')).slice(0, max);
	}
	return words
		.slice(0, max)
		.map((w) => w[0].toLocaleUpperCase())
		.join('');
}

/**
 * The monogram to render for an entity: its stored `initials` when present,
 * else the derived suggestion. Empty/whitespace stored value → derive.
 */
export function markText(entity: {
	initials?: string | null;
	name?: string | null;
}): string {
	const stored = entity.initials?.trim();
	return stored && stored.length > 0 ? stored : deriveInitials(entity.name);
}
