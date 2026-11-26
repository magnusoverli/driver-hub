import { describe, expect, it, vi } from 'vitest';
import {
	THEME_STORAGE_KEY,
	ThemePreference,
	type ThemeMode,
	type ThemeTarget
} from './theme.svelte.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const values = new Map(Object.entries(initial));
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => void values.delete(key),
		setItem: (key, value) => void values.set(key, value)
	};
}

function recorder() {
	const applied: ThemeMode[] = [];
	const target: ThemeTarget = { setTheme: (mode) => void applied.push(mode) };
	return { applied, target };
}

describe('ThemePreference', () => {
	it('follows the system until the viewer chooses, then remembers the choice', () => {
		const storage = memoryStorage();
		const { applied, target } = recorder();
		const theme = new ThemePreference(target, storage);
		expect(theme.mode).toBe('system');
		theme.set('dark');
		expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
		expect(new ThemePreference(target, storage).mode).toBe('dark');
		theme.set('system');
		expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
		expect(applied).toEqual(['system', 'dark', 'dark', 'system']);
	});

	it('ignores unknown stored values', () => {
		const { target } = recorder();
		expect(new ThemePreference(target, memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' })).mode).toBe(
			'system'
		);
	});

	it('still applies the theme when storage is blocked or missing', () => {
		const blocked = memoryStorage();
		blocked.getItem = vi.fn(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		blocked.setItem = vi.fn(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		const { applied, target } = recorder();
		const theme = new ThemePreference(target, blocked);
		theme.set('light');
		new ThemePreference(target, undefined).set('dark');
		expect(applied).toEqual(['system', 'light', 'system', 'dark']);
	});
});
