import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  classifySourceAccess,
  decodeHtmlEntities,
  deduplicateAndRank,
  extractBingTargetUrl,
  extractDomain,
  extractTopicClusters,
  filterNewsByAccess,
  getDisplayUrl,
  parseMcpJsonRpcPayload,
  cleanMarkdownSnippet,
  resolveRegionProfile,
  RegionProfile,
} from '@/lib/search-engine';
import { NewsAccessFilter, SearchRegion, SearchResult } from '@/lib/search-types';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
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
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return undefined;
  }
}

/**
 * 1. DuckDuckGo News (`duckduckgo.com/news.js`) — returns direct publisher URLs + images
 */
async function fetchDuckDuckGoNews(
  query: string,
  regionProfile: RegionProfile
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const pageRes = await fetchWithTimeout(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&ia=news&kl=${encodeURIComponent(regionProfile.ddgKl)}`,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9,en;q=0.7`,
        },
      },
      3500
    );
    if (!pageRes.ok) return items;
    const html = await pageRes.text();
    const vqdMatch = html.match(/vqd=["']?([0-9-]+)["']?/) || html.match(/vqd=([0-9-]+)/);
    const vqd = vqdMatch?.[1];
    if (!vqd) return items;

    const newsRes = await fetchWithTimeout(
      `https://duckduckgo.com/news.js?l=${encodeURIComponent(regionProfile.ddgKl)}&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&p=1`,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9`,
          Referer: 'https://duckduckgo.com/',
        },
      },
      3500
    );
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
        publishedDate: r.relative_time || formatDateLabel(r.date),
        author: sourceName,
        thumbnail: r.image || undefined,
        rankPosition: i,
      });
    }
  } catch {
    // ignore
  }
  return items;
}

/**
 * 2. Bing News RSS (`bing.com/news/search?format=rss`) — unwraps `url=` param to direct publisher URLs
 */
async function fetchBingNewsRss(
  query: string,
  regionProfile: RegionProfile
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const rssUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&cc=${encodeURIComponent(regionProfile.bingCc)}&setlang=${encodeURIComponent(regionProfile.bingLang)}`;
    const res = await fetchWithTimeout(
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
  } catch {
    // ignore
  }
  return items;
}

/**
 * 3. Direct Open-Access Publisher RSS Feeds (Portuguese + International wires)
 */
async function fetchDirectPublisherFeeds(
  topic: string,
  query: string | undefined,
  regionProfile: RegionProfile
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
    // Keep BBC World alongside Portuguese national wires for balanced international coverage
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
        const res = await fetchWithTimeout(feed.url, { headers: { 'User-Agent': BROWSER_UA } }, 3500);
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
        // ignore
      }
    })
  );

  return results;
}

/**
 * 4. Hacker News Algolia (for tech & breaking dev news with direct article links)
 */
async function fetchHackerNewsStories(query: string): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const endpoint = query
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`
      : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=8`;
    const res = await fetchWithTimeout(endpoint, {}, 3000);
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
  } catch {
    // ignore
  }
  return items;
}

/**
 * 5. TinyFish Keyless MCP News (`domain_type: "news"`)
 */
async function fetchTinyFishNews(
  query: string,
  regionProfile: RegionProfile
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const tfArgs: Record<string, any> = {
      query,
      domain_type: 'news',
      recency_minutes: 10080,
      page: 0,
    };
    if (regionProfile.code !== 'global') {
      tfArgs.location = regionProfile.country;
      tfArgs.language = regionProfile.lang;
    }

    const res = await fetchWithTimeout(
      'https://agent.tinyfish.ai/mcp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(process.env.TINYFISH_API_KEY
            ? { 'X-API-Key': process.env.TINYFISH_API_KEY }
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
        id: `tf-news-${i}-${Date.now()}`,
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
  } catch {
    // ignore
  }
  return items;
}

/**
 * 6. Firecrawl Keyless News (`sources: ["news"]`) — returns `data.news` with dates & thumbnails
 */
async function fetchFirecrawlNews(
  query: string,
  regionProfile: RegionProfile
): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const fcPayload: Record<string, any> = {
      query,
      sources: ['news'],
      limit: 10,
      tbs: 'qdr:m',
    };
    if (regionProfile.code !== 'global') {
      fcPayload.location = regionProfile.countryName;
      fcPayload.country = regionProfile.country;
    }

    const res = await fetchWithTimeout(
      'https://api.firecrawl.dev/v2/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.FIRECRAWL_API_KEY
            ? { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` }
            : {}),
        },
        body: JSON.stringify(fcPayload),
      },
      4000
    );
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
  } catch {
    // ignore
  }
  return items;
}

/**
 * 7. Tavily Keyless News (`topic: "news"`)
 */
async function fetchTavilyNews(query: string): Promise<SearchResult[]> {
  const items: SearchResult[] = [];
  try {
    const res = await fetchWithTimeout(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.TAVILY_API_KEY
            ? { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }
            : { 'X-Tavily-Access-Mode': 'keyless' }),
        },
        body: JSON.stringify({
          query,
          topic: 'news',
          days: 14,
          max_results: 8,
          search_depth: 'basic',
        }),
      },
      3800
    );
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
  } catch {
    // ignore
  }
  return items;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const topic = searchParams.get('topic')?.trim() || 'TOP';
  const accessParam = (searchParams.get('access') as NewsAccessFilter) || 'all';
  const regionParam = (searchParams.get('region') as SearchRegion) || 'auto';
  const langParam = searchParams.get('lang') || req.headers.get('accept-language') || undefined;
  const regionProfile = resolveRegionProfile(regionParam, q, langParam);

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

  const effectiveQuery =
    q || defaultTopicQueries[topic.toUpperCase()] || (regionProfile.lang === 'pt' ? 'notícias hoje' : 'latest news');

  try {
    const [ddgRes, bingRes, rssRes, hnRes, tfRes, fcRes, tavRes] = await Promise.allSettled([
      fetchDuckDuckGoNews(effectiveQuery, regionProfile),
      fetchBingNewsRss(effectiveQuery, regionProfile),
      fetchDirectPublisherFeeds(topic, q, regionProfile),
      q || topic.toUpperCase() === 'TECHNOLOGY'
        ? fetchHackerNewsStories(q || 'technology')
        : Promise.resolve([]),
      fetchTinyFishNews(effectiveQuery, regionProfile),
      fetchFirecrawlNews(effectiveQuery, regionProfile),
      fetchTavilyNews(effectiveQuery),
    ]);

    const combined: SearchResult[] = [
      ...(ddgRes.status === 'fulfilled' ? ddgRes.value : []),
      ...(bingRes.status === 'fulfilled' ? bingRes.value : []),
      ...(rssRes.status === 'fulfilled' ? rssRes.value : []),
      ...(hnRes.status === 'fulfilled' ? hnRes.value : []),
      ...(tfRes.status === 'fulfilled' ? tfRes.value : []),
      ...(fcRes.status === 'fulfilled' ? fcRes.value : []),
      ...(tavRes.status === 'fulfilled' ? tavRes.value : []),
    ];

    // Ensure zero Google News wrapper URLs slip through and annotate accessType
    const cleanDirect = combined
      .filter((item) => item.url && item.url.startsWith('http') && !item.url.includes('news.google.com'))
      .map((item) => ({
        ...item,
        accessType: classifySourceAccess(item.url),
      }));

    const ranked = deduplicateAndRank(cleanDirect, q || undefined);
    const filtered = filterNewsByAccess(ranked, accessParam);
    const clusters = extractTopicClusters(filtered);

    return NextResponse.json({
      items: filtered,
      featured: filtered[0] || null,
      clusters,
      region: regionProfile.code,
      sourcesUsed: Array.from(new Set(filtered.flatMap((r) => r.engine.split(', ')))),
    });
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
        snippet: 'In-depth technical reporting on computing, hardware, spaceflight, and open-source software.',
        engine: 'arstechnica',
        category: 'news',
        publishedDate: 'Today',
        author: 'Ars Technica',
      },
    ];

    return NextResponse.json({
      items: fallbackItems,
      featured: fallbackItems[0],
      clusters: extractTopicClusters(fallbackItems),
      sourcesUsed: ['bbc', 'arstechnica'],
    });
  }
}
