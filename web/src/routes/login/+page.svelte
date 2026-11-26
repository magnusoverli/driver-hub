<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import SignInForm from '#lib/session/SignInForm.svelte';
	import ThemeMenu from '#lib/shell/ThemeMenu.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Logo from '#lib/ui/Logo.svelte';

	const session = getSession();
</script>

<svelte:head>
	<title>{m.signin_title()} · Driver Hub</title>
</svelte:head>

<div class="corner"><ThemeMenu /></div>

<main class="sign-in-page">
	{#if session.status === 'signed-out'}
		<div class="panel">
			<div class="intro">
				<Logo size={40} />
				<h1>{m.signin_title()}</h1>
				<p>{m.signin_subtitle()}</p>
			</div>
			{#if session.lastSignOut === 'password-changed'}
				<Callout tone="ok" live>{m.signin_notice_password_changed()}</Callout>
			{:else if session.lastSignOut === 'signed-out'}
				<Callout live>{m.signin_notice_signed_out()}</Callout>
			{/if}
			<SignInForm />
			<p class="help">{m.signin_help()}</p>
		</div>
	{/if}
</main>

<style>
	.corner {
		position: fixed;
		top: var(--space-4);
		right: var(--space-4);
	}

	.sign-in-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-6) var(--space-4);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		max-width: 23rem;
		padding: var(--space-8);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--ring);
	}

	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.intro :global(.logo) {
		margin-bottom: var(--space-2);
	}

	h1 {
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
	}

	.intro p,
	.help {
		color: var(--text-2);
	}

	.help {
		font-size: var(--text-sm);
	}
</style>
