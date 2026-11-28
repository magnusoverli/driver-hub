import { isIPv6 } from 'node:net';
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
// URL values in canonical form, as the external drivers repository defines them
// (Drivers/RELEASING.md#url-values and tools/driverhub_contract.py): printable ASCII
// without "\\", and scheme "://" authority path ["?" query] ["#" fragment]. Anything a
// WHATWG parser would repair or normalize is refused, so Hub never approves a value the
// driver reads differently. Shared cases: test/fixtures/driver-config.
const urlForm = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/s;
const hostPort = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._~-]+)(?::([0-9]{1,5}))?$/;
const octet = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const dottedQuad = new RegExp(`^${octet}(?:\\.${octet}){3}$`);
const numericLabel = /^(?:[0-9]+|0[xX][0-9A-Fa-f]*)$/;

function hostOk(host) {
  if (host.startsWith('[')) return isIPv6(host.slice(1, -1));
  // WHATWG parsers read a host whose last label is numeric as IPv4; accept only a dotted quad.
  const last = host.replace(/\.+$/, '').split('.').at(-1);
  return numericLabel.test(last) ? dottedQuad.test(host) : true;
}

/** Reasons a string violates a url constraint, sorted: url_invalid alone, or the others. */
export function urlErrors(rule, value) {
  if (typeof value !== 'string' || [...value].some(c => c < '!' || c > '~' || c === '\\')) return ['url_invalid'];
  const match = urlForm.exec(value);
  if (!match) return ['url_invalid'];
  const [, scheme, authority, path, query, fragment] = match;
  const at = authority.lastIndexOf('@');
  const host = hostPort.exec(authority.slice(at + 1));
  if (!host || !hostOk(host[1]) || (host[2] && Number(host[2]) > 65535)) return ['url_invalid'];
  const reasons = [];
  if (!rule.schemes.includes(scheme.toLowerCase())) reasons.push('url_scheme');
  if (at !== -1 && !rule.allowCredentials) reasons.push('url_credentials');
  if (rule.path !== undefined && path !== rule.path) reasons.push('url_path');
  if (query !== undefined && !rule.allowQuery) reasons.push('url_query');
  if (fragment !== undefined && !rule.allowFragment) reasons.push('url_fragment');
  return reasons.sort();
}

/** Every reason a value violates its input. Integers keep the released out_of_range code. */
function valueErrors(field, value) {
  if (field.secret) {
    if (!isObject(value) || Object.keys(value).length !== 1 ||
        typeof value.secretRef !== 'string' || !value.secretRef.trim()) return ['secret_reference_required'];
    return [];
  }
  if (field.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== field.type) return ['wrong_type'];
  if (field.type === 'integer') return value < field.minimum || value > field.maximum ? ['out_of_range'] : [];
  if (field.type !== 'string') return [];
  const reasons = [];
  if ([...value].length < (field.minLength ?? 0)) reasons.push('too_short');
  if ([...value].length > (field.maxLength ?? Infinity)) reasons.push('too_long');
  if (field.enum && !field.enum.includes(value)) reasons.push('not_in_enum');
  if (field.url) reasons.push(...urlErrors(field.url, value));
  return reasons;
}

const v2Keys = new Set(['schemaVersion', 'inputs', 'controlHealth', 'nodeIdInput', 'videoIPathInputs']);
const urlKeys = ['schemes', 'path', 'allowCredentials', 'allowQuery', 'allowFragment'];
const schemePattern = /^[a-z][a-z0-9+.-]*$/;
// An absolute path without dot segments (also not as %2E), percent-escapes in uppercase hex.
const pathPattern = /^(?!.*\/(?:\.|%2[Ee]){1,2}(?:\/|$))\/(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-F]{2})*$/;

export function checkDeclaration(declaration) {
  requireRelease([1, 2].includes(declaration?.schemaVersion) && Array.isArray(declaration.inputs),
    'Unsupported configuration declaration');
  const v2 = declaration.schemaVersion === 2;
  requireRelease(!v2 || Object.keys(declaration).every(key => v2Keys.has(key)), 'Unsupported declaration property');
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
      requireRelease(field.enum === undefined || field.url === undefined, 'An input is either an enum or a URL');
      const distinct = list => Array.isArray(list) && list.length > 0 &&
        list.every(x => typeof x === 'string' && x.length > 0) && new Set(list).size === list.length;
      if (field.enum !== undefined) {
        requireRelease(distinct(field.enum), 'Invalid string enum');
        requireRelease(field.enum.every(choice => [...choice].length >= (field.minLength ?? 0) &&
          [...choice].length <= (field.maxLength ?? Infinity)), 'Enum choice outside the length bounds');
      }
      if (field.url !== undefined) {
        const r = field.url;
        // Every key but path is required, so neither side relies on an implied default.
        requireRelease(isObject(r) && Object.keys(r).every(k => urlKeys.includes(k)) &&
          distinct(r.schemes) && r.schemes.every(s => schemePattern.test(s)) &&
          (r.path === undefined || (typeof r.path === 'string' && pathPattern.test(r.path))) &&
          ['allowCredentials', 'allowQuery', 'allowFragment'].every(k => typeof r[k] === 'boolean'),
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
    requireRelease(!Object.hasOwn(field, 'default') || !valueErrors(field, field.default).length, 'Invalid input default');
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
    if (Object.hasOwn(settings, field.name)) {
      for (const code of valueErrors(field, settings[field.name])) errors.push({ field: field.name, code });
    } else if (field.required && !Object.hasOwn(field, 'default')) {
      errors.push({ field: field.name, code: 'required' });
    }
  }
  return { valid: errors.length === 0, errors };
}
