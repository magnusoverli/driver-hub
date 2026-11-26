<script lang="ts">
	import '@fontsource-variable/hanken-grotesk';
	import '@fontsource/dm-mono/400.css';
	import '@fontsource/dm-mono/500.css';
	import '#lib/ui/styles/tokens.css';
	import '#lib/ui/styles/base.css';
	import '#lib/ui/floating.css';

	import { onMount } from 'svelte';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createApiClient } from '#lib/api/client.js';
	import { setApi } from '#lib/api/context.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { createQueryClient } from '#lib/query/client.js';
	import { httpAuthService } from '#lib/session/auth-service.js';
	import { safeNextPath, signInPath } from '#lib/session/redirect.js';
	import { Session, setSession } from '#lib/session/session.svelte.js';
	import { documentTarget, setTheme, ThemePreference } from '#lib/theme/theme.svelte.js';
	import { Clock, setClock } from '#lib/time/clock.svelte.js';
	import StartupScreen from '#lib/shell/StartupScreen.svelte';
	import { Notices, setNotices } from '#lib/shell/notices.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Composition root: every service is created once here and shared through context.
	const queryClient = createQueryClient();
	const api = createApiClient({ onSessionEnded: () => session.expire() });
	const session = new Session(httpAuthService(api), {
		onOperatorChanged: () => queryClient.clear()
	});
	const clock = new Clock();

	setApi(api);
	setSession(session);
	setClock(clock);
	setNotices(new Notices());
	setTheme(new ThemePreference(documentTarget(), browserStorage()));

	function browserStorage(): Storage | undefined {
		try {
			return window.localStorage;
		} catch {
			return undefined;
		}
	}

	onMount(() => {
		document.documentElement.lang = getLocale();
		void session.restore();
		return clock.start();
	});

	// Signed-out operators go to the sign-in page and return to where they were afterwards.
	$effect(() => {
		const url = page.url;
		const onSignIn = url.pathname === '/login';
		if (session.status === 'signed-out' && !onSignIn) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from the current path
			void goto(signInPath(url), { replaceState: true });
		} else if (session.status === 'signed-in' && onSignIn) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- validated same-origin path
			void goto(safeNextPath(url.searchParams.get('next')), { replaceState: true });
		}
	});
</script>

<QueryClientProvider client={queryClient}>
	{#if session.status === 'restoring' || session.status === 'unavailable'}
		<StartupScreen
			unavailable={session.status === 'unavailable'}
			onRetry={() => session.restore()}
		/>
	{:else}
		{@render children()}
	{/if}
</QueryClientProvider>
