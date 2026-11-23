import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import {
  classifySourceAccess,
  cleanMarkdownSnippet,
  decodeHtmlEntities,
  deduplicateAndRank,
  extractBingTargetUrl,
  extractDomain,
  extractTopicClusters,
  filterNewsByAccess,
  filterResultsBySyntax,
  getDisplayUrl,
  parseExaMcpTextResponse,
  parseMcpJsonRpcPayload,
  parseSearchSyntax,
  RegionProfile,
  resolveRegionProfile,
} from './search-engine';
import type {
  EngineHealth,
  NewsAccessFilter,
  SearchRegion,
  SearchResult,
  TimeRange,
} from './search-types';
import { resolveProviderConfig, type ProviderContext } from './provider-config';
import { searchBraveNews, searchSerperNews, SerpQuotaError } from './serp-providers';
import {
  buildNewsCacheKey,
  getCachedNewsResponse,
  isEngineCoolingDown,
  recordEngineRateLimit,
  recordEngineSuccess,
  setCachedNewsResponse,
} from './server-cache';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class NewsQuotaError extends Error {
  constructor(public readonly engine: string, public readonly status: number) {
    super(`${engine} quota/rate-limit (HTTP ${status})`);
    this.name = 'NewsQuotaError';
  }
}

type TimeoutFetch = (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>;

function createFetchWithDeadline(parentSignal?: AbortSignal): TimeoutFetch {
  return (url: string, options: RequestInit = {}, timeoutMs = 4500) => {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (parentSignal) signals.push(parentSignal);
    if (options.signal) signals.push(options.signal);
    return fetch(url, { ...options, signal: AbortSignal.any(signals) });
  };
}

function checkNewsQuota(engine: string, res: Response): void {
  if (res.status === 429 || res.status === 402) {
    throw new NewsQuotaError(engine, res.status);
  }
}

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatDateLabel(raw?: string | number): string | undefined {
  if (!raw) return undefined;
  try {
    const d = typeof raw === 'number' ? new Date(raw * 1000) : new Date(raw);
    if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : undefined;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return undefined;
  }
}

function timeRangeToDays(timeRange: TimeRange, defaultDays: number): number {
  if (timeRange === 'day') return 1;
  if (timeRange === 'week') return 7;
  if (timeRange === 'month') return 30;
  if (timeRange === 'year') return 365;
  return defaultDays;
}

function timeRangeToTbs(timeRange: TimeRange, fallback = 'qdr:m'): string {
  if (timeRange === 'day') return 'qdr:d';
  if (timeRange === 'week') return 'qdr:w';
  if (timeRange === 'month') return 'qdr:m';
  if (timeRange === 'year') return 'qdr:y';
  return fallback;
}

function timeRangeToDdgDf(timeRange: TimeRange): string | undefined {
  if (timeRange === 'day') return 'd';
  if (timeRange === 'week') return 'w';
  if (timeRange === 'month') return 'm';
  if (timeRange === 'year') return 'y';
  return undefined;
}

function timeRangeToBingQft(timeRange: TimeRange): string | undefined {
  // Bing News interval codes: 7=past 24h, 8=past 7d, 9=past 30d
  if (timeRange === 'day') return 'interval="7"';
  if (timeRange === 'week') return 'interval="8"';
  if (timeRange === 'month') return 'interval="9"';
  return undefined;
}

function timeRangeToLabel(timeRange: TimeRange): string {
  if (timeRange === 'day') return 'the past 24 hours';
  if (timeRange === 'week') return 'the past week';
  if (timeRange === 'month') return 'the past month';
  if (timeRange === 'year') return 'the past year';
  return 'recent days';
}

/**
 * 1. DuckDuckGo News (`duckduckgo.com/news.js`) — returns direct publisher URLs + images
 */
async function fetchDuckDuckGoNews(
  query: string,
  regionProfile: RegionProfile,
  timeRange: TimeRange,
  fetchFn: TimeoutFetch
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const pageRes = await fetchFn(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&ia=news&kl=${encodeURIComponent(regionProfile.ddgKl)}`,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9,en;q=0.7`,
      },
    },
    3500
  );
  checkNewsQuota('duckduckgo-news', pageRes);
  if (!pageRes.ok) return items;
  const html = await pageRes.text();
  const vqdMatch = html.match(/vqd=["']?([0-9-]+)["']?/) || html.match(/vqd=([0-9-]+)/);
  const vqd = vqdMatch?.[1];
  if (!vqd) return items;

  const df = timeRangeToDdgDf(timeRange);
  const newsParams = new URLSearchParams({
    l: regionProfile.ddgKl,
    o: 'json',
    q: query,
    vqd,
    p: '1',
  });
  if (df) newsParams.set('df', df);

  const newsRes = await fetchFn(
    `https://duckduckgo.com/news.js?${newsParams.toString()}`,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9`,
        Referer: 'https://duckduckgo.com/',
      },
    },
    3500
  );
  checkNewsQuota('duckduckgo-news', newsRes);
  if (!newsRes.ok) return items;
  const data = await newsRes.json();
  const results = Array.isArray(data.results) ? data.results : [];

  for (let i = 0; i < Math.min(results.length, 18); i++) {
    const r = results[i];
    if (!r.url || !r.title) continue;
    const sourceName = r.source ? decodeURIComponent(String(r.source)) : extractDomain(r.url);
    items.push({
      id: `ddg-news-${i}-${Date.now()}`,
      title: decodeHtmlEntities(r.title),
      url: r.url,
      displayedUrl: sourceName || getDisplayUrl(r.url),
      snippet: decodeHtmlEntities(r.excerpt || r.title),
      engine: 'duckduckgo-news',
      category: 'news',
      publishedDate: formatDateLabel(r.date) || r.relative_time,
      author: sourceName,
      thumbnail: r.image || undefined,
      rankPosition: i,
    });
  }
  return items;
}

/**
 * 2. Bing News RSS (`bing.com/news/search?format=rss`) — unwraps `url=` param to direct publisher URLs
 */
export async function fetchBingNewsRss(
  query: string,
  regionProfile: RegionProfile,
  timeRange: TimeRange = 'all',
  fetchFn: TimeoutFetch = createFetchWithDeadline()
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const params = new URLSearchParams({
    q: query,
    format: 'rss',
    cc: regionProfile.bingCc,
    setlang: regionProfile.bingLang,
  });
  const qft = timeRangeToBingQft(timeRange);
  if (qft) params.set('qft', qft);

  const rssUrl = `https://www.bing.com/news/search?${params.toString()}`;
  const res = await fetchFn(
    rssUrl,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9`,
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    },
    3500
  );
  checkNewsQuota('bing-news', res);
  if (!res.ok) return items;
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  $('item').each((i, el) => {
    if (i >= 18) return false;
    const rawTitle = $(el).find('title').text().trim();
    const rawLink = $(el).find('link').text().trim();
    const rawDesc = $(el).find('description').text().trim();
    const pubDate = $(el).find('pubDate').text().trim();
    const source = $(el).find('News\\:Source, source').text().trim() || '';
    const img =
      $(el).find('News\\:Image').text().trim() ||
      $(el).find('media\\:content, media\\:thumbnail').attr('url') ||
      '';

    const directUrl = extractBingTargetUrl(rawLink);
    if (!rawTitle || !directUrl || directUrl.includes('bing.com/news/')) return;

    const cleanTitle = decodeHtmlEntities(rawTitle);
    const cleanSnippet = decodeHtmlEntities(rawDesc) || cleanTitle;
    const domain = extractDomain(directUrl);

    items.push({
      id: `bing-news-${i}-${Date.now()}`,
      title: cleanTitle,
      url: directUrl,
      displayedUrl: source || domain,
      snippet: cleanSnippet,
      engine: 'bing-news',
      category: 'news',
      publishedDate: formatDateLabel(pubDate),
      author: source || domain,
      thumbnail: img || undefined,
      rankPosition: i,
    });
  });
  return items;
}

/**
 * 3. Direct Open-Access Publisher RSS Feeds (Portuguese + International wires)
 */
async function fetchDirectPublisherFeeds(
  topic: string,
  query: string | undefined,
  regionProfile: RegionProfile,
  fetchFn: TimeoutFetch
): Promise<SearchResult[]> {
  const feeds: Array<{ url: string; engine: string; label: string }> = [];
  const t = topic.toUpperCase();

  if (regionProfile.lang === 'pt') {
    feeds.push(
      { url: 'https://www.rtp.pt/noticias/rss', engine: 'rtp', label: 'RTP Notícias' },
      {
        url: 'https://www.noticiasaominuto.com/rss/ultima-hora',
        engine: 'noticiasaominuto',
        label: 'Notícias ao Minuto',
      },
      { url: 'https://observador.pt/feed/', engine: 'observador', label: 'Observador' },
      { url: 'https://eco.sapo.pt/feed/', engine: 'eco', label: 'ECO' },
      { url: 'https://feeds.feedburner.com/PublicoRSS', engine: 'publico', label: 'Público' }
    );
  }

  if (t === 'TECHNOLOGY') {
    feeds.push(
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', engine: 'bbc', label: 'BBC Tech' },
      { url: 'https://feeds.npr.org/1019/rss.xml', engine: 'npr', label: 'NPR Tech' },
      {
        url: 'https://www.theguardian.com/uk/technology/rss',
        engine: 'guardian',
        label: 'The Guardian',
      },
      {
        url: 'https://feeds.arstechnica.com/arstechnica/index',
        engine: 'arstechnica',
        label: 'Ars Technica',
      }
    );
  } else if (t === 'SCIENCE') {
    feeds.push(
      {
        url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        engine: 'bbc',
        label: 'BBC Science',
      },
      { url: 'https://feeds.npr.org/1007/rss.xml', engine: 'npr', label: 'NPR Science' },
      { url: 'https://www.theguardian.com/science/rss', engine: 'guardian', label: 'The Guardian' },
      {
        url: 'https://feeds.arstechnica.com/arstechnica/science',
        engine: 'arstechnica',
        label: 'Ars Science',
      }
    );
  } else if (t === 'BUSINESS') {
    feeds.push(
      {
        url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
        engine: 'bbc',
        label: 'BBC Business',
      },
      { url: 'https://feeds.npr.org/1006/rss.xml', engine: 'npr', label: 'NPR Business' },
      { url: 'https://www.theguardian.com/business/rss', engine: 'guardian', label: 'The Guardian' }
    );
  } else if (regionProfile.code !== 'pt-PT') {
    feeds.push(
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', engine: 'bbc', label: 'BBC World' },
      { url: 'https://feeds.npr.org/1001/rss.xml', engine: 'npr', label: 'NPR News' },
      { url: 'https://www.theguardian.com/world/rss', engine: 'guardian', label: 'The Guardian' },
      {
        url: 'https://feeds.arstechnica.com/arstechnica/index',
        engine: 'arstechnica',
        label: 'Ars Technica',
      }
    );
  } else {
    feeds.push({
      url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
      engine: 'bbc',
      label: 'BBC World',
    });
  }

  const results: SearchResult[] = [];
  const qTerms = query
    ? stripDiacritics(query)
        .split(/\s+/)
        .filter((w) => w.length > 2)
    : [];

  await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        const res = await fetchFn(feed.url, { headers: { 'User-Agent': BROWSER_UA } }, 3500);
        if (!res.ok) return;
        const xml = await res.text();
        const $ = cheerio.load(xml, { xmlMode: true });

        let idx = 0;
        $('item').each((_, el) => {
          if (idx >= 12) return false;
          const title = decodeHtmlEntities($(el).find('title').text().trim());
          const link = $(el).find('link').text().trim();
          const rawDesc = decodeHtmlEntities($(el).find('description').text().trim());
          const desc = cleanMarkdownSnippet(rawDesc, 260);
          const pubDate = $(el).find('pubDate').text().trim();
          const thumb =
            $(el).find('media\\:thumbnail').attr('url') ||
            $(el).find('media\\:content').last().attr('url') ||
            $(el).find('enclosure').attr('url') ||
            undefined;

          if (!title || !link || !link.startsWith('http')) return;

          if (qTerms.length > 0) {
            const hay = stripDiacritics(`${title} ${desc}`);
            const allMatch = qTerms.every((term) => hay.includes(term));
            const keyTermMatch = qTerms.some((term) => term.length >= 5 && hay.includes(term));
            if (!allMatch && !keyTermMatch) return;
          }

          results.push({
            id: `${feed.engine}-${idx}-${Date.now()}`,
            title,
            url: link,
            displayedUrl: feed.label || extractDomain(link),
            snippet: desc || title,
            engine: feed.engine,
            category: 'news',
            publishedDate: formatDateLabel(pubDate),
            author: feed.label,
            thumbnail: thumb,
            rankPosition: idx,
          });
          idx++;
        });
      } catch {
        // ignore individual RSS feed errors
      }
    })
  );

  return results;
}

/**
 * 4. Hacker News Algolia (for tech & breaking dev news with direct article links)
 */
async function fetchHackerNewsStories(
  query: string,
  timeRange: TimeRange,
  fetchFn: TimeoutFetch
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const params = new URLSearchParams({ hitsPerPage: '8' });
  if (query) {
    params.set('query', query);
    params.set('tags', 'story');
  } else {
    params.set('tags', 'front_page');
  }
  if (timeRange !== 'all') {
    const cutoffSec = Math.floor((Date.now() - timeRangeToDays(timeRange, 7) * 86_400_000) / 1000);
    params.set('numericFilters', `created_at_i>${cutoffSec}`);
  }

  const endpoint = `https://hn.algolia.com/api/v1/search?${params.toString()}`;
  const res = await fetchFn(endpoint, {}, 3000);
  checkNewsQuota('hackernews', res);
  if (!res.ok) return items;
  const data = await res.json();
  const hits = Array.isArray(data.hits) ? data.hits : [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit.title || !hit.url) continue;
    items.push({
      id: `hn-news-${hit.objectID}`,
      title: hit.title,
      url: hit.url,
      displayedUrl: extractDomain(hit.url),
      snippet: `${hit.points || 0} points · ${hit.num_comments || 0} comments via Hacker News`,
      engine: 'hackernews',
      category: 'news',
      publishedDate: formatDateLabel(hit.created_at),
      author: hit.author,
      rankPosition: i + 1,
    });
  }
  return items;
}

/**
 * 5. TinyFish Keyless / BYOK MCP News (`domain_type: "news"`)
 */
async function fetchTinyFishNews(
  query: string,
  regionProfile: RegionProfile,
  timeRange: TimeRange,
  page: number,
  fetchFn: TimeoutFetch,
  key?: string
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const tfArgs: Record<string, any> = {
    query,
    domain_type: 'news',
    recency_minutes: timeRangeToDays(timeRange, 7) * 1440,
    page: Math.max(0, Math.min(10, page - 1)),
  };
  if (regionProfile.code !== 'global') {
    tfArgs.location = regionProfile.country;
    tfArgs.language = regionProfile.lang;
  }

  const res = await fetchFn(
    'https://agent.tinyfish.ai/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(key
          ? { 'X-API-Key': key }
          : { 'X-TinyFish-Access-Mode': 'keyless' }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search',
          arguments: tfArgs,
        },
      }),
    },
    3800
  );
  checkNewsQuota('tinyfish-news', res);
  if (!res.ok) return items;
  const raw = await res.text();
  const inner = parseMcpJsonRpcPayload(raw);
  if (!inner) return items;
  const parsed = JSON.parse(inner);
  const list = Array.isArray(parsed.results) ? parsed.results.slice(0, 10) : [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r?.url || !r?.title) continue;
    items.push({
      id: `tf-news-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url: r.url,
      displayedUrl: r.site_name || extractDomain(r.url),
      snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 240),
      engine: 'tinyfish-news',
      category: 'news',
      publishedDate: r.date ? String(r.date) : undefined,
      author: r.site_name || extractDomain(r.url),
      rankPosition: i,
    });
  }
  return items;
}

/**
 * 6. Firecrawl Keyless / BYOK News (`sources: ["news"]`)
 */
async function fetchFirecrawlNews(
  query: string,
  regionProfile: RegionProfile,
  timeRange: TimeRange,
  fetchFn: TimeoutFetch,
  key?: string
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const fcPayload: Record<string, any> = {
    query,
    sources: ['news'],
    limit: 10,
    tbs: timeRangeToTbs(timeRange, 'qdr:m'),
  };
  if (regionProfile.code !== 'global') {
    fcPayload.location = regionProfile.countryName;
    fcPayload.country = regionProfile.country;
  }

  const res = await fetchFn(
    'https://api.firecrawl.dev/v2/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(fcPayload),
    },
    4000
  );
  checkNewsQuota('firecrawl-news', res);
  if (!res.ok) return items;
  const json = await res.json();
  const list = Array.isArray(json?.data?.news) ? json.data.news : [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r?.url || !r?.title) continue;
    items.push({
      id: `fc-news-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url: r.url,
      displayedUrl: extractDomain(r.url),
      snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 240),
      engine: 'firecrawl-news',
      category: 'news',
      publishedDate: r.date ? String(r.date) : undefined,
      author: extractDomain(r.url),
      thumbnail: r.imageUrl || undefined,
      rankPosition: i,
    });
  }
  return items;
}

/**
 * 7. Tavily Keyless / BYOK News (`topic: "news"`)
 */
async function fetchTavilyNews(
  query: string,
  timeRange: TimeRange,
  fetchFn: TimeoutFetch,
  key?: string
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const res = await fetchFn(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key
          ? { Authorization: `Bearer ${key}` }
          : { 'X-Tavily-Access-Mode': 'keyless' }),
      },
      body: JSON.stringify({
        query,
        topic: 'news',
        days: timeRangeToDays(timeRange, 14),
        max_results: 8,
        search_depth: 'basic',
      }),
    },
    3800
  );
  checkNewsQuota('tavily-news', res);
  if (!res.ok) return items;
  const data = await res.json();
  const list = Array.isArray(data?.results) ? data.results : [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r?.url || !r?.title) continue;
    items.push({
      id: `tav-news-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url: r.url,
      displayedUrl: extractDomain(r.url),
      snippet: cleanMarkdownSnippet(String(r.content || r.title), 240),
      engine: 'tavily-news',
      category: 'news',
      publishedDate: r.published_date ? formatDateLabel(r.published_date) : undefined,
      author: extractDomain(r.url),
      score: typeof r.score === 'number' ? r.score : undefined,
      rankPosition: i,
    });
  }
  return items;
}

/**
 * 8. Exa Keyless / BYOK MCP News (`web_search_exa` with news-targeted query & objective)
 */
async function fetchExaNews(
  query: string,
  regionProfile: RegionProfile,
  timeRange: TimeRange,
  fetchFn: TimeoutFetch,
  key?: string
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  const regionHint =
    regionProfile.code !== 'global' ? ` (${regionProfile.countryName} / ${regionProfile.lang})` : '';
  const windowLabel = timeRangeToLabel(timeRange);

  const res = await fetchFn(
    'https://mcp.exa.ai/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(key ? { 'x-api-key': key } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: {
            query: `latest news articles about ${query}`,
            objective: `Return only recent news articles from news outlets about ${query}${regionHint} published in ${windowLabel}; exclude encyclopedia pages and evergreen overviews.`,
            numResults: 8,
          },
        },
      }),
    },
    4000
  );
  checkNewsQuota('exa-news', res);
  if (!res.ok) return items;
  const raw = await res.text();
  const inner = parseMcpJsonRpcPayload(raw);
  if (!inner) return items;
  const parsed = parseExaMcpTextResponse(inner);
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    if (!r.url || !r.title) continue;
    items.push({
      id: `exa-news-${i}-${Date.now()}`,
      title: r.title,
      url: r.url,
      displayedUrl: extractDomain(r.url),
      snippet: r.snippet,
      engine: 'exa-news',
      category: 'news',
      publishedDate: r.publishedDate,
      author: r.author || extractDomain(r.url),
      rankPosition: i,
    });
  }
  return items;
}

export interface NewsOptions extends ProviderContext {
  query?: string | null;
  topic?: string | null;
  access?: NewsAccessFilter;
  region?: SearchRegion;
  timeRange?: TimeRange;
  page?: number;
  enginesParam?: string | null;
  signal?: AbortSignal;
  acceptLanguage?: string;
}

export interface NewsResponse {
  items: SearchResult[];
  featured: SearchResult | null;
  clusters: ReturnType<typeof extractTopicClusters>;
  region?: RegionProfile['code'];
  sourcesUsed: string[];
  engineHealth: EngineHealth[];
  timeTakenMs: number;
  cacheHit: boolean;
}

export async function searchNews(options: NewsOptions = {}): Promise<NewsResponse> {
  const startTime = Date.now();
  const hasUserOverrides = Object.keys(resolveProviderConfig({ userConfig: options.userConfig })).length > 0;
  const providers = resolveProviderConfig(options);
  const providerScope = Object.keys(providers).length
    ? createHash('sha256').update(JSON.stringify(providers)).digest('hex')
    : '';

  const rawQuery = options.query?.trim() || '';
  const parsedQuery = parseSearchSyntax(rawQuery);
  const q = parsedQuery.cleanQuery || rawQuery || undefined;
  const topic = options.topic?.trim() || 'TOP';
  const accessParam = options.access || 'all';
  const timeRange: TimeRange = options.timeRange || 'all';
  const page = Math.max(1, Math.min(10, options.page || 1));
  const regionParam = parsedQuery.regionOverride || options.region || 'auto';
  const langParam = options.acceptLanguage;
  const regionProfile = resolveRegionProfile(regionParam, q, langParam);

  const allowedEngines = options.enginesParam?.trim()
    ? new Set(
        options.enginesParam
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;
  const isSourceEnabled = (id: string, ...aliases: string[]) =>
    !allowedEngines || allowedEngines.has(id) || aliases.some((alias) => allowedEngines.has(alias));

  const cacheKey = buildNewsCacheKey({
    query: rawQuery,
    topic,
    region: regionProfile.code,
    access: accessParam,
    timeRange,
    page,
    engines: options.enginesParam || '',
    providerScope,
  });
  const cached = !hasUserOverrides ? getCachedNewsResponse<NewsResponse>(cacheKey) : null;
  if (cached) return cached;

  const defaultTopicQueries: Record<string, string> =
    regionProfile.lang === 'pt'
      ? {
          TOP: `${regionProfile.countryName} notícias hoje`,
          TECHNOLOGY: `tecnologia inteligência artificial ${regionProfile.countryName}`,
          SCIENCE: `ciência investigação espaço ${regionProfile.countryName}`,
          BUSINESS: `economia mercados finanças ${regionProfile.countryName}`,
        }
      : {
          TOP: 'world breaking news today',
          TECHNOLOGY: 'technology AI software cybersecurity news',
          SCIENCE: 'science space research discovery news',
          BUSINESS: 'global economy markets finance news',
        };

  const baseQuery =
    q || defaultTopicQueries[topic.toUpperCase()] || (regionProfile.lang === 'pt' ? 'notícias hoje' : 'latest news');
  const effectiveQuery = parsedQuery.site ? `${baseQuery} site:${parsedQuery.site}` : baseQuery;

  const fetchFn = createFetchWithDeadline(options.signal);
  const engineHealthMap = new Map<string, EngineHealth>();
  const cooldownKey = (engine: string) => (providerScope ? `${engine}:${providerScope}` : engine);

  const runTracked = async (
    engineId: string,
    label: string,
    enabled: boolean,
    fn: () => Promise<SearchResult[]>
  ): Promise<SearchResult[]> => {
    if (!enabled) {
      engineHealthMap.set(engineId, { engine: engineId, label, status: 'disabled', count: 0, durationMs: 0 });
      return [];
    }
    if (isEngineCoolingDown(cooldownKey(engineId))) {
      engineHealthMap.set(engineId, { engine: engineId, label, status: 'cooldown', count: 0, durationMs: 0 });
      return [];
    }
    const t0 = Date.now();
    try {
      const results = await fn();
      if (results.length > 0) recordEngineSuccess(cooldownKey(engineId));
      engineHealthMap.set(engineId, {
        engine: engineId,
        label,
        status: results.length > 0 ? 'ok' : 'empty',
        count: results.length,
        durationMs: Date.now() - t0,
      });
      return results;
    } catch (err) {
      const isQuota = err instanceof NewsQuotaError || err instanceof SerpQuotaError;
      if (isQuota) recordEngineRateLimit(cooldownKey(engineId));
      const isTimeout = err instanceof Error && ['AbortError', 'TimeoutError'].includes(err.name);
      engineHealthMap.set(engineId, {
        engine: engineId,
        label,
        status: isQuota ? 'cooldown' : isTimeout ? 'timeout' : 'error',
        count: 0,
        durationMs: Date.now() - t0,
      });
      return [];
    }
  };

  try {
    const rssEnabled =
      page === 1 &&
      isSourceEnabled('rss', 'direct-rss', 'bbc', 'npr', 'guardian', 'arstechnica', 'rtp', 'observador', 'eco', 'publico', 'noticiasaominuto');
    const hnEnabled =
      page === 1 &&
      Boolean(q || topic.toUpperCase() === 'TECHNOLOGY') &&
      isSourceEnabled('hackernews');

    const tasks: Array<Promise<SearchResult[]>> = [
      runTracked('duckduckgo-news', 'DuckDuckGo News', page === 1 && isSourceEnabled('duckduckgo-news', 'duckduckgo'), () =>
        fetchDuckDuckGoNews(effectiveQuery, regionProfile, timeRange, fetchFn)
      ),
      runTracked('bing-news', 'Bing News', page === 1 && isSourceEnabled('bing-news', 'bing'), () =>
        fetchBingNewsRss(effectiveQuery, regionProfile, timeRange, fetchFn)
      ),
      runTracked('direct-rss', 'Publisher Wires', rssEnabled, () =>
        fetchDirectPublisherFeeds(topic, q, regionProfile, fetchFn)
      ),
      runTracked('hackernews', 'Hacker News', hnEnabled, () =>
        fetchHackerNewsStories(q || 'technology', timeRange, fetchFn)
      ),
      runTracked('tinyfish-news', 'TinyFish News', isSourceEnabled('tinyfish-news', 'tinyfish'), () =>
        fetchTinyFishNews(effectiveQuery, regionProfile, timeRange, page, fetchFn, providers.tinyfishApiKey)
      ),
      runTracked('firecrawl-news', 'Firecrawl News', page === 1 && isSourceEnabled('firecrawl-news', 'firecrawl'), () =>
        fetchFirecrawlNews(effectiveQuery, regionProfile, timeRange, fetchFn, providers.firecrawlApiKey)
      ),
      runTracked('tavily-news', 'Tavily News', page === 1 && isSourceEnabled('tavily-news', 'tavily'), () =>
        fetchTavilyNews(effectiveQuery, timeRange, fetchFn, providers.tavilyApiKey)
      ),
      runTracked('exa-news', 'Exa News', page === 1 && isSourceEnabled('exa-news', 'exa'), () =>
        fetchExaNews(effectiveQuery, regionProfile, timeRange, fetchFn, providers.exaApiKey)
      ),
    ];

    if (providers.serperApiKey) {
      tasks.push(
        runTracked('serper-news', 'Serper News', isSourceEnabled('serper-news', 'serper'), () =>
          searchSerperNews({
            query: effectiveQuery,
            apiKey: providers.serperApiKey!,
            page,
            timeRange,
            regionProfile,
            fetchFn,
            timeoutMs: 4000,
          })
        )
      );
    }

    if (providers.braveApiKey) {
      tasks.push(
        runTracked('brave-news', 'Brave News', isSourceEnabled('brave-news', 'brave'), () =>
          searchBraveNews({
            query: effectiveQuery,
            apiKey: providers.braveApiKey!,
            page,
            timeRange,
            regionProfile,
            fetchFn,
            timeoutMs: 4000,
          })
        )
      );
    }

    const settled = await Promise.all(tasks);
    const combined = settled.flat();

    // Ensure zero Google News wrapper URLs slip through and annotate accessType
    const cleanDirect = combined
      .filter((item) => item.url && item.url.startsWith('http') && !item.url.includes('news.google.com'))
      .map((item) => ({
        ...item,
        accessType: classifySourceAccess(item.url),
      }));

    // Enforce syntax operators (site:, "exact", -exclude) and post-fetch recency cap across all sources
    const syntaxFiltered = filterResultsBySyntax(cleanDirect, parsedQuery, timeRange);
    const ranked = deduplicateAndRank(syntaxFiltered, q || undefined, {
      category: 'news',
      regionCode: regionProfile.code,
      timeRange,
    });
    const filtered = filterNewsByAccess(ranked, accessParam);
    const clusters = extractTopicClusters(filtered);

    const response: NewsResponse = {
      items: filtered,
      featured: filtered[0] || null,
      clusters,
      region: regionProfile.code,
      sourcesUsed: Array.from(new Set(filtered.flatMap((r) => r.engine.split(', ')))),
      engineHealth: Array.from(engineHealthMap.values()),
      timeTakenMs: Date.now() - startTime,
      cacheHit: false,
    };

    if (!hasUserOverrides && !options.signal?.aborted && filtered.length > 0) {
      setCachedNewsResponse(cacheKey, response);
    }

    return response;
  } catch {
    const fallbackItems: SearchResult[] = [
      {
        id: 'fallback-news-1',
        title: 'BBC World News — Live International Reporting',
        url: 'https://www.bbc.com/news/world',
        displayedUrl: 'bbc.com',
        snippet: 'Direct international journalism, policy updates, and verified field reports.',
        engine: 'bbc',
        category: 'news',
        publishedDate: 'Today',
        author: 'BBC News',
      },
      {
        id: 'fallback-news-2',
        title: 'Ars Technica — Technology, Science, and Policy Coverage',
        url: 'https://arstechnica.com/',
        displayedUrl: 'arstechnica.com',
        snippet: 'In-depth technology, science, and engineering journalism.',
        engine: 'arstechnica',
        category: 'news',
        publishedDate: 'Today',
        author: 'Ars Technica',
      },
    ];
    return {
      items: fallbackItems,
      featured: fallbackItems[0],
      clusters: [],
      region: regionProfile.code,
      sourcesUsed: ['bbc', 'arstechnica'],
      engineHealth: Array.from(engineHealthMap.values()),
      timeTakenMs: Date.now() - startTime,
      cacheHit: false,
    };
  }
}
