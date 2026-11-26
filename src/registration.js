import { expect } from './errors.js';

// A saved deployment carries the URL and an immutable key name, never its bearer value.
export function registrationBindings(configuration, settings, profile) {
  if (!profile) return { inputs: configuration.inputs, supplied: { ...settings } };
  const inputs = [...configuration.inputs];
  const supplied = { ...settings };
  let tokenField;
  for (const [role, env] of [['url', 'VIDEOIPATH_URL'], ['token', 'VIDEOIPATH_TOKEN']]) {
    const declaredName = configuration.videoIPathInputs?.[role];
    let field = inputs.find(f => declaredName ? f.name === declaredName : f.env === env);
    if (!field) {
      field = { name: `$site_${role}`, env, required: true, type: 'string', secret: role === 'token' };
      inputs.push(field);
    }
    expect(field.type === 'string' && Boolean(field.secret) === (role === 'token'),
      'Driver registration input has an incompatible declaration', 422);
    expect(!Object.hasOwn(settings, field.name), 'Omit site-managed registration inputs or disable site inheritance', 422,
      'site_input_override', { field: field.name });
    if (role === 'url') supplied[field.name] = profile.url;
    else {
      supplied[field.name] = { secretRef: `vip_${profile.id}` };
      tokenField = field.name;
    }
  }
  return { inputs, supplied, tokenField };
}
