<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Info from '@lucide/svelte/icons/info';
	import { m } from '#lib/paraglide/messages.js';

	/** Background for a nearby label or value, kept out of the page until someone asks. */
	let { label, help }: { label: string; help: string } = $props();
	let open = $state(false);
	const id = $props.id();
</script>

<Tooltip.Provider delayDuration={150}>
	<Tooltip.Root bind:open disableCloseOnTriggerClick>
		<Tooltip.Trigger
			class="help-tip-trigger"
			aria-label={m.field_help({ label })}
			aria-describedby={id}
			onclick={() => (open = true)}
		>
			<Info size={15} aria-hidden="true" />
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				role="tooltip"
				class="help-tip"
				side="top"
				sideOffset={4}
				collisionPadding={12}
			>
				{help}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
<span class="visually-hidden" {id}>{help}</span>

<style>
	:global(.help-tip-trigger) {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 0;
		border-radius: var(--radius);
		padding: 0;
		background: transparent;
		color: var(--text-2);
		vertical-align: middle;
		cursor: help;
	}

	:global(.help-tip-trigger:focus-visible) {
		outline: 2px solid var(--accent);
	}

	:global(.help-tip) {
		z-index: 60;
		max-width: min(20rem, calc(100vw - 2rem));
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		box-shadow: var(--ring), var(--elevated);
		background: var(--surface-raised);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: var(--weight-regular);
	}
</style>
