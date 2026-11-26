import { createContext } from 'svelte';

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Must match the inline script in src/app.html, which applies the theme before first paint. */
export const THEME_STORAGE_KEY = 'driverhub.theme';

export interface ThemeTarget {
	setTheme(mode: ThemeMode): void;
}

/** Applies the mode as `data-theme` on <html>; the CSS tokens follow the OS when it is absent. */
export function documentTarget(root: HTMLElement = document.documentElement): ThemeTarget {
	return {
		setTheme(mode) {
			if (mode === 'system') delete root.dataset.theme;
			else root.dataset.theme = mode;
		}
	};
}

function isMode(value: unknown): value is ThemeMode {
	return THEME_MODES.includes(value as ThemeMode);
}

/**
 * The viewer's colour theme. Storage can be unavailable (private windows, blocked site data),
 * so every access is guarded and the theme still works for the current page.
 */
export class ThemePreference {
	mode = $state<ThemeMode>('system');

	readonly #storage: Storage | undefined;
	readonly #target: ThemeTarget;

	constructor(target: ThemeTarget, storage: Storage | undefined) {
		this.#target = target;
		this.#storage = storage;
		try {
			const saved = storage?.getItem(THEME_STORAGE_KEY);
			if (isMode(saved)) this.mode = saved;
		} catch {
			// Unreadable storage: follow the system.
		}
		this.#target.setTheme(this.mode);
	}

	set(mode: ThemeMode): void {
		this.mode = mode;
		this.#target.setTheme(mode);
		try {
			if (mode === 'system') this.#storage?.removeItem(THEME_STORAGE_KEY);
			else this.#storage?.setItem(THEME_STORAGE_KEY, mode);
		} catch {
			// The choice still applies until the page is closed.
		}
	}
}

export const [getTheme, setTheme] = createContext<ThemePreference>();
