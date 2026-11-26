/**
 * Where to continue after signing in. Only same-origin paths are accepted, so a crafted
 * `?next=` link cannot send an operator to another site after they enter their password.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\'))
		return fallback;
	try {
		const url = new URL(next, 'http://driver-hub.invalid');
		if (url.origin !== 'http://driver-hub.invalid' || url.pathname === '/login') return fallback;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return fallback;
	}
}

export function signInPath(current: Pick<URL, 'pathname' | 'search'>): string {
	const next = `${current.pathname}${current.search}`;
	return next === '/' || current.pathname === '/login'
		? '/login'
		: `/login?next=${encodeURIComponent(next)}`;
}
