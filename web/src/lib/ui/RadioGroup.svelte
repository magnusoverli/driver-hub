<script lang="ts" generics="T extends string">
	type Option = { value: T; label: string; description?: string; disabled?: boolean };
	type Props = {
		legend: string;
		options: Option[];
		value: T;
		/** Lays the options out side by side when they fit. */
		inline?: boolean;
		hint?: string;
	};

	let { legend, options, value = $bindable(), inline = false, hint }: Props = $props();
	const name = $props.id();
</script>

<fieldset class={['radio-group', { inline }]} aria-describedby={hint ? `${name}-hint` : undefined}>
	<legend>{legend}</legend>
	<div class="options">
		{#each options as option (option.value)}
			<label class={['option', { disabled: option.disabled }]}>
				<input
					type="radio"
					{name}
					value={option.value}
					disabled={option.disabled}
					bind:group={value}
				/>
				<span class="text">
					<span class="label">{option.label}</span>
					{#if option.description}<span class="description">{option.description}</span>{/if}
				</span>
			</label>
		{/each}
	</div>
	{#if hint}<p id="{name}-hint" class="hint">{hint}</p>{/if}
</fieldset>

<style>
	.radio-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: var(--space-1);
		padding: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.inline .options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
	}

	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		cursor: pointer;
	}

	.option:has(input:checked) {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}

	.option:has(input:focus-visible) {
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	.option.disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	input {
		flex: none;
		margin: 0.15rem 0 0;
		accent-color: var(--accent);
	}

	input:focus-visible {
		outline: none;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.label {
		font-weight: var(--weight-semibold);
	}

	.description,
	.hint {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
