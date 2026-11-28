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
	plaintext_not_declared: m.compat_plaintext,
	url_scheme: m.compat_scheme,
	url_invalid: m.compat_url,
	url_credentials: m.compat_url_credentials,
	url_path: m.compat_url_path,
	url_query: m.compat_url_query,
	url_fragment: m.compat_url_fragment,
	not_in_enum: m.compat_enum,
	required: m.configuration_field_required,
	wrong_type: m.configuration_field_wrong_type,
	too_short: m.configuration_field_too_short,
	too_long: m.configuration_field_too_long,
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
	if (field.type === 'string') {
		if (field.enum && !field.enum.includes(value)) return fieldErrorText('not_in_enum');
		const length = [...value].length;
		if (field.minLength !== undefined && length < field.minLength)
			return fieldErrorText('too_short');
		if (field.maxLength !== undefined && length > field.maxLength)
			return fieldErrorText('too_long');
	}
	return null;
}

/** "At least 3 characters", "At most 80 characters" or "3 to 80 characters". */
function lengthHint({ minLength, maxLength }: FormField): string | null {
	// A minimum of one character is what "required" already says.
	const minimum = minLength !== undefined && minLength > 1 ? minLength : undefined;
	if (minimum !== undefined && maxLength !== undefined)
		return m.configuration_hint_length({ minimum, maximum: maxLength });
	if (minimum !== undefined) return m.configuration_hint_min_length({ count: minimum });
	if (maxLength !== undefined) return m.configuration_hint_max_length({ count: maxLength });
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

/**
 * A readable name for an input key, such as "Device host" for deviceHost. The key itself is
 * still shown beside it, since driver documentation refers to inputs by key.
 */
export function fieldLabel(name: string): string {
	const words = name
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.trim()
		.split(/\s+/)
		.map((word, index) =>
			/^[A-Z0-9]+$/.test(word) && word.length > 1
				? word
				: index === 0
					? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
					: word.toLowerCase()
		);
	return words.join(' ') || name;
}

/** What an input is for, as its driver describes it, then what it accepts. */
export function fieldHint(field: FormField, variable: string): string {
	const parts: string[] = [];
	if (field.url) parts.push(m.compat_schemes({ values: field.url.schemes.join(', ') }));
	if (field.enum) parts.push(m.compat_choices({ values: field.enum.join(', ') }));
	if (field.description) parts.push(field.description.trim());
	if (field.secret) parts.push(m.configuration_hint_secret({ variable }));
	if (field.default !== undefined)
		parts.push(m.configuration_hint_default({ value: String(field.default) }));
	if (field.minimum !== undefined && field.maximum !== undefined) {
		parts.push(m.configuration_hint_range({ minimum: field.minimum, maximum: field.maximum }));
	} else if (field.minimum !== undefined)
		parts.push(m.configuration_hint_minimum({ minimum: field.minimum }));
	else if (field.maximum !== undefined)
		parts.push(m.configuration_hint_maximum({ maximum: field.maximum }));
	// A secret's length bounds describe its value; the operator only enters the name of its key.
	const length = field.secret ? null : lengthHint(field);
	if (length) parts.push(length);
	parts.push(m.configuration_hint_key({ name: field.name }));
	return parts.join(' ');
}
