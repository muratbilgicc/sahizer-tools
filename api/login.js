import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = '__Host-yks_session';
const ITERATIONS = 180000;
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function respondRedirect(res, location, cookie) {
  const headers = { ...RESPONSE_HEADERS, Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return res.writeHead(303, headers).end();
}

function parseBody(body) {
  if (typeof body === 'string') return new URLSearchParams(body);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { get: (key) => typeof body[key] === 'string' ? body[key] : null };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.writeHead(405, { ...RESPONSE_HEADERS, Allow: 'POST' }).end('Method Not Allowed');
  }

  const username = process.env.YKS_AUTH_USERNAME;
  const salt = process.env.YKS_AUTH_SALT;
  const hash = process.env.YKS_AUTH_HASH;
  const secret = process.env.YKS_AUTH_SECRET;
  if (!username || !salt || !hash || !secret) {
    console.error('YKS login: authentication configuration missing');
    return res.writeHead(503, RESPONSE_HEADERS).end('Authentication is temporarily unavailable');
  }

  // Vercel may forward a production alias to an internal deployment hostname.
  // Compare Origin with public/forwarded hosts and reject cross-site browser requests.
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.writeHead(403, RESPONSE_HEADERS).end('Forbidden');
  }
  if (origin) {
    let originHost;
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== 'https:') throw new Error('Invalid origin protocol');
      originHost = parsedOrigin.host.toLowerCase();
    } catch {
      return res.writeHead(403, RESPONSE_HEADERS).end('Forbidden');
    }
    const allowedHosts = new Set([
      String(req.headers.host || '').toLowerCase(),
      String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase(),
      'sahizer-tools.vercel.app',
      'sahizer-tools-embi.vercel.app',
      'sahizer-tools-git-main-embi.vercel.app'
    ]);
    if (!allowedHosts.has(originHost)) {
      return res.writeHead(403, RESPONSE_HEADERS).end('Forbidden');
    }
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const size = Number(req.headers['content-length'] || '0');
  if (!contentType.startsWith('application/x-www-form-urlencoded') ||
      (size && (size < 0 || size > 4096))) return respondRedirect(res, '/login?error=1');

  try {
    const form = parseBody(req.body);
    if (!form) {
      console.error('YKS login: form body unavailable');
      return respondRedirect(res, '/login?error=1');
    }

    const submittedName = form.get('username');
    const submittedPassword = form.get('password');
    if (typeof submittedName !== 'string' || typeof submittedPassword !== 'string' ||
        submittedName.length > 120 || submittedPassword.length > 256) {
      return respondRedirect(res, '/login?error=1');
    }

    const derived = pbkdf2Sync(submittedPassword, Buffer.from(salt, 'base64url'), ITERATIONS, 32, 'sha256');
    const stored = Buffer.from(hash, 'base64url');
    const validPassword = stored.length === derived.length && timingSafeEqual(derived, stored);
    if (submittedName.trim() !== username || !validPassword) {
      return respondRedirect(res, '/login?error=1');
    }

    const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = 'v1.' + expiry + '.' + randomBytes(16).toString('base64url');
    const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('base64url');
    const cookie = COOKIE_NAME + '=' + payload + '.' + signature +
      '; Max-Age=' + SESSION_TTL_SECONDS + '; Path=/; HttpOnly; Secure; SameSite=Lax';
    return respondRedirect(res, '/', cookie);
  } catch (error) {
    console.error('YKS login: server-side verification failed', error?.name || 'Error');
    return res.writeHead(500, RESPONSE_HEADERS).end('Sign-in temporarily unavailable');
  }
}
