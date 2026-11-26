import { expect } from './errors.js';
import { randomUUID } from 'node:crypto';
import { isObject, validateSettings } from './settings.js';
import { uuidPattern } from './request-key.js';

export const nodeEnv = 'VIDEOIPATH_NODE_ID';
const secretKey = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function validateNodeId(value) {
  expect(typeof value === 'string' && uuidPattern.test(value) && value !== '00000000-0000-0000-0000-000000000000',
    'Expected a lowercase, non-nil node UUID');
}

export function selectProfile(inheritSite, profile) {
  expect(inheritSite === undefined || typeof inheritSite === 'boolean', 'inheritSite must be boolean');
  if (inheritSite === true) expect(profile, 'No VideoIPath site is configured', 409);
  return inheritSite === false ? null : profile;
}

function applyRegistration(configuration, fields, supplied, profile, errors) {
  for (const [role, env] of [['url', 'VIDEOIPATH_URL'], ['token', 'VIDEOIPATH_TOKEN']]) {
    const declaredName = configuration.videoIPathInputs?.[role];
    let field = fields.find(f => declaredName ? f.name === declaredName : f.env === env);
    if (!field) {
      field = { name: `$site_${role}`, env, required: true, type: 'string', secret: role === 'token' };
      fields.push(field);
    }
    expect(field.type === 'string' && Boolean(field.secret) === (role === 'token'),
      'Driver registration input has an incompatible declaration', 422);
    if (Object.hasOwn(supplied, field.name)) errors.push({ field: field.name, code: 'site_input_override' });
    field.source = 'site';
    if (role === 'url') supplied[field.name] = profile.url;
    else supplied[field.name] = { secretRef: `vip_${profile.id}` };
  }
}

// Job rendering consumes supplied values. HTTP consumers receive only fields and validation.
export function resolveDeploymentInputs(configuration, settings, nodeId, profile) {
  expect(isObject(settings), 'Expected a settings object');
  const fields = configuration.inputs.map(f => ({ ...f, source: 'operator' }));
  const supplied = { ...settings };
  const errors = [];
  if (profile) applyRegistration(configuration, fields, supplied, profile, errors);
  const identities = fields.filter(f => f.env === nodeEnv || f.name === configuration.nodeIdInput);
  if (!identities.length) {
    const implicit = { name: '$nodeId', type: 'string', required: true, env: nodeEnv };
    fields.push(implicit);
    identities.push(implicit);
  }
  for (const field of identities) {
    expect(!field.secret && field.type === 'string' && field.source !== 'site', 'Invalid node ID declaration', 422);
    if (Object.hasOwn(settings, field.name) && (field.name === '$nodeId' || settings[field.name] !== nodeId)) {
      errors.push({ field: field.name, code: 'identity_override' });
    }
    field.source = 'identity';
    supplied[field.name] = nodeId;
  }
  errors.push(...validateSettings({ inputs: fields }, supplied).errors);
  for (const field of fields) {
    const value = Object.hasOwn(supplied, field.name) ? supplied[field.name] : field.default;
    if (value === undefined) continue;
    if (typeof value?.secretRef === 'string' && field.secret && value.secretRef.trim() && !secretKey.test(value.secretRef)) {
      errors.push({ field: field.name, code: 'invalid_secret_key' });
    }
    if (field.env?.startsWith('NOMAD_') || (field.file && !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(field.file))) {
      errors.push({ field: field.name, code: 'unsupported_binding' });
    }
  }
  return { fields, supplied, validation: { valid: !errors.length, errors } };
}

export function deployForm(configuration, input, siteProfile) {
  expect(Object.keys(input).every(key => ['settings', 'nodeId', 'inheritSite'].includes(key)), 'Unknown deploy form option');
  if (input.nodeId !== undefined) validateNodeId(input.nodeId);
  const profile = selectProfile(input.inheritSite, siteProfile);
  const { fields, validation } = resolveDeploymentInputs(configuration,
    input.settings === undefined ? {} : input.settings, input.nodeId ?? randomUUID(), profile);
  for (const field of fields) {
    if (field.source !== 'operator') delete field.default;
    else if (field.secret) field.secretRefPattern = secretKey.source;
  }
  return { inheritsSite: Boolean(profile), fields, validation };
}
