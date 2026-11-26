<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { signInErrorMessage } from './error-messages';
	import { getSession } from './session.svelte';

	type Props = {
		/** Prefills the username, for example when resuming an expired session. */
		username?: string;
		submitLabel?: string;
		onSignedIn?: () => void;
	};

	let {
		username: initialUsername = '',
		submitLabel = m.signin_submit(),
		onSignedIn
	}: Props = $props();

	const session = getSession();
	// The prop only seeds the field; the operator may still type another name.
	// svelte-ignore state_referenced_locally
	let username = $state(initialUsername);
	let password = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let passwordInput = $state<HTMLInputElement | null>(null);
	let usernameInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		(initialUsername ? passwordInput : usernameInput)?.focus();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		problem = null;
		try {
			await session.signIn(username.trim(), password);
			password = '';
			onSignedIn?.();
		} catch (error) {
			problem = signInErrorMessage(error);
			password = '';
			passwordInput?.focus();
		} finally {
			busy = false;
		}
	}
</script>

<form class="sign-in" onsubmit={submit} novalidate>
	{#if problem}
		<Callout tone="fail" live>{problem}</Callout>
	{/if}
	<TextField
		label={m.signin_username()}
		name="username"
		autocomplete="username"
		autocapitalize="none"
		spellcheck="false"
		required
		bind:value={username}
		bind:ref={usernameInput}
	/>
	<TextField
		label={m.signin_password()}
		name="password"
		type="password"
		autocomplete="current-password"
		required
		bind:value={password}
		bind:ref={passwordInput}
	/>
	<Button variant="primary" type="submit" fullWidth {busy} disabled={!username.trim() || !password}>
		{submitLabel}
	</Button>
</form>

<style>
	.sign-in {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
