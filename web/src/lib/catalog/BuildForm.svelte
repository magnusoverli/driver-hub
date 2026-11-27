<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import SelectField from '#lib/ui/SelectField.svelte';
	import TextArea from '#lib/ui/TextArea.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import type { BuildInput } from './queries';
	import {
		buildDirectoryProblem,
		commitProblem,
		driverIdProblem,
		parseDeclaration
	} from './validation';

	let { busy, submit }: { busy: boolean; submit: (input: BuildInput) => Promise<void> } = $props();

	const PLATFORMS = [
		{ value: 'linux/amd64', label: 'linux/amd64' },
		{ value: 'linux/arm64', label: 'linux/arm64' }
	] as const;

	let driverId = $state('');
	let commit = $state('');
	let directory = $state('');
	let platform = $state<(typeof PLATFORMS)[number]['value']>('linux/amd64');
	let declaration = $state('');
	let attempted = $state(false);

	const driverError = $derived(attempted ? driverIdProblem(driverId) : null);
	const commitError = $derived(attempted ? commitProblem(commit, true) : null);
	const directoryError = $derived(attempted ? buildDirectoryProblem(directory) : null);
	const declarationError = $derived(attempted ? parseDeclaration(declaration).problem : null);

	async function build(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		const parsed = parseDeclaration(declaration);
		if (
			driverIdProblem(driverId) ||
			commitProblem(commit, true) ||
			buildDirectoryProblem(directory) ||
			parsed.problem
		) {
			return;
		}
		await submit({
			driverId: driverId.trim(),
			commit: commit.trim(),
			directory: directory.trim(),
			platform,
			...(parsed.declaration && { configuration: parsed.declaration })
		});
	}
</script>

<form class="form" onsubmit={build} novalidate>
	<Callout tone="warn" title={m.catalog_build_trust_title()}>
		{m.catalog_build_trust_body()}
	</Callout>
	<div class="pair">
		<TextField
			label={m.catalog_driver()}
			bind:value={driverId}
			placeholder="exampleco-meter"
			autocomplete="off"
			spellcheck={false}
			error={driverError}
		/>
		<SelectField label={m.catalog_platform()} options={[...PLATFORMS]} bind:value={platform} />
	</div>
	<TextField
		label={m.catalog_commit()}
		bind:value={commit}
		autocomplete="off"
		spellcheck={false}
		hint={m.catalog_commit_hint()}
		error={commitError}
	/>
	<TextField
		label={m.catalog_directory()}
		bind:value={directory}
		placeholder="Drivers/exampleco-meter"
		autocomplete="off"
		spellcheck={false}
		hint={m.catalog_directory_hint()}
		error={directoryError}
	/>
	<TextArea
		label={m.catalog_declaration()}
		bind:value={declaration}
		code
		rows={5}
		spellcheck={false}
		placeholder={'{"schemaVersion": 1, "inputs": []}'}
		hint={m.catalog_declaration_hint()}
		error={declarationError}
	/>
	<div><Button type="submit" variant="primary" {busy}>{m.catalog_build_action()}</Button></div>
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 46rem;
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: var(--space-4);
	}
</style>
