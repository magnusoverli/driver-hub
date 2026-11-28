import { describe, expect, it } from 'vitest';
import {
	fieldHint,
	fieldLabel,
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

	it('describes each input by default and limits, ending with its key', () => {
		const [host, credential, poll, verbose] = form.fields;
		expect(fieldHint(host, 'nomad/jobs/x')).toBe('Key: host.');
		expect(fieldHint(credential, 'nomad/jobs/x')).toMatch(
			/key in the Nomad Variable nomad\/jobs\/x/
		);
		expect(fieldHint(poll, '')).toBe('Default: 5. From 1 to 60. Key: poll.');
		expect(fieldHint(verbose, '')).toBe('Key: verbose.');
	});

	it('labels inputs readably and keeps acronyms', () => {
		expect(fieldLabel('deviceHost')).toBe('Device host');
		expect(fieldLabel('maxFrameBytes')).toBe('Max frame bytes');
		expect(fieldLabel('log_level')).toBe('Log level');
		expect(fieldLabel('deviceURL')).toBe('Device URL');
		expect(fieldLabel('poll')).toBe('Poll');
	});

	it("leads with the driver's description and checks length bounds, never on a secret", () => {
		const device = field({
			name: 'deviceHost',
			minLength: 3,
			maxLength: 12,
			env: 'DEVICE_HOST',
			description: 'Host name of the device.'
		});
		expect(fieldHint(device, '')).toBe(
			'Host name of the device. 3 to 12 characters. Key: deviceHost.'
		);
		expect(fieldHint(field({ maxLength: 8, env: 'LEVEL' }), '')).toBe(
			'At most 8 characters. Key: input.'
		);
		expect(localProblem(device, 'ab')).toBe('Too short.');
		expect(localProblem(device, 'a'.repeat(13))).toBe('Too long.');
		expect(localProblem(device, 'meter-1')).toBeNull();

		// A secret's bounds describe its value; the operator enters only the name of its key.
		const token = field({
			name: 'token',
			secret: true,
			minLength: 20,
			maxLength: 8192,
			env: 'TOKEN',
			description: 'Bearer token created in the VideoIPath CLI.'
		});
		expect(fieldHint(token, 'nomad/jobs/x')).not.toMatch(/characters/);
		expect(fieldHint(token, 'nomad/jobs/x')).toMatch(
			/^Bearer token created in the VideoIPath CLI\./
		);
		expect(localProblem(token, 'vip_token')).toBeNull();
	});

	it('lists the secret references a deployment needs', () => {
		expect(
			secretReferences({ a: { secretRef: 'one' }, b: 'plain', c: { secretRef: 'two' } })
		).toEqual(['one', 'two']);
	});
});
