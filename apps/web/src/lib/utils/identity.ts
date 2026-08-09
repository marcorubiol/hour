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

/** The subset of a project the identity editors (dialog + popover) read/write. */
export type EditableProject = {
	id: string;
	slug: string;
	name: string;
	accent?: string | null;
	initials?: string | null;
	description?: string | null;
};

/**
 * A sibling the identity editor checks against: its monogram (case-exact
 * collision) and, for the colour warning, its slug + accent (resolved to a
 * hue) and name.
 */
export type IdentitySibling = {
	id: string;
	initials?: string | null;
	slug?: string | null;
	name?: string | null;
	accent?: string | null;
};

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
/**
 * THE SPACE IS ALWAYS LOWERCASE (Marco, 2026-08-09) — a norm, everywhere.
 *
 * A space is not a subject you look at, it is the ADDRESS a project lives
 * at, and the case is what says so: the eye lands on the tinted, capitalised
 * thing and takes the space as context. Same argument as the two-level mark
 * (`mk│MM`), which is only this rule with a box around it.
 *
 * It is a WRITER, not a stylesheet, and that is deliberate. Half the places
 * a space is named cannot be reached by CSS — aria-labels, the composed name
 * of a saved scope, a sentence a translation interpolates it into — and a
 * norm with two mechanisms is a norm that drifts (this repo has the scars).
 * The stored value never changes: settings still edit the name its owner
 * typed, and a copy carries the real one.
 */
export function spaceName(name?: string | null): string {
	return (name ?? '').toLocaleLowerCase();
}

export function markText(entity: {
	initials?: string | null;
	name?: string | null;
}): string {
	const stored = entity.initials?.trim();
	return stored && stored.length > 0 ? stored : deriveInitials(entity.name);
}
