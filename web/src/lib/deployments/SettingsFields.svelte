<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import {
		fieldHint,
		operatorFields,
		type DeployForm,
		type FormField,
		type SettingValues
	} from './settings-form';

	type Props = {
		form: DeployForm;
		values: SettingValues;
		/** Problems per input name, shown once the operator has tried to continue. */
		problems: ReadonlyMap<string, string>;
		showProblems: boolean;
		/** The Nomad Variable that secret references name keys in. */
		variable: string;
	};

	let { form, values = $bindable(), problems, showProblems, variable }: Props = $props();

	const fields = $derived(operatorFields(form));
	const supplied = $derived(form.fields.filter((field) => field.source !== 'operator'));

	function label(field: FormField): string {
		const optional = !field.required || field.default !== undefined;
		return optional ? m.settings_label_optional({ name: field.name }) : field.name;
	}

	function booleanOptions(field: FormField) {
		const unset =
			field.default !== undefined
				? m.settings_boolean_default({ value: field.default ? m.common_yes() : m.common_no() })
				: m.settings_boolean_unset();
		return [
			...(field.required && field.default === undefined ? [] : [{ value: '', label: unset }]),
			{ value: 'true', label: m.common_yes() },
			{ value: 'false', label: m.common_no() }
		];
	}

	/** Inputs start unset; an empty string leaves the release default in place. */
	function set(name: string, value: string) {
		values[name] = value;
	}

	/** Names Hub gives its own inputs internally are not meaningful to operators. */
	function suppliedName(field: FormField): string {
		return field.name.startsWith('$') ? (field.env ?? field.name) : field.name;
	}
</script>

<div class="fields">
	{#each fields as field (field.name)}
		{@const problem = showProblems ? (problems.get(field.name) ?? null) : null}
		{#if field.type === 'boolean'}
			<div>
				<RadioGroup
					inline
					legend={label(field)}
					options={booleanOptions(field)}
					bind:value={() => values[field.name] ?? '', (value: string) => set(field.name, value)}
					hint={fieldHint(field, variable)}
				/>
				{#if problem}<p class="problem">{problem}</p>{/if}
			</div>
		{:else}
			<TextField
				label={label(field)}
				bind:value={() => values[field.name] ?? '', (value: string) => set(field.name, value)}
				inputmode={field.type === 'integer' ? 'numeric' : undefined}
				placeholder={field.default !== undefined ? String(field.default) : undefined}
				autocomplete="off"
				spellcheck={false}
				hint={fieldHint(field, variable)}
				error={problem}
			/>
		{/if}
	{:else}
		<p class="none">{m.settings_form_none()}</p>
	{/each}

	{#if supplied.length}
		<div class="supplied">
			<p class="title">{m.settings_supplied_title()}</p>
			<ul>
				{#each supplied as field (field.name)}
					<li>
						<code>{suppliedName(field)}</code>
						<span>
							{field.source === 'identity'
								? m.settings_supplied_identity()
								: field.secret
									? m.settings_supplied_site_token()
									: m.settings_supplied_site_url()}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.problem {
		margin-top: var(--space-1);
		color: var(--fail);
		font-size: var(--text-sm);
	}

	.none {
		color: var(--text-2);
	}

	.supplied {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--sunken);
		font-size: var(--text-sm);
	}

	.title {
		margin-bottom: var(--space-2);
		font-weight: var(--weight-semibold);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		color: var(--text-2);
	}

	code {
		color: var(--text);
	}
</style>
