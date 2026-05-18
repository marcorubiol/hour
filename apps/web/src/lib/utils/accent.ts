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
