import { requireRelease } from './release.js';

// The input properties of driver-config.json v1, as the VideoIPath External Drivers repository's
// schema defines them (Drivers/schemas/driver-config-v1.schema.json).
const fieldProperties = new Set([
  'name', 'type', 'required', 'description', 'secret', 'env', 'file', 'default', 'minimum', 'maximum',
  'minLength', 'maxLength'
]);

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A secret's length bounds describe its value, which Hub never sees: only its key name.
function valueError(field, value) {
  if (field.secret) {
    if (!isObject(value) || Object.keys(value).length !== 1 ||
        typeof value.secretRef !== 'string' || !value.secretRef.trim()) return 'secret_reference_required';
    return;
  }
  if (field.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== field.type) return 'wrong_type';
  if (field.enum && !field.enum.includes(value)) return 'not_in_enum';
  if (field.url) {
    const rule = field.url;
    let url;
    try { url = new URL(value); } catch { return 'invalid_url'; }
    if (!url.hostname || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /[\s\\]/.test(value)) return 'invalid_url';
    if (!rule.schemes.includes(url.protocol.slice(0, -1))) return 'unsupported_url_scheme';
    if ((rule.path !== undefined && url.pathname !== rule.path) ||
      (rule.allowCredentials === false && /:\/\/[^/?#]*@/.test(value)) ||
      (rule.allowQuery === false && value.split('#')[0].includes('?')) ||
      (rule.allowFragment === false && value.includes('#'))) return 'invalid_url';
  }
  if (field.type === 'string' && [...value].length < (field.minLength ?? 0)) return 'too_short';
  if (field.type === 'string' && [...value].length > (field.maxLength ?? Infinity)) return 'too_long';
  if (value < field.minimum || value > field.maximum) return 'out_of_range';
}

export function checkDeclaration(declaration) {
  requireRelease([1, 2].includes(declaration?.schemaVersion) && Array.isArray(declaration.inputs),
    'Unsupported configuration declaration');
  if (declaration.controlHealth !== undefined) {
    const h = declaration.controlHealth;
    requireRelease(isObject(h) && Number.isInteger(h.port) && h.port > 0 && h.port <= 65535 &&
      typeof h.path === 'string' && /^\/[A-Za-z0-9_/-]*$/.test(h.path) && !h.path.includes('//'),
    'Invalid control-health endpoint');
  }
  const names = new Set();
  const bindings = new Set();
  for (const field of declaration.inputs) {
    requireRelease(isObject(field) && typeof field.name === 'string' && /^[A-Za-z][\w.-]*$/.test(field.name) &&
      !names.has(field.name), 'Invalid or duplicate input name');
    requireRelease(Object.keys(field).every(key => fieldProperties.has(key) ||
      (declaration.schemaVersion === 2 && ['enum', 'url'].includes(key))), 'Unsupported input property');
    if (field.enum !== undefined || field.url !== undefined) {
      requireRelease(field.type === 'string' && !field.secret, 'Constraints require a non-secret string');
      const distinct = list => Array.isArray(list) && list.length > 0 &&
        list.every(x => typeof x === 'string' && x.length > 0) && new Set(list).size === list.length;
      if (field.enum !== undefined) requireRelease(distinct(field.enum), 'Invalid string enum');
      if (field.url !== undefined) {
        const r = field.url;
        requireRelease(isObject(r) && Object.keys(r).every(k => ['schemes', 'path', 'allowCredentials', 'allowQuery', 'allowFragment'].includes(k)) &&
          distinct(r.schemes) && r.schemes.every(s => /^[a-z][a-z0-9+.-]*$/.test(s)) &&
          (r.path === undefined || (typeof r.path === 'string' && /^\/[^\s\\?#]*$/.test(r.path))) &&
          ['allowCredentials', 'allowQuery', 'allowFragment'].every(k => r[k] === undefined || typeof r[k] === 'boolean'),
        'Invalid URL constraint');
      }
    }
    names.add(field.name);
    requireRelease(['string', 'integer', 'boolean'].includes(field.type) && typeof field.required === 'boolean',
      'Invalid input type or required flag');
    requireRelease((field.secret === undefined || typeof field.secret === 'boolean') &&
      (!field.secret || (field.type === 'string' && !Object.hasOwn(field, 'default'))), 'Invalid secret declaration');
    requireRelease((field.env === undefined) !== (field.file === undefined), 'Expected one input binding');
    const binding = field.env ?? field.file;
    requireRelease(typeof binding === 'string' && (field.env !== undefined
      ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(binding)
      : binding.startsWith('/') && binding.slice(1).split('/').every(s => s && s !== '.' && s !== '..')),
    'Invalid input binding');
    requireRelease(!bindings.has(binding), 'Duplicate input binding');
    bindings.add(binding);
    requireRelease(field.description === undefined || (typeof field.description === 'string' &&
      field.description.trim() && [...field.description].length <= 1000), 'Invalid input description');
    for (const bound of [field.minLength, field.maxLength]) {
      requireRelease(bound === undefined || (field.type === 'string' && Number.isSafeInteger(bound) && bound >= 0),
        'Invalid length bound');
    }
    requireRelease(!(field.minLength > field.maxLength), 'Inverted length bounds');
    for (const bound of [field.minimum, field.maximum]) {
      requireRelease(bound === undefined || (field.type === 'integer' && Number.isSafeInteger(bound)),
        'Invalid integer bound');
    }
    requireRelease(!(field.minimum > field.maximum), 'Inverted integer bounds');
    requireRelease(!Object.hasOwn(field, 'default') || !valueError(field, field.default), 'Invalid input default');
  }
  if (declaration.nodeIdInput !== undefined) {
    const field = declaration.inputs.find(f => f.name === declaration.nodeIdInput);
    requireRelease(field?.type === 'string' && !field.secret && !Object.hasOwn(field, 'default'),
      'nodeIdInput must name a non-secret string input without a default');
  }
  if (declaration.videoIPathInputs !== undefined) {
    const mapping = declaration.videoIPathInputs;
    requireRelease(isObject(mapping) && Object.keys(mapping).every(k => ['url', 'token'].includes(k)),
      'Invalid VideoIPath registration input mapping');
    for (const [role, name] of Object.entries(mapping)) {
      const field = declaration.inputs.find(f => f.name === name);
      const canonical = role === 'url' ? 'VIDEOIPATH_URL' : 'VIDEOIPATH_TOKEN';
      requireRelease(field?.type === 'string' && Boolean(field.secret) === (role === 'token') &&
        field.name !== declaration.nodeIdInput && field.env !== 'VIDEOIPATH_NODE_ID' &&
        field.env !== (role === 'url' ? 'VIDEOIPATH_TOKEN' : 'VIDEOIPATH_URL') &&
        !declaration.inputs.some(f => f !== field && f.env === canonical), 'Invalid VideoIPath registration binding');
    }
  }
  return declaration;
}

export function validateSettings(declaration, settings) {
  const fields = new Map(declaration.inputs.map(field => [field.name, field]));
  const errors = [];
  for (const key of Object.keys(settings)) {
    if (!fields.has(key)) errors.push({ field: key, code: 'unknown_input' });
  }
  for (const field of fields.values()) {
    let code;
    if (Object.hasOwn(settings, field.name)) code = valueError(field, settings[field.name]);
    else if (field.required && !Object.hasOwn(field, 'default')) code = 'required';
    if (code) errors.push({ field: field.name, code });
  }
  return { valid: errors.length === 0, errors };
}
