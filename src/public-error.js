import { RequestError } from './errors.js';
import { UpstreamError } from './github.js';
import { InvalidRelease } from './release.js';
import { ReleaseConflict } from './release-store.js';

const statusCodes = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large', 415: 'unsupported_media_type',
  422: 'validation_failed', 429: 'busy', 502: 'upstream_error', 503: 'unavailable' };

export function publicError(error) {
  if (error instanceof ReleaseConflict) return { status: 409, error: error.message, code: 'release_conflict' };
  if (error instanceof InvalidRelease) return { status: 422, error: error.message, code: 'invalid_release' };
  if (error instanceof UpstreamError) return { status: 502, error: error.message, code: 'github_unavailable' };
  if (error instanceof RequestError) return {
    status: error.status, error: error.message, code: error.code ?? statusCodes[error.status], details: error.details
  };
  return { status: 500, error: 'Internal server error', code: 'internal_error' };
}
