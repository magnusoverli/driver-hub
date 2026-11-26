import { getLocale } from '#lib/paraglide/runtime.js';

/** A date and time to the second in the active locale, for observations and events. */
export function formatTimestamp(iso: string, locale = getLocale()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}
