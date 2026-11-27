import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';

export type DeployForm = Schema<'DeployForm'>;
export type FormField = DeployForm['fields'][number];
export type Settings = NonNullable<Schema<'Stage'>['settings']>;
/** What the operator typed per input, as text; an empty string leaves the input unset. */
export type SettingValues = Record<string, string>;

const NUMBER = /^-?\d+$/;

/** Sentences for a single input, unlike the lists of names and codes in lifecycle messages. */
const fieldCodes: Record<string, () => string> = {
	required: m.configuration_field_required,
	wrong_type: m.configuration_field_wrong_type,
	too_short: m.configuration_field_too_short,
	out_of_range: m.configuration_field_out_of_range,
	secret_reference_required: m.configuration_field_secret_reference,
	invalid_secret_key: m.configuration_error_secret_key,
	unknown_input: m.configuration_field_unknown_input,
	site_input_override: m.configuration_field_site_input,
	identity_override: m.configuration_field_identity,
	unsupported_binding: m.configuration_field_unsupported_binding
};

export function fieldErrorText(code: string): string {
	return fieldCodes[code]?.() ?? code;
}

/** Inputs the operator fills in, as opposed to those supplied by the site or by Hub. */
export function operatorFields(form: DeployForm): FormField[] {
	return form.fields.filter((field) => field.source === 'operator');
}

/** Text values for a form, from existing settings where there are any. */
export function initialValues(form: DeployForm, settings: Settings = {}): SettingValues {
	const values: SettingValues = {};
	for (const field of operatorFields(form)) {
		const value = settings[field.name];
		values[field.name] =
			value === undefined ? '' : typeof value === 'object' ? value.secretRef : String(value);
	}
	return values;
}

/** The settings object the manager expects; unset inputs are left out so defaults apply. */
export function settingsFromValues(form: DeployForm, values: SettingValues): Settings {
	const settings: Settings = {};
	for (const field of operatorFields(form)) {
		const text = (values[field.name] ?? '').trim();
		if (!text) continue;
		if (field.secret) settings[field.name] = { secretRef: text };
		else if (field.type === 'integer')
			settings[field.name] = NUMBER.test(text) ? Number(text) : text;
		else if (field.type === 'boolean') settings[field.name] = text === 'true';
		else settings[field.name] = values[field.name];
	}
	return settings;
}

/** Mirrors the manager's checks, so most problems show before anything is sent. */
export function localProblem(field: FormField, value: string): string | null {
	const text = value.trim();
	if (!text) {
		return field.required && field.default === undefined ? fieldErrorText('required') : null;
	}
	if (field.secret) {
		return field.secretRefPattern && !new RegExp(field.secretRefPattern).test(text)
			? m.configuration_error_secret_key()
			: null;
	}
	if (field.type === 'integer') {
		if (!NUMBER.test(text)) return m.configuration_error_integer();
		const number = Number(text);
		if (field.minimum !== undefined && number < field.minimum)
			return fieldErrorText('out_of_range');
		if (field.maximum !== undefined && number > field.maximum)
			return fieldErrorText('out_of_range');
	}
	if (
		field.type === 'string' &&
		field.minLength !== undefined &&
		[...value].length < field.minLength
	) {
		return fieldErrorText('too_short');
	}
	return null;
}

/** The first problem per input: the manager's answer where it has one, else the local check. */
export function fieldProblems(
	form: DeployForm,
	values: SettingValues,
	reported: readonly { field: string; code: string }[] = []
): Map<string, string> {
	const problems = new Map<string, string>();
	for (const { field, code } of reported) {
		if (!problems.has(field)) problems.set(field, fieldErrorText(code));
	}
	for (const field of operatorFields(form)) {
		const problem = localProblem(field, values[field.name] ?? '');
		if (problem && !problems.has(field.name)) problems.set(field.name, problem);
	}
	return problems;
}

/** Secret reference names a deployment's settings point to, which must exist before it starts. */
export function secretReferences(settings: Settings): string[] {
	return Object.values(settings)
		.filter((value): value is { secretRef: string } => typeof value === 'object')
		.map((value) => value.secretRef);
}

/** A short description of what an input accepts, for its hint. */
export function fieldHint(field: FormField, variable: string): string {
	const parts: string[] = [];
	if (field.secret) parts.push(m.configuration_hint_secret({ variable }));
	if (field.default !== undefined)
		parts.push(m.configuration_hint_default({ value: String(field.default) }));
	if (field.minimum !== undefined && field.maximum !== undefined) {
		parts.push(m.configuration_hint_range({ minimum: field.minimum, maximum: field.maximum }));
	} else if (field.minimum !== undefined)
		parts.push(m.configuration_hint_minimum({ minimum: field.minimum }));
	else if (field.maximum !== undefined)
		parts.push(m.configuration_hint_maximum({ maximum: field.maximum }));
	// A minimum of one character is what "required" already says.
	if (field.minLength && field.minLength > 1) {
		parts.push(m.configuration_hint_min_length({ count: field.minLength }));
	}
	parts.push(
		field.env
			? m.configuration_hint_env({ name: field.env })
			: m.configuration_hint_file({ path: field.file ?? '' })
	);
	return parts.join(' ');
}
