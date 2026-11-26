<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getApi } from '#lib/api/context.js';
	import { ApiError } from '#lib/api/errors.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import FileField from '#lib/ui/FileField.svelte';
	import TextArea from '#lib/ui/TextArea.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { importRelease, type Identity, type ImportMetadata } from './queries';
	import {
		archiveProblem,
		commitProblem,
		driverIdProblem,
		MAX_METADATA_BYTES,
		parseDeclaration,
		versionProblem
	} from './validation';

	let {
		open = $bindable(),
		onImported
	}: { open: boolean; onImported: (release: Identity) => void } = $props();

	const api = getApi();
	const formId = $props.id();
	let driverId = $state('');
	let version = $state('');
	let displayName = $state('');
	let commit = $state('');
	let directory = $state('');
	let declaration = $state('');
	let showOptions = $state(false);
	let files = $state<FileList>();
	let attempted = $state(false);
	let upload = $state<AbortController | null>(null);
	let problem = $state<string | null>(null);
	onDestroy(() => upload?.abort());

	// Shown once the operator has tried to import, then follow the input.
	const archiveError = $derived(attempted ? archiveProblem(files?.[0]) : null);
	const driverError = $derived(attempted ? driverIdProblem(driverId) : null);
	const versionError = $derived(attempted ? versionProblem(version) : null);
	const commitError = $derived(attempted ? commitProblem(commit, false) : null);
	const declarationError = $derived(attempted ? parseDeclaration(declaration).problem : null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (upload) return;
		attempted = true;
		problem = null;
		const image = files?.[0];
		const parsed = parseDeclaration(declaration);
		if (commitProblem(commit, false) || parsed.problem) showOptions = true;
		if (
			!image ||
			archiveProblem(image) ||
			driverIdProblem(driverId) ||
			versionProblem(version) ||
			commitProblem(commit, false) ||
			parsed.problem
		) {
			return;
		}
		const metadata: ImportMetadata = {
			...(displayName.trim() && { displayName: displayName.trim() }),
			...((commit.trim() || directory.trim()) && {
				source: {
					...(commit.trim() && { commit: commit.trim() }),
					...(directory.trim() && { directory: directory.trim() })
				}
			}),
			...(parsed.declaration && { configuration: parsed.declaration })
		};
		if (new Blob([JSON.stringify(metadata)]).size > MAX_METADATA_BYTES) {
			problem = m.catalog_import_metadata_size();
			return;
		}
		const controller = (upload = new AbortController());
		try {
			const { record } = await importRelease(
				api,
				{ driverId: driverId.trim(), version: version.trim() },
				metadata,
				image,
				controller.signal
			);
			onImported(record);
			open = false;
		} catch (error) {
			if (controller.signal.aborted) problem = m.catalog_import_cancelled();
			else if (error instanceof ApiError && error.code === 'release_conflict') {
				problem = m.catalog_import_conflict();
			} else problem = errorMessage(error);
		} finally {
			upload = null;
		}
	}
</script>

<Dialog
	bind:open
	title={m.catalog_import()}
	description={m.catalog_import_intro()}
	width="lg"
	dismissible={!upload}
>
	<form id={formId} onsubmit={submit} novalidate>
		<fieldset class="stack" disabled={!!upload}>
			{#if problem}<Callout tone="fail" title={problem} live />{/if}
			<FileField
				label={m.catalog_import_archive()}
				help={m.catalog_import_archive_hint()}
				accept=".tar.gz,.tgz,.gz,application/gzip"
				bind:files
				error={archiveError}
			/>
			<div class="identity">
				<TextField
					label={m.catalog_driver()}
					help={m.catalog_import_id_tip()}
					placeholder="exampleco-meter"
					autocomplete="off"
					spellcheck={false}
					bind:value={driverId}
					error={driverError}
				/>
				<TextField
					label={m.catalog_version()}
					placeholder="1.0.0"
					autocomplete="off"
					spellcheck={false}
					help={m.catalog_import_version_hint()}
					bind:value={version}
					error={versionError}
				/>
			</div>
			<details bind:open={showOptions}>
				<summary>{m.catalog_import_options()}</summary>
				<div class="stack options">
					<TextField
						label={m.catalog_import_name()}
						help={m.catalog_import_name_tip()}
						placeholder={driverId}
						bind:value={displayName}
					/>
					<TextField
						label={m.catalog_commit()}
						help={m.catalog_import_commit_tip()}
						autocomplete="off"
						spellcheck={false}
						bind:value={commit}
						error={commitError}
					/>
					<TextField
						label={m.catalog_directory()}
						help={m.catalog_import_directory_tip()}
						placeholder="Drivers/exampleco-meter"
						bind:value={directory}
					/>
					<TextArea
						label={m.catalog_import_config()}
						bind:value={declaration}
						code
						rows={6}
						spellcheck={false}
						placeholder={'{"schemaVersion": 1, "inputs": []}'}
						help={m.catalog_import_config_hint()}
						error={declarationError}
					/>
				</div>
			</details>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button
			variant="ghost"
			onclick={() => {
				if (upload) upload.abort();
				else open = false;
			}}
		>
			{m.common_cancel()}
		</Button>
		<Button form={formId} type="submit" variant="primary" busy={!!upload}>
			{upload ? m.catalog_import_busy() : m.catalog_import_submit()}
		</Button>
	{/snippet}
</Dialog>

<style>
	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.identity {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
		gap: var(--space-4);
	}

	details {
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border);
	}

	summary {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-weight: var(--weight-semibold);
		cursor: pointer;
	}

	summary:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.options {
		padding: 0 var(--space-3) var(--space-3);
	}
</style>
