<script lang="ts">
	import type { Schema } from '#lib/api/types.js';
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Table from '#lib/ui/Table.svelte';

	let { declaration }: { declaration: Schema<'Declaration'> } = $props();

	type Input = Schema<'Declaration'>['inputs'][number];

	function limits(input: Input): string {
		const parts: string[] = [];
		if (input.minimum !== undefined && input.maximum !== undefined) {
			parts.push(m.settings_hint_range({ minimum: input.minimum, maximum: input.maximum }));
		} else if (input.minimum !== undefined) {
			parts.push(m.settings_hint_minimum({ minimum: input.minimum }));
		} else if (input.maximum !== undefined) {
			parts.push(m.settings_hint_maximum({ maximum: input.maximum }));
		}
		if (input.minLength && input.minLength > 1) {
			parts.push(m.settings_hint_min_length({ count: input.minLength }));
		}
		return parts.join(' ');
	}

	/** Inputs Hub fills in for the operator: the node ID and, with a site target, the connection. */
	function suppliedBy(input: Input): string | null {
		if (input.name === declaration.nodeIdInput || input.env === 'VIDEOIPATH_NODE_ID') {
			return m.release_input_identity();
		}
		const mapping = declaration.videoIPathInputs ?? {};
		if (
			input.name === mapping.url ||
			input.name === mapping.token ||
			input.env === 'VIDEOIPATH_URL' ||
			input.env === 'VIDEOIPATH_TOKEN'
		) {
			return m.release_input_site();
		}
		return null;
	}
</script>

{#if declaration.inputs.length}
	<Table label={m.release_inputs_title()}>
		<thead>
			<tr>
				<th scope="col">{m.release_input_name()}</th>
				<th scope="col">{m.release_input_type()}</th>
				<th scope="col">{m.release_input_default()}</th>
				<th scope="col">{m.release_input_binding()}</th>
			</tr>
		</thead>
		<tbody>
			{#each declaration.inputs as input (input.name)}
				{@const supplied = suppliedBy(input)}
				<tr>
					<td>
						<span class="name">
							<code>{input.name}</code>
							{#if input.required && input.default === undefined}
								<Badge>{m.catalog_required()}</Badge>
							{/if}
							{#if input.secret}<Badge tone="accent">{m.settings_secret_reference()}</Badge>{/if}
						</span>
						{#if supplied}<span class="secondary">{supplied}</span>{/if}
						{#if limits(input)}<span class="secondary">{limits(input)}</span>{/if}
					</td>
					<td>{input.type}</td>
					<td>
						{#if input.default !== undefined}<code>{String(input.default)}</code>
						{:else}<span class="secondary">—</span>{/if}
					</td>
					<td>
						<code>{input.env ?? input.file}</code>
						<span class="secondary">
							{input.env ? m.release_binding_env() : m.release_binding_file()}
						</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</Table>
{:else}
	<p class="none">{m.catalog_no_inputs()}</p>
{/if}

<style>
	.name {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.secondary {
		display: block;
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.none {
		padding: var(--space-4);
		color: var(--text-2);
	}
</style>
