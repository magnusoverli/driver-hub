import { describe, expect, it } from 'vitest';
import {
	fieldHint,
	fieldProblems,
	initialValues,
	localProblem,
	secretReferences,
	settingsFromValues,
	type DeployForm,
	type FormField
} from './configuration-form';

const field = (overrides: Partial<FormField>): FormField => ({
	name: 'input',
	type: 'string',
	required: false,
	source: 'operator',
	env: 'INPUT',
	...overrides
});

const form: DeployForm = {
	inheritsSite: true,
	validation: { valid: true, errors: [] },
	fields: [
		field({ name: 'host', required: true, minLength: 1, env: 'HOST' }),
		field({
			name: 'credential',
			required: true,
			secret: true,
			secretRefPattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$',
			env: 'TOKEN'
		}),
		field({ name: 'poll', type: 'integer', default: 5, minimum: 1, maximum: 60, env: 'POLL' }),
		field({ name: 'verbose', type: 'boolean', file: '/run/verbose', env: undefined }),
		field({ name: '$site_url', source: 'site', env: 'VIDEOIPATH_URL' }),
		field({ name: '$nodeId', source: 'identity', env: 'VIDEOIPATH_NODE_ID' })
	]
};

describe('settings form', () => {
	it('fills inputs from existing settings, leaving the rest empty', () => {
		expect(
			initialValues(form, {
				host: 'meter.local',
				credential: { secretRef: 'device_token' },
				poll: 9
			})
		).toEqual({ host: 'meter.local', credential: 'device_token', poll: '9', verbose: '' });
	});

	it('sends typed values and leaves unset inputs to their defaults', () => {
		expect(
			settingsFromValues(form, {
				host: 'meter.local',
				credential: ' key ',
				poll: '',
				verbose: 'false'
			})
		).toEqual({ host: 'meter.local', credential: { secretRef: 'key' }, verbose: false });
		expect(settingsFromValues(form, { host: 'h', credential: 'k', poll: '12' }).poll).toBe(12);
		// Never sends inputs the site or Hub supplies.
		expect(settingsFromValues(form, { $site_url: 'wss://x', $nodeId: 'id' })).toEqual({});
	});

	it('checks inputs as the manager would before anything is sent', () => {
		const [host, credential, poll] = form.fields;
		expect(localProblem(host, '')).toBe('Required.');
		expect(localProblem(poll, '')).toBeNull();
		expect(localProblem(poll, '2.5')).toBe('Enter a whole number.');
		expect(localProblem(poll, '61')).toBe('Outside the allowed range.');
		expect(localProblem(poll, '60')).toBeNull();
		expect(localProblem(credential, 'not a key')).toMatch(/letters, digits and underscores/);
		expect(localProblem(credential, 'device_token')).toBeNull();
	});

	it('prefers what the manager reported, then the local checks', () => {
		const problems = fieldProblems(form, { host: '', credential: 'k', poll: '' }, [
			{ field: 'credential', code: 'invalid_secret_key' },
			{ field: 'credential', code: 'required' }
		]);
		expect([...problems.keys()]).toEqual(['credential', 'host']);
		expect(problems.get('credential')).toMatch(/letters, digits and underscores/);
	});

	it('describes each input by default, limits and how the driver receives it', () => {
		const [host, credential, poll, verbose] = form.fields;
		expect(fieldHint(host, 'nomad/jobs/x')).toBe('Passed as HOST.');
		expect(fieldHint(credential, 'nomad/jobs/x')).toMatch(
			/key in the Nomad Variable nomad\/jobs\/x/
		);
		expect(fieldHint(poll, '')).toBe('Default: 5. From 1 to 60. Passed as POLL.');
		expect(fieldHint(verbose, '')).toBe('Mounted at /run/verbose.');
	});

	it('lists the secret references a deployment needs', () => {
		expect(
			secretReferences({ a: { secretRef: 'one' }, b: 'plain', c: { secretRef: 'two' } })
		).toEqual(['one', 'two']);
	});
});
