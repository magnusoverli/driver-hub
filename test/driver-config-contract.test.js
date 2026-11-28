import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkDeclaration, validateSettings } from '../src/settings.js';

// The cases the external drivers repository and Hub agreed on (see fixtures/driver-config).
const read = name => JSON.parse(readFileSync(new URL(`fixtures/driver-config/${name}`, import.meta.url), 'utf8'));
const declarations = read('driver-config-v2.cases.json');
const values = read('driver-config-values.cases.json');

/** JSON Merge Patch (RFC 7386): objects merge, anything else (arrays included) replaces. */
function merge(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = merge(result[key], value);
  }
  return result;
}

test('declarations are valid or refused exactly as the shared cases say', () => {
  for (const item of declarations.cases) {
    const document = structuredClone(merge(declarations.base, item.patch ?? {}));
    let valid = true;
    try { checkDeclaration(document); } catch { valid = false; }
    assert.equal(valid, item.valid, `${item.rule}: ${item.note ?? JSON.stringify(item.patch)}`);
  }
});

test('effective values produce the shared reason codes', () => {
  for (const item of values.cases) {
    const field = { name: item.input, ...values.inputs[item.input] };
    const { errors } = validateSettings({ inputs: [field] }, { [item.input]: item.value });
    // Hub's released integer code covers both of the contract's bounds.
    const codes = errors.map(({ code }) => code === 'out_of_range'
      ? (item.value < field.minimum ? 'below_minimum' : 'above_maximum')
      : code);
    assert.deepEqual(codes.sort(), [...item.errors].sort(),
      `${item.input} = ${JSON.stringify(item.value)}${item.note ? ` (${item.note})` : ''}`);
  }
});
