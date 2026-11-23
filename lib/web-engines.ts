// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from SearXNG's Google, Bing and DuckDuckGo engines.
// Upstream revision and license: ../third_party/searxng/NOTICE.md
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { extractBingTargetUrl, getDisplayUrl, resolveRegionProfile } from './search-engine';
import type { SearchRegion, SearchResult, TimeRange } from './search-types';
import { browserFetch, type BrowserRequestInit } from './browser-transport';
import { TimeoutError } from 'impit';

export const WEB_ENGINES = { google: 'Google', bing: 'Bing Web', duckduckgo: 'DuckDuckGo' } as const;
type WebEngine = keyof typeof WEB_ENGINES;
interface SearchOptions { query: string; page: number; region: SearchRegion; timeRange: TimeRange; signal?: AbortSignal }
const TIME_RANGES = { day: 'd', week: 'w', month: 'm', year: 'y', all: '' };
const ddgTokens = new Map<string, { value: string; expires: number }>();

export class WebEngineError extends Error {
  constructor(message: string, public status: 'error' | 'timeout' | 'cooldown' = 'error') {
    super(message);
  }
}

export function buildWebRequest(engine: WebEngine, options: SearchOptions, vqd?: string) {
  const region = resolveRegionProfile(options.region, options.query);
  const range = TIME_RANGES[options.timeRange];
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `${region.bingLang},${region.lang};q=0.7`,
  };
  const params = new URLSearchParams({ q: options.query });
  let url: string;
  const init: BrowserRequestInit = { headers };
  if (engine === 'google') {
    params.set('sca_esv', '1');
    params.set('hl', region.lang);
    params.set('lr', region.code === 'global' ? '' : `lang_${region.lang}`);
    if (region.code !== 'global') params.set('cr', `country${region.bingCc.toUpperCase()}`);
    params.set('ie', 'utf8');
    params.set('oe', 'utf8');
    if (options.page > 1) params.set('start', String((options.page - 1) * 10));
    if (range) params.set('tbs', `qdr:${range}`);
    params.append('adtest', 'on');
    params.set('adtest-useragent', 'SAMSUNG-GT-S5230');
    params.append('adtest', 'preview');
    headers.Cookie = 'CONSENT=YES+';
    headers.Accept = '*/*';
    delete headers['Accept-Language'];
    url = `https://www.google.com/search?${params}`;
  } else if (engine === 'bing') {
    // Upstream currently declares no paging or time-range support for Bing Web.
    if (options.page > 1 || range) return null;
    params.set('adlt', 'off');
    if (region.code !== 'global') {
      params.set('setlang', region.lang);
      if (!['us', 'cn', 'ru'].includes(region.bingCc.toLowerCase())) {
        params.set('cc', region.bingCc.toLowerCase());
      }
    }
    url = `https://www.bing.com/search?${params}`;
  } else {
    if (options.query.length >= 500) return null;
    // Quote bang tokens so DDG cannot redirect an unknown Pharol bang elsewhere.
    params.set('q', options.query.replace(/(^|\s)(![\w]+)/g, '$1"$2"'));
    params.set('kl', region.ddgKl);
    if (range) params.set('df', range);
    if (options.page === 1) {
      params.set('b', '');
    } else {
      if (!vqd) throw new WebEngineError('DuckDuckGo pagination token missing');
      params.set('vqd', vqd);
      params.set('nextParams', '');
      params.set('api', 'd.js');
      params.set('o', 'json');
      params.set('v', 'l');
      const offset = 10 + (options.page - 2) * 15;
      params.set('s', String(offset));
      params.set('dc', String(offset + 1));
    }
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Referer = 'https://html.duckduckgo.com/html/';
    headers.Cookie = `kl=${region.ddgKl}${range ? `; df=${range}` : ''}`;
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'same-origin';
    headers['Sec-Fetch-User'] = '?1';
    url = 'https://html.duckduckgo.com/html/';
    init.method = 'POST';
    init.body = params.toString();
    init.redirect = 'manual';
  }
  return { url, init };
}

export function parseWebResponse(engine: WebEngine, html: string, responseUrl: string, page: number) {
  const $ = cheerio.load(html);
  const location = new URL(responseUrl);
  if (location.hostname === 'sorry.google.com' || location.pathname.startsWith('/sorry')
    || $('#challenge-form, #b_captcha, #captcha, form[action*="/sorry/"]').length
    || (engine === 'google' && html.length < 2000 && html.includes('/sorry/'))) {
    throw new WebEngineError(`${WEB_ENGINES[engine]} CAPTCHA`, 'cooldown');
  }
  if (engine === 'google' && location.hostname === 'consent.google.com') {
    throw new WebEngineError('Google consent page');
  }
  if (engine === 'google' && !$('div.zMzFAb a.fuLhoc').length
    && html.includes('/httpservice/retry/')) {
    throw new WebEngineError('Google JavaScript challenge', 'cooldown');
  }
  const results: SearchResult[] = [];
  const add = (href: string | undefined, title: string, snippet: string) => {
    if (!href || !title.trim()) return;
    let target: URL;
    try {
      target = new URL(href, responseUrl);
      if (engine === 'google' && target.hostname.endsWith('.google.com') && target.pathname === '/url') {
        target = new URL(target.searchParams.get('q') || target.searchParams.get('url') || '');
      } else if (engine === 'bing') {
        target = new URL(extractBingTargetUrl(target.href));
      } else if (engine === 'duckduckgo' && target.searchParams.has('uddg')) {
        target = new URL(target.searchParams.get('uddg')!);
      }
    } catch { return; }
    if (!['http:', 'https:'].includes(target.protocol)) return;
    results.push({
      id: `${engine}-${page}-${results.length}`, title: title.trim(), url: target.href,
      displayedUrl: getDisplayUrl(target.href), snippet: snippet.trim() || title.trim(),
      engine, category: 'all', rankPosition: results.length,
    });
  };
  if (engine === 'google') {
    $('div.zMzFAb:has(a.fuLhoc)').each((_, element) => {
      const card = $(element);
      add(card.find('a.fuLhoc').first().attr('href'), card.find('span.CVA68e').first().text(),
        card.find('span.FrIlee > span.fYyStc:not(.YVIcad)').first().text());
    });
  } else if (engine === 'bing') {
    $('#b_results > li.b_algo').each((_, element) => {
      const card = $(element);
      card.find('span.algoSlug_icon').remove();
      const link = card.find('h2 a').first();
      add(link.attr('href'), link.text(), card.find('p').text());
    });
  } else {
    $('#links > div.web-result:not(.result--ad)').each((_, element) => {
      const card = $(element);
      const link = card.find('h2 a').first();
      add(link.attr('href'), link.text(), card.find('a.result__snippet').first().text());
    });
  }
  return { results, vqd: $('input[name="vqd"]').first().attr('value') };
}

export async function searchWebEngine(engine: WebEngine, options: SearchOptions): Promise<SearchResult[]> {
  // Tokens stay in process memory; hash keys avoid retaining query text here.
  const browser = engine === 'duckduckgo' ? 'firefox144' : 'chrome142';
  const key = createHash('sha256').update(JSON.stringify([options.query, options.region, options.timeRange, browser, process.env.PHAROL_WEB_TRANSPORT])).digest('hex');
  const cached = ddgTokens.get(key);
  let vqd = cached && cached.expires > Date.now() ? cached.value : undefined;
  const request = async (page: number, token?: string): Promise<{ results: SearchResult[]; vqd?: string }> => {
    const spec = buildWebRequest(engine, { ...options, page }, token);
    if (!spec) return { results: [] };
    try {
      const response = await browserFetch(spec.url, { ...spec.init, signal: AbortSignal.any([AbortSignal.timeout(4000), ...(options.signal ? [options.signal] : [])]) }, browser);
      if (engine === 'duckduckgo' && response.status === 303) return { results: [] };
      if (!response.ok) throw new WebEngineError(`${WEB_ENGINES[engine]} HTTP ${response.status}`,
        [403, 429].includes(response.status) ? 'cooldown' : 'error');
      const parsed = parseWebResponse(engine, await response.text(), response.url || spec.url, page);
      if (parsed.vqd && engine === 'duckduckgo') {
        if (ddgTokens.size >= 100) ddgTokens.delete(ddgTokens.keys().next().value!);
        ddgTokens.set(key, { value: parsed.vqd, expires: Date.now() + 3600_000 });
      }
      return parsed;
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new WebEngineError(`${WEB_ENGINES[engine]} timed out`, 'timeout');
      }
      throw error;
    }
  };
  if (engine === 'duckduckgo' && options.page > 1 && !vqd) {
    vqd = (await request(1)).vqd;
    if (!vqd) throw new WebEngineError('DuckDuckGo pagination token missing');
  }
  return (await request(options.page, vqd)).results;
}
