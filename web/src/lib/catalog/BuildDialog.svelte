<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Dialog from '#lib/ui/Dialog.svelte';
	import BuildForm from './BuildForm.svelte';
	import type { BuildInput } from './queries';

	type Props = {
		open: boolean;
		busy: boolean;
		/** Starts the build; the catalog page reports its progress. */
		submit: (input: BuildInput) => Promise<void>;
	};

	let { open = $bindable(), busy, submit }: Props = $props();

	async function build(input: BuildInput) {
		open = false;
		await submit(input);
	}
</script>

<Dialog bind:open title={m.catalog_build_title()} description={m.catalog_build_hint()} width="lg">
	<BuildForm {busy} submit={build} />
</Dialog>
