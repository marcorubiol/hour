import { describe, it, expect } from 'vitest';
import {
	ACCENT_COUNT,
	accentIndex,
	accentVar,
	accentVarFor,
	customAccent,
	customHue,
	isCustomAccent,
} from './accent';

describe('accentIndex', () => {
	it('is stable for a slug and lands in 1..ACCENT_COUNT', () => {
		const a = accentIndex('memories-del-agua');
		expect(a).toBe(accentIndex('memories-del-agua'));
		expect(a).toBeGreaterThanOrEqual(1);
		expect(a).toBeLessThanOrEqual(ACCENT_COUNT);
	});
	it('falls back to 1 for empty slug', () => {
		expect(accentIndex(null)).toBe(1);
		expect(accentIndex('')).toBe(1);
	});
});

describe('accentVarFor', () => {
	it('hashes the slug when no override is stored', () => {
		expect(accentVarFor({ slug: 'x' })).toBe(accentVar('x'));
	});
	it('honours an in-range palette index', () => {
		expect(accentVarFor({ slug: 'x', accent: '3' })).toBe('var(--accent-3)');
	});
	it('wraps an out-of-range index back into the shrunk palette', () => {
		// old 12-colour palette leftovers must not dangle at undefined tokens
		expect(accentVarFor({ slug: 'x', accent: '8' })).toBe('var(--accent-1)');
		expect(accentVarFor({ slug: 'x', accent: '9' })).toBe('var(--accent-2)');
		expect(accentVarFor({ slug: 'x', accent: '12' })).toBe('var(--accent-5)');
	});
	it('renders a custom hue with the palette-fixed L/C tokens', () => {
		expect(accentVarFor({ slug: 'x', accent: 'h210' })).toBe(
			'oklch(var(--accent-custom-l) var(--accent-custom-c) 210)',
		);
	});
	it('passes a literal colour through untouched', () => {
		expect(accentVarFor({ slug: 'x', accent: 'oklch(55% 0.1 200)' })).toBe('oklch(55% 0.1 200)');
	});
});

describe('custom hue helpers', () => {
	it('wraps and rounds into h<0-359>', () => {
		expect(customAccent(210)).toBe('h210');
		expect(customAccent(370)).toBe('h10');
		expect(customAccent(-30)).toBe('h330');
		expect(customAccent(55.6)).toBe('h56');
		expect(customAccent(360)).toBe('h0');
	});
	it('recognises and parses custom tokens only', () => {
		expect(isCustomAccent('h210')).toBe(true);
		expect(isCustomAccent('3')).toBe(false);
		expect(isCustomAccent(null)).toBe(false);
		expect(customHue('h210')).toBe(210);
		expect(customHue('3')).toBeNull();
	});
});
