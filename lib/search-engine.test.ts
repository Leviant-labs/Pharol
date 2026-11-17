import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchSyntax,
  filterResultsBySyntax,
  normalizeUrl,
  getDisplayUrl,
  extractBingTargetUrl,
  deduplicateAndRank,
  reconstructOpenAlexAbstract,
  parseJinaMarkdownToReader,
  decodeHtmlEntities,
  extractTopicClusters,
  getWeatherText,
  classifySourceAccess,
  filterNewsByAccess,
  hasSubscriptionJsonLd,
  cleanMarkdownSnippet,
  parseMcpJsonRpcPayload,
  parseExaMcpTextResponse,
  parseContext7ResolveResponse,
  parseContext7DocsResponse,
  sanitizeTrustedBaseUrl,
  buildRepoWikiLinks,
  isDeepWikiErrorText,
  detectSearchIntent,
  normalizeConceptKeywords,
  extractWikidataAttributes,
  detectQueryRegionHint,
  resolveRegionProfile,
  parseApproximateTimestamp,
} from './search-engine';
import {
  buildUserProviderHeaders,
  extractUserProviderConfig,
} from './user-provider-headers';
import { evaluateInstantUtility } from './instant-tools';
import {
  buildSearchCacheKey,
  clearSearchCache,
  getCachedSearchResponse,
  isEngineCoolingDown,
  recordEngineRateLimit,
  recordEngineSuccess,
  setCachedSearchResponse,
} from './server-cache';
import { SearchResponse, SearchResult } from './search-types';

test('parseSearchSyntax extracts site, filetype, exact phrases, and exclusions', () => {
  const parsed = parseSearchSyntax('site:github.com filetype:pdf "quantum computing" -legacy -obsolete latest breakthroughs');
  assert.equal(parsed.site, 'github.com');
  assert.equal(parsed.filetype, 'pdf');
  assert.deepEqual(parsed.exactPhrases, ['quantum computing']);
  assert.deepEqual(parsed.excludedTerms, ['legacy', 'obsolete']);
  assert.equal(parsed.cleanQuery, 'latest breakthroughs');
});

test('parseSearchSyntax handles query without operators gracefully', () => {
  const parsed = parseSearchSyntax('searxng metasearch privacy');
  assert.equal(parsed.cleanQuery, 'searxng metasearch privacy');
  assert.equal(parsed.site, undefined);
  assert.equal(parsed.filetype, undefined);
  assert.deepEqual(parsed.exactPhrases, []);
  assert.deepEqual(parsed.excludedTerms, []);
});

test('normalizeUrl removes tracking parameters, www, and trailing slashes', () => {
  const raw = 'https://www.example.com/article/?utm_source=twitter&utm_medium=social&utm_campaign=launch#comments';
  const normalized = normalizeUrl(raw);
  assert.equal(normalized, 'https://example.com/article');
});

test('extractBingTargetUrl unwraps Bing apiclick url parameter to direct publisher URL', () => {
  const bingUrl = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fwww.reuters.com%2ftech%2fai-chips&mkt=en-us';
  assert.equal(extractBingTargetUrl(bingUrl), 'https://www.reuters.com/tech/ai-chips');

  const directUrl = 'https://www.bbc.com/news/science-123';
  assert.equal(extractBingTargetUrl(directUrl), directUrl);
});

test('getDisplayUrl formats clean domain and breadcrumbs', () => {
  const disp = getDisplayUrl('https://en.wikipedia.org/wiki/Artificial_intelligence');
  assert.equal(disp, 'en.wikipedia.org › wiki › Artificial_intelligence');
});

test('deduplicateAndRank interleaves results across engines via RRF and promotes consensus URLs', () => {
  const results: SearchResult[] = [
    // Engine A (duckduckgo) ranks 0, 1, 2
    {
      id: 'ddg-0',
      title: 'TypeScript Handbook',
      url: 'https://www.typescriptlang.org/docs/handbook/',
      displayedUrl: 'typescriptlang.org',
      snippet: 'Official TypeScript handbook.',
      engine: 'duckduckgo',
      category: 'all',
      rankPosition: 0,
    },
    {
      id: 'ddg-1',
      title: 'TypeScript Playground',
      url: 'https://www.typescriptlang.org/play',
      displayedUrl: 'typescriptlang.org',
      snippet: 'Try TypeScript in your browser.',
      engine: 'duckduckgo',
      category: 'all',
      rankPosition: 1,
    },
    {
      id: 'ddg-2',
      title: 'TypeScript Deep Dive',
      url: 'https://basarat.gitbook.io/typescript',
      displayedUrl: 'basarat.gitbook.io',
      snippet: 'Comprehensive guide to TypeScript.',
      engine: 'duckduckgo',
      category: 'all',
      rankPosition: 2,
    },
    // Engine B (bing) ranks 0 (unique), 1 (consensus with ddg-0!)
    {
      id: 'bing-0',
      title: 'TypeScript Wikipedia Overview',
      url: 'https://en.wikipedia.org/wiki/TypeScript',
      displayedUrl: 'en.wikipedia.org',
      snippet: 'TypeScript is a free and open-source high-level programming language.',
      engine: 'bing',
      category: 'all',
      rankPosition: 0,
    },
    {
      id: 'bing-1',
      title: 'TypeScript Official Documentation',
      url: 'https://typescriptlang.org/docs/handbook?utm_source=bing',
      displayedUrl: 'typescriptlang.org',
      snippet: 'Official TypeScript documentation covering types, interfaces, generics, and compiler flags.',
      engine: 'bing',
      category: 'all',
      rankPosition: 1,
    },
  ];

  const ranked = deduplicateAndRank(results, 'TypeScript');
  assert.equal(ranked.length, 4);
  // Consensus result (found in both ddg and bing) must be #1
  assert.equal(ranked[0].engine, 'duckduckgo, bing');
  assert.match(ranked[0].snippet, /compiler flags/);
  // Next top results should interleave bing rank 0 and ddg rank 1 rather than grouping all ddg first
  assert.ok(ranked[1].engine === 'bing' || ranked[2].engine === 'bing');
});

test('reconstructOpenAlexAbstract builds ordered text from inverted index', () => {
  const inverted = {
    Attention: [0],
    is: [1],
    all: [2],
    you: [3],
    need: [4],
    for: [5],
    transformers: [6],
  };
  assert.equal(reconstructOpenAlexAbstract(inverted), 'Attention is all you need for transformers');
  assert.equal(reconstructOpenAlexAbstract(null), '');
});

test('parseJinaMarkdownToReader extracts title, headings, quotes, lists, and paragraphs cleanly', () => {
  const md = [
    'Title: Deep Dive into Metasearch',
    'URL Source: https://example.com/metasearch',
    'Published Time: 2026-10-01',
    'Markdown Content:',
    '## Architecture Overview',
    'Metasearch engines query multiple upstream providers in parallel and fuse rankings cleanly without storing user cookies.',
    '> Privacy by architecture means zero server-side query retention.',
    '- Reciprocal rank fusion balances engine authority.',
    '- Direct publisher URLs ensure transparent linking.',
  ].join('\n');

  const parsed = parseJinaMarkdownToReader(md, 'https://example.com/metasearch');
  assert.equal(parsed.title, 'Deep Dive into Metasearch');
  assert.equal(parsed.publishedTime, '2026-10-01');
  assert.ok(parsed.blocks.some((b) => b.type === 'h2' && b.text === 'Architecture Overview'));
  assert.ok(parsed.blocks.some((b) => b.type === 'quote'));
  assert.ok(parsed.blocks.some((b) => b.type === 'ul' && b.items?.length === 2));
  assert.ok(parsed.paragraphs.length >= 4);
});

test('decodeHtmlEntities cleans HTML and special entities', () => {
  const dirty = 'AT&amp;T &lt;b&gt;announces&lt;/b&gt; &#39;breakthrough&#39; &quot;speed&quot;';
  const clean = decodeHtmlEntities(dirty);
  assert.equal(clean, 'AT&T announces \'breakthrough\' "speed"');
});

test('extractTopicClusters groups related news into clusters', () => {
  const items: SearchResult[] = [
    {
      id: 'n1',
      title: 'NASA James Webb Telescope spots oldest galaxy',
      url: 'https://nasa.gov/1',
      displayedUrl: 'nasa.gov',
      snippet: 'Webb telescope discovers ancient galaxy formation',
      engine: 'bing-news',
      category: 'news',
    },
    {
      id: 'n2',
      title: 'European Space Agency analyzes Webb data on galaxy clusters',
      url: 'https://esa.int/2',
      displayedUrl: 'esa.int',
      snippet: 'ESA researchers confirm Webb discoveries of distant galaxy clusters',
      engine: 'duckduckgo-news',
      category: 'news',
    },
    {
      id: 'n3',
      title: 'Global markets rally today following inflation reports',
      url: 'https://reuters.com/3',
      displayedUrl: 'reuters.com',
      snippet: 'Markets surge worldwide as inflation cools down',
      engine: 'bbc',
      category: 'news',
    },
  ];

  const clusters = extractTopicClusters(items);
  assert.ok(clusters.length > 0);
  assert.ok(clusters.some((c) => c.topic.toLowerCase() === 'webb' || c.topic.toLowerCase() === 'galaxy'));
});

test('getWeatherText maps WMO weather codes correctly', () => {
  assert.equal(getWeatherText(0), 'Clear Sky');
  assert.equal(getWeatherText(3), 'Overcast');
  assert.equal(getWeatherText(61), 'Rain');
  assert.equal(getWeatherText(95), 'Thunderstorm');
});

test('parseSearchSyntax extracts !bang shortcuts and removes token from cleanQuery', () => {
  const parsed = parseSearchSyntax('attention mechanism !gh');
  assert.equal(parsed.bang?.bang, '!gh');
  assert.equal(parsed.bang?.category, 'code');
  assert.deepEqual(parsed.bang?.engines, ['github']);
  assert.equal(parsed.cleanQuery, 'attention mechanism');

  const arxiv = parseSearchSyntax('!arxiv sparse transformers');
  assert.equal(arxiv.bang?.bang, '!arxiv');
  assert.equal(arxiv.bang?.category, 'science');
  assert.equal(arxiv.cleanQuery, 'sparse transformers');
});

test('filterResultsBySyntax enforces exactPhrases, inTitle, and timeRange', () => {
  const parsed = parseSearchSyntax('"attention mechanism" intitle:transformer');
  const now = new Date('2026-11-13T12:00:00Z').getTime();
  const sample: SearchResult[] = [
    {
      id: '1',
      title: 'Transformer Architecture Guide',
      url: 'https://example.com/1',
      displayedUrl: 'example.com',
      snippet: 'Explains the multi-head attention mechanism in depth.',
      engine: 'duckduckgo',
      category: 'all',
      publishedDate: '2026-11-10',
    },
    {
      id: '2',
      title: 'Old RNN Guide',
      url: 'https://example.com/2',
      displayedUrl: 'example.com',
      snippet: 'Covers attention mechanism.',
      engine: 'duckduckgo',
      category: 'all',
      publishedDate: '2021-01-01',
    },
    {
      id: '3',
      title: 'Transformer Basics',
      url: 'https://example.com/3',
      displayedUrl: 'example.com',
      snippet: 'Covers feed-forward layers.',
      engine: 'bing',
      category: 'all',
      publishedDate: '2023-05-01',
    },
  ];

  const weekFiltered = filterResultsBySyntax(sample, parsed, 'week', now);
  assert.equal(weekFiltered.length, 1);
  assert.equal(weekFiltered[0].id, '1');
});

test('parseJinaMarkdownToReader preserves fenced code blocks and resolves GitHub relative images', () => {
  const md = [
    '# Go Attention',
    '[![CI](https://img.shields.io/badge/ci-pass-green)](https://github.com/takara-ai/go-attention/actions)',
    '![Diagram](docs/arch.png)',
    '```go',
    'func Attention(q, k, v Matrix) Matrix {',
    '  return q.Mul(k)',
    '}',
    '```',
  ].join('\n');

  const parsed = parseJinaMarkdownToReader(md, 'https://github.com/takara-ai/go-attention');
  assert.equal(
    parsed.heroImage,
    'https://raw.githubusercontent.com/takara-ai/go-attention/HEAD/docs/arch.png'
  );
  assert.ok(!parsed.paragraphs.some((p) => p.includes('](')));
  const codeBlock = parsed.blocks.find((b) => b.type === 'code');
  assert.ok(codeBlock);
  assert.match(codeBlock.text, /func Attention/);
});

test('classifySourceAccess and filterNewsByAccess enforce free and open-wire modes', () => {
  assert.equal(classifySourceAccess('https://www.bbc.com/news/world-123'), 'open');
  assert.equal(classifySourceAccess('https://feeds.npr.org/1001/rss.xml'), 'open');
  assert.equal(classifySourceAccess('https://www.nytimes.com/2026/story.html'), 'subscription');
  assert.equal(classifySourceAccess('https://localblog.example.org/post'), 'unknown');

  const items: SearchResult[] = [
    {
      id: '1',
      title: 'BBC Story',
      url: 'https://www.bbc.com/news/world-1',
      displayedUrl: 'bbc.com',
      snippet: 'Free public wire',
      engine: 'bbc',
      category: 'news',
    },
    {
      id: '2',
      title: 'NYT Story',
      url: 'https://www.nytimes.com/2026/11/story',
      displayedUrl: 'nytimes.com',
      snippet: 'Subscription story',
      engine: 'bing-news',
      category: 'news',
    },
    {
      id: '3',
      title: 'Independent Tech Blog',
      url: 'https://indie.example.org/post',
      displayedUrl: 'indie.example.org',
      snippet: 'Unclassified free web article',
      engine: 'duckduckgo-news',
      category: 'news',
    },
  ];

  assert.equal(filterNewsByAccess(items, 'all').length, 3);
  assert.deepEqual(
    filterNewsByAccess(items, 'free').map((i) => i.id),
    ['1', '3']
  );
  assert.deepEqual(
    filterNewsByAccess(items, 'open-wire').map((i) => i.id),
    ['1']
  );
});

test('hasSubscriptionJsonLd detects Schema.org isAccessibleForFree false', () => {
  assert.equal(
    hasSubscriptionJsonLd('<script type="application/ld+json">{"isAccessibleForFree":false}</script>'),
    true
  );
  assert.equal(
    hasSubscriptionJsonLd('<script type="application/ld+json">{"isAccessibleForFree":true}</script>'),
    false
  );
});

test('cleanMarkdownSnippet strips markdown syntax and truncates cleanly', () => {
  const md = '## Installation\nUse **[Next.js](https://nextjs.org)** with `pnpm create next-app`.\n```ts\nconst x = 1;\n```';
  const clean = cleanMarkdownSnippet(md, 100);
  assert.equal(clean, 'Installation Use Next.js with pnpm create next-app .');
});

test('parseMcpJsonRpcPayload unwraps both plain JSON-RPC and SSE payloads', () => {
  const plainJson = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: '{"results":[{"title":"A"}]}' }] },
  });
  assert.equal(parseMcpJsonRpcPayload(plainJson), '{"results":[{"title":"A"}]}');

  const ssePayload = [
    'event: message',
    `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Title: Exa Hit\nURL: https://exa.ai' }] } })}`,
  ].join('\n');
  assert.equal(parseMcpJsonRpcPayload(ssePayload), 'Title: Exa Hit\nURL: https://exa.ai');
});

test('parseExaMcpTextResponse extracts structured search results from Exa MCP text', () => {
  const raw = [
    'Title: Server Components Guide',
    'URL: https://nextjs.org/docs/app/getting-started/server-and-client-components',
    'Published: 2026-08-15T00:00:00Z',
    'Author: Vercel Team',
    'Highlights:',
    'By default, layouts and pages are Server Components in Next.js App Router.',
    '',
    '---',
    '',
    'Title: React TypeScript Docs',
    'URL: https://react.dev/learn/typescript',
    'Published: N/A',
    'Author: N/A',
    'Highlights:',
    'TypeScript adds static types to React components.',
  ].join('\n');

  const items = parseExaMcpTextResponse(raw);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Server Components Guide');
  assert.equal(items[0].publishedDate, '2026-08-15');
  assert.equal(items[0].author, 'Vercel Team');
  assert.match(items[0].snippet, /Server Components/);
  assert.equal(items[1].publishedDate, undefined);
  assert.equal(items[1].author, undefined);
});

test('extractWikidataAttributes maps official site, inception, ticker, and QID cleanly', () => {
  const entity = {
    id: 'Q2283',
    claims: {
      P856: [{ mainsnak: { datavalue: { type: 'string', value: 'https://www.microsoft.com/' } } }],
      P571: [{ mainsnak: { datavalue: { type: 'time', value: { time: '+1975-04-04T00:00:00Z' } } } }],
      P249: [{ mainsnak: { datavalue: { type: 'string', value: 'MSFT' } } }],
    },
  };
  const attrs = extractWikidataAttributes(entity);
  assert.deepEqual(attrs, [
    { label: 'Official Site', value: 'microsoft.com' },
    { label: 'Founded', value: '1975-04-04' },
    { label: 'Ticker', value: 'MSFT' },
    { label: 'Wikidata ID', value: 'Q2283' },
  ]);
});

test('detectQueryRegionHint and resolveRegionProfile target Portugal for Portuguese queries & locales', () => {
  assert.equal(detectQueryRegionHint('Luís Montenegro'), 'pt-PT');
  assert.equal(detectQueryRegionHint('site:rtp.pt notícias'), 'pt-PT');
  assert.equal(detectQueryRegionHint('rust async runtime'), null);

  const autoQuery = resolveRegionProfile('auto', 'Luís Montenegro', 'en-US,en;q=0.9');
  assert.equal(autoQuery.code, 'pt-PT');
  assert.equal(autoQuery.ddgKl, 'pt-pt');
  assert.equal(autoQuery.bingCc, 'PT');
  assert.equal(autoQuery.wikiLang, 'pt');

  const autoLocale = resolveRegionProfile('auto', 'noticias', 'pt-PT,pt;q=0.9,en;q=0.8');
  assert.equal(autoLocale.code, 'pt-PT');

  const explicitGlobal = resolveRegionProfile('global', 'Luís Montenegro', 'pt-PT');
  assert.equal(explicitGlobal.code, 'global');
  assert.equal(explicitGlobal.wikiLang, 'en');
});

test('classifySourceAccess recognizes Portuguese public & open-access wires', () => {
  assert.equal(classifySourceAccess('https://www.rtp.pt/noticias/pais/exemplo'), 'open');
  assert.equal(classifySourceAccess('https://www.portugal.gov.pt/pt/gc24'), 'open');
  assert.equal(classifySourceAccess('https://eco.sapo.pt/2026/11/15/exemplo/'), 'open');
});

test('evaluateInstantUtility resolves math, units, PT/EN world clock, colors, base64, and ignores plain years', () => {
  const math = evaluateInstantUtility('25 * 18 / 4');
  assert.equal(math?.kind, 'calculator');
  assert.equal(math?.text, '112.5');

  const dist = evaluateInstantUtility('100 km to miles');
  assert.equal(dist?.kind, 'converter');
  assert.match(dist?.text || '', /^62\.137/);

  const temp = evaluateInstantUtility('30 c em f');
  assert.equal(temp?.kind, 'converter');
  assert.equal(temp?.text, '86°F');

  const tz = evaluateInstantUtility('time in lisbon', new Date('2026-11-16T14:30:00Z'));
  assert.equal(tz?.kind, 'timezone');
  assert.match(tz?.heading || '', /Europe\/Lisbon/);
  assert.match(tz?.text || '', /14:30:00/);

  const color = evaluateInstantUtility('#ff5733');
  assert.equal(color?.kind, 'color');
  assert.match(color?.text || '', /rgb\(255, 87, 51\)/);

  const b64 = evaluateInstantUtility('base64 encode searx');
  assert.equal(b64?.kind, 'developer');
  assert.equal(b64?.text, 'c2Vhcng=');

  assert.equal(evaluateInstantUtility('2026'), null);
});

test('server-cache handles TTL expiration and adaptive rate-limit cooldowns', () => {
  clearSearchCache();
  const key = buildSearchCacheKey({
    query: 'Luís Montenegro',
    category: 'all',
    region: 'pt-PT',
    timeRange: 'all',
    page: 1,
    engines: 'duckduckgo,bing',
  });

  const sampleResp: SearchResponse = {
    query: 'Luís Montenegro',
    parsedQuery: parseSearchSyntax('Luís Montenegro'),
    category: 'all',
    results: [
      {
        id: '1',
        title: 'Portugal.gov.pt',
        url: 'https://www.portugal.gov.pt/',
        displayedUrl: 'portugal.gov.pt',
        snippet: 'Portal do Governo.',
        engine: 'bing',
        category: 'all',
      },
    ],
    totalResults: 1,
    timeTakenMs: 320,
    enginesUsed: ['bing'],
  };

  setCachedSearchResponse(key, sampleResp, 60_000, 1000);
  const hit = getCachedSearchResponse(key, 10_000);
  assert.equal(hit?.cacheHit, true);
  assert.equal(hit?.results.length, 1);

  const expired = getCachedSearchResponse(key, 65_000);
  assert.equal(expired, null);

  assert.equal(isEngineCoolingDown('firecrawl', 1000), false);
  recordEngineRateLimit('firecrawl', 180_000, 1000);
  assert.equal(isEngineCoolingDown('firecrawl', 10_000), true);
  assert.equal(isEngineCoolingDown('firecrawl', 200_000), false);

  recordEngineRateLimit('exa', 180_000, 1000);
  recordEngineSuccess('exa');
  assert.equal(isEngineCoolingDown('exa', 10_000), false);
});

test('parseApproximateTimestamp, parseSearchSyntax regionOverride, and recency/regional ranking', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();
  const threeDaysAgo = parseApproximateTimestamp('há 3 dias', now);
  assert.equal(threeDaysAgo, now - 3 * 86_400_000);

  const yesterdayPt = parseApproximateTimestamp('ontem', now);
  assert.equal(yesterdayPt, now - 86_400_000);

  const parsedLang = parseSearchSyntax('Montenegro lang:pt');
  assert.equal(parsedLang.regionOverride, 'pt-PT');
  assert.equal(parsedLang.cleanQuery, 'Montenegro');

  const parsedBangPt = parseSearchSyntax('!pt eleições');
  assert.equal(parsedBangPt.regionOverride, 'pt-PT');
  assert.equal(parsedBangPt.cleanQuery, 'eleições');

  const ranked = deduplicateAndRank(
    [
      {
        id: 'old-foreign',
        title: 'Montenegro Archive 2022',
        url: 'https://example.org/2022',
        displayedUrl: 'example.org',
        snippet: 'Old report on Montenegro.',
        engine: 'duckduckgo',
        category: 'all',
        publishedDate: '2022-03-01',
        rankPosition: 0,
      },
      {
        id: 'fresh-pt',
        title: 'Luís Montenegro apresenta medidas em Lisboa',
        url: 'https://www.rtp.pt/noticias/politica/medidas',
        displayedUrl: 'rtp.pt',
        snippet: 'Declarações de Luís Montenegro hoje em Lisboa.',
        engine: 'bing',
        category: 'all',
        publishedDate: '2026-11-16',
        rankPosition: 1,
      },
    ],
    'Luís Montenegro',
    { regionCode: 'pt-PT', nowMs: now }
  );

  assert.equal(ranked[0].id, 'fresh-pt');
});

test('parseSearchSyntax supports new developer & academic bangs with aliases and sectionHints', () => {
  const docs = parseSearchSyntax('nextjs cookies !docs');
  assert.equal(docs.bang?.bang, '!docs');
  assert.equal(docs.bang?.category, 'code');
  assert.equal(docs.bang?.sectionHint, 'docs');
  assert.equal(docs.cleanQuery, 'nextjs cookies');

  const cwiki = parseSearchSyntax('!cwiki vercel/next.js');
  assert.equal(cwiki.bang?.bang, '!deepwiki');
  assert.equal(cwiki.bang?.category, 'code');
  assert.equal(cwiki.bang?.sectionHint, 'wikis');

  const pkg = parseSearchSyntax('zod !npm');
  assert.equal(pkg.bang?.bang, '!pkg');
  assert.equal(pkg.bang?.sectionHint, 'packages');

  const ds = parseSearchSyntax('climate ocean temperatures !dataset');
  assert.equal(ds.bang?.bang, '!dataset');
  assert.equal(ds.bang?.category, 'science');
  assert.equal(ds.bang?.sectionHint, 'datasets');

  const scholar = parseSearchSyntax('CRISPR !scholar');
  assert.equal(scholar.bang?.bang, '!paper');
  assert.equal(scholar.bang?.category, 'science');
});

test('parseExaMcpTextResponse handles Code/Highlights blocks and N/A titles cleanly', () => {
  const raw = [
    'Title: N/A',
    'URL: https://nextjs.org/docs/app/api-reference/functions/cookies',
    'Published: N/A',
    'Author: N/A',
    'Code/Highlights:',
    '```ts',
    'const cookieStore = await cookies()',
    '```',
    'Read incoming HTTP request cookies in Server Components.',
  ].join('\n');

  const parsed = parseExaMcpTextResponse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].url, 'https://nextjs.org/docs/app/api-reference/functions/cookies');
  assert.match(parsed[0].title, /nextjs\.org/);
  assert.match(parsed[0].snippet, /Read incoming HTTP request cookies/);
});

test('parseContext7ResolveResponse and parseContext7DocsResponse parse Context7 MCP output', () => {
  const resolveRaw = [
    'Available Libraries:',
    '- Title: Next.js',
    '- Context7-compatible library ID: /vercel/next.js',
    '- Description: The React Framework for the Web',
  ].join('\n');
  const resolved = parseContext7ResolveResponse(resolveRaw);
  assert.deepEqual(resolved, {
    id: '/vercel/next.js',
    title: 'Next.js',
    description: 'The React Framework for the Web',
  });

  const docsRaw = [
    '### Reading Request Cookies',
    'Source: https://nextjs.org/docs/app/api-reference/functions/cookies',
    'Use `await cookies()` inside Server Components and Route Handlers.',
    '----------------',
    '### Setting Response Cookies',
    'Source: https://nextjs.org/docs/app/api-reference/functions/cookies#set',
    'Set cookies securely with httpOnly inside Server Actions.',
  ].join('\n');
  const chunks = parseContext7DocsResponse(docsRaw, 'Next.js', 'https://context7.com/vercel/next.js');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].title, 'Reading Request Cookies');
  assert.match(chunks[0].snippet, /Server Components/);
  assert.equal(chunks[1].url, 'https://nextjs.org/docs/app/api-reference/functions/cookies#set');
});

test('sanitizeTrustedBaseUrl and buildRepoWikiLinks never expose untrusted OpenDeepWiki mirrors', () => {
  assert.equal(sanitizeTrustedBaseUrl(''), null);
  assert.equal(sanitizeTrustedBaseUrl('http://public-mirror.example.com'), null);
  assert.equal(sanitizeTrustedBaseUrl('https://user:pass@wiki.example.com'), null);
  assert.equal(sanitizeTrustedBaseUrl('https://wiki.internal.example/'), 'https://wiki.internal.example');
  assert.equal(sanitizeTrustedBaseUrl('http://localhost:8080/'), 'http://localhost:8080');

  const defaultLinks = buildRepoWikiLinks('vercel/next.js');
  assert.equal(defaultLinks.deepwiki, 'https://deepwiki.com/vercel/next.js');
  assert.equal(defaultLinks.googleCodeWiki, 'https://codewiki.google/github.com/vercel/next.js');
  assert.equal(defaultLinks.gitmcp, 'https://gitmcp.io/vercel/next.js');
  assert.equal(defaultLinks.openDeepWiki, undefined);

  const untrustedLinks = buildRepoWikiLinks('vercel/next.js', 'http://untrusted-mirror.tld');
  assert.equal(untrustedLinks.openDeepWiki, undefined);

  const trustedLinks = buildRepoWikiLinks('vercel/next.js', 'https://wiki.myteam.internal/');
  assert.equal(trustedLinks.openDeepWiki, 'https://wiki.myteam.internal/vercel/next.js');
});

test('detectSearchIntent classifies repo slugs, code queries, and science queries accurately', () => {
  const slugIntent = detectSearchIntent('vercel/next.js');
  assert.equal(slugIntent.isCode, true);
  assert.equal(slugIntent.repoSlug, 'vercel/next.js');

  const reactIntent = detectSearchIntent('react useEffect cleanup');
  assert.equal(reactIntent.isCode, true);
  assert.equal(reactIntent.isScience, false);

  const sciIntent = detectSearchIntent('quantum error correction surface code paper');
  assert.equal(sciIntent.isScience, true);
});

test('category-aware deduplicateAndRank prioritizes citations & PDFs in science and docs/MCP in code', () => {
  const sciRanked = deduplicateAndRank(
    [
      {
        id: 'wiki-1',
        title: 'Quantum computing overview',
        url: 'https://en.wikipedia.org/wiki/Quantum_computing',
        displayedUrl: 'en.wikipedia.org',
        snippet: 'Encyclopedia summary of quantum computing.',
        engine: 'wikipedia',
        category: 'science',
        rankPosition: 0,
      },
      {
        id: 'oa-1',
        title: 'Quantum Error Correction Survey',
        url: 'https://doi.org/10.1000/qec',
        displayedUrl: 'doi.org',
        snippet: 'Comprehensive peer-reviewed quantum computing survey.',
        engine: 'openalex',
        category: 'science',
        citations: 1200,
        pdfUrl: 'https://arxiv.org/pdf/1234.5678.pdf',
        rankPosition: 1,
      },
    ],
    'quantum computing',
    { category: 'science' }
  );
  assert.equal(sciRanked[0].id, 'oa-1');

  const codeRanked = deduplicateAndRank(
    [
      {
        id: 'hn-1',
        title: 'Discussion about cookies',
        url: 'https://news.ycombinator.com/item?id=123',
        displayedUrl: 'news.ycombinator.com',
        snippet: 'Discussion thread.',
        engine: 'hackernews',
        category: 'code',
        rankPosition: 0,
      },
      {
        id: 'c7-1',
        title: 'Next.js cookies API',
        url: 'https://nextjs.org/docs/cookies',
        displayedUrl: 'nextjs.org',
        snippet: 'Official Next.js cookies documentation.',
        engine: 'context7',
        category: 'code',
        rankPosition: 0,
      },
    ],
    'nextjs cookies',
    { category: 'code' }
  );
  assert.equal(codeRanked[0].id, 'c7-1');
});

test('user provider HTTP headers round-trip client keys & custom OpenDeepWiki URL cleanly', () => {
  const headersObj = buildUserProviderHeaders({
    context7ApiKey: 'ctx7-secret',
    semanticScholarApiKey: 's2-key',
    coreApiKey: 'core-key',
    openDeepWikiUrl: 'https://wiki.internal.example',
  });
  const headers = new Headers(headersObj);
  const extracted = extractUserProviderConfig(headers);
  assert.deepEqual(extracted, {
    context7ApiKey: 'ctx7-secret',
    semanticScholarApiKey: 's2-key',
    coreApiKey: 'core-key',
    openDeepWikiUrl: 'https://wiki.internal.example',
  });
});

test('normalizeConceptKeywords normalizes OpenAlex topic keyword objects and deduplicates strings', () => {
  const normalized = normalizeConceptKeywords([
    { id: 'https://openalex.org/keywords/quantum', display_name: 'Quantum Computation', score: 0.9 },
    'quantum computation',
    { id: 'https://openalex.org/keywords/qubits', display_name: 'Qubits', score: 0.8 },
    { id: 'bad', score: 0.1 },
    'Error Correction',
  ]);
  assert.deepEqual(normalized, ['Quantum Computation', 'Qubits', 'Error Correction']);
});

test('parseMcpJsonRpcPayload rejects isError payloads and buildRepoWikiLinks gates unindexed low-star repos', () => {
  const mcpErrSse =
    'event: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"text":"Error fetching wiki for canonical/agy-sdk: Repository not found. Visit https://deepwiki.com/canonical/agy-sdk to index it.","type":"text"}],"isError":true}}\r\n\r\n';
  assert.equal(parseMcpJsonRpcPayload(mcpErrSse), null);

  assert.equal(
    isDeepWikiErrorText('Error fetching wiki for canonical/agy-sdk: Repository not found. Visit https://deepwiki.com/canonical/agy-sdk to index it.'),
    true
  );
  assert.equal(isDeepWikiErrorText('## Architecture Overview\nNext.js uses App Router...'), false);

  const unindexedLinks = buildRepoWikiLinks('canonical/agy-sdk', undefined, {
    stars: 4,
    deepWikiVerified: false,
  });
  assert.equal(unindexedLinks.deepwiki, undefined);
  assert.equal(unindexedLinks.googleCodeWiki, undefined);
  assert.equal(unindexedLinks.gitmcp, 'https://gitmcp.io/canonical/agy-sdk');

  const popularLinks = buildRepoWikiLinks('vercel/next.js', undefined, {
    stars: 130000,
    deepWikiVerified: true,
  });
  assert.equal(popularLinks.deepwiki, 'https://deepwiki.com/vercel/next.js');
  assert.equal(popularLinks.googleCodeWiki, 'https://codewiki.google/github.com/vercel/next.js');
  assert.equal(popularLinks.gitmcp, 'https://gitmcp.io/vercel/next.js');
});


