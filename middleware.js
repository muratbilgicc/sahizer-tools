import { next, rewrite } from '@vercel/functions';

// Credentials and signing key are Vercel Environment Variables, never in the public repository.
const COOKIE_NAME = '__Host-yks_session';
const SESSION_SECONDS = 8 * 60 * 60;
const PBKDF2_ITERATIONS = 180000;
const encoder = new TextEncoder();

function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const pad = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

function redirect(location, cookie) {
  const headers = new Headers(noStoreHeaders);
  headers.set('Location', location);
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function unauthorized() {
  return redirect('/login');
}

function getEnv() {
  const name = process.env.YKS_AUTH_USERNAME;
  const salt = process.env.YKS_AUTH_SALT;
  const hash = process.env.YKS_AUTH_HASH;
  const secret = process.env.YKS_AUTH_SECRET;
  if (!name || !salt || !hash || !secret) return null;
  return { name, salt, hash, secret };
}

async function signatureKey(env) {
  return crypto.subtle.importKey('raw', fromBase64Url(env.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeSession(env) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const random = crypto.getRandomValues(new Uint8Array(16));
  const payload = 'v1.' + expiry + '.' + toBase64Url(random);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signatureKey(env), encoder.encode(payload)));
  return payload + '.' + toBase64Url(signature);
}

async function hasSession(request, env) {
  if (!env) return false;
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(/(?:^|;\s*)__Host-yks_session=([^;]+)/);
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1]) ||
      !/^[a-zA-Z0-9_-]{20,24}$/.test(parts[2]) || !/^[a-zA-Z0-9_-]{42,45}$/.test(parts[3])) return false;
  const expiry = Number(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + SESSION_SECONDS) return false;
  try {
    const payload = parts.slice(0, 3).join('.');
    return await crypto.subtle.verify('HMAC', await signatureKey(env), fromBase64Url(parts[3]), encoder.encode(payload));
  } catch {
    return false;
  }
}

async function checkPassword(password, env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64Url(env.salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  ));
  const stored = fromBase64Url(env.hash);
  if (stored.length !== 32) return false;
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= derived[i] ^ stored[i];
  return difference === 0;
}

function loginCookie(session) {
  return COOKIE_NAME + '=' + session + '; Max-Age=' + SESSION_SECONDS + '; Path=/; HttpOnly; Secure; SameSite=Lax';
}

function clearCookie() {
  return COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const env = getEnv();

  // The sign-in UI is the only publicly accessible page.
  if (path === '/login.html') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
    return next();
  }

  // Dedicated Vercel Function handles credential validation, not middleware.
  if (path === '/api/login') {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { ...noStoreHeaders, Allow: 'POST' } });
    return next();
  }

  if (path === '/login') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: noStoreHeaders });
    if (await hasSession(request, env)) return redirect('/');
    return rewrite(new URL('/login.html', request.url));
  }

  if (path === '/logout') {
    if (request.method !== 'POST') return redirect('/login');
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
    return redirect('/login', clearCookie());
  }

  // Fail closed: all app routes (including /index.html and static assets)
  // require a valid signed session before any files are returned.
  if (await hasSession(request, env)) return next();
  return unauthorized();
}
