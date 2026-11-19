'use strict';
/**
 * Deterministic mock fetch for Pharol stress tests (CJS, Node >=20.18).
 *
 * Intercept: globalThis.fetch is replaced BEFORE app code runs.
 *   node --require stress/mock.cjs ...
 *   NODE_OPTIONS=--require stress/mock.cjs next start ...
 *
 * Environment:
 *   PHAROL_MOCK_LOG       JSONL file, append {ts,url,host,path,query,tavilyKeySuffix,firecrawlKeySuffix}
 *                         (if unset, logging disabled; no file is created)
 *   PHAROL_MOCK_DELAY_MS  default small delay, default 30
 *   TAVILY_API_KEY        expected Tavily key (default fake-tavily-key-TEST0001)
 *   FIRECRAWL_API_KEY     expected Firecrawl key (default fake-firecrawl-key-TEST0002)
 *   PHAROL_WEB_TRANSPORT  must be "fetch" for browser transport (caller sets it)
 *
 * Full keys are NEVER logged: only last-6 suffix (or "-" / "none").
 * No network access is ever attempted: unknown hosts get a fast 503.
 *
 * Behavior markers (checked against URL + body text, case-sensitive):
 *   "slow-"    -> delay 1200ms then normal success for that endpoint
 *   "timeout-" -> delay 6000ms (server fetchWithTimeout is 3800ms => engine timeout;
 *                 reader direct timeout is 5000/6000ms => SIGINT test target)
 *   "quota429-" -> Tavily/Firecrawl endpoints: 429 (=> RateLimitQuotaError => cooldown)
 *                  other hosts: fast 503
 *   Isolation hook: quota429 applies ONLY when the presented key ends with "-A"
 *                  (i.e. fake-tavily-key-TEST0001-A) for Tavily, and "-A" suffix
 *                  for Firecrawl caller keys. The plain TEST0001 / TEST0002 keys
 *                  always succeed on quota429 queries. This proves per-key
 *                  cooldown isolation: key A gets 429/cooldown, key B succeeds.
 *                  (See run-protocol.cjs isolation section for rationale.)
 */

const fs = require('node:fs');

const LOG_FILE = process.env.PHAROL_MOCK_LOG || '';
const DEFAULT_DELAY_MS = Number(process.env.PHAROL_MOCK_DELAY_MS || 30);
const TAVILY_EXPECTED = process.env.TAVILY_API_KEY || 'fake-tavily-key-TEST0001';
const FIRECRAWL_EXPECTED = process.env.FIRECRAWL_API_KEY || 'fake-firecrawl-key-TEST0002';

// Alternate caller keys accepted in addition to env keys (isolation test needs two scopes).
const TAVILY_ALT = 'fake-tavily-key-TEST0001-B';
const FIRECRAWL_ALT = 'fake-firecrawl-key-TEST0002-B';

function suffix(key) {
  if (!key) return 'none';
  return key.length > 6 ? key.slice(-6) : key;
}

function log(entry) {
  if (!LOG_FILE) return;
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // logging must never crash the app under test
  }
}

function sleep(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const err = signal?.reason || Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    if (signal?.aborted) return reject(err);
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(err); };
    const cleanup = () => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getHeader(headers, name) {
  if (!headers) return '';
  try {
    return new Headers(headers).get(name) || '';
  } catch {
    if (typeof headers === 'object' && !Array.isArray(headers)) {
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === name.toLowerCase()) return String(v);
      }
    }
    return '';
  }
}

function bodyText(init) {
  const b = init && init.body;
  if (b === undefined || b === null) return '';
  if (typeof b === 'string') return b;
  try { return String(b); } catch { return ''; }
}

function extractKey(init) {
  const auth = getHeader(init.headers, 'authorization');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const tavilyHeader = getHeader(init.headers, 'x-pharol-tavily-key');
  const firecrawlHeader = getHeader(init.headers, 'x-pharol-firecrawl-key');
  const xApiKey = getHeader(init.headers, 'x-api-key');
  return { bearer, tavilyHeader, firecrawlHeader, xApiKey };
}

function tavilyKeyFor(init) {
  const k = extractKey(init);
  return k.tavilyHeader || k.bearer;
}

function firecrawlKeyFor(init) {
  const k = extractKey(init);
  return k.firecrawlHeader || k.bearer;
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Fixtures (mirrors scripts/fixtures/cli-fetch.cjs) ---

const FIXTURE_OPENING = 'The reading preview should show the article itself, rather than showing a summary from a search-results page. ';
const FIXTURE_CLOSING = 'The shared reader preserves the order of the text and produces structured blocks that both the application and CLI can display. ';

function fixtureHtml() {
  return `<article><h1>Fixture article</h1><p>${FIXTURE_OPENING.repeat(3)}</p><p>${FIXTURE_CLOSING.repeat(3)}</p></article>`;
}

function thinHtml() {
  // One short paragraph (<350 chars) so direct extraction fails and reader falls back to Firecrawl.
  return '<article><h1>Thin fixture</h1><p>Short placeholder text.</p></article>';
}

function fallbackMarkdown() {
  return 'This article came from the configured fallback provider, using the same extraction chain as the web preview. '.repeat(4);
}

// --- Handler ---

async function mockFetch(input, init) {
  const urlString = typeof input === 'string' ? input : String(input && input.url ? input.url : input);
  let url;
  try { url = new URL(urlString); }
  catch { return new Response(null, { status: 503 }); }

  const method = String((init && init.method) || 'GET').toUpperCase();
  const body = bodyText(init);
  const haystack = `${urlString}\n${body}`;
  const hasSlow = haystack.includes('slow-');
  const hasTimeout = haystack.includes('timeout-');
  const hasQuota = haystack.includes('quota429-');

  const tKey = tavilyKeyFor(init);
  const fKey = firecrawlKeyFor(init);

  log({
    ts: new Date().toISOString(),
    url: urlString,
    host: url.host,
    path: url.pathname,
    query: url.searchParams.get('q') || '',
    tavilyKeySuffix: suffix(tKey || (url.host.includes('tavily') ? getHeader(init.headers, 'authorization').replace(/^Bearer\s+/i, '') : '')),
    firecrawlKeySuffix: suffix(fKey || (url.host.includes('firecrawl') ? getHeader(init.headers, 'authorization').replace(/^Bearer\s+/i, '') : '')),
  });

  // Determine delay (fast 503 for unknown hosts skips the extra delay).
  const isKnownHost =
    url.host === 'api.tavily.com' ||
    url.host === 'api.firecrawl.dev' ||
    url.host === 'example.org';
  let delayMs = DEFAULT_DELAY_MS;
  if (hasTimeout) delayMs = 6000;
  else if (hasSlow) delayMs = 1200;
  if (!isKnownHost) delayMs = Math.min(delayMs, 0); // fast, no delay beyond zero

  if (delayMs > 0) await sleep(delayMs, init?.signal);

  // ---- Tavily search ----
  if (url.href === 'https://api.tavily.com/search' && method === 'POST') {
    // Quota: 429 only for key-A scope (isolation). Plain/B keys succeed.
    if (hasQuota) {
      if (tKey.endsWith('-A') || tKey === 'fake-tavily-key-TEST0001-A') {
        return jsonResponse(429, { error: 'Rate limit exceeded' });
      }
      // Fall through to success for key B / operator key (proves isolation).
    }
    const ok =
      tKey === TAVILY_EXPECTED ||
      tKey === TAVILY_ALT ||
      tKey === 'fake-tavily-key-TEST0001-A' ||
      tKey === 'fake-tavily-key-TEST0001-B' ||
      getHeader(init.headers, 'x-tavily-access-mode') === 'keyless';
    if (!ok) return new Response(null, { status: 401 });
    let query = '';
    try { query = JSON.parse(body).query || ''; } catch { query = ''; }
    return jsonResponse(200, {
      results: [{
        title: query,
        url: 'https://example.org/fixture',
        content: 'Fixture result for ' + query,
        score: 0.9,
      }],
    });
  }

  // ---- Reader fixtures (example.org) ----
  if (url.host === 'example.org') {
    if (hasQuota) return new Response(null, { status: 503 }); // non-provider => 503 fast
    if (url.href === 'https://example.org/reader-fixture') {
      return new Response(fixtureHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (url.href === 'https://example.org/reader-fallback') {
      return new Response(thinHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (url.href === 'https://example.org/slow' || hasSlow) {
      return new Response(fixtureHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    // Any other example.org path (including timeout-reader) => 503 fast
    return new Response(null, { status: 503 });
  }

  // ---- Firecrawl scrape ----
  if (url.href === 'https://api.firecrawl.dev/v2/scrape' && method === 'POST') {
    if (hasQuota) {
      if (fKey.endsWith('-A')) return jsonResponse(429, { error: 'Rate limit exceeded' });
      // else succeed (isolation)
    }
    const ok =
      fKey === FIRECRAWL_EXPECTED ||
      fKey === FIRECRAWL_ALT ||
      fKey === 'fake-firecrawl-key-TEST0002-A' ||
      fKey === 'fake-firecrawl-key-TEST0002-B' ||
      fKey === '';
    // Reader calls firecrawl with key only when configured; empty key should
    // still succeed for the fallback fixture (matches real behavior where
    // keyless scrape is attempted). Wrong non-empty key is rejected to catch leaks.
    if (fKey && !ok) return new Response(null, { status: 401 });
    let targetUrl = '';
    try { targetUrl = JSON.parse(body).url || ''; } catch { targetUrl = ''; }
    if (targetUrl === 'https://example.org/reader-fallback') {
      return jsonResponse(200, {
        data: { markdown: fallbackMarkdown(), metadata: { title: 'Fixture fallback article' } },
      });
    }
    return jsonResponse(404, { error: 'Not found' });
  }

  // ---- Any other URL: fast 503, never hit network ----
  return new Response(null, { status: 503 });
}

globalThis.fetch = mockFetch;
globalThis.__pharolMockInstalled = true;

// POST-GC metrics listener (test harness only): surfaces server-process
// memoryUsage after a forced GC so soak baselines are comparable.
// Disable with PHAROL_METRICS_PORT=0. No prod code touched.
try {
  const http = require('node:http');
  const port = Number(process.env.PHAROL_METRICS_PORT || 0);
  if (port > 0) {
    const server = http.createServer((req, res) => {
      if (req.url !== '/__metrics' || req.method !== 'GET') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      try {
        if (typeof globalThis.gc === 'function') globalThis.gc();
        const m = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          heapUsedBytes: m.heapUsed,
          heapTotalBytes: m.heapTotal,
          externalBytes: m.external,
          arrayBuffersBytes: m.arrayBuffers,
          rssBytes: m.rss,
          gcAvailable: typeof globalThis.gc === 'function',
          pid: process.pid,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
    });
    server.on('error', () => {
      // EADDRINUSE: another worker in the same Next process already bound it.
      // Expected: Next starts multiple workers; only one wins. Metrics still work.
    });
    server.listen(port, '127.0.0.1', () => {
      // No logging of keys; metrics only.
    });
    server.unref();
  }
} catch {
  // Metrics are best-effort; never crash the app under test.
}
