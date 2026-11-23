import {
  cleanMarkdownSnippet,
  decodeHtmlEntities,
  extractDomain,
  getDisplayUrl,
  type RegionProfile,
} from './search-engine';
import type { SearchResult, TimeRange } from './search-types';

export type SerpFetch = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;

export class SerpQuotaError extends Error {
  constructor(public readonly engine: string, public readonly status: number) {
    super(`${engine} rate limit or quota exceeded (HTTP ${status})`);
    this.name = 'SerpQuotaError';
  }
}

export interface SerpQueryOptions {
  query: string;
  apiKey: string;
  page?: number;
  timeRange?: TimeRange;
  regionProfile: RegionProfile;
  fetchFn?: SerpFetch;
  timeoutMs?: number;
}

const SERPER_TBS: Record<TimeRange, string | undefined> = {
  all: undefined,
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
};

const BRAVE_FRESHNESS: Record<TimeRange, string | undefined> = {
  all: undefined,
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

function defaultFetch(url: string, init: RequestInit = {}, timeoutMs = 3800): Promise<Response> {
  const signal = init.signal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), init.signal])
    : AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function extractYouTubeEmbed(url: string): string | undefined {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : undefined;
}

async function postSerper(
  endpoint: 'search' | 'news' | 'images' | 'videos',
  engineId: string,
  options: SerpQueryOptions,
  num: number
): Promise<any | null> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const page = Math.max(1, Math.min(10, options.page ?? 1));
  const body: Record<string, unknown> = {
    q: options.query,
    num,
    page,
  };
  if (options.regionProfile.code !== 'global') {
    body.gl = options.regionProfile.country.toLowerCase();
    body.hl = options.regionProfile.lang;
  }
  const tbs = SERPER_TBS[options.timeRange ?? 'all'];
  if (tbs) body.tbs = tbs;

  const res = await fetchFn(
    `https://google.serper.dev/${endpoint}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': options.apiKey,
      },
      body: JSON.stringify(body),
    },
    options.timeoutMs ?? 3600
  );
  if (res.status === 429 || res.status === 402) {
    throw new SerpQuotaError(engineId, res.status);
  }
  if (!res.ok) return null;
  return res.json();
}

export async function searchSerperWeb(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await postSerper('search', 'serper', options, 10);
  const list = Array.isArray(data?.organic) ? data.organic : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.link) || !r?.title) continue;
    const url = r.link.trim();
    out.push({
      id: `serper-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: getDisplayUrl(url),
      snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 280),
      engine: 'serper',
      category: 'all',
      publishedDate: r.date ? String(r.date) : undefined,
      rankPosition: typeof r.position === 'number' ? r.position - 1 : i,
    });
  }
  return out;
}

export async function searchSerperNews(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await postSerper('news', 'serper-news', options, 10);
  const list = Array.isArray(data?.news) ? data.news : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.link) || !r?.title) continue;
    const url = r.link.trim();
    out.push({
      id: `serper-news-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: r.source ? String(r.source) : extractDomain(url),
      snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 240),
      engine: 'serper-news',
      category: 'news',
      publishedDate: r.date ? String(r.date) : undefined,
      author: r.source ? String(r.source) : extractDomain(url),
      thumbnail: isHttpUrl(r.imageUrl) ? r.imageUrl.trim() : undefined,
      rankPosition: typeof r.position === 'number' ? r.position - 1 : i,
    });
  }
  return out;
}

export async function searchSerperImages(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await postSerper('images', 'serper-images', options, 12);
  const list = Array.isArray(data?.images) ? data.images : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const thumb = isHttpUrl(r?.thumbnailUrl) ? r.thumbnailUrl.trim() : isHttpUrl(r?.imageUrl) ? r.imageUrl.trim() : undefined;
    const url = isHttpUrl(r?.link) ? r.link.trim() : thumb;
    if (!url || !thumb) continue;
    out.push({
      id: `serper-img-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title || options.query)),
      url,
      displayedUrl: r.source ? String(r.source) : getDisplayUrl(url),
      snippet: `${r.source ? `${r.source} · ` : ''}${r.imageWidth || 0}×${r.imageHeight || 0}`,
      engine: 'serper-images',
      category: 'images',
      thumbnail: thumb,
      imageWidth: typeof r.imageWidth === 'number' ? r.imageWidth : undefined,
      imageHeight: typeof r.imageHeight === 'number' ? r.imageHeight : undefined,
      rankPosition: i,
    });
  }
  return out;
}

export async function searchSerperVideos(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await postSerper('videos', 'serper-videos', options, 10);
  const list = Array.isArray(data?.videos) ? data.videos : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.link) || !r?.title) continue;
    const url = r.link.trim();
    out.push({
      id: `serper-vid-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: r.source ? String(r.source) : getDisplayUrl(url),
      snippet: cleanMarkdownSnippet(String(r.snippet || r.channel || r.title), 240),
      engine: 'serper-videos',
      category: 'videos',
      thumbnail: isHttpUrl(r.imageUrl) ? r.imageUrl.trim() : undefined,
      embedUrl: extractYouTubeEmbed(url),
      duration: r.duration ? String(r.duration) : undefined,
      publishedDate: r.date ? String(r.date) : undefined,
      author: r.channel ? String(r.channel) : undefined,
      rankPosition: i,
    });
  }
  return out;
}

async function getBrave(
  endpoint: 'web' | 'news' | 'images' | 'videos',
  engineId: string,
  options: SerpQueryOptions,
  count: number,
  supportsOffset = true
): Promise<any | null> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const page = Math.max(1, Math.min(10, options.page ?? 1));
  if (!supportsOffset && page > 1) return null;

  const params = new URLSearchParams({
    q: options.query,
    count: String(count),
  });
  if (supportsOffset && page > 1) {
    params.set('offset', String(page - 1));
  }
  if (options.regionProfile.code !== 'global') {
    params.set('country', options.regionProfile.country.toUpperCase());
    params.set('search_lang', options.regionProfile.lang);
  }
  const freshness = BRAVE_FRESHNESS[options.timeRange ?? 'all'];
  if (freshness && endpoint !== 'images') {
    params.set('freshness', freshness);
  }

  const res = await fetchFn(
    `https://api.search.brave.com/res/v1/${endpoint}/search?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': options.apiKey,
      },
    },
    options.timeoutMs ?? 3600
  );
  if (res.status === 429 || res.status === 402) {
    throw new SerpQuotaError(engineId, res.status);
  }
  if (!res.ok) return null;
  return res.json();
}

export async function searchBraveWeb(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await getBrave('web', 'brave', options, 10, true);
  const list = Array.isArray(data?.web?.results) ? data.web.results : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.url) || !r?.title) continue;
    const url = r.url.trim();
    out.push({
      id: `brave-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: getDisplayUrl(url),
      snippet: cleanMarkdownSnippet(String(r.description || r.title), 280),
      engine: 'brave',
      category: 'all',
      publishedDate: r.page_age ? String(r.page_age).slice(0, 10) : r.age ? String(r.age) : undefined,
      thumbnail: isHttpUrl(r.thumbnail?.src) ? r.thumbnail.src.trim() : undefined,
      rankPosition: i,
    });
  }
  return out;
}

export async function searchBraveNews(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await getBrave('news', 'brave-news', options, 10, true);
  const list = Array.isArray(data?.results) ? data.results : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.url) || !r?.title) continue;
    const url = r.url.trim();
    const source = r.meta_url?.hostname ? String(r.meta_url.hostname).replace(/^www\./, '') : extractDomain(url);
    out.push({
      id: `brave-news-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: source,
      snippet: cleanMarkdownSnippet(String(r.description || r.title), 240),
      engine: 'brave-news',
      category: 'news',
      publishedDate: r.page_age ? String(r.page_age).slice(0, 10) : r.age ? String(r.age) : undefined,
      author: source,
      thumbnail: isHttpUrl(r.thumbnail?.src) ? r.thumbnail.src.trim() : undefined,
      rankPosition: i,
    });
  }
  return out;
}

export async function searchBraveImages(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await getBrave('images', 'brave-images', options, 12, false);
  const list = Array.isArray(data?.results) ? data.results : [];
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const thumb = isHttpUrl(r?.thumbnail?.src) ? r.thumbnail.src.trim() : isHttpUrl(r?.properties?.url) ? r.properties.url.trim() : undefined;
    const url = isHttpUrl(r?.url) ? r.url.trim() : thumb;
    if (!url || !thumb) continue;
    out.push({
      id: `brave-img-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title || options.query)),
      url,
      displayedUrl: r.source ? String(r.source) : getDisplayUrl(url),
      snippet: `${r.source ? `${r.source} · ` : ''}${r.properties?.width || 0}×${r.properties?.height || 0}`,
      engine: 'brave-images',
      category: 'images',
      thumbnail: thumb,
      imageWidth: typeof r.properties?.width === 'number' ? r.properties.width : undefined,
      imageHeight: typeof r.properties?.height === 'number' ? r.properties.height : undefined,
      rankPosition: i,
    });
  }
  return out;
}

export async function searchBraveVideos(options: SerpQueryOptions): Promise<SearchResult[]> {
  const data = await getBrave('videos', 'brave-videos', options, 10, true);
  const list = Array.isArray(data?.results) ? data.results : [];
  const page = options.page ?? 1;
  const out: SearchResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!isHttpUrl(r?.url) || !r?.title) continue;
    const url = r.url.trim();
    out.push({
      id: `brave-vid-${page}-${i}-${Date.now()}`,
      title: decodeHtmlEntities(String(r.title)),
      url,
      displayedUrl: getDisplayUrl(url),
      snippet: cleanMarkdownSnippet(String(r.description || r.video?.creator || r.title), 240),
      engine: 'brave-videos',
      category: 'videos',
      thumbnail: isHttpUrl(r.thumbnail?.src) ? r.thumbnail.src.trim() : undefined,
      embedUrl: extractYouTubeEmbed(url),
      duration: r.video?.duration ? String(r.video.duration) : undefined,
      views: r.video?.views !== undefined ? `${Number(r.video.views).toLocaleString()} views` : undefined,
      publishedDate: r.age ? String(r.age) : undefined,
      author: r.video?.creator ? String(r.video.creator) : undefined,
      rankPosition: i,
    });
  }
  return out;
}
