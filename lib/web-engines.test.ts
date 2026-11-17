import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebRequest, parseWebResponse, searchWebEngine, WebEngineError } from './web-engines';
import { runMetasearch } from './server-search';
import { clearSearchCache } from './server-cache';
import { Impit, ReadTimeout } from 'impit';

// These tests mock ordinary fetch; the native transport is tested separately.
process.env.PHAROL_WEB_TRANSPORT = 'fetch';

const options = { query: 'climate research', page: 1, region: 'pt-PT', timeRange: 'all' } as const;
const googleHtml = `<div class="zMzFAb"><a class="fuLhoc" href="/url?q=https%3A%2F%2Fexample.org%2Fpaper"><span class="CVA68e">Climate &amp; research</span></a><span class="FrIlee"><span class="fYyStc YVIcad">Date</span><span class="fYyStc">Published findings</span></span></div>`;
const ddgHtml = `<div id="links"><div class="web-result"><h2><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpaper">Climate research</a></h2><a class="result__snippet">Published findings</a></div><div class="web-result result--ad"><h2><a href="https://ad.example.org">Ad</a></h2></div></div><form><input name="vqd" value="test-token"></form>`;

test('native requests retain Google locale/time/paging and Bing uses HTML with upstream limits', () => {
  const spec = buildWebRequest('google', { ...options, page: 2, timeRange: 'month' })!;
  const url = new URL(spec.url);
  assert.equal(url.searchParams.get('start'), '10');
  assert.equal(url.searchParams.get('tbs'), 'qdr:m');
  assert.equal(url.searchParams.get('lr'), 'lang_pt');
  assert.equal(url.searchParams.get('cr'), 'countryPT');
  assert.deepEqual(url.searchParams.getAll('adtest'), ['on', 'preview']);
  assert.equal(new Headers(spec.init.headers).get('Cookie'), 'CONSENT=YES+');
  const bing = new URL(buildWebRequest('bing', options)!.url);
  assert.equal(bing.searchParams.has('format'), false);
  assert.equal(bing.searchParams.get('cc'), 'pt');
  assert.equal(buildWebRequest('bing', { ...options, page: 2 }), null);
  assert.equal(buildWebRequest('bing', { ...options, timeRange: 'day' }), null);
});

test('HTML parsers extract organic results, unwrap redirects, reject unsafe URLs and exclude ads', () => {
  const google = parseWebResponse('google', googleHtml, 'https://www.google.com/search', 1).results;
  assert.equal(google[0].url, 'https://example.org/paper');
  assert.equal(google[0].title, 'Climate & research');
  assert.equal(google[0].snippet, 'Published findings');
  const encoded = Buffer.from('https://example.org/paper').toString('base64url');
  const bing = parseWebResponse('bing', `<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">Climate research</a></h2><p><span class="algoSlug_icon">Icon</span>Published findings</p></li><li class="b_algo"><h2><a href="javascript:alert(1)">Bad</a></h2></li></ol>`, 'https://www.bing.com/search', 1).results;
  assert.equal(bing.length, 1);
  assert.equal(bing[0].url, 'https://example.org/paper');
  assert.equal(bing[0].snippet, 'Published findings');
  const ddg = parseWebResponse('duckduckgo', ddgHtml, 'https://html.duckduckgo.com/html/', 1);
  assert.equal(ddg.results.length, 1);
  assert.equal(ddg.results[0].url, 'https://example.org/paper');
  assert.equal(ddg.vqd, 'test-token');
});

test('challenge pages become cooldown errors rather than empty successes', () => {
  for (const [engine, html, url] of [
    ['google', '', 'https://www.google.com/sorry/index'],
    ['google', '<a href="/httpservice/retry/enablejs">Enable JavaScript</a>', 'https://www.google.com/search'],
    ['bing', '<div id="b_captcha"></div>', 'https://www.bing.com/search'],
    ['duckduckgo', '<form id="challenge-form"></form>', 'https://html.duckduckgo.com/html/'],
  ] as const) {
    assert.throws(() => parseWebResponse(engine, html, url, 1),
      (error: unknown) => error instanceof WebEngineError && error.status === 'cooldown');
  }
});

test('native body-read timeouts are reported as engine timeouts', async (t) => {
  delete process.env.PHAROL_WEB_TRANSPORT;
  t.after(() => { process.env.PHAROL_WEB_TRANSPORT = 'fetch'; });
  t.mock.method(Impit.prototype, 'fetch', async () => ({
    ok: true, status: 200, url: 'https://www.google.com/search',
    text: async () => { throw new ReadTimeout('Body stalled'); },
  }));
  await assert.rejects(searchWebEngine('google', options),
    (error: unknown) => error instanceof WebEngineError && error.status === 'timeout');
});

test('DDG bootstraps missing pagination tokens once and reuses them with correct POST offsets', async (t) => {
  const bodies: URLSearchParams[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(init.method, 'POST');
    bodies.push(new URLSearchParams(String(init.body)));
    return new Response(ddgHtml);
  });
  const query = { ...options, query: 'pagination fixture', page: 2, timeRange: 'week' } as const;
  assert.equal((await searchWebEngine('duckduckgo', query)).length, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].get('b'), '');
  assert.equal(bodies[1].get('vqd'), 'test-token');
  assert.equal(bodies[1].get('s'), '10');
  assert.equal(bodies[1].get('dc'), '11');
  assert.equal(bodies[1].get('df'), 'w');
  await searchWebEngine('duckduckgo', { ...query, page: 3 });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].get('s'), '25');
  assert.equal(bodies[2].get('dc'), '26');
});

test('metasearch honors engine selection, query operators, streaming and block health', async (t) => {
  clearSearchCache();
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === 'www.google.com') return new Response(googleHtml);
    if (url.hostname === 'www.bing.com' && url.pathname === '/search') return new Response('', { status: 429 });
    throw new Error('Unselected upstream');
  });
  let batches = 0;
  const result = await runMetasearch({
    rawQuery: 'climate "research" site:example.org -ads', category: 'all',
    enginesParam: 'google,bing', region: 'pt-PT', onBatch: () => { batches++; },
  });
  const google = requests.find((url) => url.hostname === 'www.google.com')!;
  assert.equal(google.searchParams.get('q'), 'climate "research" -ads site:example.org');
  assert.equal(result.results[0].engine, 'google');
  assert.ok(result.enginesUsed.includes('google'));
  assert.equal(result.engineHealth?.find((health) => health.engine === 'bing')?.status, 'cooldown');
  assert.equal(result.engineHealth?.find((health) => health.engine === 'duckduckgo')?.status, 'disabled');
  assert.ok(batches > 0);
  assert.ok(!requests.some((url) => url.hostname.endsWith('duckduckgo.com')));
  const cooled = await runMetasearch({
    rawQuery: 'another climate query', category: 'all', enginesParam: 'bing',
  });
  assert.equal(cooled.engineHealth?.find((health) => health.engine === 'bing')?.status, 'cooldown');
  assert.equal(requests.filter((url) => url.hostname === 'www.bing.com' && url.pathname === '/search').length, 1);
  clearSearchCache();
});
