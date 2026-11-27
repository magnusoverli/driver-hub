import { createHash } from 'node:crypto';

// SemVer numeric identifiers cannot have leading zeroes (including in prereleases).
const numeric = '(?:0|[1-9][0-9]*)';
const pre = `(?:${numeric}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const version = `${numeric}\\.${numeric}\\.${numeric}(?:-${pre}(?:\\.${pre})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;
const tagPattern = new RegExp(`^drivers/([a-z0-9]+(?:-[a-z0-9]+)*)/v(${version})$`);
const hashPattern = /^[0-9a-f]{64}$/;

export class InvalidRelease extends Error {}

export function requireRelease(condition, message) {
  if (!condition) throw new InvalidRelease(message);
}

export function parseTag(tag) {
  const match = tagPattern.exec(tag);
  return match && { driverId: match[1], version: match[2] };
}

// Discovery only suggests stable candidates. Compare numeric components without
// losing precision; a stable release also supersedes a prerelease of its own core.
export function newerStable(candidate, installed) {
  const current = installed.split('+', 1)[0];
  const components = value => value.split(/[-+]/, 1)[0].split('.').map(BigInt);
  const a = components(candidate);
  const b = components(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return current.includes('-');
}

export function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InvalidRelease(`${label} is not valid JSON`);
  }
}

export function checkSource(source, optional) {
  if (optional && source === undefined) return;
  requireRelease(source !== null && typeof source === 'object' && !Array.isArray(source), 'Invalid release source');
  if (!optional || source.commit !== undefined)
    requireRelease(typeof source.commit === 'string' && /^[0-9a-f]{40}$/.test(source.commit), 'Expected a full lowercase Git commit');
  if (!optional || source.directory !== undefined)
    requireRelease(typeof source.directory === 'string' && source.directory.trim(), 'Expected a source directory');
}

export function readRecord(bytes, identity) {
  const record = parseJson(bytes, 'Release record');
  requireRelease(record?.schemaVersion === 1, 'Unsupported release record');
  requireRelease(record.driverId === identity.driverId && record.version === identity.version,
    'Release identity does not match the tag');
  requireRelease(typeof record.displayName === 'string' && record.displayName.trim(), 'Missing display name');
  checkSource(record.source, record.origin === 'customer');
  requireRelease(record.configuration?.file === 'driver-config.json' &&
    typeof record.configuration.sha256 === 'string' && hashPattern.test(record.configuration.sha256),
  'Invalid configuration reference');
  const image = record.image;
  requireRelease(typeof image?.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(image.digest) &&
    typeof image.archiveSha256 === 'string' && hashPattern.test(image.archiveSha256),
    'Invalid image or archive digest');
  requireRelease(typeof image.archive === 'string' && /^[\w.-]+\.tar\.gz$/.test(image.archive),
    'Invalid archive filename');
  requireRelease(Array.isArray(image.platforms) && image.platforms.length > 0 &&
    image.platforms.every(p => typeof p === 'string' && p.length > 0), 'Missing image platforms');
  return record;
}

export function verifyConfiguration(bytes, record) {
  requireRelease(createHash('sha256').update(bytes).digest('hex') === record.configuration.sha256,
    'Configuration checksum does not match the release record');
  return parseJson(bytes, 'Configuration declaration');
}
