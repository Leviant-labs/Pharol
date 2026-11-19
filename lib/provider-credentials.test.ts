import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '../app/api/providers/route';
import { openProviders, sealProviders, patchProviders, requestProviders, PROVIDER_COOKIE } from './provider-credentials';

process.env.PHAROL_CREDENTIAL_SECRET = randomBytes(32).toString('hex');
const origin = 'https://pharol.example';
function request(method = 'GET', body?: unknown, cookie?: string, source = origin) {
  return new NextRequest(`${origin}/api/providers`, {
    method, headers: { Origin: source, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('saved credentials are authenticated, encrypted, expiring and invalidated by key rotation', () => {
  const config = { openAlexApiKey: 'private-openalex-token' };
  const sealed = sealProviders(config, 1000);
  assert.ok(!sealed.includes(config.openAlexApiKey));
  assert.deepEqual(openProviders(sealed, 2000), config);
  assert.deepEqual(openProviders(sealed, 1000 + 8 * 3600_000), {});
  const bytes = Buffer.from(sealed, 'base64url'); bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(openProviders(bytes.toString('base64url'), 2000), {});
  const secret = process.env.PHAROL_CREDENTIAL_SECRET;
  process.env.PHAROL_CREDENTIAL_SECRET = randomBytes(32).toString('hex');
  assert.deepEqual(openProviders(sealed, 2000), {});
  process.env.PHAROL_CREDENTIAL_SECRET = secret;
});

test('provider validation rejects unknown fields, oversized keys and header injection', () => {
  for (const patch of [{ unknown: 'value' }, { openAlexApiKey: 'x'.repeat(513) }, { openAlexApiKey: 'token\r\nInjected: true' }, { openAlexApiKey: 'Bearer token' }]) {
    assert.throws(() => patchProviders({}, patch));
  }
  assert.throws(() => patchProviders({}, { bogusKey: 'value' }), /Unknown provider setting: bogusKey/);
  assert.throws(() => patchProviders({}, { tavilyApiKey: 'tvly key' }), /Invalid value for tavilyApiKey/);
  assert.deepEqual(patchProviders({ openAlexApiKey: 'old', coreApiKey: 'keep' }, { openAlexApiKey: null }), { coreApiKey: 'keep' });
});

test('every remaining keyless provider accepts a saved user key', () => {
  const saved = patchProviders({}, {
    tavilyApiKey: 'tvly-1', parallelApiKey: 'parallel-1',
    keenableApiKey: 'keenable-1', tinyfishApiKey: 'tinyfish-1',
  });
  assert.deepEqual(saved, {
    tavilyApiKey: 'tvly-1', parallelApiKey: 'parallel-1',
    keenableApiKey: 'keenable-1', tinyfishApiKey: 'tinyfish-1',
  });
  assert.deepEqual(patchProviders(saved, { tinyfishApiKey: null }), {
    tavilyApiKey: 'tvly-1', parallelApiKey: 'parallel-1', keenableApiKey: 'keenable-1',
  });
});

test('settings return boolean status only and set HttpOnly/SameSite cookies; removal clears them', async () => {
  const response = await PATCH(request('PATCH', { openAlexApiKey: 'never-echo-this-key' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=strict/i); assert.match(cookie, /Path=\//i);
  assert.ok(!cookie.includes('never-echo-this-key'));
  const saved = cookie.split(';')[0];
  const status = await GET(request('GET', undefined, saved));
  const text = await status.text();
  assert.ok(!text.includes('never-echo-this-key')); assert.equal(JSON.parse(text).configured.openAlexApiKey, true);
  assert.match(status.headers.get('cache-control')!, /no-store/);
  const removed = await DELETE(request('DELETE', undefined, saved));
  assert.match(removed.headers.get('set-cookie')!, /Max-Age=0/i);
});

test('settings fail closed for cross-origin writes and missing encryption configuration', async () => {
  assert.equal((await PATCH(request('PATCH', { openAlexApiKey: 'token' }, undefined, 'https://attacker.example'))).status, 403);
  assert.equal((await DELETE(request('DELETE', undefined, undefined, 'https://attacker.example'))).status, 403);
  const secret = process.env.PHAROL_CREDENTIAL_SECRET;
  delete process.env.PHAROL_CREDENTIAL_SECRET;
  assert.equal((await PATCH(request('PATCH', { openAlexApiKey: 'token' }))).status, 503);
  process.env.PHAROL_CREDENTIAL_SECRET = secret;
});

test('browser credentials stay isolated by cookie and are ignored for cross-origin requests', () => {
  const first = `${PROVIDER_COOKIE}=${sealProviders({ openAlexApiKey: 'alice-key' })}`;
  const second = `${PROVIDER_COOKIE}=${sealProviders({ openAlexApiKey: 'bob-key' })}`;
  assert.equal(requestProviders(request('GET', undefined, first)).openAlexApiKey, 'alice-key');
  assert.equal(requestProviders(request('GET', undefined, second)).openAlexApiKey, 'bob-key');
  assert.equal(requestProviders(request('GET', undefined, first, 'https://attacker.example')).openAlexApiKey, undefined);
  assert.deepEqual(requestProviders(request()), {});
});

test('standalone bind addresses use the destination Host for origin checks', async () => {
  const req = new NextRequest('http://0.0.0.0:3000/api/providers', {
    method: 'PATCH', headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ openAlexApiKey: 'test-only-key' }),
  });
  assert.equal((await PATCH(req)).status, 200);
});

test('settings name the rejected field instead of a generic error', async () => {
  const response = await PATCH(request('PATCH', { notAKey: 'value' }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown provider setting: notAKey/);
  const malformed = await PATCH(new NextRequest(`${origin}/api/providers`, {
    method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: 'openAlexApiKey=plain-secret',
  }));
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('plain-secret'));
});

test('settings reject oversized bodies, missing origins, and hosted plaintext HTTP', async () => {
  assert.equal((await PATCH(request('PATCH', { openAlexApiKey: 'x'.repeat(9000) }))).status, 413);
  const withoutOrigin = new NextRequest(`${origin}/api/providers`, { method: 'DELETE' });
  assert.equal((await DELETE(withoutOrigin)).status, 403);
  const insecure = new NextRequest('http://pharol.example/api/providers', {
    method: 'PATCH', headers: { Origin: 'http://pharol.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal((await PATCH(insecure)).status, 400);
});
