import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { browserFetch } from './browser-transport';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('native browser transport preserves POSTs, profiles, redirects and cancellation', async (t) => {
  delete process.env.PHAROL_WEB_TRANSPORT;
  const requests: { path?: string; method?: string; ua?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, ua: req.headers['user-agent'], body });
    if (req.url === '/redirect') {
      res.writeHead(303, { Location: '/echo' }).end();
    } else if (req.url !== '/slow') {
      res.end('response text');
    }
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = await listen(server);
  const response = await browserFetch(`${url}/echo`, {
    method: 'POST', body: 'q=search+terms', headers: { 'User-Agent': 'mismatched browser' },
  }, 'firefox144');
  assert.equal(await response.text(), 'response text');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body, 'q=search+terms');
  assert.match(requests[0].ua!, /Firefox\/144/);
  const manual = await browserFetch(`${url}/redirect`, { redirect: 'manual' });
  assert.equal(manual.status, 303);
  await manual.text();
  assert.equal(requests.length, 2);
  const followed = await browserFetch(`${url}/redirect`, { method: 'POST', body: 'query' });
  assert.equal(await followed.text(), 'response text');
  assert.equal(requests.at(-1)?.path, '/echo');
  assert.equal(requests.at(-1)?.method, 'GET');
  assert.match(requests.at(-1)?.ua ?? '', /Chrome\/142/);
  await assert.rejects(browserFetch(`${url}/slow`, { signal: AbortSignal.timeout(50) }),
    (error: unknown) => error instanceof Error && error.name === 'TimeoutError');
});

test('native transport rejects an untrusted self-signed TLS certificate', async (t) => {
  // This fixture contains only a disposable test key/certificate, never credentials.
  const pem = readFileSync(new URL('./fixtures/self-signed-test.pem', import.meta.url));
  const server = createSecureServer({ key: pem, cert: pem }, (_req, res) => res.end('untrusted'));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = (await listen(server)).replace('http:', 'https:');
  await assert.rejects(browserFetch(url, { signal: AbortSignal.timeout(2000) }),
    (error: unknown) => error instanceof Error && /cert|tls/i.test(error.message));
});

test('ordinary-fetch comparison is explicit and keeps matching browser identity', async (t) => {
  process.env.PHAROL_WEB_TRANSPORT = 'fetch';
  t.after(() => { delete process.env.PHAROL_WEB_TRANSPORT; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.match(new Headers(init.headers).get('user-agent')!, /Firefox\/144/);
    assert.equal(init.redirect, 'manual');
    return new Response('ordinary transport');
  });
  const response = await browserFetch('https://example.org', { redirect: 'manual' }, 'firefox144');
  assert.equal(await response.text(), 'ordinary transport');
});
