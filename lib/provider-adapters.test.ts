import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { POST as mcpPOST } from '../app/api/mcp/route';
import { GET as newsGET } from '../app/api/news/route';
import { GET as readerGET } from '../app/api/reader/route';
import { GET as searchGET } from '../app/api/search/route';
import { GET as streamGET } from '../app/api/search/stream/route';
import { readOperatorProviders, resolveProviderConfig } from './provider-config';
import { PROVIDER_COOKIE, sealProviders } from './provider-credentials';
import { clearSearchCache } from './server-cache';
import { runMetasearch } from './server-search';

const origin = 'https://pharol.example';
const articleUrl = 'https://example.org/report';
const readerPath = `/api/reader?url=${encodeURIComponent(articleUrl)}`;
const newsPath = '/api/news?q=fixture&region=global';
const operatorKeys = {
  EXA_API_KEY: 'operator-exa', FIRECRAWL_API_KEY: 'operator-firecrawl',
  TAVILY_API_KEY: 'operator-tavily', PARALLEL_API_KEY: 'operator-parallel',
  KEENABLE_API_KEY: 'operator-keenable', TINYFISH_API_KEY: 'operator-tinyfish',
  OPENALEX_API_KEY: 'operator-openalex',
};
const browserKeys = Object.fromEntries(Object.entries(readOperatorProviders(operatorKeys))
  .map(([field, value]) => [field, value.replace('operator-', 'browser-')]));

function fixture(t: TestContext, env: Partial<Record<keyof typeof operatorKeys, string>> = operatorKeys) {
  const settings = { ...Object.fromEntries(Object.keys(operatorKeys).map((key) => [key, undefined])), ...env,
    PHAROL_CREDENTIAL_SECRET: randomBytes(32).toString('hex'), PHAROL_ORIGIN: origin };
  for (const [key, value] of Object.entries(settings)) {
    const oldValue = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    });
  }
  clearSearchCache();
  t.after(clearSearchCache);
  const cookie = `${PROVIDER_COOKIE}=${sealProviders(browserKeys)}`;
  const calls = new Map<string, Headers>();
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    calls.set(`${url.host}${url.pathname}`, new Headers(init?.headers));
    if (url.host === 'api.openalex.org' && url.pathname === '/rate-limit') return Response.json({ daily: { remaining: 5 } });
    return new Response(null, { status: 503 });
  });
  const header = (target: string, name: string) => {
    assert.ok(calls.has(target), `Expected a request to ${target}`);
    return calls.get(target)?.get(name);
  };
  return { calls, cookie, header };
}

function mcpCall(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  return mcpPOST(new NextRequest(`${origin}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
}

test('provider configuration resolves user keys, then defaults, and omits unset keys', () => {
  const providerDefaults = readOperatorProviders({ FIRECRAWL_API_KEY: ' operator ', EXA_API_KEY: ' default-exa ', OPENALEX_API_KEY: ' ' });
  assert.deepEqual(resolveProviderConfig({ providerDefaults, userConfig: { firecrawlApiKey: ' user ', exaApiKey: ' ' } }), {
    exaApiKey: 'default-exa', firecrawlApiKey: 'user',
  });
  assert.deepEqual(resolveProviderConfig(), {});
});

test('search, streaming and the metasearch news category use the same key precedence', async (t) => {
  const { cookie, header, calls } = fixture(t);
  const base = `${origin}/api/search`;
  const params = '?q=provider%20fixture&region=global&engines=exa,firecrawl,tavily,parallel,keenable,tinyfish';
  const selected = [
    ['mcp.exa.ai/mcp', 'x-api-key', 'exa'], ['api.firecrawl.dev/v2/search', 'authorization', 'firecrawl'],
    ['api.tavily.com/search', 'authorization', 'tavily'], ['search.parallel.ai/mcp', 'x-api-key', 'parallel'],
    ['api.keenable.ai/mcp', 'x-api-key', 'keenable'], ['agent.tinyfish.ai/mcp', 'x-api-key', 'tinyfish'],
  ];
  const response = await searchGET(new NextRequest(base + params, { headers: { cookie } }));
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /browser-|operator-/);
  for (const [target, name, provider] of selected) {
    assert.equal(header(target, name), `${name === 'authorization' ? 'Bearer ' : ''}browser-${provider}`);
  }
  calls.clear();
  const stream = await streamGET(new NextRequest(`${base}/stream${params}`));
  assert.match(await stream.text(), /event: done/);
  for (const [target, name, provider] of selected) {
    assert.equal(header(target, name), `${name === 'authorization' ? 'Bearer ' : ''}operator-${provider}`);
  }
  calls.clear();
  await searchGET(new NextRequest(`${base}${params}&category=news`, { headers: { cookie } }));
  assert.equal(header('api.firecrawl.dev/v2/search', 'authorization'), 'Bearer browser-firecrawl');
});

test('news and reader share HTTP/MCP credential handling and keep browser keys same-origin', async (t) => {
  const { cookie, header, calls } = fixture(t);
  const news = await newsGET(new NextRequest(origin + newsPath));
  assert.match(news.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(header('api.firecrawl.dev/v2/search', 'authorization'), 'Bearer operator-firecrawl');
  assert.equal(header('api.tavily.com/search', 'authorization'), 'Bearer operator-tavily');
  assert.equal(header('agent.tinyfish.ai/mcp', 'x-api-key'), 'operator-tinyfish');
  calls.clear();
  const reader = await readerGET(new NextRequest(origin + readerPath));
  assert.match(reader.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(header('api.firecrawl.dev/v2/scrape', 'authorization'), 'Bearer operator-firecrawl');
  assert.equal(header('api.keenable.ai/mcp', 'x-api-key'), 'operator-keenable');
  assert.equal(header('example.org/report', 'authorization'), null);
  calls.clear();
  const mcpReader = await mcpCall('read_webpage', { url: articleUrl }, { origin, cookie, 'x-pharol-firecrawl-key': 'explicit-firecrawl' });
  assert.equal(mcpReader.status, 200);
  assert.doesNotMatch(await mcpReader.text(), /explicit-firecrawl|browser-keenable/);
  assert.equal(header('api.firecrawl.dev/v2/scrape', 'authorization'), 'Bearer explicit-firecrawl');
  assert.equal(header('api.keenable.ai/mcp', 'x-api-key'), 'browser-keenable');
  calls.clear();
  await mcpCall('news_search', { query: 'fixture' }, { origin, cookie });
  assert.equal(header('api.firecrawl.dev/v2/search', 'authorization'), 'Bearer browser-firecrawl');
  assert.equal(header('api.tavily.com/search', 'authorization'), 'Bearer browser-tavily');
  calls.clear();
  await mcpCall('news_search', { query: 'fixture' }, { origin: 'https://other.example', cookie });
  assert.equal(header('api.firecrawl.dev/v2/search', 'authorization'), 'Bearer operator-firecrawl');
  const badUrl = await readerGET(new NextRequest(origin + '/api/reader'));
  assert.equal(badUrl.status, 400);
  assert.deepEqual(await badUrl.json(), { error: 'Missing target URL' });
});

test('unconfigured providers keep keyless behavior and hosted OpenAlex receives explicit defaults', async (t) => {
  const { header } = fixture(t, { OPENALEX_API_KEY: 'operator-openalex' });
  await newsGET(new NextRequest(origin + newsPath));
  assert.equal(header('api.tavily.com/search', 'x-tavily-access-mode'), 'keyless');
  assert.equal(header('agent.tinyfish.ai/mcp', 'x-tinyfish-access-mode'), 'keyless');
  await readerGET(new NextRequest(origin + readerPath));
  assert.equal(header('api.keenable.ai/mcp-public', 'x-api-key'), null);
  assert.equal(header('api.firecrawl.dev/v2/scrape', 'authorization'), null);
  assert.equal((await mcpCall('openalex_status', {})).status, 200);
  assert.equal(header('api.openalex.org/rate-limit', 'authorization'), 'Bearer operator-openalex');
});

test('fast web limits fan-out, keeps its own cache, and preserves explicit selections and bangs', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  const oldTransport = process.env.PHAROL_WEB_TRANSPORT;
  process.env.PHAROL_WEB_TRANSPORT = 'fetch';
  t.after(() => { if (oldTransport === undefined) delete process.env.PHAROL_WEB_TRANSPORT; else process.env.PHAROL_WEB_TRANSPORT = oldTransport; });
  const hosts = new Set<string>();
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    hosts.add(url.host);
    if (url.host === 'api.tavily.com') {
      return Response.json({ results: [{ title: 'Light rail fixture', url: 'https://example.org/rail' }] });
    }
    return new Response(null, { status: 503 });
  });
  const options = { rawQuery: 'light rail timetables', category: 'all' as const, region: 'global' as const };
  const fast = await runMetasearch(options);
  assert.ok(fast.results.some(({ engine }) => engine === 'tavily'));
  assert.deepEqual([...hosts].sort(), [
    'agent.tinyfish.ai',
    'api.duckduckgo.com',
    'api.keenable.ai',
    'api.tavily.com',
    'en.wikipedia.org',
    'html.duckduckgo.com',
    'mcp.exa.ai',
    'search.parallel.ai',
  ]);
  assert.equal((await runMetasearch(options)).cacheHit, true);
  hosts.clear();
  assert.notEqual((await runMetasearch({ ...options, mode: 'full' })).cacheHit, true);
  assert.ok(hosts.has('www.bing.com'));
  assert.ok(hosts.has('freeserp.ai'));
  assert.ok(hosts.has('api.github.com'));
  hosts.clear();
  await runMetasearch({ ...options, enginesParam: 'freeserp' });
  assert.ok(hosts.has('freeserp.ai'));
  hosts.clear();
  const bang = { ...options, rawQuery: '!wiki light rail' };
  await runMetasearch({ ...bang, mode: 'fast', userConfig: { exaApiKey: 'fixture' } });
  const fastBangHosts = [...hosts].sort();
  assert.ok(fastBangHosts.includes('en.wikipedia.org'));
  assert.ok(!fastBangHosts.includes('mcp.exa.ai'));
  hosts.clear();
  await runMetasearch({ ...bang, mode: 'full', userConfig: { exaApiKey: 'fixture' } });
  assert.deepEqual([...hosts].sort(), fastBangHosts);
});

test('Wikipedia and GitHub hits stream before optional enrichment finishes', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  let releaseWiki!: () => void;
  let releaseDeepWiki!: () => void;
  const wikiGate = new Promise<void>((resolve) => { releaseWiki = resolve; });
  const deepWikiGate = new Promise<void>((resolve) => { releaseDeepWiki = resolve; });
  let wikiReleased = false;
  let deepWikiReleased = false;
  let firstWiki = false;
  let firstGithub = false;
  const summary = { title: 'Light Rail', type: 'standard', extract: 'Some detail about public transit.' };
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    if (url.host === 'en.wikipedia.org' && url.pathname.includes('/summary/')) {
      await wikiGate;
      return Response.json(summary);
    }
    if (url.host === 'en.wikipedia.org' && url.searchParams.get('generator') === 'search') {
      return Response.json({ query: { pages: { one: { pageid: 1, title: 'Light Rail', extract: 'Transit fixture' } } } });
    }
    if (url.host === 'api.github.com') {
      return Response.json({ items: [{ id: 1, full_name: 'fixtures/transit', html_url: 'https://github.com/fixtures/transit', description: 'Transit fixture', stargazers_count: 10 }] });
    }
    if (url.host === 'mcp.deepwiki.com') {
      await deepWikiGate;
      return Response.json({ result: { content: [{ type: 'text', text: 'Available pages\nArchitecture\nService design' }] } });
    }
    return new Response(null, { status: 503 });
  });
  const emergency = setTimeout(() => {
    wikiReleased = deepWikiReleased = true;
    releaseWiki(); releaseDeepWiki();
  }, 500);
  t.after(() => clearTimeout(emergency));
  const result = await runMetasearch({ rawQuery: 'light rail', category: 'all', region: 'global', enginesParam: 'wikipedia,github,deepwiki',
    onBatch: ({ results }) => {
      if (!wikiReleased && results.some(({ engine }) => engine === 'wikipedia')) {
        firstWiki = true; wikiReleased = true; releaseWiki();
      }
      if (!deepWikiReleased && results.some(({ engine }) => engine === 'github')) {
        firstGithub = true; deepWikiReleased = true; releaseDeepWiki();
      }
    },
  });
  assert.equal(firstWiki, true);
  assert.equal(firstGithub, true);
  assert.equal(result.knowledgeBox?.title, summary.title);
  assert.equal(result.results.find(({ engine }) => engine === 'github')?.wikiUrls?.deepwiki, 'https://deepwiki.com/fixtures/transit');
});

test('fast search aborts an upstream body that stalls after headers', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  let deadlineReason: unknown;
  t.mock.method(globalThis, 'fetch', async (_input: string | URL, init?: RequestInit) => {
    const response = new ReadableStream({ start(controller) {
      const fallback = setTimeout(() => controller.error(new Error('deadline did not cover the body')), 5500);
      init?.signal?.addEventListener('abort', () => {
        deadlineReason = init.signal?.reason;
        clearTimeout(fallback);
        controller.error(deadlineReason);
      }, { once: true });
    } });
    return new Response(response);
  });
  const result = await runMetasearch({ rawQuery: 'deadline fixture', category: 'all', mode: 'fast', enginesParam: 'tavily', region: 'global' });
  assert.equal((deadlineReason as Error | undefined)?.name, 'TimeoutError');
  assert.equal(result.engineHealth?.find(({ engine }) => engine === 'tavily')?.status, 'timeout');
});

test('embedded callers with different operator defaults do not share search results', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    if (new URL(input).host !== 'api.tavily.com') return new Response(null, { status: 503 });
    return Response.json({ results: [{ title: 'Cache scope fixture', url: `https://example.org/result-${++count}` }] });
  });
  const options = { rawQuery: 'cache scope fixture', category: 'all' as const, enginesParam: 'tavily' };
  const search = (tavilyApiKey: string) => runMetasearch({ ...options, providerDefaults: { tavilyApiKey } });
  assert.equal((await search('first')).results[0]?.url, 'https://example.org/result-1');
  assert.equal((await search('second')).results[0]?.url, 'https://example.org/result-2');
  assert.equal((await search('first')).cacheHit, true);
  assert.equal(count, 2);
});

test('Serper and Brave BYOK activate in Fast, News, Images, and Videos and stay silent when unkeyed', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  const oldTransport = process.env.PHAROL_WEB_TRANSPORT;
  process.env.PHAROL_WEB_TRANSPORT = 'fetch';
  t.after(() => { if (oldTransport === undefined) delete process.env.PHAROL_WEB_TRANSPORT; else process.env.PHAROL_WEB_TRANSPORT = oldTransport; });
  const todayIso = new Date().toISOString().slice(0, 10);
  const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    requests.push({ url: url.href, headers, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.host === 'google.serper.dev' && url.pathname === '/search') {
      return Response.json({
        organic: [{ title: 'Lisbon Metro', link: 'https://example.org/metro', snippet: 'Metro lines in Lisbon.', date: todayIso, position: 1 }],
      });
    }
    if (url.host === 'google.serper.dev' && url.pathname === '/news') {
      return Response.json({
        news: [{ title: 'Lisbon transit upgrade', link: 'https://example.org/news-serper', snippet: 'New trams arrive.', source: 'Publico', date: '1 hour ago' }],
      });
    }
    if (url.host === 'google.serper.dev' && url.pathname === '/images') {
      return Response.json({
        images: [{ title: 'Tram 28', link: 'https://example.org/tram28', imageUrl: 'https://example.org/tram28.jpg', thumbnailUrl: 'https://example.org/tram28-thumb.jpg', source: 'Example', imageWidth: 800, imageHeight: 600 }],
      });
    }
    if (url.host === 'google.serper.dev' && url.pathname === '/videos') {
      return Response.json({
        videos: [{ title: 'Riding Tram 28', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', snippet: 'Full route video.', duration: '10:00', channel: 'TransitPT' }],
      });
    }
    if (url.host === 'api.search.brave.com' && url.pathname === '/res/v1/web/search') {
      return Response.json({
        web: { results: [{ title: 'Carris Bus Network', url: 'https://example.org/carris', description: 'City buses in Lisbon.', page_age: `${todayIso}T12:00:00Z` }] },
      });
    }
    if (url.host === 'api.search.brave.com' && url.pathname === '/res/v1/news/search') {
      return Response.json({
        results: [{ title: 'Carris expands fleet', url: 'https://example.org/news-brave', description: 'Electric buses added.', meta_url: { hostname: 'www.rtp.pt' } }],
      });
    }
    if (url.host === 'api.search.brave.com' && url.pathname === '/res/v1/images/search') {
      return Response.json({
        results: [{ title: 'Lisbon ferry', url: 'https://example.org/ferry', source: 'Example', thumbnail: { src: 'https://example.org/ferry-thumb.jpg' }, properties: { width: 1024, height: 768 } }],
      });
    }
    if (url.host === 'api.search.brave.com' && url.pathname === '/res/v1/videos/search') {
      return Response.json({
        results: [{ title: 'Lisbon Metro Tour', url: 'https://example.org/video-tour', description: 'Station tour.', video: { duration: '05:12', creator: 'MetroFans', views: 1200 } }],
      });
    }
    return new Response(null, { status: 503 });
  });

  // Unkeyed fast search must never call Serper or Brave
  await runMetasearch({ rawQuery: 'Lisbon transit', category: 'all', mode: 'fast', region: 'pt-PT' });
  assert.ok(!requests.some(({ url }) => url.includes('google.serper.dev') || url.includes('api.search.brave.com')));
  requests.length = 0;

  // Keyed fast web search activates both with region, time, and pagination
  const userConfig = { serperApiKey: 'user-serper-secret', braveApiKey: 'user-brave-secret' };
  const web = await runMetasearch({
    rawQuery: 'Lisbon transit', category: 'all', mode: 'fast', page: 2, timeRange: 'week', region: 'pt-PT', userConfig,
  });
  assert.ok(web.results.some((r) => r.engine === 'serper' && r.url === 'https://example.org/metro'));
  assert.ok(web.results.some((r) => r.engine === 'brave' && r.url === 'https://example.org/carris'));
  const serperReq = requests.find(({ url }) => url === 'https://google.serper.dev/search')!;
  assert.equal(serperReq.headers.get('x-api-key'), 'user-serper-secret');
  assert.deepEqual(JSON.parse(serperReq.body!), { q: 'Lisbon transit', num: 10, page: 2, gl: 'pt', hl: 'pt', tbs: 'qdr:w' });
  const braveReq = requests.find(({ url }) => url.startsWith('https://api.search.brave.com/res/v1/web/search'))!;
  assert.equal(braveReq.headers.get('x-subscription-token'), 'user-brave-secret');
  const braveUrl = new URL(braveReq.url);
  assert.equal(braveUrl.searchParams.get('offset'), '1');
  assert.equal(braveUrl.searchParams.get('freshness'), 'pw');
  assert.equal(braveUrl.searchParams.get('country'), 'PT');
  assert.equal(braveUrl.searchParams.get('search_lang'), 'pt');

  // News, Images, and Videos verticals + MCP header override without key leakage
  const news = await runMetasearch({ rawQuery: 'Lisbon transit', category: 'news', region: 'pt-PT', userConfig });
  assert.ok(news.results.some((r) => r.engine === 'serper-news'));
  assert.ok(news.results.some((r) => r.engine === 'brave-news'));

  const images = await runMetasearch({ rawQuery: 'Lisbon tram', category: 'images', region: 'pt-PT', userConfig });
  assert.ok(images.results.some((r) => r.engine === 'serper-images' && r.thumbnail === 'https://example.org/tram28-thumb.jpg'));
  assert.ok(images.results.some((r) => r.engine === 'brave-images' && r.thumbnail === 'https://example.org/ferry-thumb.jpg'));

  const videos = await runMetasearch({ rawQuery: 'Lisbon tram', category: 'videos', region: 'pt-PT', userConfig });
  assert.ok(videos.results.some((r) => r.engine === 'serper-videos' && r.embedUrl === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  assert.ok(videos.results.some((r) => r.engine === 'brave-videos' && r.author === 'MetroFans'));

  const mcpRes = await mcpCall('news_search', { query: 'Lisbon transit' }, {
    'x-pharol-serper-key': 'mcp-serper-secret',
    'x-pharol-brave-key': 'mcp-brave-secret',
  });
  assert.equal(mcpRes.status, 200);
  const mcpText = await mcpRes.text();
  assert.match(mcpText, /serper-news/);
  assert.match(mcpText, /brave-news/);
  assert.doesNotMatch(mcpText, /mcp-serper-secret|mcp-brave-secret/);
});

test('Serper and Brave 429 responses enter per-credential cooldown', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const host = new URL(input).host;
    if (host === 'google.serper.dev' || host === 'api.search.brave.com') {
      return new Response(null, { status: 429 });
    }
    return new Response(null, { status: 503 });
  });
  const res = await runMetasearch({
    rawQuery: 'quota test',
    category: 'all',
    enginesParam: 'serper,brave',
    userConfig: { serperApiKey: 'quota-s', braveApiKey: 'quota-b' },
  });
  assert.equal(res.engineHealth?.find((h) => h.engine === 'serper')?.status, 'cooldown');
  assert.equal(res.engineHealth?.find((h) => h.engine === 'brave')?.status, 'cooldown');
});
