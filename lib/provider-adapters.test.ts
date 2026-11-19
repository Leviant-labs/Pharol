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
