import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { resolveProviderConfig, type ProviderContext } from './provider-config';
import { openAlexGet, mapOpenAlexWork, OpenAlexError } from './openalex';
import {
  parseSearchSyntax,
  filterResultsBySyntax,
  deduplicateAndRank,
  decodeHtmlEntities,
  getDisplayUrl,
  extractBingTargetUrl,
  extractDomain,
  reconstructOpenAlexAbstract,
  cleanMarkdownSnippet,
  parseMcpJsonRpcPayload,
  parseExaMcpTextResponse,
  parseContext7ResolveResponse,
  parseContext7DocsResponse,
  buildRepoWikiLinks,
  isDeepWikiErrorText,
  sanitizeTrustedBaseUrl,
  detectSearchIntent,
  normalizeConceptKeywords,
  extractWikidataAttributes,
  resolveRegionProfile,
} from './search-engine';
import {
  buildSearchCacheKey,
  getCachedSearchResponse,
  isEngineCoolingDown,
  recordEngineRateLimit,
  recordEngineSuccess,
  setCachedSearchResponse,
} from './server-cache';
import { evaluateInstantUtility } from './instant-tools';
import { searchWebEngine, WebEngineError, WEB_ENGINES } from './web-engines';
import {
  SearchCategory,
  SearchRegion,
  SearchResult,
  KnowledgeBox,
  ConceptOverview,
  IntentSectionStrip,
  InstantAnswer,
  SearchResponse,
  EngineHealth,
  TimeRange,
} from './search-types';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class RateLimitQuotaError extends Error {
  constructor(engineId: string) {
    super(`Rate limit hit for ${engineId}`);
    this.name = 'RateLimitQuotaError';
  }
}

function checkQuotaResponse(engineId: string, res: Response): void {
  if (res.status === 429 || res.status === 402) {
    throw new RateLimitQuotaError(engineId);
  }
}

function buildRelatedQueries(
  cleanQ: string,
  results: SearchResult[],
  newsHighlights: SearchResult[],
  lang: string
): string[] {
  const candidates: string[] = [];
  const lowerQ = cleanQ.toLowerCase();

  if (newsHighlights.length > 0 && !/\b(news|notícias|noticias)\b/i.test(cleanQ)) {
    candidates.push(lang === 'pt' ? `${cleanQ} notícias` : `${cleanQ} latest news`);
  }

  for (const r of results.slice(0, 6)) {
    const cleanTitle = r.title.split(/\s[-—|:]\s/)[0]?.trim() || '';
    if (
      cleanTitle.length > cleanQ.length + 4 &&
      cleanTitle.length <= 44 &&
      cleanTitle.toLowerCase() !== lowerQ &&
      !candidates.some((c) => c.toLowerCase() === cleanTitle.toLowerCase())
    ) {
      candidates.push(cleanTitle);
    }
    if (candidates.length >= 4) break;
  }

  if (candidates.length < 3) {
    const fallbacks =
      lang === 'pt'
        ? [`${cleanQ} biografia`, `${cleanQ} site oficial`, `${cleanQ} hoje`]
        : [`${cleanQ} overview`, `${cleanQ} official site`, `${cleanQ} recent updates`];
    for (const fb of fallbacks) {
      if (!candidates.some((c) => c.toLowerCase() === fb.toLowerCase())) {
        candidates.push(fb);
      }
      if (candidates.length >= 4) break;
    }
  }

  return candidates.slice(0, 4);
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 3800) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function callMcpSearchTool(
  engineId: string,
  endpoint: string,
  headers: Record<string, string>,
  toolName: string,
  toolArgs: Record<string, unknown>,
  timeoutMs: number
): Promise<string | null> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: toolArgs },
      }),
    },
    timeoutMs
  );
  checkQuotaResponse(engineId, res);
  if (!res.ok) return null;
  const raw = await res.text();
  return parseMcpJsonRpcPayload(raw);
}

async function callSessionMcpTool(
  engineId: string,
  endpoint: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  timeoutMs: number,
  existingSessionId?: string | null
): Promise<{ text: string | null; sessionId: string | null }> {
  let sessionId = existingSessionId || null;
  if (!sessionId) {
    const initRes = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'pharol', version: '1.0' },
          },
        }),
      },
      Math.min(2500, timeoutMs)
    );
    checkQuotaResponse(engineId, initRes);
    if (!initRes.ok) return { text: null, sessionId: null };
    sessionId = initRes.headers.get('mcp-session-id');
  }

  const callRes = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: toolArgs },
      }),
    },
    timeoutMs
  );
  checkQuotaResponse(engineId, callRes);
  if (!callRes.ok) return { text: null, sessionId };
  const raw = await callRes.text();
  return { text: parseMcpJsonRpcPayload(raw), sessionId };
}

export interface RunMetasearchOptions extends ProviderContext {
  rawQuery: string;
  category: SearchCategory;
  enginesParam?: string | null;
  page?: number;
  timeRange?: TimeRange;
  region?: SearchRegion;
  acceptLanguage?: string;
  includeConceptOverview?: boolean;
  ignoreBangRouting?: boolean;
  onBatch?: (partial: SearchResponse) => void;
}

export async function runMetasearch(options: RunMetasearchOptions): Promise<SearchResponse> {
  const startTime = Date.now();
  const rawQuery = options.rawQuery.trim();
  const page = Math.max(1, Math.min(10, options.page || 1));
  const timeRange: TimeRange = options.timeRange || 'all';
  const hasUserOverrides = Object.keys(resolveProviderConfig({ userConfig: options.userConfig })).length > 0;
  const providers = resolveProviderConfig(options);
  const providerScope = Object.keys(providers).length
    ? createHash('sha256').update(JSON.stringify(providers)).digest('hex') : '';
  const {
    tavilyApiKey: tavilyKey,
    parallelApiKey: parallelKey,
    keenableApiKey: keenableKey,
    tinyfishApiKey: tinyfishKey,
    exaApiKey: exaKey,
    firecrawlApiKey: firecrawlKey,
    context7ApiKey: c7Key,
    semanticScholarApiKey: s2Key,
    coreApiKey: coreKey,
    githubToken: ghToken,
  } = providers;

  if (!rawQuery) {
    return {
      query: '',
      parsedQuery: parseSearchSyntax(''),
      category: options.category,
      results: [],
      totalResults: 0,
      timeTakenMs: 0,
      enginesUsed: [],
      page,
      hasMore: false,
      engineHealth: [],
    };
  }

  const parsedQuery = parseSearchSyntax(rawQuery);
  parsedQuery.timeRange = timeRange;

  // Allow !bang shortcuts to steer category and/or targeted engines seamlessly
  const effectiveCategory: SearchCategory = !options.ignoreBangRouting && parsedQuery.bang?.category || options.category;
  const bangEngines = options.ignoreBangRouting ? undefined : parsedQuery.bang?.engines;

  const allowedEngines = bangEngines
    ? new Set(bangEngines.map((e) => e.toLowerCase()))
    : options.enginesParam?.trim()
    ? new Set(
        options.enginesParam
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;

  const isEngineEnabled = (eng: string) => !allowedEngines || allowedEngines.has(eng.toLowerCase());

  const cleanQ = parsedQuery.cleanQuery || rawQuery;
  const effectiveQuery = parsedQuery.site ? `${cleanQ} site:${parsedQuery.site}` : cleanQ;
  const searchIntent = detectSearchIntent(cleanQ);
  const regionProfile = resolveRegionProfile(
    parsedQuery.regionOverride || options.region || 'auto',
    cleanQ,
    options.acceptLanguage
  );

  const instantUtility =
    effectiveCategory === 'all' || effectiveCategory === 'code'
      ? evaluateInstantUtility(cleanQ)
      : null;

  const cacheKey = buildSearchCacheKey({
    query: rawQuery,
    category: effectiveCategory,
    region: regionProfile.code,
    timeRange,
    page,
    engines: `${options.enginesParam || ''}|concept:${options.includeConceptOverview !== false}`,
    providerScope,
  });
  const cached = !hasUserOverrides ? getCachedSearchResponse(cacheKey) : null;
  if (cached) {
    const hydrated: SearchResponse = {
      ...cached,
      instantAnswer: instantUtility || cached.instantAnswer,
    };
    options.onBatch?.(hydrated);
    return hydrated;
  }

  const enginesUsed: string[] = [];
  const aggregatedResults: SearchResult[] = [];
  const engineHealthMap = new Map<string, EngineHealth>();
  let knowledgeBox: KnowledgeBox | null = null;
  let conceptOverview: ConceptOverview | null = null;
  let instantAnswer: InstantAnswer | null = instantUtility;
  let newsHighlights: SearchResult[] = [];
  let relatedTopics: string[] = [];

  const cooldownKey = (engine: string) => providerScope ? `${engine}:${providerScope}` : engine;

  const trackEngine = async (
    engineId: string,
    label: string,
    fn: () => Promise<number>
  ) => {
    if (isEngineCoolingDown(cooldownKey(engineId))) {
      engineHealthMap.set(engineId, {
        engine: engineId,
        label,
        status: 'cooldown',
        count: 0,
        durationMs: 0,
      });
      return;
    }

    const t0 = Date.now();
    try {
      const count = await fn();
      if (count > 0) recordEngineSuccess(cooldownKey(engineId));
      engineHealthMap.set(engineId, {
        engine: engineId,
        label,
        status: count > 0 ? 'ok' : 'empty',
        count,
        durationMs: Date.now() - t0,
      });
      if (count > 0 && !enginesUsed.includes(engineId)) {
        enginesUsed.push(engineId);
      }
      if (options.onBatch && count > 0) {
        options.onBatch(buildSnapshot(false));
      }
    } catch (err) {
      const isQuota = err instanceof RateLimitQuotaError || err instanceof OpenAlexError && [402, 429].includes(err.status);
      if (isQuota || err instanceof WebEngineError && err.status === 'cooldown') recordEngineRateLimit(cooldownKey(engineId));
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      engineHealthMap.set(engineId, {
        engine: engineId,
        label,
        status: err instanceof WebEngineError ? err.status : isQuota ? 'cooldown' : isTimeout ? 'timeout' : 'error',
        count: 0,
        durationMs: Date.now() - t0,
      });
    }
  };

  const buildSnapshot = (isFinal: boolean): SearchResponse => {
    const filtered = filterResultsBySyntax(aggregatedResults, parsedQuery, timeRange);
    // In Science mode, strictly separate Encyclopedia/Wikipedia from ranked primary academic results
    const scoped =
      effectiveCategory === 'science'
        ? filtered.filter((r) => r.engine.toLowerCase() !== 'wikipedia')
        : filtered;

    const finalResults = deduplicateAndRank(scoped, cleanQ, {
      category: effectiveCategory,
      regionCode: regionProfile.code,
      timeRange,
    });

    if (isFinal && finalResults.length === 0 && page === 1 && effectiveCategory === 'all') {
      finalResults.push(
        {
          id: 'fallback-1',
          title: `${cleanQ} — Wikipedia Overview`,
          url: `https://${regionProfile.wikiLang}.wikipedia.org/wiki/${encodeURIComponent(cleanQ)}`,
          displayedUrl: `${regionProfile.wikiLang}.wikipedia.org › wiki › ${cleanQ}`,
          snippet: `Explore encyclopedia documentation and open knowledge references for ${cleanQ}.`,
          engine: 'wikipedia',
          category: 'all',
          score: 2,
        },
        {
          id: 'fallback-2',
          title: `${cleanQ} Open Source Repositories`,
          url: `https://github.com/search?q=${encodeURIComponent(cleanQ)}`,
          displayedUrl: `github.com › search`,
          snippet: `Browse open repositories, code examples, and developer tools matching ${cleanQ}.`,
          engine: 'github',
          category: 'code',
          score: 1.5,
        }
      );
      if (!enginesUsed.includes('searx-indexer')) enginesUsed.push('searx-indexer');
    }

    let kb = knowledgeBox;
    if (isFinal && !kb && effectiveCategory === 'all' && finalResults.length > 0 && page === 1 && !instantUtility) {
      kb = {
        title: cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1),
        subtitle: 'Top Indexed Overview',
        extract: finalResults[0].snippet,
        url: finalResults[0].url,
        source: finalResults[0].engine,
      };
    }

    const intentSections: IntentSectionStrip[] = [];
    if (effectiveCategory === 'all' && page === 1) {
      if (searchIntent.isCode) {
        const codeStripItems = finalResults
          .filter((r) => r.category === 'code' || Boolean(r.codeSection))
          .slice(0, 3);
        if (codeStripItems.length > 0) {
          intentSections.push({
            id: 'intent-code',
            title: 'Docs, Wikis & Repositories',
            subtitle: 'Developer Context',
            category: 'code',
            items: codeStripItems,
          });
        }
      }
      if (searchIntent.isScience) {
        const sciStripItems = finalResults
          .filter((r) => r.category === 'science' || r.scienceSection)
          .slice(0, 3);
        if (sciStripItems.length > 0) {
          intentSections.push({
            id: 'intent-science',
            title: 'Scholarly Literature',
            subtitle: 'Peer-Reviewed & Preprints',
            category: 'science',
            items: sciStripItems,
          });
        }
      }
    }

    const derivedRelated =
      relatedTopics.length > 0
        ? relatedTopics
        : isFinal && page === 1 && effectiveCategory === 'all' && !instantUtility
        ? buildRelatedQueries(cleanQ, finalResults, newsHighlights, regionProfile.lang)
        : [];

    return {
      query: rawQuery,
      parsedQuery,
      category: effectiveCategory,
      results: finalResults,
      totalResults: finalResults.length,
      timeTakenMs: Date.now() - startTime,
      knowledgeBox: kb,
      conceptOverview,
      intentSections: intentSections.length > 0 ? intentSections : undefined,
      instantAnswer,
      newsHighlights: newsHighlights.length > 0 ? newsHighlights : undefined,
      relatedTopics: derivedRelated.length > 0 ? derivedRelated : undefined,
      enginesUsed: [...enginesUsed],
      page,
      hasMore: finalResults.length >= 6 && page < 6,
      cacheHit: false,
      engineHealth: Array.from(engineHealthMap.values()),
    };
  };

  if (instantUtility && options.onBatch) {
    options.onBatch(buildSnapshot(false));
  }

  // 1. Wikipedia Knowledge Box & Search Results (region-aware wiki language with English fallback)
  const wikiTask = async () => {
    if (!isEngineEnabled('wikipedia')) {
      engineHealthMap.set('wikipedia', { engine: 'wikipedia', label: 'Wikipedia', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    await trackEngine('wikipedia', 'Wikipedia', async () => {
      let count = 0;
      const primaryLang = regionProfile.wikiLang || 'en';

      const tryWikiSummary = async (langCode: string, titleCandidate: string) => {
        const wikiSummaryUrl = `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          titleCandidate.replace(/ /g, '_')
        )}`;
        const res = await fetchWithTimeout(
          wikiSummaryUrl,
          { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
          2800
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.type === 'standard' && data.extract) {
          return { data, langCode };
        }
        return null;
      };

      const canonicalWikiMediaKey = (src: string): string => {
        try {
          const clean = src.split('?')[0].toLowerCase();
          const thumbMatch = clean.match(/\/\d+px-([^/]+)$/);
          if (thumbMatch) return decodeURIComponent(thumbMatch[1]);
          const parts = clean.split('/');
          return decodeURIComponent(parts[parts.length - 1] || clean);
        } catch {
          return src.toLowerCase();
        }
      };

      const fetchWikiGalleryImages = async (langCode: string, pageTitle: string, primaryThumb?: string): Promise<string[]> => {
        const imgs: string[] = [];
        const seenKeys = new Set<string>();
        if (primaryThumb) {
          imgs.push(primaryThumb);
          seenKeys.add(canonicalWikiMediaKey(primaryThumb));
        }
        try {
          const mediaUrl = `https://${langCode}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(
            pageTitle.replace(/ /g, '_')
          )}`;
          const res = await fetchWithTimeout(
            mediaUrl,
            { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
            2000
          );
          if (res.ok) {
            const mediaJson = await res.json();
            const items = Array.isArray(mediaJson?.items) ? mediaJson.items : [];
            for (const item of items) {
              if (item?.type !== 'image' || !Array.isArray(item?.srcset)) continue;
              const src =
                item.srcset.find((s: any) => s?.src)?.src ||
                item.original?.source;
              if (!src) continue;
              const absSrc = src.startsWith('//') ? `https:${src}` : src;
              if (
                /commons-logo|wiki-logo|ambox|edit-clear|question_book|padlock|increase|decrease|steady|disambig|loudspeaker|speaker_icon|sound-icon|oojs_ui_icon/i.test(
                  absSrc
                )
              ) {
                continue;
              }
              const key = canonicalWikiMediaKey(absSrc);
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                imgs.push(absSrc);
              }
              if (imgs.length >= 4) break;
            }
          }
        } catch {
          // gallery enrichment is optional
        }
        return imgs;
      };

      const populateKnowledgeBoxFromHit = async (hit: { data: any; langCode: string }) => {
        const { data, langCode } = hit;
        const cleanExtract = String(data.extract)
          .replace(/\(\s*\/[^;()]*\/\s*;\s*/g, '')
          .replace(/\(\s*\/[^)]*\/\s*\)/g, '')
          .replace(/\(\s*;\s*/g, '')
          .replace(/\(\s*\)/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        let wikidataAttrs: Array<{ label: string; value: string }> = [];
        const galleryPromise = fetchWikiGalleryImages(
          langCode,
          data.title || cleanQ,
          data.thumbnail?.source || data.originalimage?.source
        );
        try {
          let qid: string | undefined = data.wikibase_item;
          if (!qid) {
            const wdSearchRes = await fetchWithTimeout(
              `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
                data.title || cleanQ
              )}&language=${langCode}&limit=1&format=json`,
              { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
              1800
            );
            if (wdSearchRes.ok) {
              const wdSearchData = await wdSearchRes.json();
              qid = wdSearchData.search?.[0]?.id;
            }
          }
          if (qid) {
            const wdEntRes = await fetchWithTimeout(
              `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
                qid
              )}&props=claims&format=json`,
              { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
              1800
            );
            if (wdEntRes.ok) {
              const wdEntData = await wdEntRes.json();
              wikidataAttrs = extractWikidataAttributes(wdEntData.entities?.[qid]);
            }
          }
        } catch {
          // Wikidata enrichment is optional
        }

        const galleryImages = await galleryPromise;
        const primaryThumb = data.thumbnail?.source || data.originalimage?.source || galleryImages[0];

        knowledgeBox = {
          title: data.title || cleanQ,
          subtitle: data.description || 'Wikipedia Encyclopedia',
          extract: cleanExtract,
          url:
            data.content_urls?.desktop?.page ||
            `https://${langCode}.wikipedia.org/wiki/${encodeURIComponent((data.title || cleanQ).replace(/ /g, '_'))}`,
          thumbnail: primaryThumb,
          images: galleryImages.length > 0 ? galleryImages : undefined,
          source: wikidataAttrs.length > 0 ? 'Wikipedia · Wikidata' : 'Wikipedia',
          attributes: [
            ...(data.description ? [{ label: 'Topic', value: data.description }] : []),
            ...wikidataAttrs,
          ].slice(0, 6),
        };
        if (!instantAnswer) {
          instantAnswer = {
            source: 'Wikipedia',
            heading: data.title,
            text: cleanExtract,
            url: knowledgeBox.url,
          };
        }
      };

      let hit: { data: any; langCode: string } | null = null;
      if (page === 1) {
        hit = await tryWikiSummary(primaryLang, cleanQ);
        if (!hit && primaryLang !== 'en') {
          hit = await tryWikiSummary('en', cleanQ);
        }
        if (hit) {
          await populateKnowledgeBoxFromHit(hit);
        }
      }

      const srOffset = (page - 1) * 5;
      const searchWikiLang = async (langCode: string) => {
        const searchApiUrl = `https://${langCode}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
          cleanQ
        )}&gsrlimit=5&gsroffset=${srOffset}&prop=extracts|pageimages|info&inprop=url&exintro=1&explaintext=1&exchars=260&pithumbsize=320&format=json&origin=*`;
        const srRes = await fetchWithTimeout(
          searchApiUrl,
          { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
          2600
        );
        if (!srRes.ok) return [] as any[];
        const srData = await srRes.json();
        const pagesObj = srData.query?.pages || {};
        return Object.values(pagesObj).sort((a: any, b: any) => (a.index ?? 99) - (b.index ?? 99)) as any[];
      };

      let wikiPages = await searchWikiLang(primaryLang);
      let usedLang = primaryLang;
      if (wikiPages.length === 0 && primaryLang !== 'en') {
        wikiPages = await searchWikiLang('en');
        usedLang = 'en';
      }

      for (let i = 0; i < wikiPages.length; i++) {
        const wp = wikiPages[i];
        const title = wp.title || cleanQ;
        const url =
          wp.fullurl ||
          `https://${usedLang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        const rawSnippet = wp.extract ? String(wp.extract).replace(/\s+/g, ' ').trim() : '';
        aggregatedResults.push({
          id: `wiki-${wp.pageid || `${page}-${i}`}`,
          title: `${title} — Wikipedia`,
          url,
          displayedUrl: getDisplayUrl(url),
          snippet: rawSnippet || `Wikipedia encyclopedia article for ${title}.`,
          engine: 'wikipedia',
          category: 'all',
          thumbnail: wp.thumbnail?.source,
          rankPosition: i,
        });
        count++;
      }

      // If exact-title summary missed, resolve KnowledgeBox from the top Wikipedia search hit
      if (page === 1 && !hit && wikiPages.length > 0) {
        const topTitle = wikiPages[0].title;
        if (topTitle) {
          const resolvedHit = await tryWikiSummary(usedLang, topTitle);
          if (resolvedHit) {
            await populateKnowledgeBoxFromHit(resolvedHit);
          }
        }
      }

      return count;
    });
  };

  // 2. DuckDuckGo Instant Answer API
  const ddgInstantTask = async () => {
    if (!isEngineEnabled('duckduckgo') || page > 1) return;
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQ)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetchWithTimeout(ddgUrl, {}, 2500);
      if (res.ok) {
        const data = await res.json();
        const answerText = data.Answer || data.AbstractText || data.Definition;
        if (answerText) {
          instantAnswer = {
            source: data.AbstractSource || 'DuckDuckGo Instant Answer',
            heading: data.Heading || cleanQ,
            text: answerText,
            url: data.AbstractURL || 'https://duckduckgo.com',
          };
        }
        if (data.AbstractText && !knowledgeBox) {
          knowledgeBox = {
            title: data.Heading || cleanQ,
            subtitle: data.Entity || 'Instant Answer',
            extract: data.AbstractText,
            url: data.AbstractURL || 'https://duckduckgo.com',
            thumbnail: data.Image
              ? data.Image.startsWith('http')
                ? data.Image
                : `https://duckduckgo.com${data.Image}`
              : undefined,
            source: data.AbstractSource || 'DuckDuckGo',
          };
        }

        if (Array.isArray(data.RelatedTopics)) {
          const topics: string[] = [];
          for (const item of data.RelatedTopics.slice(0, 6)) {
            if (item.Text) topics.push(item.Text.slice(0, 65));
          }
          if (topics.length > 0) relatedTopics = topics;
        }
      }
    } catch {
      // ignore
    }
  };

  // Core web engines use the in-process SearXNG-derived adapters.
  const coreWebTask = async (engine: keyof typeof WEB_ENGINES) => {
    const label = WEB_ENGINES[engine];
    if (!isEngineEnabled(engine)) {
      engineHealthMap.set(engine, { engine, label, status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    await trackEngine(engine, label, async () => {
      const query = [
        parsedQuery.cleanQuery,
        ...parsedQuery.exactPhrases.map((phrase) => `"${phrase}"`),
        ...parsedQuery.excludedTerms.map((term) => `-${term}`),
        parsedQuery.site ? `site:${parsedQuery.site}` : '',
        parsedQuery.filetype ? `filetype:${parsedQuery.filetype}` : '',
        parsedQuery.inTitle ? `intitle:"${parsedQuery.inTitle}"` : '',
      ].filter(Boolean).join(' ');
      const results = await searchWebEngine(engine, {
        query, page, region: regionProfile.code, timeRange,
      });
      aggregatedResults.push(...results);
      return results.length;
    });
  };

  // 5. Marginalia Search
  const marginaliaTask = async () => {
    if (!isEngineEnabled('marginalia')) {
      engineHealthMap.set('marginalia', { engine: 'marginalia', label: 'Marginalia', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    await trackEngine('marginalia', 'Marginalia', async () => {
      const idxOffset = (page - 1) * 8;
      const mUrl = `https://api.marginalia.nu/public/search/${encodeURIComponent(cleanQ)}?count=8&index=${idxOffset}`;
      const res = await fetchWithTimeout(mUrl, { headers: { 'User-Agent': 'SearXMinimal/1.0' } }, 3000);
      if (!res.ok) return 0;
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      let count = 0;
      for (let i = 0; i < Math.min(results.length, 8); i++) {
        const r = results[i];
        if (!r.url || !r.title) continue;
        aggregatedResults.push({
          id: `marginalia-${page}-${i}-${Date.now()}`,
          title: decodeHtmlEntities(r.title),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: decodeHtmlEntities(r.description || r.title),
          engine: 'marginalia',
          category: 'all',
          rankPosition: i + 1,
        });
        count++;
      }
      return count;
    });
  };

  // 6. Direct News Highlights & News Vertical (`!news` / `category: 'news'`)
  const newsTask = async () => {
    if (page > 1 && effectiveCategory !== 'news') return;

    const subNewsTasks: Promise<void>[] = [
      trackEngine('bing-news', 'Bing News', async () => {
        const newsItems: SearchResult[] = [];
        const res = await fetchWithTimeout(
          `https://www.bing.com/news/search?q=${encodeURIComponent(
            cleanQ
          )}&format=rss&cc=${encodeURIComponent(regionProfile.bingCc)}&setlang=${encodeURIComponent(
            regionProfile.bingLang
          )}`,
          {
            headers: {
              'User-Agent': BROWSER_UA,
              'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9,en;q=0.7`,
            },
          },
          3000
        );
        if (!res.ok) return 0;
        const xml = await res.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        $('item').each((i, el) => {
          if (i >= 8) return false;
          const title = decodeHtmlEntities($(el).find('title').text().trim());
          const directUrl = extractBingTargetUrl($(el).find('link').text().trim());
          const snippet = decodeHtmlEntities($(el).find('description').text().trim());
          const pubDate = $(el).find('pubDate').text().trim();
          const source = $(el).find('News\\:Source, source').text().trim();
          const newsImg =
            $(el).find('News\\:Image').text().trim() ||
            $(el).find('media\\:thumbnail, media\\:content').first().attr('url') ||
            undefined;
          if (title && directUrl && !directUrl.includes('bing.com/news/')) {
            newsItems.push({
              id: `bing-hl-${page}-${i}-${Date.now()}`,
              title,
              url: directUrl,
              displayedUrl: source || extractDomain(directUrl),
              snippet: snippet || title,
              engine: 'bing-news',
              category: 'news',
              thumbnail: newsImg && newsImg.startsWith('http') ? newsImg : undefined,
              publishedDate: pubDate
                ? new Date(pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : undefined,
              author: source || extractDomain(directUrl),
              rankPosition: i,
            });
          }
        });

        if (newsItems.length > 0) {
          newsHighlights = newsItems.slice(0, 5);
          if (effectiveCategory === 'news') {
            aggregatedResults.push(...newsItems);
          }
        }
        return newsItems.length;
      }),
    ];

    if (effectiveCategory === 'news') {
      if (isEngineEnabled('firecrawl')) {
        subNewsTasks.push(
          trackEngine('firecrawl-news', 'Firecrawl News', async () => {
            const fcBody: Record<string, any> = { query: cleanQ, sources: ['news'], limit: 8 };
            if (regionProfile.code !== 'global') {
              fcBody.location = regionProfile.countryName;
              fcBody.country = regionProfile.country;
            }
            const res = await fetchWithTimeout(
              'https://api.firecrawl.dev/v2/search',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(firecrawlKey
                    ? { Authorization: `Bearer ${firecrawlKey}` }
                    : {}),
                },
                body: JSON.stringify(fcBody),
              },
              3800
            );
            checkQuotaResponse('firecrawl-news', res);
            if (!res.ok) return 0;
            const json = await res.json();
            const list = Array.isArray(json?.data?.news) ? json.data.news : [];
            let count = 0;
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (!r?.url || !r?.title) continue;
              aggregatedResults.push({
                id: `fc-news-s-${i}-${Date.now()}`,
                title: decodeHtmlEntities(String(r.title)),
                url: r.url,
                displayedUrl: extractDomain(r.url),
                snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 240),
                engine: 'firecrawl-news',
                category: 'news',
                publishedDate: r.date ? String(r.date) : undefined,
                thumbnail: r.imageUrl || undefined,
                rankPosition: i,
              });
              count++;
            }
            return count;
          })
        );
      }

      if (isEngineEnabled('tavily')) {
        subNewsTasks.push(
          trackEngine('tavily-news', 'Tavily News', async () => {
            const res = await fetchWithTimeout(
              'https://api.tavily.com/search',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(tavilyKey
                    ? { Authorization: `Bearer ${tavilyKey}` }
                    : { 'X-Tavily-Access-Mode': 'keyless' }),
                },
                body: JSON.stringify({ query: cleanQ, topic: 'news', days: 7, max_results: 8 }),
              },
              3800
            );
            checkQuotaResponse('tavily-news', res);
            if (!res.ok) return 0;
            const data = await res.json();
            const list = Array.isArray(data?.results) ? data.results : [];
            let count = 0;
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (!r?.url || !r?.title) continue;
              aggregatedResults.push({
                id: `tav-news-s-${i}-${Date.now()}`,
                title: decodeHtmlEntities(String(r.title)),
                url: r.url,
                displayedUrl: extractDomain(r.url),
                snippet: cleanMarkdownSnippet(String(r.content || r.title), 240),
                engine: 'tavily-news',
                category: 'news',
                score: typeof r.score === 'number' ? r.score : undefined,
                rankPosition: i,
              });
              count++;
            }
            return count;
          })
        );
      }

      if (isEngineEnabled('tinyfish')) {
        subNewsTasks.push(
          trackEngine('tinyfish-news', 'TinyFish News', async () => {
            const tfArgs: Record<string, any> = {
              query: cleanQ,
              domain_type: 'news',
              page: Math.max(0, page - 1),
            };
            if (regionProfile.code !== 'global') {
              tfArgs.location = regionProfile.country;
              tfArgs.language = regionProfile.lang;
            }
            const inner = await callMcpSearchTool(
              'tinyfish-news',
              'https://agent.tinyfish.ai/mcp',
              tinyfishKey
                ? { 'X-API-Key': tinyfishKey }
                : { 'X-TinyFish-Access-Mode': 'keyless' },
              'search',
              tfArgs,
              3800
            );
            if (!inner) return 0;
            const parsed = JSON.parse(inner);
            const list = Array.isArray(parsed.results) ? parsed.results.slice(0, 8) : [];
            let count = 0;
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (!r?.url || !r?.title) continue;
              aggregatedResults.push({
                id: `tf-news-s-${i}-${Date.now()}`,
                title: decodeHtmlEntities(String(r.title)),
                url: r.url,
                displayedUrl: r.site_name || extractDomain(r.url),
                snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 240),
                engine: 'tinyfish-news',
                category: 'news',
                publishedDate: r.date ? String(r.date) : undefined,
                rankPosition: i,
              });
              count++;
            }
            return count;
          })
        );
      }
    }

    await Promise.allSettled(subNewsTasks);
  };

  // 7. Code & Developer Sources (GitHub, DeepWiki, Google Code Wiki, Exa Code, Context7, GitMCP, MDN, Firecrawl Dev, Packages, Stack Overflow, Hacker News)
  const codeTask = async () => {
    const trustedOpenDeepWiki = sanitizeTrustedBaseUrl(providers.openDeepWikiUrl);
    const ghHeaders: Record<string, string> = {
      'User-Agent': 'Pharol-Metasearch/1.0',
      ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
    };
    const subTasks: Promise<void>[] = [];
    const discoveredRepoSlugs: string[] = searchIntent.repoSlug ? [searchIntent.repoSlug] : [];
    const discoveredRepoStars = new Map<string, number>();
    const deepWikiStructureCache = new Map<string, string | null>();

    const probeDeepWikiStructure = async (slug: string): Promise<string | null> => {
      if (deepWikiStructureCache.has(slug)) {
        return deepWikiStructureCache.get(slug) ?? null;
      }
      try {
        const structureText = await callMcpSearchTool(
          'deepwiki',
          'https://mcp.deepwiki.com/mcp',
          {},
          'read_wiki_structure',
          { repoName: slug },
          2400
        );
        const valid =
          structureText && !isDeepWikiErrorText(structureText) ? structureText : null;
        deepWikiStructureCache.set(slug, valid);
        return valid;
      } catch {
        deepWikiStructureCache.set(slug, null);
        return null;
      }
    };

    // 7A. GitHub Repositories (enriched with verified DeepWiki, star-gated Google Code Wiki, GitMCP, optional trusted OpenDeepWiki)
    const githubPromise = (async () => {
      if (!isEngineEnabled('github')) {
        engineHealthMap.set('github', { engine: 'github', label: 'GitHub', status: 'disabled', count: 0, durationMs: 0 });
        return;
      }
      await trackEngine('github', 'GitHub', async () => {
        const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(cleanQ)}&per_page=8&page=${page}`;
        const ghRes = await fetchWithTimeout(ghUrl, { headers: ghHeaders }, 2800);
        checkQuotaResponse('github', ghRes);
        if (!ghRes.ok) return 0;
        const ghData = await ghRes.json();
        const items = Array.isArray(ghData.items) ? ghData.items : [];

        if (isEngineEnabled('deepwiki') && page === 1 && items.length > 0) {
          await Promise.allSettled(
            items
              .slice(0, 3)
              .filter((it: any) => Boolean(it?.full_name))
              .map((it: any) => probeDeepWikiStructure(it.full_name))
          );
        }

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.full_name) {
            if (!discoveredRepoSlugs.includes(item.full_name)) {
              discoveredRepoSlugs.push(item.full_name);
            }
            discoveredRepoStars.set(item.full_name, Number(item.stargazers_count || 0));
          }
          const verifiedDW = deepWikiStructureCache.has(item.full_name)
            ? Boolean(deepWikiStructureCache.get(item.full_name))
            : undefined;
          const wikiLinks = buildRepoWikiLinks(item.full_name, trustedOpenDeepWiki || undefined, {
            stars: item.stargazers_count,
            deepWikiVerified: verifiedDW,
          });
          const wikiUrls =
            wikiLinks.deepwiki || wikiLinks.googleCodeWiki || wikiLinks.openDeepWiki
              ? {
                  ...(wikiLinks.deepwiki ? { deepwiki: wikiLinks.deepwiki } : {}),
                  ...(wikiLinks.googleCodeWiki ? { googleCodeWiki: wikiLinks.googleCodeWiki } : {}),
                  ...(wikiLinks.openDeepWiki ? { openDeepWiki: wikiLinks.openDeepWiki } : {}),
                }
              : undefined;

          aggregatedResults.push({
            id: `gh-${item.id}`,
            title: `${item.full_name}`,
            url: item.html_url,
            displayedUrl: `github.com › ${item.full_name}`,
            snippet: `${item.description || 'Open-source repository.'} (★ ${item.stargazers_count.toLocaleString()} · ${
              item.language || 'Code'
            })`,
            engine: 'github',
            category: 'code',
            codeSection: 'repos',
            publishedDate: item.pushed_at ? new Date(item.pushed_at).toLocaleDateString() : undefined,
            rankPosition: i,
            stars: item.stargazers_count,
            forks: item.forks_count,
            language: item.language,
            license:
              item.license?.spdx_id && item.license.spdx_id !== 'NOASSERTION'
                ? item.license.spdx_id
                : undefined,
            mcpUrl: wikiLinks.gitmcp,
            wikiUrls,
          });
        }
        return items.length;
      });
    })();
    subTasks.push(githubPromise);

    // 7B. Exa Code Context MCP (`get_code_context_exa`)
    if (isEngineEnabled('exa-code')) {
      subTasks.push(
        trackEngine('exa-code', 'Exa Code Context', async () => {
          const text = await callMcpSearchTool(
            'exa-code',
            'https://mcp.exa.ai/mcp?tools=web_search_exa,get_code_context_exa',
            exaKey ? { 'x-api-key': exaKey } : {},
            'get_code_context_exa',
            { query: cleanQ, tokensNum: 2500 },
            4200
          );
          if (!text) return 0;
          const items = parseExaMcpTextResponse(text).slice(0, 6);
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            aggregatedResults.push({
              id: `exa-code-${i}-${Date.now()}`,
              title: it.title,
              url: it.url,
              displayedUrl: getDisplayUrl(it.url),
              snippet: it.snippet,
              engine: 'exa-code',
              category: 'code',
              codeSection: 'docs',
              publishedDate: it.publishedDate,
              author: it.author,
              rankPosition: i,
            });
          }
          return items.length;
        })
      );
    }

    // 7C. Context7 Docs Retrieval (keyless baseline, enhanced with optional user Context7 key)
    if (isEngineEnabled('context7') && page === 1) {
      subTasks.push(
        trackEngine('context7', 'Context7 Docs', async () => {
          const c7Headers: Record<string, string> = c7Key ? { Authorization: `Bearer ${c7Key}` } : {};
          const libTerm = cleanQ.split(/\s+/).slice(0, 2).join(' ');
          const resolveText = await callMcpSearchTool(
            'context7',
            'https://mcp.context7.com/mcp',
            c7Headers,
            'resolve-library-id',
            { libraryName: libTerm, query: cleanQ },
            3200
          );
          const resolved = resolveText ? parseContext7ResolveResponse(resolveText) : null;
          if (!resolved) return 0;

          const docsText = await callMcpSearchTool(
            'context7',
            'https://mcp.context7.com/mcp',
            c7Headers,
            'query-docs',
            { libraryId: resolved.id, query: cleanQ },
            3600
          );
          if (!docsText) return 0;
          const fallbackUrl = `https://context7.com${resolved.id.startsWith('/') ? resolved.id : `/${resolved.id}`}`;
          const chunks = parseContext7DocsResponse(docsText, resolved.title, fallbackUrl);
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            aggregatedResults.push({
              id: `c7-${i}-${Date.now()}`,
              title: `${resolved.title}: ${c.title}`,
              url: c.url,
              displayedUrl: getDisplayUrl(c.url),
              snippet: c.snippet,
              engine: 'context7',
              category: 'code',
              codeSection: 'docs',
              tags: [resolved.id],
              rankPosition: i,
            });
          }
          return chunks.length;
        })
      );
    }

    // 7D. MDN Web Docs (Keyless Web/JS/CSS/HTTP reference)
    if (isEngineEnabled('mdn')) {
      subTasks.push(
        trackEngine('mdn', 'MDN Web Docs', async () => {
          const mdnUrl = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(cleanQ)}&locale=en-US&page=${page}`;
          const res = await fetchWithTimeout(mdnUrl, {}, 2600);
          if (!res.ok) return 0;
          const data = await res.json();
          const docs = Array.isArray(data.documents) ? data.documents.slice(0, 5) : [];
          for (let i = 0; i < docs.length; i++) {
            const d = docs[i];
            const fullUrl = d.mdn_url ? `https://developer.mozilla.org${d.mdn_url}` : null;
            if (!fullUrl || !d.title) continue;
            aggregatedResults.push({
              id: `mdn-${page}-${i}-${Date.now()}`,
              title: d.title,
              url: fullUrl,
              displayedUrl: `developer.mozilla.org › ${d.slug || 'docs'}`,
              snippet: cleanMarkdownSnippet(d.summary || d.title, 260),
              engine: 'mdn',
              category: 'code',
              codeSection: 'docs',
              rankPosition: i,
            });
          }
          return docs.length;
        })
      );
    }

    // 7E. Firecrawl Developer Docs & GitHub Issues/README Search
    if (isEngineEnabled('firecrawl-dev') && page === 1) {
      subTasks.push(
        trackEngine('firecrawl-dev', 'Firecrawl Dev', async () => {
          const res = await fetchWithTimeout(
            'https://api.firecrawl.dev/v2/search',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(firecrawlKey ? { Authorization: `Bearer ${firecrawlKey}` } : {}),
              },
              body: JSON.stringify({ query: cleanQ, categories: ['developer'], limit: 5 }),
            },
            3800
          );
          checkQuotaResponse('firecrawl-dev', res);
          if (!res.ok) return 0;
          const json = await res.json();
          const list = Array.isArray(json?.data?.web) ? json.data.web : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r?.url || !r?.title) continue;
            aggregatedResults.push({
              id: `fc-dev-${i}-${Date.now()}`,
              title: decodeHtmlEntities(String(r.title)),
              url: r.url,
              displayedUrl: getDisplayUrl(r.url),
              snippet: cleanMarkdownSnippet(String(r.description || r.title), 260),
              engine: 'firecrawl-dev',
              category: 'code',
              codeSection: 'docs',
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    // 7F. Package Registries: npm, Crates.io, PyPI
    if (isEngineEnabled('npm')) {
      subTasks.push(
        trackEngine('npm', 'npm Registry', async () => {
          const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(cleanQ)}&size=4&from=${(page - 1) * 4}`;
          const res = await fetchWithTimeout(npmUrl, {}, 2600);
          if (!res.ok) return 0;
          const data = await res.json();
          const objs = Array.isArray(data.objects) ? data.objects : [];
          let count = 0;
          for (let i = 0; i < objs.length; i++) {
            const pkg = objs[i]?.package;
            if (!pkg?.name) continue;
            const url = pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`;
            aggregatedResults.push({
              id: `npm-${pkg.name}`,
              title: `${pkg.name} (v${pkg.version || 'latest'})`,
              url,
              displayedUrl: `npmjs.com › package › ${pkg.name}`,
              snippet: pkg.description || `npm package ${pkg.name}`,
              engine: 'npm',
              category: 'code',
              codeSection: 'packages',
              packageName: pkg.name,
              version: pkg.version,
              installCommand: `npm install ${pkg.name}`,
              publishedDate: pkg.date ? String(pkg.date).slice(0, 10) : undefined,
              tags: Array.isArray(pkg.keywords) ? pkg.keywords.slice(0, 4) : undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('crates')) {
      subTasks.push(
        trackEngine('crates', 'Crates.io', async () => {
          const cratesUrl = `https://crates.io/api/v1/crates?q=${encodeURIComponent(cleanQ)}&per_page=4&page=${page}`;
          const res = await fetchWithTimeout(cratesUrl, { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } }, 2600);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = Array.isArray(data.crates) ? data.crates : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (!c?.id) continue;
            aggregatedResults.push({
              id: `crate-${c.id}`,
              title: `${c.name} (${c.newest_version || c.max_version || 'crate'})`,
              url: `https://crates.io/crates/${c.id}`,
              displayedUrl: `crates.io › crates › ${c.id}`,
              snippet: `${c.description || 'Rust crate.'} · ${(c.downloads || 0).toLocaleString()} downloads`,
              engine: 'crates',
              category: 'code',
              codeSection: 'packages',
              packageName: c.name,
              version: c.newest_version || c.max_version,
              installCommand: `cargo add ${c.name}`,
              publishedDate: c.updated_at ? String(c.updated_at).slice(0, 10) : undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('pypi') && page === 1) {
      const firstToken = cleanQ.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (firstToken && firstToken.length >= 2) {
        subTasks.push(
          trackEngine('pypi', 'PyPI', async () => {
            const res = await fetchWithTimeout(`https://pypi.org/pypi/${encodeURIComponent(firstToken)}/json`, {}, 2200);
            if (!res.ok) return 0;
            const data = await res.json();
            const info = data?.info;
            if (!info?.name) return 0;
            aggregatedResults.push({
              id: `pypi-${info.name}`,
              title: `${info.name} (v${info.version || 'latest'})`,
              url: info.package_url || `https://pypi.org/project/${info.name}/`,
              displayedUrl: `pypi.org › project › ${info.name}`,
              snippet: info.summary || `Python package ${info.name} on PyPI.`,
              engine: 'pypi',
              category: 'code',
              codeSection: 'packages',
              packageName: info.name,
              version: info.version,
              license: info.license ? String(info.license).slice(0, 32) : undefined,
              installCommand: `pip install ${info.name}`,
              rankPosition: 0,
            });
            return 1;
          })
        );
      }
    }

    // 7G. Stack Overflow & Hacker News (`qa`)
    if (isEngineEnabled('stackoverflow')) {
      subTasks.push(
        trackEngine('stackoverflow', 'Stack Overflow', async () => {
          const soUrl = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
            cleanQ
          )}&page=${page}&pagesize=8&site=stackoverflow`;
          const soRes = await fetchWithTimeout(soUrl, { headers: { 'Accept-Encoding': 'gzip' } }, 2800);
          if (!soRes.ok) return 0;
          const soData = await soRes.json();
          const items = Array.isArray(soData.items) ? soData.items.slice(0, 8) : [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            aggregatedResults.push({
              id: `so-${item.question_id}`,
              title: decodeHtmlEntities(item.title),
              url: item.link,
              displayedUrl: 'stackoverflow.com › questions',
              snippet: `${item.score} votes · ${item.answer_count} answers${
                item.is_answered ? ' · Accepted' : ''
              } · ${(item.tags || []).slice(0, 3).join(', ')}`,
              engine: 'stackoverflow',
              category: 'code',
              codeSection: 'qa',
              author: item.owner?.display_name,
              publishedDate: item.last_activity_date
                ? new Date(item.last_activity_date * 1000).toLocaleDateString()
                : undefined,
              rankPosition: i,
              tags: item.tags,
            });
          }
          return items.length;
        })
      );
    } else {
      engineHealthMap.set('stackoverflow', { engine: 'stackoverflow', label: 'Stack Overflow', status: 'disabled', count: 0, durationMs: 0 });
    }

    if (isEngineEnabled('hackernews')) {
      subTasks.push(
        trackEngine('hackernews', 'Hacker News', async () => {
          let dateFilter = '';
          if (timeRange !== 'all') {
            const secs =
              timeRange === 'day'
                ? 86400
                : timeRange === 'week'
                ? 7 * 86400
                : timeRange === 'month'
                ? 30 * 86400
                : 365 * 86400;
            dateFilter = `&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - secs}`;
          }
          const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
            cleanQ
          )}&tags=story&hitsPerPage=8&page=${page - 1}${dateFilter}`;
          const hnRes = await fetchWithTimeout(hnUrl, {}, 2800);
          if (!hnRes.ok) return 0;
          const hnData = await hnRes.json();
          const hits = Array.isArray(hnData.hits) ? hnData.hits : [];
          let count = 0;
          for (let i = 0; i < hits.length; i++) {
            const hit = hits[i];
            if (hit.title && (hit.url || hit.objectID)) {
              const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
              aggregatedResults.push({
                id: `hn-${hit.objectID}`,
                title: hit.title,
                url,
                displayedUrl: getDisplayUrl(url),
                snippet: `${hit.points || 0} points · ${hit.num_comments || 0} comments on Hacker News`,
                engine: 'hackernews',
                category: 'code',
                codeSection: 'qa',
                publishedDate: hit.created_at ? new Date(hit.created_at).toLocaleDateString() : undefined,
                rankPosition: i,
              });
              count++;
            }
          }
          return count;
        })
      );
    } else {
      engineHealthMap.set('hackernews', { engine: 'hackernews', label: 'Hacker News', status: 'disabled', count: 0, durationMs: 0 });
    }

    // 7H. Repo-Aware DeepWiki, Google Code Wiki, GitMCP & Trusted Self-Hosted OpenDeepWiki
    const repoEnrichmentTask = (async () => {
      await githubPromise;
      const targetSlug = discoveredRepoSlugs[0];
      const followUps: Promise<void>[] = [];

      if (isEngineEnabled('deepwiki') && page === 1 && targetSlug) {
        followUps.push(
          trackEngine('deepwiki', 'DeepWiki & Code Wiki', async () => {
            let count = 0;
            const structureText = await probeDeepWikiStructure(targetSlug);
            const targetStars = discoveredRepoStars.get(targetSlug);
            const links = buildRepoWikiLinks(targetSlug, trustedOpenDeepWiki || undefined, {
              stars: targetStars,
              deepWikiVerified: Boolean(structureText),
            });

            const wikiUrls =
              links.deepwiki || links.googleCodeWiki || links.openDeepWiki
                ? {
                    ...(links.deepwiki ? { deepwiki: links.deepwiki } : {}),
                    ...(links.googleCodeWiki ? { googleCodeWiki: links.googleCodeWiki } : {}),
                    ...(links.openDeepWiki ? { openDeepWiki: links.openDeepWiki } : {}),
                  }
                : undefined;

            if (links.deepwiki && structureText) {
              const topics = structureText
                .split('\n')
                .map((l) => l.replace(/^[\s\-*0-9.]+/, '').trim())
                .filter((l) => l.length > 3 && !l.startsWith('Available pages'))
                .slice(0, 6);
              const wikiSummary =
                topics.length > 0
                  ? `DeepWiki chapters: ${topics.join(' · ')}`
                  : `Architectural wiki, module breakdown, and interactive diagram index for ${targetSlug}.`;

              aggregatedResults.push({
                id: `deepwiki-${targetSlug}`,
                title: `${targetSlug} — DeepWiki Architecture`,
                url: links.deepwiki,
                displayedUrl: `deepwiki.com › ${targetSlug}`,
                snippet: wikiSummary,
                engine: 'deepwiki',
                category: 'code',
                codeSection: 'wikis',
                mcpUrl: links.gitmcp,
                wikiUrls,
                rankPosition: 0,
              });
              count++;
            }

            if (links.googleCodeWiki) {
              aggregatedResults.push({
                id: `gcodewiki-${targetSlug}`,
                title: `${targetSlug} — Google Code Wiki`,
                url: links.googleCodeWiki,
                displayedUrl: `codewiki.google › github.com › ${targetSlug}`,
                snippet: `Living AI-indexed codebase documentation, dependency diagrams, and symbol guide for ${targetSlug} on Google Code Wiki.`,
                engine: 'google-code-wiki',
                category: 'code',
                codeSection: 'wikis',
                mcpUrl: links.gitmcp,
                wikiUrls,
                rankPosition: 1,
              });
              count++;
            }

            if (links.openDeepWiki) {
              aggregatedResults.push({
                id: `opendeepwiki-${targetSlug}`,
                title: `${targetSlug} — Custom OpenDeepWiki`,
                url: links.openDeepWiki,
                displayedUrl: getDisplayUrl(links.openDeepWiki),
                snippet: `Your configured self-hosted OpenDeepWiki instance documentation for ${targetSlug}.`,
                engine: 'opendeepwiki',
                category: 'code',
                codeSection: 'wikis',
                mcpUrl: links.gitmcp,
                wikiUrls,
                rankPosition: 2,
              });
              count++;
            }

            return count;
          })
        );
      }

      if (isEngineEnabled('gitmcp') && page === 1) {
        followUps.push(
          trackEngine('gitmcp', 'GitMCP Docs', async () => {
            let owner: string | undefined;
            let repo: string | undefined;
            if (targetSlug && targetSlug.includes('/')) {
              [owner, repo] = targetSlug.split('/');
            } else {
              const libCandidate = cleanQ.split(/\s+/)[0];
              if (libCandidate && libCandidate.length >= 2) {
                const mapRes = await callSessionMcpTool(
                  'gitmcp',
                  'https://gitmcp.io/docs',
                  'match_common_libs_owner_repo_mapping',
                  { library: libCandidate },
                  3000
                );
                const slugMatch = mapRes.text?.match(/\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/);
                if (slugMatch?.[1]) {
                  [owner, repo] = slugMatch[1].split('/');
                }
              }
            }

            if (!owner || !repo) return 0;
            const searchRes = await callSessionMcpTool(
              'gitmcp',
              'https://gitmcp.io/docs',
              'search_generic_documentation',
              { owner, repo, query: cleanQ },
              3800
            );
            const slug = `${owner}/${repo}`;
            const gitmcpUrl = `https://gitmcp.io/${slug}`;
            const snippet = searchRes.text
              ? cleanMarkdownSnippet(searchRes.text, 280)
              : `Keyless GitMCP live repository documentation server for ${slug}.`;
            aggregatedResults.push({
              id: `gitmcp-${slug}`,
              title: `${slug} — GitMCP Live Repo Docs`,
              url: `https://github.com/${slug}`,
              displayedUrl: `gitmcp.io › ${slug}`,
              snippet,
              engine: 'gitmcp',
              category: 'code',
              codeSection: 'docs',
              mcpUrl: gitmcpUrl,
              rankPosition: 0,
            });
            return 1;
          })
        );
      }

      if (followUps.length > 0) {
        await Promise.allSettled(followUps);
      }
    })();

    subTasks.push(repoEnrichmentTask);
    await Promise.allSettled(subTasks);
  };

  // 8. Science Concept Overview (strictly separated from paper rankings)
  const academicConceptTask = async () => {
    if (page > 1) return;
    const primaryLang = regionProfile.wikiLang || 'en';
    const [oaTopicRes, wikiRes, sepRes] = await Promise.allSettled([
      isEngineEnabled('openalex')
        ? openAlexGet('topics', { search: cleanQ, per_page: '2' }, providers.openAlexApiKey, 2800)
        : Promise.resolve(null),
      (async () => {
        const tryLang = async (lang: string) => {
          const sr = await fetchWithTimeout(
            `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&srlimit=1&format=json`,
            { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
            2200
          );
          if (!sr.ok) return null;
          const srJson = await sr.json();
          const title = srJson?.query?.search?.[0]?.title || cleanQ;
          const sum = await fetchWithTimeout(
            `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
            { headers: { 'User-Agent': 'Pharol/1.0 (metasearch)' } },
            2400
          );
          if (!sum.ok) return null;
          const data = await sum.json();
          return data?.type === 'standard' && data.extract ? { data, lang } : null;
        };
        return (await tryLang('en')) || (primaryLang !== 'en' ? await tryLang(primaryLang) : null);
      })(),
      fetchWithTimeout(
        `https://plato.stanford.edu/search/searcher.py?query=${encodeURIComponent(cleanQ)}`,
        { headers: { 'User-Agent': BROWSER_UA } },
        2400
      ).then(async (r) => {
        if (!r.ok) return null;
        const html = await r.text();
        const $ = cheerio.load(html);
        const firstLink = $('.result_title a').first();
        const href = firstLink.attr('href');
        const title = firstLink.text().trim();
        const snippet = $('.result_snippet').first().text().replace(/\s+/g, ' ').trim();
        if (!href || !title) return null;
        const absUrl = href.startsWith('http') ? href : `https://plato.stanford.edu${href.startsWith('/') ? '' : '/'}${href}`;
        return { title, url: absUrl, snippet };
      }),
    ]);

    const topic = oaTopicRes.status === 'fulfilled' ? oaTopicRes.value?.results?.[0] : null;
    const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : null;
    const sep = sepRes.status === 'fulfilled' ? sepRes.value : null;

    if (!topic && !wiki && !sep) return;

    const taxonomy = [
      topic?.domain?.display_name,
      topic?.field?.display_name,
      topic?.subfield?.display_name,
    ].filter(Boolean) as string[];

    const wikiExtract = wiki?.data?.extract
      ? String(wiki.data.extract)
          .replace(/\(\s*\/[^;()]*\/\s*;\s*/g, '')
          .replace(/\(\s*\/[^)]*\/\s*\)/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : '';

    const summary =
      wikiExtract ||
      topic?.description ||
      sep?.snippet ||
      `Academic topic overview for ${cleanQ}.`;

    const primaryUrl =
      wiki?.data?.content_urls?.desktop?.page ||
      (topic?.id ? `https://openalex.org/topics/${String(topic.id).split('/').pop()}` : undefined) ||
      sep?.url ||
      `https://openalex.org/works?search=${encodeURIComponent(cleanQ)}`;

    const attributes: Array<{ label: string; value: string }> = [];
    if (topic?.works_count) {
      attributes.push({ label: 'Indexed Works', value: Number(topic.works_count).toLocaleString() });
    }
    if (topic?.cited_by_count) {
      attributes.push({ label: 'Total Citations', value: Number(topic.cited_by_count).toLocaleString() });
    }
    if (wiki?.data?.description) {
      attributes.push({ label: 'Subject', value: String(wiki.data.description) });
    }

    const relatedConcepts = normalizeConceptKeywords(topic?.keywords, 6);

    conceptOverview = {
      title: String(topic?.display_name || wiki?.data?.title || cleanQ),
      subtitle: taxonomy.length > 0 ? taxonomy.join(' › ') : 'Background Concept Reference',
      summary: String(summary),
      url: primaryUrl,
      source: [topic ? 'OpenAlex Topics' : null, wiki ? 'Wikipedia' : null].filter(Boolean).join(' · ') || 'Concept Reference',
      taxonomy: taxonomy.length > 0 ? taxonomy.map(String) : undefined,
      relatedConcepts: relatedConcepts.length > 0 ? relatedConcepts : undefined,
      worksCount: typeof topic?.works_count === 'number' ? topic.works_count : undefined,
      attributes: attributes.length > 0 ? attributes : undefined,
      secondaryReference: sep
        ? {
            title: sep.title,
            source: 'Stanford Encyclopedia of Philosophy',
            url: sep.url,
            snippet: sep.snippet,
          }
        : undefined,
    };
  };

  // 9. PaperSearch Multi-Source Academic Suite
  const scienceTask = async () => {
    const paperTasks: Promise<void>[] = [];

    if (isEngineEnabled('openalex')) {
      paperTasks.push(
        trackEngine('openalex', 'OpenAlex', async () => {
          const data = await openAlexGet('works', {
            search: cleanQ, per_page: '10', page: String(page),
            ...(parsedQuery.bang?.sectionHint === 'datasets' ? { filter: 'type:dataset' } : {}),
          }, providers.openAlexApiKey);
          if (!Array.isArray(data.results)) throw new Error('Invalid OpenAlex search response');
          const works = data.results.map((work: any, rank: number) => mapOpenAlexWork(work, rank)).filter(Boolean);
          aggregatedResults.push(...works);
          return works.length;
        })
      );
    }

    if (isEngineEnabled('semanticscholar')) {
      paperTasks.push(
        trackEngine('semanticscholar', 'Semantic Scholar', async () => {
          const offset = (page - 1) * 8;
          const s2Url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
            cleanQ
          )}&limit=8&offset=${offset}&fields=title,url,abstract,year,citationCount,authors,venue,openAccessPdf,tldr,externalIds`;
          const res = await fetchWithTimeout(
            s2Url,
            { headers: s2Key ? { 'x-api-key': s2Key } : {} },
            3200
          );
          checkQuotaResponse('semanticscholar', res);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = Array.isArray(data.data) ? data.data : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (!p?.title) continue;
            const doi = p.externalIds?.DOI;
            const targetUrl = doi ? `https://doi.org/${doi}` : p.url || `https://www.semanticscholar.org/paper/${p.paperId}`;
            const authors = (p.authors || []).slice(0, 4).map((a: any) => a.name).filter(Boolean);
            const tldr = p.tldr?.text ? String(p.tldr.text) : undefined;
            aggregatedResults.push({
              id: `s2-${p.paperId || `${page}-${i}`}`,
              title: decodeHtmlEntities(p.title),
              url: targetUrl,
              displayedUrl: getDisplayUrl(targetUrl),
              snippet: p.abstract || tldr || `${authors.join(', ')} · ${p.venue || 'Semantic Scholar'}`,
              tldr,
              engine: 'semanticscholar',
              category: 'science',
              scienceSection: 'papers',
              publishedDate: p.year ? String(p.year) : undefined,
              authors,
              doi,
              journal: p.venue || undefined,
              citations: typeof p.citationCount === 'number' ? p.citationCount : undefined,
              pdfUrl: p.openAccessPdf?.url || undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('openaire')) {
      paperTasks.push(
        trackEngine('openaire', 'OpenAIRE Graph', async () => {
          const oaGraphUrl = `https://api.openaire.eu/graph/v1/researchProducts?search=${encodeURIComponent(
            cleanQ
          )}&pageSize=8&page=${page}`;
          const res = await fetchWithTimeout(oaGraphUrl, {}, 3400);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = Array.isArray(data.results) ? data.results : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r?.mainTitle) continue;
            const pidDoi = (r.pids || []).find((pid: any) => pid?.scheme === 'doi')?.value;
            const instanceUrl = r.instances?.[0]?.urls?.[0];
            const url = pidDoi
              ? `https://doi.org/${pidDoi}`
              : instanceUrl || `https://explore.openaire.eu/search/publication?articleId=${encodeURIComponent(r.id || '')}`;
            const authors = (r.authors || []).slice(0, 4).map((a: any) => a.fullName).filter(Boolean);
            const rawDesc = Array.isArray(r.descriptions) && r.descriptions[0] ? String(r.descriptions[0]) : '';
            const cleanDesc = decodeHtmlEntities(rawDesc.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
            const isDataset = r.type === 'dataset' || r.type === 'software';

            aggregatedResults.push({
              id: `openaire-${r.id || `${page}-${i}`}`,
              title: decodeHtmlEntities(r.mainTitle),
              url,
              displayedUrl: getDisplayUrl(url),
              snippet: cleanDesc.slice(0, 300) || `${authors.join(', ')} · OpenAIRE ${r.type || 'publication'}`,
              engine: 'openaire',
              category: 'science',
              scienceSection: isDataset ? 'datasets' : 'papers',
              publishedDate: r.publicationDate ? String(r.publicationDate).slice(0, 4) : undefined,
              authors,
              doi: pidDoi,
              journal: r.container?.name || r.publisher || 'OpenAIRE',
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('europepmc')) {
      paperTasks.push(
        trackEngine('europepmc', 'Europe PMC', async () => {
          const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
            cleanQ
          )}&format=json&resultType=core&pageSize=8&page=${page}`;
          const res = await fetchWithTimeout(epmcUrl, {}, 3500);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = data.resultList?.result || [];
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const doi = item.doi;
            const url = doi
              ? `https://doi.org/${doi}`
              : item.pmcid
              ? `https://europepmc.org/article/PMC/${item.pmcid.replace(/^PMC/, '')}`
              : `https://europepmc.org/article/MED/${item.pmid || item.id}`;
            const pdfEntry = (item.fullTextUrlList?.fullTextUrl || []).find(
              (u: any) => u.documentStyle === 'pdf'
            );

            aggregatedResults.push({
              id: `epmc-${item.id || `${page}-${i}`}`,
              title: decodeHtmlEntities(item.title || 'Europe PMC Article'),
              url,
              displayedUrl: getDisplayUrl(url),
              snippet: decodeHtmlEntities(
                item.abstractText ||
                  `${item.authorString ? `${item.authorString}. ` : ''}${item.journalTitle || ''}`
              )
                .replace(/\b(Introduction|Background|Methods|Results|Conclusion|Conclusions|Discussion|Objective|Purpose)([A-Z][a-z])/g, '$1: $2')
                .slice(0, 320),
              engine: 'europepmc',
              category: 'science',
              scienceSection: 'papers',
              publishedDate: item.pubYear ? String(item.pubYear) : undefined,
              authors: item.authorString ? item.authorString.split(',').slice(0, 4).map((s: string) => s.trim()) : undefined,
              doi,
              journal: item.journalTitle,
              citations: item.citedByCount,
              pdfUrl: pdfEntry?.url || undefined,
              rankPosition: i,
            });
          }
          return list.length;
        })
      );
    }

    if (isEngineEnabled('pubmed')) {
      paperTasks.push(
        trackEngine('pubmed', 'PubMed', async () => {
          const retstart = (page - 1) * 6;
          const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
            cleanQ
          )}&retmode=json&retmax=6&retstart=${retstart}&sort=relevance`;
          const sRes = await fetchWithTimeout(esearchUrl, {}, 3000);
          if (!sRes.ok) return 0;
          const sData = await sRes.json();
          const ids: string[] = sData.esearchresult?.idlist || [];
          if (ids.length === 0) return 0;

          const sumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(
            ','
          )}&retmode=json`;
          const sumRes = await fetchWithTimeout(sumUrl, {}, 3000);
          if (!sumRes.ok) return 0;
          const sumData = await sumRes.json();
          const resultObj = sumData.result || {};
          let count = 0;

          ids.forEach((pmid, idx) => {
            const doc = resultObj[pmid];
            if (!doc || !doc.title) return;
            const authors = (doc.authors || []).slice(0, 4).map((a: any) => a.name).filter(Boolean);
            const doiObj = (doc.articleids || []).find((aid: any) => aid.idtype === 'doi');
            const pmcObj = (doc.articleids || []).find((aid: any) => aid.idtype === 'pmc');
            const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

            aggregatedResults.push({
              id: `pubmed-${pmid}`,
              title: decodeHtmlEntities(doc.title),
              url,
              displayedUrl: `pubmed.ncbi.nlm.nih.gov › ${pmid}`,
              snippet: `${authors.length ? `${authors.join(', ')}. ` : ''}${
                doc.fulljournalname || doc.source || ''
              } (${doc.pubdate || 'n.d.'}).`,
              engine: 'pubmed',
              category: 'science',
              scienceSection: 'papers',
              publishedDate: doc.pubdate ? doc.pubdate.slice(0, 4) : undefined,
              authors,
              doi: doiObj?.value,
              journal: doc.fulljournalname || doc.source,
              pdfUrl: pmcObj?.value ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcObj.value}/pdf/` : undefined,
              rankPosition: idx + 1,
            });
            count++;
          });
          return count;
        })
      );
    }

    if (isEngineEnabled('hal')) {
      paperTasks.push(
        trackEngine('hal', 'HAL Archive', async () => {
          const start = (page - 1) * 6;
          const halUrl = `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(
            cleanQ
          )}&wt=json&rows=6&start=${start}&fl=docid,title_s,uri_s,abstract_s,authFullName_s,publicationDateY_i,doiId_s,journalTitle_s,fileMain_s`;
          const res = await fetchWithTimeout(halUrl, {}, 3000);
          if (!res.ok) return 0;
          const data = await res.json();
          const docs = data.response?.docs || [];
          let count = 0;
          for (let i = 0; i < docs.length; i++) {
            const d = docs[i];
            const title = Array.isArray(d.title_s) ? d.title_s[0] : d.title_s;
            const abstract = Array.isArray(d.abstract_s) ? d.abstract_s[0] : d.abstract_s;
            const url = d.uri_s;
            if (!title || !url) continue;
            aggregatedResults.push({
              id: `hal-${d.docid || `${page}-${i}`}`,
              title: decodeHtmlEntities(title),
              url,
              displayedUrl: getDisplayUrl(url),
              snippet: abstract
                ? decodeHtmlEntities(abstract).slice(0, 300)
                : `${(d.authFullName_s || []).slice(0, 3).join(', ')} · HAL Open Archive`,
              engine: 'hal',
              category: 'science',
              scienceSection: 'preprints',
              publishedDate: d.publicationDateY_i ? String(d.publicationDateY_i) : undefined,
              authors: (d.authFullName_s || []).slice(0, 4),
              doi: d.doiId_s,
              journal: d.journalTitle_s,
              pdfUrl: d.fileMain_s || undefined,
              rankPosition: i + 1,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('crossref')) {
      paperTasks.push(
        trackEngine('crossref', 'CrossRef', async () => {
          const offset = (page - 1) * 8;
          const crUrl = `https://api.crossref.org/works?query=${encodeURIComponent(cleanQ)}&rows=8&offset=${offset}`;
          const crRes = await fetchWithTimeout(
            crUrl,
            { headers: { 'User-Agent': 'Pharol/1.0 (mailto:research@pharol.search)' } },
            3200
          );
          if (!crRes.ok) return 0;
          const crData = await crRes.json();
          const items = crData.message?.items || [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const title = Array.isArray(item.title) ? item.title[0] : item.title || 'Scholarly Paper';
            const authorList = (item.author || [])
              .slice(0, 4)
              .map((a: any) => `${a.given || ''} ${a.family || ''}`.trim())
              .filter(Boolean);
            const journal = Array.isArray(item['container-title'])
              ? item['container-title'][0]
              : item['container-title'];
            const year = item.published?.['date-parts']?.[0]?.[0] || item['created']?.['date-parts']?.[0]?.[0];
            const doi = item.DOI;
            const url = doi ? `https://doi.org/${doi}` : item.URL || '#';

            aggregatedResults.push({
              id: `cr-${doi || `${page}-${i}`}`,
              title: decodeHtmlEntities(title),
              url,
              displayedUrl: `doi.org › ${doi || 'paper'}`,
              snippet: `${authorList.length ? `${authorList.join(', ')}. ` : ''}${
                journal ? `${journal} ` : ''
              }${year ? `(${year}). ` : ''}Citations: ${item['is-referenced-by-count'] || 0}`,
              engine: 'crossref',
              category: 'science',
              scienceSection: 'papers',
              publishedDate: year ? String(year) : undefined,
              authors: authorList,
              doi,
              journal,
              citations: item['is-referenced-by-count'],
              rankPosition: i + 1,
            });
          }
          return items.length;
        })
      );
    }

    if (isEngineEnabled('arxiv')) {
      paperTasks.push(
        trackEngine('arxiv', 'arXiv', async () => {
          const start = (page - 1) * 8;
          const arxivUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
            cleanQ
          )}&start=${start}&max_results=8`;
          const res = await fetchWithTimeout(arxivUrl, {}, 3500);
          if (!res.ok) return 0;
          const xml = await res.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          let idx = 0;
          $('entry').each((_, el) => {
            if (idx >= 8) return false;
            const title = $(el).find('title').text().replace(/\s+/g, ' ').trim();
            const link = $(el).find('id').text().trim();
            const summary = $(el).find('summary').text().replace(/\s+/g, ' ').trim();
            const published = $(el).find('published').text().trim();
            const authors = $(el)
              .find('author > name')
              .map((__, a) => $(a).text().trim())
              .get()
              .slice(0, 4);

            if (title && link) {
              aggregatedResults.push({
                id: `arxiv-${page}-${idx}-${Date.now()}`,
                title,
                url: link,
                displayedUrl: getDisplayUrl(link),
                snippet: summary.slice(0, 280) + (summary.length > 280 ? '...' : ''),
                engine: 'arxiv',
                category: 'science',
                scienceSection: 'preprints',
                publishedDate: published ? new Date(published).getFullYear().toString() : undefined,
                authors,
                journal: 'arXiv Preprint',
                pdfUrl: link.replace('/abs/', '/pdf/'),
                rankPosition: idx,
              });
              idx++;
            }
          });
          return idx;
        })
      );
    }

    if (isEngineEnabled('inspire')) {
      paperTasks.push(
        trackEngine('inspire', 'INSPIRE-HEP', async () => {
          const insUrl = `https://inspirehep.net/api/literature?q=${encodeURIComponent(cleanQ)}&size=6&page=${page}`;
          const res = await fetchWithTimeout(insUrl, {}, 3200);
          if (!res.ok) return 0;
          const data = await res.json();
          const hits = Array.isArray(data?.hits?.hits) ? data.hits.hits : [];
          let count = 0;
          for (let i = 0; i < hits.length; i++) {
            const m = hits[i]?.metadata;
            const title = m?.titles?.[0]?.title;
            if (!title) continue;
            const doi = m.dois?.[0]?.value;
            const arxivId = m.arxiv_eprints?.[0]?.value;
            const url = doi
              ? `https://doi.org/${doi}`
              : arxivId
              ? `https://arxiv.org/abs/${arxivId}`
              : `https://inspirehep.net/literature/${hits[i].id}`;
            const authors = (m.authors || []).slice(0, 4).map((a: any) => a.full_name).filter(Boolean);
            const abs = m.abstracts?.[0]?.value || '';
            aggregatedResults.push({
              id: `inspire-${hits[i].id || `${page}-${i}`}`,
              title: decodeHtmlEntities(title),
              url,
              displayedUrl: getDisplayUrl(url),
              snippet: abs ? decodeHtmlEntities(abs).slice(0, 280) : `${authors.join(', ')} · INSPIRE-HEP`,
              engine: 'inspire',
              category: 'science',
              scienceSection: 'preprints',
              publishedDate: m.earliest_date ? String(m.earliest_date).slice(0, 4) : undefined,
              authors,
              doi,
              citations: typeof m.citation_count === 'number' ? m.citation_count : undefined,
              pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('datacite')) {
      paperTasks.push(
        trackEngine('datacite', 'DataCite', async () => {
          const dcTypeParam =
            parsedQuery.bang?.sectionHint === 'datasets' ? '&resource-type-id=dataset' : '';
          const dcUrl = `https://api.datacite.org/dois?query=${encodeURIComponent(cleanQ)}&page[size]=6&page[number]=${page}${dcTypeParam}`;
          const res = await fetchWithTimeout(dcUrl, {}, 3200);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const attrs = list[i]?.attributes;
            const title = attrs?.titles?.[0]?.title;
            const doi = attrs?.doi;
            if (!title || !doi) continue;
            const url = `https://doi.org/${doi}`;
            const authors = (attrs.creators || []).slice(0, 4).map((c: any) => c.name).filter(Boolean);
            const desc = attrs.descriptions?.[0]?.description || '';
            const resType = attrs.types?.resourceTypeGeneral?.toLowerCase() || '';
            aggregatedResults.push({
              id: `dc-${doi}`,
              title: decodeHtmlEntities(title),
              url,
              displayedUrl: `doi.org › ${doi}`,
              snippet:
                cleanMarkdownSnippet(desc, 260) ||
                `${authors.join(', ')} · ${attrs.publisher || 'DataCite'} (${attrs.publicationYear || 'n.d.'})`,
              engine: 'datacite',
              category: 'science',
              scienceSection: resType === 'dataset' || resType === 'software' ? 'datasets' : 'papers',
              publishedDate: attrs.publicationYear ? String(attrs.publicationYear) : undefined,
              authors,
              doi,
              journal: attrs.publisher,
              citations: typeof attrs.citationCount === 'number' ? attrs.citationCount : undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    if (isEngineEnabled('core') && coreKey) {
      paperTasks.push(
        trackEngine('core', 'CORE Open Access', async () => {
          const offset = (page - 1) * 6;
          const res = await fetchWithTimeout(
            `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(cleanQ)}&limit=6&offset=${offset}`,
            { headers: { Authorization: `Bearer ${coreKey}` } },
            3400
          );
          checkQuotaResponse('core', res);
          if (!res.ok) return 0;
          const data = await res.json();
          const list = Array.isArray(data?.results) ? data.results : [];
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const url = r.doi ? `https://doi.org/${r.doi}` : r.downloadUrl || r.sourceFulltextUrls?.[0];
            if (!r?.title || !url) continue;
            aggregatedResults.push({
              id: `core-${r.id || `${page}-${i}`}`,
              title: decodeHtmlEntities(r.title),
              url,
              displayedUrl: getDisplayUrl(url),
              snippet: cleanMarkdownSnippet(r.abstract || r.title, 280),
              engine: 'core',
              category: 'science',
              scienceSection: 'papers',
              publishedDate: r.yearPublished ? String(r.yearPublished) : undefined,
              authors: Array.isArray(r.authors) ? r.authors.slice(0, 4).map((a: any) => a.name).filter(Boolean) : undefined,
              doi: r.doi,
              journal: r.publisher || 'CORE Repository',
              pdfUrl: r.downloadUrl || undefined,
              rankPosition: i,
            });
            count++;
          }
          return count;
        })
      );
    }

    await Promise.allSettled(paperTasks);
  };

  // 9. Images (Openverse & Wikimedia Commons)
  const imagesTask = async () => {
    await Promise.allSettled([
      trackEngine('openverse', 'Openverse', async () => {
        const ovUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(cleanQ)}&page_size=18&page=${page}`;
        const ovRes = await fetchWithTimeout(
          ovUrl,
          { headers: { 'User-Agent': 'SearXMinimal-Metasearch' } },
          3500
        );
        if (!ovRes.ok) return 0;
        const ovData = await ovRes.json();
        const results = Array.isArray(ovData.results) ? ovData.results : [];
        let count = 0;
        results.forEach((item: any, idx: number) => {
          if (item.thumbnail || item.url) {
            aggregatedResults.push({
              id: `ov-${item.id}`,
              title: item.title || cleanQ,
              url: item.foreign_landing_url || item.url,
              displayedUrl: getDisplayUrl(item.foreign_landing_url || item.url),
              snippet: `${item.creator ? `By ${item.creator} · ` : ''}${
                item.license?.toUpperCase() || 'CC'
              } · ${item.width || 0}×${item.height || 0}`,
              engine: 'openverse',
              category: 'images',
              thumbnail: item.thumbnail || item.url,
              imageWidth: item.width,
              imageHeight: item.height,
              rankPosition: idx,
            });
            count++;
          }
        });
        return count;
      }),
      trackEngine('wikimedia', 'Wikimedia', async () => {
        const gsrOffset = (page - 1) * 10;
        const wmUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
          cleanQ
        )}&gsrnamespace=6&gsroffset=${gsrOffset}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=600&format=json&origin=*`;
        const wmRes = await fetchWithTimeout(wmUrl, {}, 2800);
        if (!wmRes.ok) return 0;
        const wmData = await wmRes.json();
        const pages = wmData.query?.pages || {};
        let count = 0;
        Object.keys(pages).forEach((pid, idx) => {
          const p = pages[pid];
          const info = p.imageinfo?.[0];
          if (info && (info.thumburl || info.url)) {
            const cleanTitle = (p.title || '').replace(/^File:/, '').replace(/\.[^.]+$/, '');
            aggregatedResults.push({
              id: `wm-${pid}`,
              title: cleanTitle || cleanQ,
              url: info.descriptionurl || info.url,
              displayedUrl: 'commons.wikimedia.org',
              snippet: `${info.width || 0}×${info.height || 0} px · Wikimedia Commons`,
              engine: 'wikimedia',
              category: 'images',
              thumbnail: info.thumburl || info.url,
              imageWidth: info.width,
              imageHeight: info.height,
              rankPosition: idx,
            });
            count++;
          }
        });
        return count;
      }),
    ]);
  };

  // 10. Videos (YouTube + Internet Archive)
  const videosTask = async () => {
    await Promise.allSettled([
      trackEngine('internet-archive', 'Internet Archive', async () => {
        const iaUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
          cleanQ
        )}+AND+mediatype:movies&fl[]=identifier,title,description,downloads,date&output=json&rows=10&page=${page}`;
        const iaRes = await fetchWithTimeout(iaUrl, {}, 3000);
        if (!iaRes.ok) return 0;
        const iaData = await iaRes.json();
        const docs = iaData.response?.docs || [];
        docs.forEach((doc: any, idx: number) => {
          const videoId = doc.identifier;
          aggregatedResults.push({
            id: `ia-${videoId}`,
            title: doc.title || cleanQ,
            url: `https://archive.org/details/${videoId}`,
            displayedUrl: `archive.org › ${videoId}`,
            snippet: doc.description
              ? decodeHtmlEntities(String(doc.description).slice(0, 180))
              : 'Public video stream from Internet Archive',
            engine: 'internet-archive',
            category: 'videos',
            thumbnail: `https://archive.org/services/img/${videoId}`,
            embedUrl: `https://archive.org/embed/${videoId}`,
            publishedDate: doc.date ? new Date(doc.date).toLocaleDateString() : undefined,
            views: doc.downloads ? `${Number(doc.downloads).toLocaleString()} views` : undefined,
            rankPosition: idx + 1,
          });
        });
        return docs.length;
      }),
      trackEngine('youtube', 'YouTube', async () => {
        if (page > 1) return 0;
        const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQ)}`;
        const ytRes = await fetchWithTimeout(
          ytUrl,
          { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
          3200
        );
        if (!ytRes.ok) return 0;
        const html = await ytRes.text();
        const rendererMatches = Array.from(
          html.matchAll(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,600}?"title":\{"runs":\[\{"text":"([^"]+)"\}/g)
        );
        const seenIds = new Set<string>();
        let idx = 0;

        for (const m of rendererMatches) {
          const vid = m[1];
          const vidTitle = m[2]?.replace(/\\u0026/g, '&').replace(/\\"/g, '"');
          if (!seenIds.has(vid)) {
            seenIds.add(vid);
            aggregatedResults.push({
              id: `yt-${vid}`,
              title: vidTitle || `${cleanQ} — Video`,
              url: `https://www.youtube.com/watch?v=${vid}`,
              displayedUrl: `youtube.com › watch`,
              snippet: `Watch ${vidTitle || cleanQ} on YouTube (privacy-enhanced embed ready).`,
              engine: 'youtube',
              category: 'videos',
              thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              embedUrl: `https://www.youtube-nocookie.com/embed/${vid}`,
              duration: 'Video',
              rankPosition: idx++,
            });
            if (seenIds.size >= 10) break;
          }
        }
        return seenIds.size;
      }),
    ]);
  };

  // 11. Newer Keyless AI & MCP Search Endpoints (Exa, Parallel, Tavily, Firecrawl, FreeSerp, Keenable, TinyFish)
  const exaTask = async () => {
    if (!isEngineEnabled('exa')) {
      engineHealthMap.set('exa', { engine: 'exa', label: 'Exa MCP', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    if (page > 1) return;
    await trackEngine('exa', 'Exa MCP', async () => {
      const text = await callMcpSearchTool(
        'exa',
        'https://mcp.exa.ai/mcp',
        exaKey ? { 'x-api-key': exaKey } : {},
        'web_search_exa',
        {
          query: effectiveQuery,
          objective: `Find authoritative, up-to-date pages about ${cleanQ}`,
          numResults: 6,
        },
        4200
      );
      if (!text) return 0;
      const items = parseExaMcpTextResponse(text);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        aggregatedResults.push({
          id: `exa-${i}-${Date.now()}`,
          title: it.title,
          url: it.url,
          displayedUrl: getDisplayUrl(it.url),
          snippet: it.snippet,
          engine: 'exa',
          category: 'all',
          publishedDate: it.publishedDate,
          author: it.author,
          rankPosition: i,
        });
      }
      return items.length;
    });
  };

  const parallelTask = async () => {
    if (!isEngineEnabled('parallel')) {
      engineHealthMap.set('parallel', { engine: 'parallel', label: 'Parallel MCP', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    if (page > 1) return;
    await trackEngine('parallel', 'Parallel MCP', async () => {
      const innerText = await callMcpSearchTool(
        'parallel',
        'https://search.parallel.ai/mcp',
        parallelKey ? { 'x-api-key': parallelKey } : {},
        'web_search',
        {
          objective: `Search authoritative pages for: ${cleanQ}`,
          search_queries: [effectiveQuery],
        },
        4200
      );
      if (!innerText) return 0;
      const parsed = JSON.parse(innerText);
      const list = Array.isArray(parsed.results) ? parsed.results.slice(0, 6) : [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r?.url || !r?.title) continue;
        const rawExcerpt = Array.isArray(r.excerpts) ? r.excerpts.join(' ') : r.snippet || '';
        aggregatedResults.push({
          id: `parallel-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(rawExcerpt, 280) || String(r.title),
          engine: 'parallel',
          category: 'all',
          publishedDate: r.publish_date ? String(r.publish_date).slice(0, 10) : undefined,
          rankPosition: i,
        });
        count++;
      }
      return count;
    });
  };

  const tavilyTask = async () => {
    if (!isEngineEnabled('tavily')) {
      engineHealthMap.set('tavily', { engine: 'tavily', label: 'Tavily Keyless', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    if (page > 1) return;
    await trackEngine('tavily', 'Tavily Keyless', async () => {
      const body: Record<string, any> = {
        query: effectiveQuery,
        max_results: 6,
        search_depth: 'basic',
      };
      if (timeRange !== 'all') {
        body.days = timeRange === 'day' ? 1 : timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 365;
      }
      const res = await fetchWithTimeout(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tavilyKey
              ? { Authorization: `Bearer ${tavilyKey}` }
              : { 'X-Tavily-Access-Mode': 'keyless' }),
          },
          body: JSON.stringify(body),
        },
        3800
      );
      checkQuotaResponse('tavily', res);
      if (!res.ok) return 0;
      const data = await res.json();
      const list = Array.isArray(data.results) ? data.results.slice(0, 6) : [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `tavily-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.content || r.title), 280),
          engine: 'tavily',
          category: 'all',
          score: typeof r.score === 'number' ? r.score : undefined,
          rankPosition: i,
        });
        count++;
      }
      return count;
    });
  };

  const firecrawlTask = async () => {
    if (!isEngineEnabled('firecrawl')) {
      engineHealthMap.set('firecrawl', { engine: 'firecrawl', label: 'Firecrawl Keyless', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    if (page > 1) return;
    await trackEngine('firecrawl', 'Firecrawl Keyless', async () => {
      const body: Record<string, any> = {
        query: effectiveQuery,
        sources: ['web', 'news'],
        limit: 5,
      };
      if (regionProfile.code !== 'global') {
        body.location = regionProfile.countryName;
        body.country = regionProfile.country;
      }
      if (timeRange !== 'all') {
        body.tbs =
          timeRange === 'day'
            ? 'qdr:d'
            : timeRange === 'week'
            ? 'qdr:w'
            : timeRange === 'month'
            ? 'qdr:m'
            : 'qdr:y';
      }
      const res = await fetchWithTimeout(
        'https://api.firecrawl.dev/v2/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(firecrawlKey
              ? { Authorization: `Bearer ${firecrawlKey}` }
              : {}),
          },
          body: JSON.stringify(body),
        },
        4200
      );
      checkQuotaResponse('firecrawl', res);
      if (!res.ok) return 0;
      const json = await res.json();
      const webList = Array.isArray(json.data?.web) ? json.data.web : Array.isArray(json.data) ? json.data : [];
      const newsList = Array.isArray(json.data?.news) ? json.data.news : [];
      let count = 0;
      for (let i = 0; i < Math.min(webList.length, 5); i++) {
        const r = webList[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `firecrawl-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.description || r.markdown || r.title), 280),
          engine: 'firecrawl',
          category: 'all',
          rankPosition: i,
        });
        count++;
      }
      for (let i = 0; i < Math.min(newsList.length, 3); i++) {
        const r = newsList[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `firecrawl-n-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 280),
          engine: 'firecrawl',
          category: 'all',
          publishedDate: r.date ? String(r.date) : undefined,
          rankPosition: i,
        });
        if (newsHighlights.length < 5) {
          newsHighlights.push({
            id: `fc-hl-${i}-${Date.now()}`,
            title: decodeHtmlEntities(String(r.title)),
            url: r.url,
            displayedUrl: extractDomain(r.url),
            snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 220),
            engine: 'firecrawl-news',
            category: 'news',
            publishedDate: r.date ? String(r.date) : undefined,
            author: extractDomain(r.url),
            thumbnail: r.imageUrl || undefined,
            rankPosition: i,
          });
        }
        count++;
      }
      return count;
    });
  };

  const freeserpTask = async () => {
    if (!isEngineEnabled('freeserp')) {
      engineHealthMap.set('freeserp', { engine: 'freeserp', label: 'FreeSerp', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    await trackEngine('freeserp', 'FreeSerp', async () => {
      const offset = (page - 1) * 6;
      const fsUrl = `https://freeserp.ai/api.php?index=web&q=${encodeURIComponent(
        cleanQ
      )}&size=6&from=${offset}`;
      const res = await fetchWithTimeout(fsUrl, { headers: { Accept: 'application/json' } }, 3500);
      checkQuotaResponse('freeserp', res);
      if (!res.ok) return 0;
      const data = await res.json();
      const list = Array.isArray(data.results) ? data.results.slice(0, 6) : [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `freeserp-${page}-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.snippet || r.ai_summary || r.title), 280),
          engine: 'freeserp',
          category: 'all',
          publishedDate: r.published_at ? String(r.published_at).slice(0, 10) : r.crawled_at ? String(r.crawled_at).slice(0, 10) : undefined,
          rankPosition: i + 1,
        });
        count++;
      }
      return count;
    });
  };

  const keenableTask = async () => {
    if (!isEngineEnabled('keenable')) {
      engineHealthMap.set('keenable', { engine: 'keenable', label: 'Keenable', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    if (page > 1) return;
    await trackEngine('keenable', 'Keenable', async () => {
      const args: Record<string, any> = {
        query: cleanQ,
        max_results: 6,
        output_format: 'json',
      };
      if (parsedQuery.site) args.site = parsedQuery.site;
      if (timeRange !== 'all') {
        args.published_after =
          timeRange === 'day' ? '24h' : timeRange === 'week' ? '7d' : timeRange === 'month' ? '1mo' : '1y';
      }
      const innerText = await callMcpSearchTool(
        'keenable',
        keenableKey
          ? 'https://api.keenable.ai/mcp'
          : 'https://api.keenable.ai/mcp-public',
        keenableKey ? { 'X-API-Key': keenableKey } : {},
        'search_web_pages',
        args,
        3600
      );
      if (!innerText) return 0;
      const parsed = JSON.parse(innerText);
      const list = Array.isArray(parsed.results) ? parsed.results.slice(0, 6) : [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `keenable-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.snippet || r.description || r.title), 280),
          engine: 'keenable',
          category: 'all',
          publishedDate: r.published_at ? String(r.published_at).slice(0, 10) : undefined,
          rankPosition: i,
        });
        count++;
      }
      return count;
    });
  };

  const tinyfishTask = async () => {
    if (!isEngineEnabled('tinyfish')) {
      engineHealthMap.set('tinyfish', { engine: 'tinyfish', label: 'TinyFish Keyless', status: 'disabled', count: 0, durationMs: 0 });
      return;
    }
    await trackEngine('tinyfish', 'TinyFish Keyless', async () => {
      const args: Record<string, any> = {
        query: cleanQ,
        domain_type: effectiveCategory === 'news' ? 'news' : 'web',
        page: Math.max(0, Math.min(10, page - 1)),
      };
      if (regionProfile.code !== 'global') {
        args.location = regionProfile.country;
        args.language = regionProfile.lang;
      }
      if (parsedQuery.site) args.include_domains = parsedQuery.site;
      if (timeRange !== 'all') {
        const mins =
          timeRange === 'day'
            ? 1440
            : timeRange === 'week'
            ? 10080
            : timeRange === 'month'
            ? 43200
            : 525600;
        args.recency_minutes = mins;
      }

      const innerText = await callMcpSearchTool(
        'tinyfish',
        'https://agent.tinyfish.ai/mcp',
        tinyfishKey
          ? { 'X-API-Key': tinyfishKey }
          : { 'X-TinyFish-Access-Mode': 'keyless' },
        'search',
        args,
        4000
      );
      if (!innerText) return 0;
      const parsed = JSON.parse(innerText);
      const list = Array.isArray(parsed.results) ? parsed.results.slice(0, 6) : [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r?.url || !r?.title) continue;
        aggregatedResults.push({
          id: `tinyfish-${page}-${i}-${Date.now()}`,
          title: decodeHtmlEntities(String(r.title)),
          url: r.url,
          displayedUrl: getDisplayUrl(r.url),
          snippet: cleanMarkdownSnippet(String(r.snippet || r.title), 280),
          engine: 'tinyfish',
          category: 'all',
          publishedDate: r.date ? String(r.date) : undefined,
          rankPosition: i,
        });
        count++;
      }
      return count;
    });
  };

  // Run tasks for the effective category
  const tasks: Promise<void>[] = [];
  if (effectiveCategory === 'images') {
    tasks.push(imagesTask());
  } else if (effectiveCategory === 'videos') {
    tasks.push(videosTask());
  } else if (effectiveCategory === 'code') {
    tasks.push(codeTask());
  } else if (effectiveCategory === 'science') {
    tasks.push(scienceTask());
    if (options.includeConceptOverview !== false) tasks.push(academicConceptTask());
  } else if (effectiveCategory === 'news') {
    tasks.push(newsTask());
  } else {
    tasks.push(
      wikiTask(),
      ddgInstantTask(),
      ...Object.keys(WEB_ENGINES).map((engine) => coreWebTask(engine as keyof typeof WEB_ENGINES)),
      marginaliaTask(),
      exaTask(),
      parallelTask(),
      tavilyTask(),
      firecrawlTask(),
      freeserpTask(),
      keenableTask(),
      tinyfishTask(),
      newsTask(),
      codeTask()
    );
    if (searchIntent.isScience) {
      tasks.push(scienceTask());
    }
  }

  await Promise.allSettled(tasks);
  const finalResponse = buildSnapshot(true);
  if (!hasUserOverrides) {
    setCachedSearchResponse(cacheKey, finalResponse);
  }
  return finalResponse;
}
