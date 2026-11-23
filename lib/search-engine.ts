import {
  AccessType,
  BangDefinition,
  NewsAccessFilter,
  ParsedQuery,
  SearchCategory,
  SearchRegion,
  SearchResult,
  ReaderBlock,
  TimeRange,
} from './search-types';

export const BANG_SHORTCUTS: BangDefinition[] = [
  { bang: '!gh', label: 'GitHub', category: 'code', engines: ['github'], sectionHint: 'repos', description: 'Search GitHub repositories' },
  { bang: '!docs', label: 'Docs & MCP', category: 'code', engines: ['exa-code', 'context7', 'gitmcp', 'mdn', 'firecrawl-dev'], sectionHint: 'docs', description: 'Search library docs & keyless MCP context' },
  { bang: '!deepwiki', label: 'Repo Wikis', category: 'code', engines: ['deepwiki', 'github'], sectionHint: 'wikis', description: 'Search DeepWiki & Google Code Wiki architecture' },
  { bang: '!pkg', label: 'Packages', category: 'code', engines: ['npm', 'crates', 'pypi'], sectionHint: 'packages', description: 'Search npm, Crates.io, and PyPI registries' },
  { bang: '!so', label: 'Stack Overflow', category: 'code', engines: ['stackoverflow'], sectionHint: 'qa', description: 'Search Stack Overflow Q&A' },
  { bang: '!hn', label: 'Hacker News', category: 'code', engines: ['hackernews'], sectionHint: 'qa', description: 'Search Hacker News discussions' },
  { bang: '!paper', label: 'Papers', category: 'science', description: 'Search all academic repositories & concept overview' },
  { bang: '!arxiv', label: 'arXiv', category: 'science', engines: ['arxiv'], sectionHint: 'preprints', description: 'Search arXiv preprints' },
  { bang: '!dataset', label: 'Datasets', category: 'science', engines: ['datacite', 'openaire'], sectionHint: 'datasets', description: 'Search open datasets & software DOIs' },
  { bang: '!news', label: 'News', category: 'news', description: 'Search direct news publishers' },
  { bang: '!img', label: 'Images', category: 'images', description: 'Search Openverse & Wikimedia images' },
  { bang: '!vid', label: 'Videos', category: 'videos', description: 'Search YouTube & Internet Archive' },
  { bang: '!wiki', label: 'Wikipedia', category: 'all', engines: ['wikipedia'], description: 'Search Wikipedia entries' },
];

const BANG_ALIASES: Record<string, string> = {
  '!github': '!gh',
  '!sci': '!paper',
  '!science': '!paper',
  '!scholar': '!paper',
  '!images': '!img',
  '!videos': '!vid',
  '!cwiki': '!deepwiki',
  '!codewiki': '!deepwiki',
  '!doc': '!docs',
  '!context7': '!docs',
  '!gitmcp': '!docs',
  '!npm': '!pkg',
  '!pypi': '!pkg',
  '!crates': '!pkg',
  '!datasets': '!dataset',
};

/**
 * Parses user search query for advanced syntax operators:
 * - !bang shortcuts (!gh, !so, !arxiv, !paper, !news, !img, !vid, !wiki)
 * - site:example.com
 * - filetype:pdf / ext:pdf
 * - intitle:"term" or intitle:term
 * - exact phrases: "quoted words"
 * - exclusions: -term or -"exclude phrase"
 */
export function parseSearchSyntax(rawQuery: string): ParsedQuery {
  let text = rawQuery.trim();
  const exactPhrases: string[] = [];
  const excludedTerms: string[] = [];
  let site: string | undefined;
  let filetype: string | undefined;
  let inTitle: string | undefined;
  let bang: BangDefinition | undefined;

  const REGION_SYNTAX_MAP: Record<string, SearchRegion> = {
    auto: 'auto',
    global: 'global',
    pt: 'pt-PT',
    'pt-pt': 'pt-PT',
    portugal: 'pt-PT',
    br: 'pt-BR',
    'pt-br': 'pt-BR',
    brasil: 'pt-BR',
    us: 'en-US',
    'en-us': 'en-US',
    uk: 'en-GB',
    gb: 'en-GB',
    'en-gb': 'en-GB',
    es: 'es-ES',
    'es-es': 'es-ES',
    fr: 'fr-FR',
    'fr-fr': 'fr-FR',
    de: 'de-DE',
    'de-de': 'de-DE',
  };

  let regionOverride: SearchRegion | undefined;

  const bangMatch = text.match(/(?:^|\s)(![a-zA-Z0-9]+)(?=\s|$)/i);
  if (bangMatch) {
    const rawToken = bangMatch[1].toLowerCase();
    const regionBangKey = rawToken.slice(1);
    if (REGION_SYNTAX_MAP[regionBangKey] && !BANG_SHORTCUTS.some((b) => b.bang === rawToken)) {
      regionOverride = REGION_SYNTAX_MAP[regionBangKey];
      text = text.replace(bangMatch[0], ' ');
    } else {
      const canonical = BANG_ALIASES[rawToken] || rawToken;
      const found = BANG_SHORTCUTS.find((b) => b.bang === canonical);
      if (found) {
        bang = found;
        text = text.replace(bangMatch[0], ' ');
      }
    }
  }

  const regionSyntaxMatch = text.match(/\b(?:lang|region):([a-zA-Z-]+)\b/i);
  if (regionSyntaxMatch) {
    const candidate = REGION_SYNTAX_MAP[regionSyntaxMatch[1].toLowerCase()];
    if (candidate) {
      regionOverride = candidate;
      text = text.replace(regionSyntaxMatch[0], ' ');
    }
  }

  const siteMatch = text.match(/\bsite:([^\s]+)/i);
  if (siteMatch) {
    site = siteMatch[1].toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    text = text.replace(siteMatch[0], '');
  }

  const filetypeMatch = text.match(/\b(?:filetype|ext):([a-zA-Z0-9]+)/i);
  if (filetypeMatch) {
    filetype = filetypeMatch[1].toLowerCase();
    text = text.replace(filetypeMatch[0], '');
  }

  const intitleMatch = text.match(/\bintitle:(?:"([^"]+)"|([^\s]+))/i);
  if (intitleMatch) {
    inTitle = intitleMatch[1] || intitleMatch[2];
    text = text.replace(intitleMatch[0], '');
  }

  const phraseMatches = text.matchAll(/"([^"]+)"/g);
  for (const m of phraseMatches) {
    if (m[1].trim()) {
      exactPhrases.push(m[1].trim());
    }
  }
  text = text.replace(/"[^"]+"/g, '');

  const excludeMatches = text.matchAll(/(?:^|\s)-([a-zA-Z0-9_\-]+)/g);
  for (const m of excludeMatches) {
    if (m[1]) {
      excludedTerms.push(m[1].toLowerCase());
    }
  }
  text = text.replace(/(?:^|\s)-[a-zA-Z0-9_\-]+/g, '');

  const cleanQuery = text.replace(/\s+/g, ' ').trim();

  return {
    raw: rawQuery,
    cleanQuery,
    site,
    filetype,
    exactPhrases,
    excludedTerms,
    inTitle,
    bang,
    regionOverride,
  };
}

export function parseApproximateTimestamp(
  publishedDate?: string,
  nowMs: number = Date.now()
): number | null {
  if (!publishedDate) return null;
  const trimmed = publishedDate.trim();
  if (!trimmed) return null;

  if (/^(?:today|hoje|just now|agora)$/i.test(trimmed)) {
    return nowMs;
  }
  if (/^(?:yesterday|ontem)$/i.test(trimmed)) {
    return nowMs - 86_400_000;
  }
  if (/^\d{4}$/.test(trimmed)) {
    return new Date(`${trimmed}-06-15T00:00:00Z`).getTime();
  }

  const relEn = trimmed.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relEn) {
    const val = Number(relEn[1]);
    const unit = relEn[2].toLowerCase();
    const mult =
      unit === 'minute'
        ? 60_000
        : unit === 'hour'
        ? 3_600_000
        : unit === 'day'
        ? 86_400_000
        : unit === 'week'
        ? 7 * 86_400_000
        : unit === 'month'
        ? 30 * 86_400_000
        : 365 * 86_400_000;
    return nowMs - val * mult;
  }

  const relPt = trimmed.match(/^há\s+(\d+)\s+(minuto|hora|dia|semana|mês|mes|ano)s?$/i);
  if (relPt) {
    const val = Number(relPt[1]);
    const unit = relPt[2].toLowerCase();
    const mult =
      unit === 'minuto'
        ? 60_000
        : unit === 'hora'
        ? 3_600_000
        : unit === 'dia'
        ? 86_400_000
        : unit === 'semana'
        ? 7 * 86_400_000
        : unit.startsWith('m')
        ? 30 * 86_400_000
        : 365 * 86_400_000;
    return nowMs - val * mult;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Enforces parsed search operators (site, filetype, exactPhrases, inTitle, excludedTerms)
 * and optional timeRange window on aggregated search results.
 */
export function filterResultsBySyntax(
  results: SearchResult[],
  parsed: ParsedQuery,
  timeRange: TimeRange = 'all',
  nowMs: number = Date.now()
): SearchResult[] {
  let out = results;

  if (parsed.site) {
    const siteDomain = parsed.site.toLowerCase();
    out = out.filter((r) => r.url.toLowerCase().includes(siteDomain));
  }

  if (parsed.filetype) {
    const ft = parsed.filetype.toLowerCase();
    out = out.filter(
      (r) =>
        r.url.toLowerCase().endsWith(`.${ft}`) ||
        (r.pdfUrl && r.pdfUrl.toLowerCase().includes(ft)) ||
        r.snippet.toLowerCase().includes(ft)
    );
  }

  if (parsed.inTitle) {
    const target = parsed.inTitle.toLowerCase();
    out = out.filter((r) => r.title.toLowerCase().includes(target));
  }

  if (parsed.exactPhrases.length > 0) {
    out = out.filter((r) => {
      const text = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
      return parsed.exactPhrases.every((phrase) => text.includes(phrase.toLowerCase()));
    });
  }

  if (parsed.excludedTerms.length > 0) {
    out = out.filter((r) => {
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      return !parsed.excludedTerms.some((term) => text.includes(term));
    });
  }

  if (timeRange && timeRange !== 'all') {
    const windowMs =
      timeRange === 'day'
        ? 2 * 86_400_000
        : timeRange === 'week'
        ? 8 * 86_400_000
        : timeRange === 'month'
        ? 32 * 86_400_000
        : 366 * 86_400_000;
    const cutoff = nowMs - windowMs;
    const datedMatches = out.filter((r) => {
      const ts = parseApproximateTimestamp(r.publishedDate, nowMs);
      return ts !== null && ts >= cutoff;
    });
    if (datedMatches.length > 0) {
      return datedMatches;
    }
    // If no items had dates within the cutoff, filter out explicitly older dated items
    out = out.filter((r) => {
      const ts = parseApproximateTimestamp(r.publishedDate, nowMs);
      return ts === null || ts >= cutoff;
    });
  }

  return out;
}

/**
 * Normalizes a URL: strips tracking parameters, hash, www prefix,
 * and trailing slash for reliable deduplication across engines.
 */
export function normalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'msclkid',
      'ref',
      'source',
      'spm',
      'ocid',
      'ncid',
    ];

    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    let normalized = parsed.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return urlStr.trim().replace(/\/$/, '');
  }
}

/**
 * Extracts clean hostname without www.
 */
export function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return urlStr;
  }
}

/**
 * Unwraps Bing News / Bing Web apiclick redirect links into direct publisher URLs.
 */
export function extractBingTargetUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.includes('bing.com')) {
      const target = parsed.searchParams.get('url') || parsed.searchParams.get('u');
      if (target) {
        if (target.startsWith('http://') || target.startsWith('https://')) {
          return target;
        }
        // Bing sometimes prefixes base64 URL with 'a1'
        if (target.startsWith('a1')) {
          const b64 = target.slice(2).replace(/-/g, '+').replace(/_/g, '/');
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          if (decoded.startsWith('http')) return decoded;
        }
      }
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Formats a clean display domain/breadcrumb
 */
export function getDisplayUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const domain = parsed.hostname.replace(/^www\./, '');
    const pathname = parsed.pathname;
    if (pathname && pathname !== '/') {
      const parts = pathname.split('/').filter(Boolean).slice(0, 2);
      return parts.length > 0 ? `${domain} › ${parts.join(' › ')}` : domain;
    }
    return domain;
  } catch {
    return urlStr;
  }
}

const ENGINE_WEIGHTS: Record<string, number> = {
  serper: 1.3,
  brave: 1.28,
  duckduckgo: 1.25,
  bing: 1.2,
  wikipedia: 1.18,
  wikidata: 1.12,
  exa: 1.22,
  'exa-code': 1.28,
  context7: 1.24,
  gitmcp: 1.22,
  deepwiki: 1.2,
  'google-code-wiki': 1.18,
  opendeepwiki: 1.18,
  mdn: 1.2,
  'firecrawl-dev': 1.16,
  npm: 1.08,
  crates: 1.08,
  pypi: 1.08,
  parallel: 1.2,
  tavily: 1.2,
  firecrawl: 1.16,
  keenable: 1.16,
  tinyfish: 1.14,
  freeserp: 1.1,
  openalex: 1.2,
  semanticscholar: 1.22,
  europepmc: 1.16,
  pubmed: 1.14,
  openaire: 1.14,
  arxiv: 1.12,
  inspire: 1.08,
  crossref: 1.05,
  hal: 1.04,
  datacite: 1.04,
  core: 1.12,
  github: 1.14,
  stackoverflow: 1.12,
  hackernews: 0.98,
  marginalia: 0.92,
  'serper-news': 1.22,
  'brave-news': 1.22,
  'duckduckgo-news': 1.2,
  'bing-news': 1.15,
  'firecrawl-news': 1.18,
  'tavily-news': 1.18,
  'tinyfish-news': 1.14,
  bbc: 1.1,
  npr: 1.08,
  guardian: 1.08,
  arstechnica: 1.05,
  rtp: 1.14,
  observador: 1.1,
  eco: 1.08,
  noticiasaominuto: 1.06,
  publico: 1.06,
  'serper-images': 1.15,
  'brave-images': 1.15,
  openverse: 1.05,
  wikimedia: 1.0,
  'serper-videos': 1.15,
  'brave-videos': 1.15,
  youtube: 1.05,
  'internet-archive': 0.95,
};

const CATEGORY_ENGINE_WEIGHTS: Partial<Record<SearchCategory, Record<string, number>>> = {
  science: {
    openalex: 1.32,
    semanticscholar: 1.3,
    europepmc: 1.24,
    pubmed: 1.22,
    openaire: 1.2,
    arxiv: 1.18,
    inspire: 1.15,
    core: 1.15,
    crossref: 1.1,
    hal: 1.08,
    datacite: 1.06,
    wikipedia: 0.35,
  },
  code: {
    'exa-code': 1.32,
    context7: 1.28,
    gitmcp: 1.26,
    mdn: 1.24,
    deepwiki: 1.24,
    'google-code-wiki': 1.2,
    opendeepwiki: 1.2,
    github: 1.2,
    stackoverflow: 1.18,
    'firecrawl-dev': 1.16,
    npm: 1.1,
    crates: 1.1,
    pypi: 1.1,
    hackernews: 1.0,
  },
};

function getEngineWeight(engine: string, category?: SearchCategory): number {
  const key = engine.toLowerCase();
  const catWeight = category ? CATEGORY_ENGINE_WEIGHTS[category]?.[key] : undefined;
  if (catWeight !== undefined) return catWeight;
  return ENGINE_WEIGHTS[key] ?? 1.0;
}

interface PreparedLexicalQuery {
  trimmedLower: string;
  terms: string[];
}

function prepareLexicalQuery(query?: string): PreparedLexicalQuery | null {
  if (!query) return null;
  const trimmedLower = query.toLowerCase().trim();
  const terms = trimmedLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return null;
  return { trimmedLower, terms };
}

function computeLexicalBoost(
  title: string,
  snippet: string,
  prepared: PreparedLexicalQuery | null
): number {
  if (!prepared) return 0;
  const { terms, trimmedLower } = prepared;
  const lowerTitle = title.toLowerCase();
  const lowerSnippet = snippet.toLowerCase();
  let matchedTitle = 0;
  let matchedSnippet = 0;

  for (const term of terms) {
    if (lowerTitle.includes(term)) matchedTitle++;
    if (lowerSnippet.includes(term)) matchedSnippet++;
  }

  const titleRatio = matchedTitle / terms.length;
  const snippetRatio = matchedSnippet / terms.length;
  const exactBonus = lowerTitle.includes(trimmedLower) ? 1.2 : 0;

  return titleRatio * 1.6 + snippetRatio * 0.6 + exactBonus;
}

export function isFreshnessSensitiveQuery(query?: string): boolean {
  if (!query) return false;
  return /\b(202[4-9]|today|hoje|latest|recent|breaking|news|not[íi]cias|atual|elei[çc][õo]es|election|prime minister|primeiro[- ]ministro|president|presidente|price|pre[çc]o|release|update|score|montenegro)\b/i.test(
    query
  );
}

export function computeRegionalDomainBoost(url: string, regionCode?: string): number {
  if (!regionCode || regionCode === 'global' || regionCode === 'auto' || regionCode === 'en-US') {
    return 0;
  }
  const domain = extractDomain(url);
  if (!domain) return 0;

  if (regionCode === 'pt-PT') {
    if (
      domain.endsWith('.pt') ||
      domain === 'pt.wikipedia.org' ||
      domain === 'noticiasaominuto.com' ||
      domain === 'jornaleconomico.sapo.pt' ||
      domain === 'eco.sapo.pt'
    ) {
      return 1.4;
    }
    return 0;
  }

  if (regionCode === 'pt-BR') {
    return domain.endsWith('.br') || domain === 'pt.wikipedia.org' ? 1.4 : 0;
  }
  if (regionCode === 'es-ES') {
    return domain.endsWith('.es') || domain === 'es.wikipedia.org' ? 1.3 : 0;
  }
  if (regionCode === 'fr-FR') {
    return domain.endsWith('.fr') || domain === 'fr.wikipedia.org' ? 1.3 : 0;
  }
  if (regionCode === 'de-DE') {
    return domain.endsWith('.de') || domain === 'de.wikipedia.org' ? 1.3 : 0;
  }
  if (regionCode === 'en-GB') {
    return domain.endsWith('.uk') || domain === 'bbc.co.uk' || domain === 'theguardian.com' ? 1.1 : 0;
  }
  return 0;
}

export function computeRecencyBoost(
  publishedDate: string | undefined,
  category: string,
  freshnessSensitive: boolean,
  nowMs: number = Date.now()
): number {
  const ts = parseApproximateTimestamp(publishedDate, nowMs);
  if (ts === null) return 0;

  const ageHours = Math.max(0, (nowMs - ts) / 3_600_000);
  const weight = category === 'news' || freshnessSensitive ? 1.0 : 0.4;

  if (ageHours <= 48) return 2.6 * weight;
  if (ageHours <= 24 * 7) return 1.8 * weight;
  if (ageHours <= 24 * 30) return 0.9 * weight;
  if (ageHours <= 24 * 180) return 0.25 * weight;
  if (ageHours > 24 * 365 * 2 && (category === 'news' || freshnessSensitive)) {
    return -0.7;
  }
  return 0;
}

export interface RankOptions {
  category?: SearchCategory;
  regionCode?: string;
  timeRange?: TimeRange;
  nowMs?: number;
}

/**
 * Deduplicates search results from multiple keyless engines and ranks them
 * using SearXNG-style Reciprocal Rank Fusion (RRF), multi-engine consensus,
 * category-aware engine weight, lexical query relevance, recency decay,
 * citation/star authority, regional authority, and domain diversity dampening.
 */
export function deduplicateAndRank(
  results: SearchResult[],
  query?: string,
  options: RankOptions = {}
): SearchResult[] {
  interface RankedEntry {
    result: SearchResult;
    rrfScore: number;
    engineCount: number;
    engines: string[];
  }

  const nowMs = options.nowMs ?? Date.now();
  const preparedQuery = prepareLexicalQuery(query);
  const freshnessSensitive =
    isFreshnessSensitiveQuery(query) || Boolean(options.timeRange && options.timeRange !== 'all');
  const map = new Map<string, RankedEntry>();

  // Track position per engine if rankPosition wasn't explicitly set
  const engineAutoPos = new Map<string, number>();

  for (const item of results) {
    const norm = normalizeUrl(item.url);
    if (!norm) continue;

    const eng = item.engine.toLowerCase();
    const pos =
      typeof item.rankPosition === 'number'
        ? item.rankPosition
        : engineAutoPos.get(eng) ?? 0;
    engineAutoPos.set(eng, (engineAutoPos.get(eng) ?? 0) + 1);

    const effectiveCategory = options.category || item.category;
    const weight = getEngineWeight(eng, effectiveCategory);
    // RRF contribution: position 0 gets highest, decaying smoothly across ranks
    const rrfContribution = (12 / (pos + 4)) * weight;

    if (map.has(norm)) {
      const entry = map.get(norm)!;
      entry.rrfScore += rrfContribution;

      if (!entry.engines.includes(item.engine)) {
        entry.engines.push(item.engine);
        entry.engineCount += 1;
        // Multi-engine consensus bonus
        entry.rrfScore += 1.5;
        entry.result.engine = entry.engines.join(', ');
      }

      if (item.snippet.length > entry.result.snippet.length && !item.snippet.startsWith('http')) {
        entry.result.snippet = item.snippet;
      }
      if (!entry.result.publishedDate && item.publishedDate) {
        entry.result.publishedDate = item.publishedDate;
      }
      if (!entry.result.thumbnail && item.thumbnail) {
        entry.result.thumbnail = item.thumbnail;
      }
      if (!entry.result.pdfUrl && item.pdfUrl) {
        entry.result.pdfUrl = item.pdfUrl;
      }
      if (!entry.result.doi && item.doi) {
        entry.result.doi = item.doi;
      }
      if (!entry.result.tldr && item.tldr) {
        entry.result.tldr = item.tldr;
      }
      if (item.citations !== undefined && (entry.result.citations === undefined || item.citations > entry.result.citations)) {
        entry.result.citations = item.citations;
      }
      if (!entry.result.codeSection && item.codeSection) {
        entry.result.codeSection = item.codeSection;
      }
      if (!entry.result.scienceSection && item.scienceSection) {
        entry.result.scienceSection = item.scienceSection;
      }
      if (!entry.result.wikiUrls && item.wikiUrls) {
        entry.result.wikiUrls = item.wikiUrls;
      }
      if (!entry.result.mcpUrl && item.mcpUrl) {
        entry.result.mcpUrl = item.mcpUrl;
      }
      if (!entry.result.installCommand && item.installCommand) {
        entry.result.installCommand = item.installCommand;
        entry.result.packageName = item.packageName;
        entry.result.version = item.version;
      }
    } else {
      const lexicalBoost = computeLexicalBoost(item.title, item.snippet, preparedQuery);
      const explicitBonus = item.score ? Math.min(item.score, 5) * 0.15 : 0;
      const recencyBoost = computeRecencyBoost(
        item.publishedDate,
        item.category,
        freshnessSensitive,
        nowMs
      );
      const regionBoost = computeRegionalDomainBoost(item.url, options.regionCode);
      const citationBoost =
        effectiveCategory === 'science' && typeof item.citations === 'number' && item.citations > 0
          ? Math.min(1.6, Math.log10(item.citations + 1) * 0.35)
          : 0;
      const openPdfBoost =
        effectiveCategory === 'science' && item.pdfUrl ? 0.35 : 0;
      const starBoost =
        effectiveCategory === 'code' && typeof item.stars === 'number' && item.stars > 0
          ? Math.min(1.2, Math.log10(item.stars + 1) * 0.22)
          : 0;

      map.set(norm, {
        result: {
          ...item,
          displayedUrl: item.displayedUrl || getDisplayUrl(item.url),
        },
        rrfScore:
          rrfContribution +
          lexicalBoost +
          explicitBonus +
          recencyBoost +
          regionBoost +
          citationBoost +
          openPdfBoost +
          starBoost,
        engineCount: 1,
        engines: [item.engine],
      });
    }
  }

  // Apply gentle domain diversity dampening so one host doesn't flood top results
  const entries = Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  const domainCounts = new Map<string, number>();

  for (const entry of entries) {
    const domain = extractDomain(entry.result.url);
    const seen = domainCounts.get(domain) || 0;
    domainCounts.set(domain, seen + 1);
    if (seen >= 2) {
      entry.rrfScore *= Math.pow(0.82, seen - 1);
    }
    entry.result.score = Number(entry.rrfScore.toFixed(3));
  }

  return entries
    .sort((a, b) => (b.result.score || 0) - (a.result.score || 0))
    .map((e) => e.result);
}

/**
 * Reconstructs readable abstract text from OpenAlex abstract_inverted_index.
 */
export function reconstructOpenAlexAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words: Array<{ pos: number; word: string }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      words.push({ pos, word });
    }
  }
  words.sort((a, b) => a.pos - b.pos);
  return words.map((w) => w.word).join(' ').trim();
}

/**
 * Decodes HTML entities commonly found in web snippets
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/<[^>]*>/g, '');
}

/**
 * Parses Markdown returned by Jina Reader (`r.jina.ai`) into structured ReaderBlock[]
 * and clean paragraph strings, stripping navigation chrome and boilerplate.
 */
export function parseJinaMarkdownToReader(
  markdown: string,
  fallbackUrl: string
): {
  title?: string;
  publishedTime?: string;
  blocks: ReaderBlock[];
  paragraphs: string[];
  heroImage?: string;
} {
  const lines = markdown.split(/\r?\n/);
  let title: string | undefined;
  let publishedTime: string | undefined;
  let heroImage: string | undefined;
  let inContent = false;

  const blocks: ReaderBlock[] = [];
  const paragraphs: string[] = [];
  let currentList: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push({ type: 'ul', text: currentList.join(' • '), items: [...currentList] });
      paragraphs.push(currentList.map((item) => `• ${item}`).join('\n'));
      currentList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inContent) {
      if (line.startsWith('Title:')) {
        title = line.replace(/^Title:\s*/, '').trim();
        continue;
      }
      if (line.startsWith('URL Source:')) {
        continue;
      }
      if (line.startsWith('Published Time:')) {
        publishedTime = line.replace(/^Published Time:\s*/, '').trim();
        continue;
      }
      if (line.startsWith('Markdown Content:')) {
        inContent = true;
        continue;
      }
    }

    if (line.startsWith('```')) {
      flushList();
      if (inCodeBlock) {
        if (codeLines.length > 0) {
          const codeText = codeLines.join('\n');
          blocks.push({ type: 'code', text: codeText });
          paragraphs.push(codeText);
        }
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line) {
      flushList();
      continue;
    }

    // Extract image markdown ![alt](url) including relative GitHub README assets
    const imgMatch = line.match(/^!\[[^\]]*\]\(([^\s)]+)\)/);
    if (imgMatch) {
      let imgUrl = imgMatch[1];
      if (!imgUrl.startsWith('http')) {
        const ghMatch = fallbackUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
        if (ghMatch) {
          const cleanRel = imgUrl.replace(/^\.?\//, '');
          imgUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/HEAD/${cleanRel}`;
        }
      }
      if (
        imgUrl.startsWith('http') &&
        !heroImage &&
        !imgUrl.includes('icon') &&
        !imgUrl.includes('logo') &&
        !imgUrl.includes('avatar') &&
        !imgUrl.includes('shields.io')
      ) {
        heroImage = imgUrl;
      }
      continue;
    }

    // Skip pure link lists/nav crumbs (lines that are just [Link](url) or * [Link](url))
    if (/^(\*|-)?\s*\[[^\]]{1,40}\]\([^)]+\)$/.test(line)) {
      continue;
    }

    // Skip setext underline markers
    if (/^[=\-]{3,}$/.test(line)) {
      continue;
    }

    // Clean inline markdown links [text](url) -> text (including empty badge links [](url)), bold/italic markers, and raw HTML tags
    const cleanText = line
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) continue;

    // Skip common cookie/nav boilerplate
    const lower = cleanText.toLowerCase();
    if (
      lower === 'skip to content' ||
      lower === 'sign in' ||
      lower === 'subscribe' ||
      lower.startsWith('cookie') ||
      lower.includes('all rights reserved') ||
      lower.includes('accept all cookies')
    ) {
      continue;
    }

    if (line.startsWith('# ') && !title) {
      title = cleanText.replace(/^#\s*/, '');
      continue;
    }

    if (line.startsWith('## ') || line.startsWith('# ')) {
      flushList();
      const heading = cleanText.replace(/^#{1,2}\s*/, '');
      if (heading.length > 2 && heading.length < 180) {
        blocks.push({ type: 'h2', text: heading });
        paragraphs.push(heading);
      }
      continue;
    }

    if (line.startsWith('### ') || line.startsWith('#### ')) {
      flushList();
      const heading = cleanText.replace(/^#{3,4}\s*/, '');
      if (heading.length > 2 && heading.length < 180) {
        blocks.push({ type: 'h3', text: heading });
        paragraphs.push(heading);
      }
      continue;
    }

    if (line.startsWith('> ')) {
      flushList();
      const quote = cleanText.replace(/^>\s*/, '');
      if (quote.length > 15) {
        blocks.push({ type: 'quote', text: quote });
        paragraphs.push(quote);
      }
      continue;
    }

    if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const item = cleanText.replace(/^([-*•]|\d+\.)\s+/, '');
      if (item.length > 12) {
        currentList.push(item);
      }
      continue;
    }

    flushList();
    if (cleanText.length > 28) {
      blocks.push({ type: 'p', text: cleanText });
      paragraphs.push(cleanText);
    }
  }

  flushList();

  return {
    title: title || extractDomain(fallbackUrl),
    publishedTime,
    blocks: blocks.slice(0, 60),
    paragraphs: paragraphs.slice(0, 60),
    heroImage,
  };
}

/**
 * Extracts topic clusters from news items for the bottom section in the News Page.
 * Limited to 3 blocks with related news articles per block.
 */
export function extractTopicClusters(
  items: SearchResult[],
  excludeQuery?: string
): Array<{ topic: string; items: SearchResult[] }> {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'as', 'is', 'are', 'was', 'were', 'it', 'its', 'this', 'that', 'after',
    'says', 'new', 'how', 'why', 'what', 'who', 'when', 'where', 'over', 'into',
    'more', 'about', 'will', 'have', 'has', 'had', 'been', 'out', 'up', 'down', 'live',
    'first', 'today', 'news', 'reports', 'state', 'years', 'time', 'week', 'month',
    'could', 'would', 'their', 'they', 'than', 'amid', 'amidst', 'make', 'made',
    'going', 'being', 'using', 'based', 'every', 'under', 'above', 'still', 'should',
    'there', 'which', 'while', 'stock', 'stocks', 'better', 'double', 'months', 'report',
    'firm', 'firms', 'watch', 'video', 'heres', 'whats', 'most', 'some', 'many', 'best',
    'next', 'year', 'here', 'just', 'like', 'know', 'need', 'want', 'back', 'take',
    'look', 'even', 'also', 'only', 'than', 'much', 'very', 'good', 'high', 'long',
    // Portuguese / Iberian news stop words
    'para', 'mais', 'como', 'sobre', 'pelo', 'pela', 'pelos', 'pelas', 'esta', 'este',
    'isto', 'esse', 'essa', 'isso', 'entre', 'apos', 'contra', 'ainda', 'onde', 'pode',
    'fala', 'segundo', 'hoje', 'ontem', 'tudo', 'nada', 'muito', 'cada', 'dois', 'duas',
    'tres', 'anos', 'caso', 'agora', 'antes', 'depois', 'quando', 'porque', 'quem', 'qual',
    'quais', 'vale', 'pais', 'noite', 'oito', 'defende', 'considera', 'afirma', 'reafirma',
    'explica', 'acusa', 'elogia', 'elogio',
  ]);

  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  if (excludeQuery) {
    for (const qWord of fold(excludeQuery).replace(/[^a-z0-9\s]/g, '').split(/\s+/)) {
      if (qWord.length > 2) stopWords.add(qWord);
    }
  }

  const wordCounts = new Map<string, number>();

  for (const item of items) {
    const words = fold(item.title)
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    const uniqueWords = new Set(words);
    for (const w of uniqueWords) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }
  }

  const topTopics = Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic]) => topic);

  const clusters: Array<{ topic: string; items: SearchResult[] }> = [];

  for (const topic of topTopics) {
    if (clusters.length >= 3) break;

    const matched = items.filter((item) =>
      fold(item.title).includes(topic) || fold(item.snippet).includes(topic)
    );
    if (matched.length > 0) {
      const capitalized = topic.charAt(0).toUpperCase() + topic.slice(1);
      clusters.push({ topic: capitalized, items: matched.slice(0, 8) });
    }
  }

  if (clusters.length < 3 && items.length > 3) {
    const fallbackThemes = [
      { name: 'Global Affairs', keywords: ['world', 'state', 'election', 'senate', 'court', 'war', 'policy', 'global', 'summit', 'trade'] },
      { name: 'Technology & AI', keywords: ['ai', 'tech', 'nasa', 'space', 'chip', 'apple', 'google', 'data', 'software', 'brain', 'model'] },
      { name: 'Markets & Economy', keywords: ['wall', 'street', 'market', 'stock', 'bank', 'inflation', 'price', 'trade', 'dollar', 'jobs', 'economy'] },
    ];

    for (const theme of fallbackThemes) {
      if (clusters.length >= 3) break;
      if (clusters.some((c) => c.topic === theme.name)) continue;

      const matched = items.filter((item) =>
        theme.keywords.some((k) => item.title.toLowerCase().includes(k) || item.snippet.toLowerCase().includes(k))
      );
      if (matched.length >= 2) {
        clusters.push({ topic: theme.name, items: matched.slice(0, 8) });
      }
    }
  }

  return clusters.slice(0, 3);
}

/**
 * Maps WMO weather code to readable text condition
 */
export function getWeatherText(code: number): string {
  switch (code) {
    case 0:
      return 'Clear Sky';
    case 1:
      return 'Mainly Clear';
    case 2:
      return 'Partly Cloudy';
    case 3:
      return 'Overcast';
    case 45:
    case 48:
      return 'Fog';
    case 51:
    case 53:
    case 55:
      return 'Drizzle';
    case 61:
    case 63:
    case 65:
      return 'Rain';
    case 71:
    case 73:
    case 75:
      return 'Snow';
    case 77:
      return 'Snow Grains';
    case 80:
    case 81:
    case 82:
      return 'Rain Showers';
    case 85:
    case 86:
      return 'Snow Showers';
    case 95:
      return 'Thunderstorm';
    case 96:
    case 99:
      return 'Thunderstorm with Hail';
    default:
      return 'Cloudy';
  }
}

export const OPEN_WIRE_DOMAINS = [
  'bbc.com',
  'bbc.co.uk',
  'npr.org',
  'apnews.com',
  'pbs.org',
  'theguardian.com',
  'aljazeera.com',
  'dw.com',
  'france24.com',
  'cbc.ca',
  'abc.net.au',
  'euronews.com',
  'propublica.org',
  'theconversation.com',
  'restofworld.org',
  'arstechnica.com',
  'theregister.com',
  'lwn.net',
  'quantamagazine.org',
  'sciencedaily.com',
  'space.com',
  'nasa.gov',
  'esa.int',
  'arxiv.org',
  'wikipedia.org',
  'wikimedia.org',
  'github.com',
  'github.blog',
  'rtp.pt',
  'lusa.pt',
  'noticiasaominuto.com',
  'eco.sapo.pt',
  'portugal.gov.pt',
];

export const SUBSCRIPTION_DOMAINS = [
  'nytimes.com',
  'wsj.com',
  'ft.com',
  'economist.com',
  'washingtonpost.com',
  'bloomberg.com',
  'newyorker.com',
  'theatlantic.com',
  'barrons.com',
  'businessinsider.com',
  'seekingalpha.com',
  'theinformation.com',
  'telegraph.co.uk',
  'thetimes.co.uk',
  'haaretz.com',
  'lemonde.fr',
  'lefigaro.fr',
];

function matchesDomainList(hostname: string, list: string[]): boolean {
  const lower = hostname.toLowerCase().replace(/^www\./, '');
  return list.some((d) => lower === d || lower.endsWith(`.${d}`));
}

/**
 * Classifies whether a URL belongs to a known open-access / free public wire,
 * a subscription-gated publisher, or an unclassified web publisher.
 */
export function classifySourceAccess(url: string): AccessType {
  const domain = extractDomain(url);
  if (!domain) return 'unknown';
  if (matchesDomainList(domain, SUBSCRIPTION_DOMAINS)) return 'subscription';
  if (matchesDomainList(domain, OPEN_WIRE_DOMAINS)) return 'open';
  return 'unknown';
}

/**
 * Filters and annotates news results based on open-access / free-wire mode:
 * - 'all': keeps all direct articles, annotating accessType
 * - 'free': removes known subscription-gated publishers
 * - 'open-wire': keeps exclusively verified free/open-access news & science wires
 */
export function filterNewsByAccess(
  items: SearchResult[],
  mode: NewsAccessFilter
): SearchResult[] {
  const annotated = items.map((item) => ({
    ...item,
    accessType: item.accessType || classifySourceAccess(item.url),
  }));

  if (mode === 'all') return annotated;
  if (mode === 'free') {
    return annotated.filter((item) => item.accessType !== 'subscription');
  }
  return annotated.filter((item) => item.accessType === 'open');
}

/**
 * Checks standard Schema.org JSON-LD metadata in HTML for publisher-declared subscription gating.
 */
export function hasSubscriptionJsonLd(html: string): boolean {
  return /["']isAccessibleForFree["']\s*:\s*(?:false|["']false["'])/i.test(html);
}

/**
 * Cleans Markdown formatting from search snippets returned by Firecrawl, Parallel, Exa, or Keenable.
 */
export function cleanMarkdownSnippet(raw: string, maxLen = 280): string {
  if (!raw) return '';
  const cleaned = decodeHtmlEntities(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3).replace(/\s+\S*$/, '')}...`;
}

/**
 * Parses either plain JSON-RPC HTTP responses or SSE-framed `data: {...}` MCP responses,
 * returning the inner text string from `result.content[0].text` (or null).
 */
export function parseMcpJsonRpcPayload(rawBody: string): string | null {
  if (!rawBody) return null;
  const trimmed = rawBody.trim();

  const extractContentText = (obj: any): string | null => {
    if (obj?.error || obj?.result?.isError === true) return null;
    const content = obj?.result?.content;
    if (Array.isArray(content)) {
      const textItem = content.find((c: any) => c && typeof c.text === 'string');
      if (textItem) return textItem.text;
    }
    return null;
  };

  if (trimmed.startsWith('{')) {
    try {
      return extractContentText(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  // SSE stream framing: collect `data:` lines
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const jsonPart = line.slice(5).trim();
      if (!jsonPart) continue;
      try {
        const text = extractContentText(JSON.parse(jsonPart));
        if (text) return text;
      } catch {
        // continue
      }
    }
  }

  return null;
}

export interface ExaParsedResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  author?: string;
}

/**
 * Parses Exa Hosted MCP (`web_search_exa` or `get_code_context_exa`) formatted text blocks into structured items.
 */
export function parseExaMcpTextResponse(rawText: string): ExaParsedResult[] {
  if (!rawText) return [];
  const blocks = rawText.split(/\n\s*---\s*\n/);
  const results: ExaParsedResult[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    const urlMatch = block.match(/^URL:\s*(https?:\/\/\S+)$/m);
    const pubMatch = block.match(/^Published:\s*(.+)$/m);
    const authorMatch = block.match(/^Author:\s*(.+)$/m);

    const url = urlMatch?.[1]?.trim();
    const rawTitle = titleMatch?.[1]?.trim();
    if (!url) continue;

    const title =
      rawTitle && rawTitle !== 'N/A' && rawTitle !== 'null'
        ? rawTitle
        : getDisplayUrl(url);

    const codeHighlightsIdx = block.indexOf('Code/Highlights:');
    const highlightsIdx = block.indexOf('Highlights:');

    let rawHighlights = '';
    if (codeHighlightsIdx >= 0) {
      rawHighlights = block.slice(codeHighlightsIdx + 'Code/Highlights:'.length).trim();
    } else if (highlightsIdx >= 0) {
      rawHighlights = block.slice(highlightsIdx + 'Highlights:'.length).trim();
    } else {
      rawHighlights = block
        .replace(/^Title:.*$/gm, '')
        .replace(/^URL:.*$/gm, '')
        .replace(/^Published:.*$/gm, '')
        .replace(/^Author:.*$/gm, '')
        .trim();
    }

    const publishedRaw = pubMatch?.[1]?.trim();
    const publishedDate =
      publishedRaw && publishedRaw !== 'N/A' && publishedRaw !== 'null'
        ? publishedRaw.slice(0, 10)
        : undefined;
    const authorRaw = authorMatch?.[1]?.trim();
    const author =
      authorRaw && authorRaw !== 'N/A' && authorRaw !== 'null' ? authorRaw : undefined;

    results.push({
      title: decodeHtmlEntities(title),
      url,
      snippet: cleanMarkdownSnippet(rawHighlights, 280) || title,
      publishedDate,
      author,
    });
  }

  return results;
}

export interface Context7ResolvedLibrary {
  id: string;
  title: string;
  description?: string;
}

export function parseContext7ResolveResponse(rawText: string): Context7ResolvedLibrary | null {
  if (!rawText) return null;
  const idMatch = rawText.match(/Context7-compatible library ID:\s*([^\s\n]+)/i);
  if (!idMatch?.[1]) return null;
  const titleMatch = rawText.match(/-\s*Title:\s*(.+)$/m);
  const descMatch = rawText.match(/-\s*Description:\s*(.+)$/m);
  return {
    id: idMatch[1].trim(),
    title: titleMatch?.[1]?.trim() || idMatch[1].trim(),
    description: descMatch?.[1]?.trim(),
  };
}

export interface Context7DocChunk {
  title: string;
  url: string;
  snippet: string;
}

export function parseContext7DocsResponse(
  rawText: string,
  libraryTitle: string,
  fallbackUrl: string
): Context7DocChunk[] {
  if (!rawText) return [];
  const sections = rawText.split(/\n-{8,}\n/);
  const chunks: Context7DocChunk[] = [];
  const seenUrls = new Set<string>();

  for (const section of sections) {
    const headingMatch = section.match(/^###\s+(.+)$/m);
    const sourceMatch = section.match(/^Source:\s*(https?:\/\/\S+)$/m);
    const url = sourceMatch?.[1]?.trim() || fallbackUrl;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const body = section
      .replace(/^###\s+.*$/gm, '')
      .replace(/^Source:\s*.*$/gm, '')
      .trim();
    const title = headingMatch?.[1]?.trim() || `${libraryTitle} Documentation`;
    const snippet = cleanMarkdownSnippet(body, 280);
    if (!snippet) continue;
    chunks.push({ title, url, snippet });
    if (chunks.length >= 4) break;
  }

  return chunks;
}

export function sanitizeTrustedBaseUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`;
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.endsWith('.local'))
    ) {
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function isDeepWikiErrorText(rawText?: string | null): boolean {
  if (!rawText) return false;
  const trimmed = rawText.trim();
  if (!trimmed) return true;
  return (
    /^error fetching wiki\b/i.test(trimmed) ||
    /\brepository not found\b/i.test(trimmed) ||
    /visit https:\/\/deepwiki\.com\/[^\s]+ to index it/i.test(trimmed)
  );
}

export interface RepoWikiLinkOptions {
  stars?: number;
  deepWikiVerified?: boolean;
  googleCodeWikiVerified?: boolean;
}

export function buildRepoWikiLinks(
  repoSlug: string,
  trustedOpenDeepWikiUrl?: string,
  options?: RepoWikiLinkOptions
): { deepwiki?: string; googleCodeWiki?: string; gitmcp: string; openDeepWiki?: string } {
  const cleanSlug = repoSlug.replace(/^\/+|\/+$/g, '');
  const trustedCustom = sanitizeTrustedBaseUrl(trustedOpenDeepWikiUrl);

  const stars = options?.stars;
  const includeDeepWiki =
    options?.deepWikiVerified !== undefined
      ? options.deepWikiVerified
      : stars !== undefined
      ? stars >= 100
      : true;

  const includeGoogleCodeWiki =
    options?.googleCodeWikiVerified !== undefined
      ? options.googleCodeWikiVerified
      : stars !== undefined
      ? stars >= 250 || (options?.deepWikiVerified === true && stars >= 50)
      : options?.deepWikiVerified !== undefined
      ? options.deepWikiVerified
      : true;

  return {
    ...(includeDeepWiki ? { deepwiki: `https://deepwiki.com/${cleanSlug}` } : {}),
    ...(includeGoogleCodeWiki ? { googleCodeWiki: `https://codewiki.google/github.com/${cleanSlug}` } : {}),
    gitmcp: `https://gitmcp.io/${cleanSlug}`,
    ...(trustedCustom ? { openDeepWiki: `${trustedCustom}/${cleanSlug}` } : {}),
  };
}

export function normalizeConceptKeywords(rawKeywords: unknown, maxCount = 6): string[] {
  if (!Array.isArray(rawKeywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawKeywords) {
    let label = '';
    if (typeof item === 'string') {
      label = item.trim();
    } else if (
      item &&
      typeof item === 'object' &&
      'display_name' in item &&
      typeof (item as { display_name?: unknown }).display_name === 'string'
    ) {
      label = (item as { display_name: string }).display_name.trim();
    }
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= maxCount) break;
  }
  return out;
}

export interface SearchIntentSummary {
  isCode: boolean;
  isScience: boolean;
  repoSlug?: string;
  packageCandidate?: string;
}

export function detectSearchIntent(rawQuery: string): SearchIntentSummary {
  const q = rawQuery.trim();
  const repoMatch = q.match(/\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/);
  const repoSlug = repoMatch && !repoMatch[1].includes('http') ? repoMatch[1] : undefined;

  const isCode =
    Boolean(repoSlug) ||
    /\b(react|next\.?js|nextjs|typescript|javascript|python|rust|golang|cargo|npm|pip|pypi|crate|crates|docker|kubernetes|k8s|mcp|api|sdk|hook|useeffect|middleware|webpack|vite|tailwind|sql|postgres|drizzle|prisma|gitmcp|context7|deepwiki|regex|error|exception|stacktrace|cli|library|framework)\b/i.test(
      q
    );

  const isScience =
    /\b(doi:|arxiv|paper|papers|journal|peer[- ]reviewed|citation|meta[- ]analysis|systematic review|clinical trial|quantum|protein|genome|neural|transformer|theorem|physics|biology|chemistry|neuroscience|astrophysics|biomedical|epidemiology|dataset)\b/i.test(
      q
    );

  const pkgTokenMatch = q.match(/^([@a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)$/);
  const packageCandidate = pkgTokenMatch ? pkgTokenMatch[1] : undefined;

  return { isCode, isScience, repoSlug, packageCandidate };
}

/**
 * Extracts concise Knowledge Box attributes from a Wikidata entity payload (`wbgetentities`).
 */
export function extractWikidataAttributes(
  entity: any
): Array<{ label: string; value: string }> {
  if (!entity || !entity.claims) return [];
  const claims = entity.claims as Record<string, any[]>;
  const attrs: Array<{ label: string; value: string }> = [];

  const getFirstValue = (prop: string): string | null => {
    const arr = claims[prop];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const datavalue = arr[0]?.mainsnak?.datavalue;
    if (!datavalue) return null;
    if (datavalue.type === 'string' && typeof datavalue.value === 'string') {
      return datavalue.value;
    }
    if (datavalue.type === 'time' && datavalue.value?.time) {
      const m = String(datavalue.value.time).match(/^[+-]?(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        return m[2] === '00' ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
    if (datavalue.type === 'quantity' && datavalue.value?.amount) {
      const num = Number(String(datavalue.value.amount).replace(/^\+/, ''));
      if (Number.isFinite(num)) return num.toLocaleString('en-US');
    }
    return null;
  };

  const website = getFirstValue('P856');
  if (website) {
    attrs.push({ label: 'Official Site', value: website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') });
  }

  const inception = getFirstValue('P571');
  if (inception) attrs.push({ label: 'Founded', value: inception });

  const dob = getFirstValue('P569');
  if (dob && !inception) attrs.push({ label: 'Born', value: dob });

  const ticker = getFirstValue('P249');
  if (ticker) attrs.push({ label: 'Ticker', value: ticker });

  const version = getFirstValue('P348');
  if (version) attrs.push({ label: 'Version', value: version });

  const population = getFirstValue('P1082');
  if (population) attrs.push({ label: 'Population', value: population });

  if (entity.id) {
    attrs.push({ label: 'Wikidata ID', value: String(entity.id) });
  }

  return attrs.slice(0, 5);
}

export interface RegionProfile {
  code: Exclude<SearchRegion, 'auto'>;
  label: string;
  country: string;
  countryName: string;
  lang: string;
  ddgKl: string;
  bingCc: string;
  bingLang: string;
  wikiLang: string;
}

const REGION_PROFILES: Record<Exclude<SearchRegion, 'auto'>, RegionProfile> = {
  global: {
    code: 'global',
    label: 'Global',
    country: 'US',
    countryName: 'United States',
    lang: 'en',
    ddgKl: 'wt-wt',
    bingCc: 'US',
    bingLang: 'en-US',
    wikiLang: 'en',
  },
  'pt-PT': {
    code: 'pt-PT',
    label: 'Portugal',
    country: 'PT',
    countryName: 'Portugal',
    lang: 'pt',
    ddgKl: 'pt-pt',
    bingCc: 'PT',
    bingLang: 'pt-PT',
    wikiLang: 'pt',
  },
  'pt-BR': {
    code: 'pt-BR',
    label: 'Brasil',
    country: 'BR',
    countryName: 'Brazil',
    lang: 'pt',
    ddgKl: 'br-pt',
    bingCc: 'BR',
    bingLang: 'pt-BR',
    wikiLang: 'pt',
  },
  'en-US': {
    code: 'en-US',
    label: 'United States',
    country: 'US',
    countryName: 'United States',
    lang: 'en',
    ddgKl: 'us-en',
    bingCc: 'US',
    bingLang: 'en-US',
    wikiLang: 'en',
  },
  'en-GB': {
    code: 'en-GB',
    label: 'United Kingdom',
    country: 'GB',
    countryName: 'United Kingdom',
    lang: 'en',
    ddgKl: 'uk-en',
    bingCc: 'GB',
    bingLang: 'en-GB',
    wikiLang: 'en',
  },
  'es-ES': {
    code: 'es-ES',
    label: 'Spain',
    country: 'ES',
    countryName: 'Spain',
    lang: 'es',
    ddgKl: 'es-es',
    bingCc: 'ES',
    bingLang: 'es-ES',
    wikiLang: 'es',
  },
  'fr-FR': {
    code: 'fr-FR',
    label: 'France',
    country: 'FR',
    countryName: 'France',
    lang: 'fr',
    ddgKl: 'fr-fr',
    bingCc: 'FR',
    bingLang: 'fr-FR',
    wikiLang: 'fr',
  },
  'de-DE': {
    code: 'de-DE',
    label: 'Germany',
    country: 'DE',
    countryName: 'Germany',
    lang: 'de',
    ddgKl: 'de-de',
    bingCc: 'DE',
    bingLang: 'de-DE',
    wikiLang: 'de',
  },
};

export function detectQueryRegionHint(query?: string): Exclude<SearchRegion, 'auto'> | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // Explicit .pt domain or unambiguous Portuguese diacritics (ã, õ)
  if (/\bsite:[^\s]+\.pt\b/i.test(q) || /[ãõ]/i.test(q)) {
    return 'pt-PT';
  }

  // Portuguese entities, cities, public institutions & political figures
  if (
    /\b(portugal|portugu[eê]s|portuguesa|lisboa|lisbon|porto|algarve|coimbra|braga|aveiro|madeira|a[cç]ores|montenegro|marcelo|rebelo de sousa|pedro nuno santos|andré ventura|primeiro[- ]ministro|assembleia da rep[úu]blica|di[áa]rio da rep[úu]blica|observador|sic not[íi]cias|cnn portugal|rtp|benfica|sporting|fc porto|sns24)\b/i.test(
      q
    )
  ) {
    return 'pt-PT';
  }

  // Portuguese character ç combined with Portuguese accents or common Portuguese prepositions
  if (/[ç]/i.test(q) && /\b(da|do|das|dos|em|para|com|não|nao|são|sao|mais)\b/i.test(q)) {
    return 'pt-PT';
  }

  if (/[ñ¿¡]/i.test(q) || /\b(españa|madrid|barcelona)\b/i.test(q)) {
    return 'es-ES';
  }

  return null;
}

export function resolveRegionProfile(
  region: SearchRegion = 'auto',
  query?: string,
  acceptLanguage?: string
): RegionProfile {
  if (region && region !== 'auto' && REGION_PROFILES[region]) {
    return REGION_PROFILES[region];
  }

  const queryHint = detectQueryRegionHint(query);
  if (queryHint && REGION_PROFILES[queryHint]) {
    return REGION_PROFILES[queryHint];
  }

  if (acceptLanguage) {
    const primary = acceptLanguage.split(',')[0]?.split(';')[0]?.trim().toLowerCase() || '';
    if (primary.startsWith('pt-br')) return REGION_PROFILES['pt-BR'];
    if (primary.startsWith('pt')) return REGION_PROFILES['pt-PT'];
    if (primary.startsWith('es')) return REGION_PROFILES['es-ES'];
    if (primary.startsWith('fr')) return REGION_PROFILES['fr-FR'];
    if (primary.startsWith('de')) return REGION_PROFILES['de-DE'];
    if (primary === 'en-gb') return REGION_PROFILES['en-GB'];
  }

  return REGION_PROFILES.global;
}
