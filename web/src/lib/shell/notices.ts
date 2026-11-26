import { createContext } from 'svelte';

export type Notice = { tone: 'info' | 'ok' | 'warn'; title: string; body?: string };

/**
 * Outcomes to show on the page an action leads to, such as the deployment list after a
 * deletion. Each notice is shown once, by the first page that takes it.
 */
export class Notices {
	#pending = new Map<string, Notice[]>();

	/** Leaves a notice for the page at `route` (a route ID). */
	leave(route: string, notice: Notice): void {
		this.#pending.set(route, [...(this.#pending.get(route) ?? []), notice]);
	}

	take(route: string): Notice[] {
		const notices = this.#pending.get(route) ?? [];
		this.#pending.delete(route);
		return notices;
	}
}

export const [getNotices, setNotices] = createContext<Notices>();
