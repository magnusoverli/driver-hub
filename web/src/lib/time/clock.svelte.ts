import { createContext } from 'svelte';
import { getLocale } from '#lib/paraglide/runtime.js';

/**
 * One shared ticking signal for "updated 4 s ago" labels. Only the labels that read `now`
 * re-render on each tick; the data behind them is untouched.
 */
export class Clock {
	now = $state(Date.now());
	#timer: ReturnType<typeof setInterval> | undefined;

	start(intervalMs = 1_000): () => void {
		this.stop();
		this.#timer = setInterval(() => (this.now = Date.now()), intervalMs);
		return () => this.stop();
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
	['day', 86_400],
	['hour', 3_600],
	['minute', 60],
	['second', 1]
];

/** "4 seconds ago", "now", "2 minutes ago" in the active locale. */
export function relativeTime(timestamp: number, now: number, locale = getLocale()): string {
	const seconds = Math.round((timestamp - now) / 1000);
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size || unit === 'second') {
			return format.format(Math.trunc(seconds / size), unit);
		}
	}
	return format.format(0, 'second');
}

export const [getClock, setClock] = createContext<Clock>();
