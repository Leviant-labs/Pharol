import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as newsGET } from '../app/api/news/route';
import { searchNews } from './news-service';
import { clearSearchCache } from './server-cache';
import { runMetasearch } from './server-search';

test('searchNews includes Exa News, forwards timeRange upstream, and filters stale items post-fetch', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);

  const nowIso = new Date().toISOString().slice(0, 10);
  const nowRfc = new Date().toUTCString();
  const oldUnix = Math.floor((Date.now() - 348 * 86_400_000) / 1000);
  const recentUnix = Math.floor((Date.now() - 3600_000) / 1000);

  const seenUrls: string[] = [];
  const seenBodies = new Map<string, string>();
  const seenHeaders = new Map<string, Headers>();

  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    seenUrls.push(url.href);
    seenHeaders.set(`${url.host}${url.pathname}`, new Headers(init?.headers));
    if (typeof init?.body === 'string') seenBodies.set(`${url.host}${url.pathname}`, init.body);

    if (url.host === 'duckduckgo.com' && url.pathname === '/') {
      return new Response('<script>vqd="4-123456"</script>');
    }
    if (url.host === 'duckduckgo.com' && url.pathname === '/news.js') {
      return Response.json({
        results: [
          { title: 'Stale viral story', url: 'https://example.org/stale-ddg', excerpt: 'Old report.', source: 'ArchiveWire', date: oldUnix, relative_time: '348 days ago' },
          { title: 'Fresh DDG headline', url: 'https://example.org/fresh-ddg', excerpt: 'Breaking update.', source: 'DailyWire', date: recentUnix, relative_time: '1 hour ago' },
        ],
      });
    }
    if (url.host === 'www.bing.com' && url.pathname === '/news/search') {
      return new Response(
        `<rss><channel><item><title>Fresh Bing Story</title><link>https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent('https://example.org/fresh-bing')}</link><description>Recent update</description><pubDate>${nowRfc}</pubDate></item></channel></rss>`,
        { headers: { 'Content-Type': 'application/xml' } }
      );
    }
    if (url.host === 'mcp.exa.ai' && url.pathname === '/mcp') {
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: `Title: Fresh Exa News Report\nURL: https://example.org/fresh-exa\nPublished: ${nowIso}\nAuthor: Exa Desk\nHighlights: Portugal economic update from Exa News.`,
            },
          ],
        },
      });
    }
    if (url.host === 'hn.algolia.com') {
      return Response.json({ hits: [] });
    }
    return new Response(null, { status: 503 });
  });

  const res = await searchNews({
    query: 'Portugal economy',
    region: 'en-US',
    timeRange: 'week',
    access: 'all',
    providerDefaults: { exaApiKey: 'operator-exa' },
  });

  // Upstream timeRange params forwarded
  const ddgNewsUrl = seenUrls.find((u) => u.includes('duckduckgo.com/news.js'))!;
  assert.equal(new URL(ddgNewsUrl).searchParams.get('df'), 'w');
  const bingNewsUrl = seenUrls.find((u) => u.includes('www.bing.com/news/search'))!;
  assert.equal(new URL(bingNewsUrl).searchParams.get('qft'), 'interval="8"');
  const hnUrl = seenUrls.find((u) => u.includes('hn.algolia.com'))!;
  assert.match(new URL(hnUrl).searchParams.get('numericFilters') ?? '', /^created_at_i>\d+$/);
  assert.equal(seenHeaders.get('mcp.exa.ai/mcp')?.get('x-api-key'), 'operator-exa');
  assert.equal(JSON.parse(seenBodies.get('api.tavily.com/search')!).days, 7);
  assert.equal(JSON.parse(seenBodies.get('api.firecrawl.dev/v2/search')!).tbs, 'qdr:w');

  // Fresh items survive (including year-preserved formatDateLabel dates) and 348-day-old item is filtered out
  assert.ok(res.items.some((i) => i.engine === 'exa-news' && i.url === 'https://example.org/fresh-exa'));
  assert.ok(res.items.some((i) => i.engine === 'duckduckgo-news' && i.url === 'https://example.org/fresh-ddg'));
  assert.ok(res.items.some((i) => i.engine === 'bing-news' && i.url === 'https://example.org/fresh-bing'));
  assert.ok(!res.items.some((i) => i.url === 'https://example.org/stale-ddg'));

  // Telemetry & caching
  assert.equal(res.cacheHit, false);
  assert.equal(res.engineHealth.find((h) => h.engine === 'exa-news')?.status, 'ok');
  assert.equal(res.engineHealth.find((h) => h.engine === 'bing-news')?.status, 'ok');

  const beforeRepeat = seenUrls.length;
  const cached = await searchNews({
    query: 'Portugal economy',
    region: 'en-US',
    timeRange: 'week',
    access: 'all',
    providerDefaults: { exaApiKey: 'operator-exa' },
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(seenUrls.length, beforeRepeat);

  // User key overrides bypass the shared cache
  const userRes = await searchNews({
    query: 'Portugal economy',
    region: 'en-US',
    timeRange: 'week',
    access: 'all',
    userConfig: { exaApiKey: 'user-exa' },
  });
  assert.equal(userRes.cacheHit, false);
  assert.equal(seenHeaders.get('mcp.exa.ai/mcp')?.get('x-api-key'), 'user-exa');
});

test('runMetasearch category=news and /api/news share the unified news pipeline and cooldowns', async (t) => {
  clearSearchCache();
  t.after(clearSearchCache);

  let exaCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    if (url.host === 'mcp.exa.ai') {
      exaCalls++;
      return new Response(null, { status: 429 });
    }
    if (url.host === 'feeds.bbci.co.uk') {
      return new Response(
        `<rss><channel><item><title>Lisbon metro expansion update</title><link>https://www.bbc.com/news/lisbon-metro</link><description>Lisbon transit investment approved.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`,
        { headers: { 'Content-Type': 'application/xml' } }
      );
    }
    return new Response(null, { status: 503 });
  });

  // Metasearch category=news uses unified pipeline (direct RSS wires + Exa News cooldown)
  const meta = await runMetasearch({
    rawQuery: '!news Lisbon metro',
    category: 'all',
    region: 'en-US',
    timeRange: 'week',
  });
  assert.equal(meta.category, 'news');
  assert.ok(meta.results.some((r) => r.engine === 'bbc' && r.url === 'https://www.bbc.com/news/lisbon-metro'));
  assert.equal(meta.engineHealth?.find((h) => h.engine === 'exa-news')?.status, 'cooldown');
  assert.equal(exaCalls, 1);

  // Subsequent /api/news call with different query sees exa-news still in cooldown (does not retry)
  const apiRes = await newsGET(new NextRequest('https://pharol.example/api/news?q=other+topic&region=en-US&timeRange=day'));
  assert.equal(apiRes.status, 200);
  const apiData = await apiRes.json();
  assert.equal(apiData.engineHealth.find((h: { engine: string }) => h.engine === 'exa-news')?.status, 'cooldown');
  assert.equal(exaCalls, 1);
});
