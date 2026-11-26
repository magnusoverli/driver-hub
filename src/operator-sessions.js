import { createHash, randomBytes } from 'node:crypto';
import { expect } from './errors.js';

const cookie = '__Host-driverhub_session';
const attributes = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const lifetime = 8 * 60 * 60 * 1000;
const digest = id => createHash('sha256').update(id).digest('hex');
const publicUser = ({ username, role, provider }) => ({ username, role, provider });

function sessionKey(request) {
  const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookie}=`));
  return value && digest(value.slice(cookie.length + 1));
}

// Browser writes must be non-simple requests. Keep the API same-origin; never enable arbitrary credentialed CORS.
export function browserWrite(request) {
  expect(request.headers['x-driver-hub-request'] === '1', 'Missing browser request header', 403, 'csrf_check_failed');
  expect(request.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site request denied', 403, 'csrf_check_failed');
  const origin = request.headers.origin;
  if (origin) {
    const host = request.headers.host;
    expect(origin === `https://${host}` || (origin === `http://${host}` && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)),
      'Unexpected browser origin', 403, 'csrf_check_failed');
  }
}

// Providers verify credentials and resolve a current {username, provider, role, revision}.
// A changed revision invalidates sessions without teaching the HTTP routes about the directory.
export class OperatorSessions {
  constructor(provider, now = Date.now) {
    this.provider = provider;
    this.now = now;
    this.sessions = new Map();
    this.attempts = new Map();
    this.verifying = 0;
  }

  async verify(request, username, password) {
    const now = this.now();
    for (const [key, bucket] of this.attempts) if (bucket.until <= now) this.attempts.delete(key);
    const key = request.socket.remoteAddress;
    const bucket = this.attempts.get(key) ?? { count: 0, until: now + 60_000 };
    expect(this.verifying < 3 && bucket.count < 15 && (this.attempts.has(key) || this.attempts.size < 4096),
      'Too many sign-in attempts; retry later', 429);
    bucket.count++;
    this.attempts.set(key, bucket);
    this.verifying++;
    try {
      const identity = await this.provider.authenticate(username, password);
      expect(identity && ['viewer', 'admin'].includes(identity.role), 'Invalid username or password', 401, 'invalid_credentials');
      bucket.count--;
      return identity;
    } finally { this.verifying--; }
  }

  async login(request, input, headers) {
    const identity = await this.verify(request, input.username, input.password);
    const now = this.now();
    for (const [key, session] of this.sessions) if (session.expires <= now) this.sessions.delete(key);
    this.sessions.delete(sessionKey(request));
    expect(this.sessions.size < 10000, 'Session capacity reached', 503);
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(digest(id), { identity, expires: now + lifetime });
    headers['Set-Cookie'] = `${cookie}=${id}; ${attributes}; Max-Age=${lifetime / 1000}`;
    return publicUser(identity);
  }

  async current(request) {
    const key = sessionKey(request);
    const session = this.sessions.get(key);
    if (session && session.expires > this.now()) {
      const user = await this.provider.resolve(session.identity.username);
      if (user && user.username === session.identity.username && user.provider === session.identity.provider && user.revision === session.identity.revision &&
          user.role === session.identity.role) return publicUser(user);
    }
    this.sessions.delete(key);
    expect(false, 'Sign-in required', 401);
  }

  logout(request, headers) {
    this.sessions.delete(sessionKey(request));
    headers['Set-Cookie'] = `${cookie}=; ${attributes}; Max-Age=0`;
    return { signedOut: true };
  }
}
