<!-- Test-only: provides a session to the session components under test. -->
<script lang="ts">
	import ChangePasswordDialog from '../ChangePasswordDialog.svelte';
	import { setSession, type Session } from '../session.svelte.js';
	import SignInForm from '../SignInForm.svelte';

	type Props = {
		session: Session;
		view: 'sign-in' | 'change-password';
		username?: string;
		onSignedIn?: () => void;
	};

	let { session, view, username, onSignedIn }: Props = $props();
	// svelte-ignore state_referenced_locally
	setSession(session);
	let open = $state(true);
</script>

{#if view === 'sign-in'}
	<SignInForm {username} {onSignedIn} />
{:else}
	<ChangePasswordDialog bind:open />
	<output data-testid="dialog-state">{open ? 'open' : 'closed'}</output>
{/if}
