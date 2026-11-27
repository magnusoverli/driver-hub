import { getLocale } from '#lib/paraglide/runtime.js';

/** A date and time to the second in the active locale, for observations and events. */
export function formatTimestamp(iso: string, locale = getLocale()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

/** A duration such as "45 s", "3 min 20 s" or "1 h 5 min", in the active locale. */
export function formatDuration(milliseconds: number, locale = getLocale()): string {
	const unit = (value: number, name: 'hour' | 'minute' | 'second') =>
		new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(
			value
		);
	const seconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours)
		return minutes ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour');
	if (minutes) {
		const rest = seconds % 60;
		return rest ? `${unit(minutes, 'minute')} ${unit(rest, 'second')}` : unit(minutes, 'minute');
	}
	return unit(seconds, 'second');
}
