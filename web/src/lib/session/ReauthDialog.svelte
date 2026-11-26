<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { getSession } from './session.svelte';
	import SignInForm from './SignInForm.svelte';

	type Props = {
		/** Called after the operator signed in again, to refresh what failed meanwhile. */
		onResumed: () => void;
	};

	let { onResumed }: Props = $props();
	const session = getSession();
	const open = $derived(session.status === 'expired');
</script>

<!--
	Blocking on purpose: the page underneath stays as it was, so nothing the operator was doing is
	lost, but it cannot be used until the session is valid again.
-->
<Dialog
	{open}
	dismissible={false}
	title={m.reauth_title()}
	description={m.reauth_description()}
	onOpenAutoFocus={(event: Event) => {
		event.preventDefault();
	}}
>
	<SignInForm
		username={session.operator?.username ?? ''}
		submitLabel={m.reauth_submit()}
		onSignedIn={onResumed}
	/>
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => session.signOut()}>
			{m.reauth_sign_out()}
		</Button>
	{/snippet}
</Dialog>
