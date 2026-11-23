import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as answerPOST } from '../app/api/answer/route';
import { POST as mcpPOST } from '../app/api/mcp/route';
import { GET as readerGET } from '../app/api/reader/route';
import {
  assertPublicHttpUrl,
  isPrivateOrReservedIp,
  parsePublicHttpUrl,
  readBoundedText,
  ResponseTooLargeError,
  UnsafeUrlError,
} from './url-guard';

test('parsePublicHttpUrl allows public HTTP(S) URLs and rejects private, internal, and non-web URLs', () => {
  assert.equal(parsePublicHttpUrl('https://example.org/article').hostname, 'example.org');
  assert.equal(parsePublicHttpUrl('http://93.184.215.14/test').hostname, '93.184.215.14');
  assert.equal(isPrivateOrReservedIp('93.184.215.14'), false);
  assert.equal(isPrivateOrReservedIp('2606:2800:220:1:248:1893:25c8:1946'), false);

  const blocked = [
    '',
    'file:///etc/passwd',
    'ftp://example.org/file',
    'javascript:alert(1)',
    'https://user:pass@example.org/',
    'http://localhost:3000/',
    'http://app.localhost/',
    'http://printer.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://redis:6379/',
    'http://127.0.0.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'http://172.16.5.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:7f00:1]/',
    'http://[64:ff9b::10.0.0.1]/',
  ];

  for (const target of blocked) {
    assert.throws(() => parsePublicHttpUrl(target), UnsafeUrlError, `Expected rejection for ${target}`);
  }
});

test('assertPublicHttpUrl blocks hostnames that resolve to private or metadata IPs', async () => {
  await assert.doesNotReject(
    assertPublicHttpUrl('https://public.example/page', async () => [{ address: '93.184.215.14' }])
  );
  await assert.rejects(
    assertPublicHttpUrl('https://rebind.example/page', async () => [{ address: '127.0.0.1' }]),
    UnsafeUrlError
  );
  await assert.rejects(
    assertPublicHttpUrl('https://mixed.example/page', async () => [
      { address: '93.184.215.14' },
      { address: '169.254.169.254' },
    ]),
    UnsafeUrlError
  );
  await assert.rejects(
    assertPublicHttpUrl('https://ula.example/page', async () => [{ address: 'fd00::1' }]),
    UnsafeUrlError
  );
});

test('readBoundedText enforces maximum byte size from headers and streams', async () => {
  const ok = await readBoundedText(new Response('hello world'), 64);
  assert.equal(ok, 'hello world');

  await assert.rejects(
    readBoundedText(new Response('x', { headers: { 'content-length': '2048' } }), 1024),
    ResponseTooLargeError
  );

  const bigStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(600));
      controller.enqueue(new Uint8Array(600));
      controller.close();
    },
  });
  await assert.rejects(readBoundedText(new Response(bigStream), 1024), ResponseTooLargeError);
});

test('/api/reader and keyless /api/mcp read_webpage block SSRF targets and unsafe redirects', async (t) => {
  const fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const href = String(input);
    fetched.push(href);
    if (href === 'https://example.org/bounce') {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
    }
    return new Response(null, { status: 503 });
  });

  const directBlocked = await readerGET(
    new NextRequest('https://pharol.example/api/reader?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F')
  );
  assert.equal(directBlocked.status, 400);
  assert.equal(fetched.length, 0);

  const mcpBlocked = await mcpPOST(
    new NextRequest('https://pharol.example/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'read_webpage', arguments: { url: 'http://127.0.0.1:3000/api/capabilities' } },
      }),
    })
  );
  assert.equal(mcpBlocked.status, 400);
  const mcpPayload = await mcpBlocked.json();
  assert.equal(mcpPayload.error?.code, -32602);
  assert.equal(fetched.length, 0);

  const redirectBlocked = await readerGET(
    new NextRequest('https://pharol.example/api/reader?url=https%3A%2F%2Fexample.org%2Fbounce')
  );
  assert.equal(redirectBlocked.status, 400);
  assert.deepEqual(fetched, ['https://example.org/bounce']);
});

test('/api/answer enforces body size limits, JSON validation, and public URL checks before Jina enrichment', async (t) => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  });

  const badJson = await answerPOST(
    new NextRequest('https://pharol.example/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    })
  );
  assert.equal(badJson.status, 400);

  const tooBig = await answerPOST(
    new NextRequest('https://pharol.example/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', pad: 'a'.repeat(70 * 1024) }),
    })
  );
  assert.equal(tooBig.status, 413);

  const fallbackRes = await answerPOST(
    new NextRequest('https://pharol.example/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Lisbon trams',
        results: [
          {
            id: '1',
            title: 'Lisbon tram network',
            url: 'https://example.org/trams',
            displayedUrl: 'example.org',
            snippet: 'Historic tram routes operate across central Lisbon neighborhoods.',
            engine: 'bing',
            category: 'all',
          },
        ],
      }),
    })
  );
  assert.equal(fallbackRes.status, 200);
  assert.match(fallbackRes.headers.get('cache-control') ?? '', /no-store/);
  const fallbackData = await fallbackRes.json();
  assert.equal(fallbackData.provider, 'instant-synthesis');

  // With a key set, private URLs in results[] must never be forwarded to r.jina.ai
  process.env.GEMINI_API_KEY = 'fake-test-key';
  const fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    fetched.push(String(input));
    return new Response(null, { status: 503 });
  });

  const guarded = await answerPOST(
    new NextRequest('https://pharol.example/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'metadata probe',
        results: [
          {
            id: '1',
            title: 'Internal',
            url: 'http://169.254.169.254/latest/meta-data/',
            displayedUrl: '169.254.169.254',
            snippet: 'Internal snippet.',
            engine: 'bing',
            category: 'all',
          },
        ],
      }),
    })
  );
  assert.equal(guarded.status, 200);
  assert.ok(!fetched.some((url) => url.includes('r.jina.ai')));
});
