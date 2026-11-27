<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Info from '@lucide/svelte/icons/info';
	import { m } from '#lib/paraglide/messages.js';

	let { field, label, help }: { field: string; label: string; help: string } = $props();
	let open = $state(false);
</script>

<div class="label">
	<label for={field}>{label}</label>
	<Tooltip.Provider delayDuration={150}>
		<Tooltip.Root bind:open disableCloseOnTriggerClick>
			<Tooltip.Trigger
				class="help-trigger"
				aria-label={m.field_help({ label })}
				onclick={() => (open = true)}
			>
				<Info size={15} aria-hidden="true" />
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					role="tooltip"
					class="field-tip"
					side="top"
					sideOffset={4}
					collisionPadding={12}
				>
					{help}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
	<span class="visually-hidden" id="{field}-help">{help}</span>
</div>

<style>
	.label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}
	:global(.help-trigger) {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 0;
		border-radius: var(--radius);
		padding: 0;
		background: transparent;
		color: var(--text-2);
		cursor: help;
	}
	:global(.help-trigger:focus-visible) {
		outline: 2px solid var(--accent);
	}
	:global(.field-tip) {
		z-index: 60;
		max-width: min(18rem, calc(100vw - 2rem));
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		box-shadow: var(--ring), var(--elevated);
		background: var(--surface-raised);
		color: var(--text);
		font-size: var(--text-sm);
	}
</style>
