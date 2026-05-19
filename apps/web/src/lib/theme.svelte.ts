/**
 * Theme — two orthogonal axes.
 *
 *   theme  → palette / fonts / identity     ('editorial-sobrio', 'serif-quiet', ...)
 *   mode   → luminance scheme               ('light' | 'dark' | 'system')
 *
 * 'system' follows `prefers-color-scheme` live (subscribes to changes).
 * Until the user picks anything explicit, the saved mode defaults to
 * 'system' so the OS preference is respected end-to-end.
 *
 * DOM is in sync via two attributes on <html>:
 *   data-theme="X"        (absent when theme === 'editorial-sobrio')
 *   data-mode="dark"      (absent when resolved mode is light)
 *
 * Persistence: two localStorage keys (`hour_theme`, `hour_mode`).
 * First-paint flip is done by the inline script in app.html — this
 * module keeps the store reactive after that.
 *
 * View Transitions API: any DOM swap is wrapped in
 * `document.startViewTransition()` when available for a smooth fade.
 */

import { getContext, setContext } from 'svelte';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

const MODE_KEY = 'hour_mode';
const THEME_KEY = 'hour_theme';
const DEFAULT_THEME = 'editorial-sobrio';

function systemPrefersDark(): boolean {
	if (typeof matchMedia === 'undefined') return false;
	return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readSavedMode(): ThemeMode {
	if (typeof localStorage === 'undefined') return 'system';
	const raw = localStorage.getItem(MODE_KEY);
	if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
	return 'system';
}

export function readSavedTheme(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_THEME;
	return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}

export function resolveMode(mode: ThemeMode): ResolvedMode {
	return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

function applyMode(resolved: ResolvedMode): void {
	if (typeof document === 'undefined') return;
	if (resolved === 'dark') {
		document.documentElement.setAttribute('data-mode', 'dark');
	} else {
		document.documentElement.removeAttribute('data-mode');
	}
}

function applyTheme(theme: string): void {
	if (typeof document === 'undefined') return;
	if (theme && theme !== DEFAULT_THEME) {
		document.documentElement.setAttribute('data-theme', theme);
	} else {
		document.documentElement.removeAttribute('data-theme');
	}
}

function startSwap(fn: () => void): void {
	const doc = document as Document & {
		startViewTransition?: (cb: () => void) => unknown;
	};
	if (typeof doc.startViewTransition === 'function') {
		doc.startViewTransition(fn);
	} else {
		fn();
	}
}

export class ThemeStore {
	mode = $state<ThemeMode>('system');
	theme = $state<string>(DEFAULT_THEME);
	resolvedMode = $derived<ResolvedMode>(resolveMode(this.mode));

	constructor(initialMode: ThemeMode, initialTheme: string) {
		this.mode = initialMode;
		this.theme = initialTheme;
	}

	setMode(mode: ThemeMode): void {
		this.mode = mode;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(MODE_KEY, mode);
		}
		startSwap(() => applyMode(resolveMode(mode)));
	}

	setTheme(theme: string): void {
		this.theme = theme;
		if (typeof localStorage !== 'undefined') {
			if (theme === DEFAULT_THEME) localStorage.removeItem(THEME_KEY);
			else localStorage.setItem(THEME_KEY, theme);
		}
		startSwap(() => applyTheme(theme));
	}

	/** Flip light ↔ dark based on what's currently visible (ignores 'system' saved state). */
	toggle(): void {
		this.setMode(this.resolvedMode === 'dark' ? 'light' : 'dark');
	}
}

const KEY = Symbol('theme');

export function provideTheme(): ThemeStore {
	const store = new ThemeStore(readSavedMode(), readSavedTheme());
	setContext(KEY, store);

	// When mode === 'system', subscribe to OS changes so the app flips live.
	if (typeof matchMedia !== 'undefined') {
		const mq = matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', () => {
			if (store.mode === 'system') {
				startSwap(() => applyMode(systemPrefersDark() ? 'dark' : 'light'));
			}
		});
	}

	return store;
}

export function useTheme(): ThemeStore {
	const store = getContext<ThemeStore | undefined>(KEY);
	if (!store) throw new Error('useTheme() called outside provideTheme()');
	return store;
}
