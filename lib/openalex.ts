import { createHash } from 'node:crypto';
import { decodeHtmlEntities, getDisplayUrl, reconstructOpenAlexAbstract } from './search-engine';
import type { SearchResult } from './search-types';

export class OpenAlexError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}

const cache = new Map<string, { expires: number; data: any }>();
const limits = new Map<string, { until: number; window: number; count: number }>();
const pending = new Map<string, Promise<any>>();

export async function openAlexGet(path: string, params: Record<string, string> = {}, apiKey?: string, timeoutMs = 3500): Promise<any> {
  if (!/^(works(?:\/[^?#]+)?|topics|rate-limit)$/.test(path)) throw new Error('Unsupported OpenAlex endpoint');
  const key = apiKey?.trim() || process.env.OPENALEX_API_KEY?.trim() || '';
  const scope = createHash('sha256').update(key).digest('hex');
  const url = new URL(`https://api.openalex.org/${path}`);
  url.search = new URLSearchParams(params).toString();
  const cacheKey = `${scope}:${url}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.data);
  const existing = pending.get(cacheKey);
  if (existing) return structuredClone(await existing);
  const now = Date.now();
  let limit = limits.get(scope);
  if (!limit) {
    if (limits.size >= 100) limits.delete(limits.keys().next().value!);
    limit = { until: 0, window: now, count: 0 }; limits.set(scope, limit);
  }
  if (limit.until > now) throw new OpenAlexError('OpenAlex quota is cooling down', 429, Math.ceil((limit.until - now) / 1000));
  if (now - limit.window >= 1000) { limit.window = now; limit.count = 0; }
  if (limit.count >= (key ? 30 : 10)) throw new OpenAlexError('OpenAlex request rate exceeded; retry shortly', 429, 1);
  if (pending.size >= 16) throw new OpenAlexError('OpenAlex is busy; retry shortly', 429, 1);
  limit.count++;
  const request = (async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Pharol/1.0', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const rawRetry = response.headers.get('retry-after');
      const retry = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry)
        : rawRetry ? Math.ceil((Date.parse(rawRetry) - Date.now()) / 1000) : 0;
      const reset = response.headers.get('x-ratelimit-remaining') === '0'
        ? Number(response.headers.get('x-ratelimit-reset')) : 0;
      const seconds = Math.min(86400, Math.max(1, Number.isFinite(retry) ? retry : 0, Number.isFinite(reset) ? reset : 0));
      if (response.status === 429 || response.status === 402) limit!.until = Date.now() + seconds * 1000;
      throw new OpenAlexError(`OpenAlex returned HTTP ${response.status}; check your key or quota`, response.status, seconds);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid OpenAlex response');
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { expires: Date.now() + (path === 'rate-limit' ? 30_000 : 180_000), data });
    return data;
  })();
  pending.set(cacheKey, request);
  try { return structuredClone(await request); } finally { pending.delete(cacheKey); }
}

export function normalizePaperIdentifier(identifier: unknown): string {
  if (typeof identifier !== 'string' || identifier.length > 1024) throw new Error('Use a DOI or OpenAlex work ID');
  let value = identifier.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (!['doi.org', 'dx.doi.org', 'openalex.org'].includes(url.host) || url.username || url.password || url.search || url.hash) {
      throw new Error('Identifier URLs must be from doi.org or openalex.org without query strings');
    }
    value = decodeURIComponent(url.pathname.slice(1));
    if (url.host === 'openalex.org' && !/^W\d+$/i.test(value)) throw new Error('Expected an OpenAlex work ID');
  } else value = value.replace(/^doi:\s*/i, '');
  if (/^W\d+$/i.test(value)) return value.toUpperCase();
  if (/^10\.\d{4,9}\/[^\s\x00-\x1f\x7f?#]+$/i.test(value)) return `doi:${value.toLowerCase()}`;
  throw new Error('Use a DOI or OpenAlex work ID; paper titles are ambiguous');
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch {}
}

export interface PaperResult extends SearchResult {
  openalexId?: string; references?: string[]; isOpenAccess?: boolean; openAccessUrl?: string;
}

// Adapted from openags/paper-search-mcp; see third_party/paper-search/NOTICE.md.
export function mapOpenAlexWork(work: any, rankPosition = 0): PaperResult | null {
  if (!work || typeof work.title !== 'string' || !work.title.trim() || !/^https:\/\/openalex.org\/W\d+$/.test(work.id)) return null;
  const primary = work.primary_location || {};
  const best = work.best_oa_location || {};
  const url = httpUrl(work.doi) || httpUrl(primary.landing_page_url) || work.id;
  const authors = (Array.isArray(work.authorships) ? work.authorships : []).map((a: any) => a?.author?.display_name).filter((v: unknown) => typeof v === 'string');
  // An OA landing page is not necessarily a PDF; retain the two separately.
  const pdfUrl = httpUrl(best.pdf_url) || (primary.is_oa ? httpUrl(primary.pdf_url) : undefined);
  return {
    id: `oa-${work.id}`, openalexId: work.id.split('/').pop(), title: decodeHtmlEntities(work.title),
    url, displayedUrl: getDisplayUrl(url), snippet: reconstructOpenAlexAbstract(work.abstract_inverted_index)
      || `${authors.slice(0, 4).join(', ')} · ${primary.source?.display_name || 'OpenAlex'}`,
    engine: 'openalex', category: 'science',
    scienceSection: work.type === 'dataset' ? 'datasets' : work.type === 'preprint' ? 'preprints' : 'papers',
    authors, doi: typeof work.doi === 'string' ? work.doi.replace(/^https?:\/\/doi.org\//, '') : undefined,
    publishedDate: work.publication_date || (work.publication_year ? String(work.publication_year) : undefined),
    journal: primary.source?.display_name, citations: work.cited_by_count || 0, pdfUrl, rankPosition,
    isOpenAccess: Boolean(work.open_access?.is_oa),
    openAccessUrl: httpUrl(best.landing_page_url) || httpUrl(work.open_access?.oa_url),
    references: (Array.isArray(work.referenced_works) ? work.referenced_works : [])
      .filter((id: unknown) => typeof id === 'string' && /^https:\/\/openalex.org\/W\d+$/.test(id)).map((id: string) => id.split('/').pop()),
  };
}

export async function lookupOpenAlexPaper(identifier: unknown, key?: string) {
  const normalized = normalizePaperIdentifier(identifier);
  const path = normalized.startsWith('doi:') ? `doi:${encodeURIComponent(normalized.slice(4))}` : normalized;
  const raw = await openAlexGet(`works/${path}`, {}, key);
  const paper = mapOpenAlexWork(raw);
  if (!paper) throw new Error('OpenAlex returned an invalid paper');
  return { raw, paper };
}
