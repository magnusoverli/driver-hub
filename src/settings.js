import { requireRelease } from './release.js';

const fieldProperties = new Set([
  'name', 'type', 'required', 'secret', 'env', 'file', 'default', 'minimum', 'maximum', 'minLength'
]);

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueError(field, value) {
  if (field.secret) {
    if (!isObject(value) || Object.keys(value).length !== 1 ||
        typeof value.secretRef !== 'string' || !value.secretRef.trim()) return 'secret_reference_required';
    return;
  }
  if (field.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== field.type) return 'wrong_type';
  if (field.type === 'string' && [...value].length < (field.minLength ?? 0)) return 'too_short';
  if (value < field.minimum || value > field.maximum) return 'out_of_range';
}

export function checkDeclaration(declaration) {
  requireRelease(declaration?.schemaVersion === 1 && Array.isArray(declaration.inputs),
    'Unsupported configuration declaration');
  const names = new Set();
  const bindings = new Set();
  for (const field of declaration.inputs) {
    requireRelease(isObject(field) && typeof field.name === 'string' && /^[A-Za-z][\w.-]*$/.test(field.name) &&
      !names.has(field.name), 'Invalid or duplicate input name');
    requireRelease(Object.keys(field).every(key => fieldProperties.has(key)), 'Unsupported input property');
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
    requireRelease(field.minLength === undefined || (field.type === 'string' && !field.secret &&
      Number.isSafeInteger(field.minLength) && field.minLength >= 0), 'Invalid minimum length');
    for (const bound of [field.minimum, field.maximum]) {
      requireRelease(bound === undefined || (field.type === 'integer' && Number.isSafeInteger(bound)),
        'Invalid integer bound');
    }
    requireRelease(!(field.minimum > field.maximum), 'Inverted integer bounds');
    requireRelease(!Object.hasOwn(field, 'default') || !valueError(field, field.default), 'Invalid input default');
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
