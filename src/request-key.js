import { createHash } from 'node:crypto';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function canonicalJson(input) {
  return JSON.stringify(input, (_, value) => {
    if (!value || Array.isArray(value) || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

export function fingerprint(kind, input) {
  return createHash('sha256').update(canonicalJson([kind, input])).digest('hex');
}
