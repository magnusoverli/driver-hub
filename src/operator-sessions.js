import { createHash, randomBytes } from 'node:crypto';
import { expect } from './errors.js';

const lifetime = 8 * 60 * 60 * 1000;
const digest = id => createHash('sha256').update(id).digest('hex');
const publicUser = ({ username, role, provider, mustChangePassword }) => ({
  username, role, provider, ...(mustChangePassword && { mustChangePassword: true })
});

// By default the session cookie is Secure, which browsers accept over plain HTTP only on localhost.
// With plain HTTP allowed (DRIVER_HUB_ALLOW_PLAIN_HTTP), it works over HTTP from any host: the
// __Host- prefix requires Secure, so the cookie is named without it.
function sessionCookie(plainHttp) {
  return plainHttp
    ? { name: 'driverhub_session', attributes: 'Path=/; HttpOnly; SameSite=Strict' }
    : { name: '__Host-driverhub_session', attributes: 'Path=/; HttpOnly; Secure; SameSite=Strict' };
}

// Browser writes must be non-simple requests. Keep the API same-origin; never enable arbitrary credentialed CORS.
// An http:// origin is accepted for localhost, or for any host when plain HTTP is allowed.
export function browserWrite(request, plainHttp = false) {
  expect(request.headers['x-driver-hub-request'] === '1', 'Missing browser request header', 403, 'csrf_check_failed');
  expect(request.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site request denied', 403, 'csrf_check_failed');
  const origin = request.headers.origin;
  if (origin) {
    const host = request.headers.host;
    expect(origin === `https://${host}` || (origin === `http://${host}` &&
      (plainHttp || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))),
    'Unexpected browser origin', 403, 'csrf_check_failed');
  }
}

// Providers verify credentials and resolve a current {username, provider, role, revision}.
// A changed revision invalidates sessions without teaching the HTTP routes about the directory.
export class OperatorSessions {
  constructor(provider, now = Date.now, { plainHttp = false } = {}) {
    this.provider = provider;
    this.now = now;
    this.plainHttp = plainHttp;
    this.cookie = sessionCookie(plainHttp);
    this.sessions = new Map();
    this.attempts = new Map();
    this.verifying = 0;
  }

  sessionKey(request) {
    const { name } = this.cookie;
    const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
    return value && digest(value.slice(name.length + 1));
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
    this.sessions.delete(this.sessionKey(request));
    expect(this.sessions.size < 10000, 'Session capacity reached', 503);
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(digest(id), { identity, expires: now + lifetime });
    headers['Set-Cookie'] = `${this.cookie.name}=${id}; ${this.cookie.attributes}; Max-Age=${lifetime / 1000}`;
    return publicUser(identity);
  }

  async current(request) {
    const key = this.sessionKey(request);
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
    this.sessions.delete(this.sessionKey(request));
    headers['Set-Cookie'] = `${this.cookie.name}=; ${this.cookie.attributes}; Max-Age=0`;
    return { signedOut: true };
  }
}
