export type SearchCategory = 'all' | 'images' | 'videos' | 'news' | 'code' | 'science';

export type SearchMode = 'fast' | 'full';

export function parseSearchMode(value: unknown): SearchMode | undefined {
  return value === 'fast' || value === 'full' ? value : undefined;
}

export type CodeSection = 'all' | 'docs' | 'wikis' | 'repos' | 'packages' | 'qa';
export type ScienceSection = 'all' | 'papers' | 'preprints' | 'datasets';

export type TimeRange = 'all' | 'day' | 'week' | 'month' | 'year';

export type SearchRegion =
  | 'auto'
  | 'global'
  | 'pt-PT'
  | 'pt-BR'
  | 'en-US'
  | 'en-GB'
  | 'es-ES'
  | 'fr-FR'
  | 'de-DE';

export type AccessType = 'open' | 'subscription' | 'unknown';

export type NewsAccessFilter = 'all' | 'free' | 'open-wire';

export interface UserProviderConfig {
  context7ApiKey?: string;
  semanticScholarApiKey?: string;
  coreApiKey?: string;
  openAlexApiKey?: string;
  githubToken?: string;
  exaApiKey?: string;
  firecrawlApiKey?: string;
  tavilyApiKey?: string;
  parallelApiKey?: string;
  keenableApiKey?: string;
  tinyfishApiKey?: string;
  serperApiKey?: string;
  braveApiKey?: string;
  openDeepWikiUrl?: string;
}

export type ProviderKeyStatus = Partial<Record<keyof UserProviderConfig, boolean>>;

export interface BangDefinition {
  bang: string;
  label: string;
  category: SearchCategory;
  engines?: string[];
  sectionHint?: string;
  description: string;
}

export interface EngineHealth {
  engine: string;
  label: string;
  status: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled' | 'cooldown';
  count: number;
  durationMs: number;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  displayedUrl: string;
  snippet: string;
  engine: string;
  category: SearchCategory;
  publishedDate?: string;
  thumbnail?: string;
  score?: number;
  rankPosition?: number;
  author?: string;
  authors?: string[];
  tags?: string[];
  accessType?: AccessType;
  // Vertical section routing
  codeSection?: Exclude<CodeSection, 'all'>;
  scienceSection?: Exclude<ScienceSection, 'all'>;
  // Rich media & category specific metadata
  imageWidth?: number;
  imageHeight?: number;
  duration?: string;
  views?: string;
  embedUrl?: string;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string;
  packageName?: string;
  version?: string;
  installCommand?: string;
  mcpUrl?: string;
  wikiUrls?: {
    deepwiki?: string;
    googleCodeWiki?: string;
    openDeepWiki?: string;
  };
  doi?: string;
  journal?: string;
  citations?: number;
  pdfUrl?: string;
  tldr?: string;
}

export interface KnowledgeBox {
  title: string;
  subtitle?: string;
  extract: string;
  url: string;
  thumbnail?: string;
  images?: string[];
  source: string;
  attributes?: Array<{ label: string; value: string }>;
}

export interface ConceptOverview {
  title: string;
  subtitle?: string;
  summary: string;
  url: string;
  source: string;
  taxonomy?: string[];
  relatedConcepts?: string[];
  worksCount?: number;
  attributes?: Array<{ label: string; value: string }>;
  secondaryReference?: {
    title: string;
    source: string;
    url: string;
    snippet?: string;
  };
}

export interface IntentSectionStrip {
  id: string;
  title: string;
  subtitle: string;
  category: SearchCategory;
  items: SearchResult[];
}

export interface InstantAnswer {
  source: string;
  heading?: string;
  text: string;
  url?: string;
  kind?: 'calculator' | 'converter' | 'timezone' | 'developer' | 'color' | 'encyclopedia';
  detail?: string;
}

export interface AnswerCitation {
  index: number;
  title: string;
  url: string;
  domain: string;
  engine?: string;
}

export interface AnswerFollowUpTurn {
  question: string;
  answer: string;
  citations?: AnswerCitation[];
  provider?: 'gemini-grounded' | 'instant-synthesis';
}

export interface UnifiedAnswer {
  summary: string;
  keyPoints: string[];
  citations: AnswerCitation[];
  provider: 'gemini-grounded' | 'instant-synthesis';
  query: string;
}

export interface ParsedQuery {
  raw: string;
  cleanQuery: string;
  site?: string;
  filetype?: string;
  exactPhrases: string[];
  excludedTerms: string[];
  timeRange?: TimeRange;
  inTitle?: string;
  bang?: BangDefinition;
  regionOverride?: SearchRegion;
}

export interface SearchResponse {
  query: string;
  parsedQuery: ParsedQuery;
  category: SearchCategory;
  results: SearchResult[];
  totalResults: number;
  timeTakenMs: number;
  knowledgeBox?: KnowledgeBox | null;
  conceptOverview?: ConceptOverview | null;
  intentSections?: IntentSectionStrip[];
  instantAnswer?: InstantAnswer | null;
  newsHighlights?: SearchResult[];
  relatedTopics?: string[];
  enginesUsed: string[];
  page?: number;
  hasMore?: boolean;
  cacheHit?: boolean;
  engineHealth?: EngineHealth[];
}

export interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  weatherText: string;
  daily: Array<{
    date: string;
    weatherCode: number;
    weatherText: string;
    tempMax: number;
    tempMin: number;
  }>;
}

export interface LocalHistoryItem {
  id: string;
  query: string;
  category: SearchCategory;
  timestamp: number;
  resultCount: number;
}

export interface SavedBookmark {
  id: string;
  title: string;
  url: string;
  snippet: string;
  savedAt: number;
  category: string;
}

export type ColorTheme = 'slate' | 'blue' | 'green';

export interface ReaderBlock {
  type: 'h2' | 'h3' | 'p' | 'quote' | 'code' | 'ul';
  text: string;
  items?: string[];
}

export interface ReaderContent {
  url: string;
  resolvedUrl?: string;
  title: string;
  byline?: string;
  publishedTime?: string;
  siteName?: string;
  heroImage?: string;
  excerpt?: string;
  paragraphs: string[];
  blocks?: ReaderBlock[];
  readingTimeMinutes: number;
  type: 'article' | 'video' | 'image' | 'pdf';
  embedUrl?: string;
  pdfUrl?: string;
  extractor?: 'direct' | 'wikipedia' | 'arxiv' | 'github' | 'deepwiki' | 'jina-reader' | 'firecrawl' | 'keenable' | 'fallback';
  accessType?: AccessType;
  accessBlocked?: boolean;
  isFallback?: boolean;
  fallbackNotice?: string;
}
