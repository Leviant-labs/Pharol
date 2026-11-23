'use client';

import {
  LocalHistoryItem,
  SavedBookmark,
  ColorTheme,
  NewsAccessFilter,
} from './search-types';

const HISTORY_KEY = 'searx_local_history';
const BOOKMARKS_KEY = 'searx_saved_bookmarks';
const THEME_KEY = 'searx_theme_mode';
const COLOR_THEME_KEY = 'searx_color_theme';
const WEATHER_CITY_KEY = 'searx_weather_city';
const USER_PROVIDER_CONFIG_KEY = 'pharol_user_provider_config';

export function getLocalHistory(): LocalHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalHistoryItem(query: string, category: string, resultCount: number): void {
  if (typeof window === 'undefined' || !query.trim()) return;
  try {
    const existing = getLocalHistory();
    // Remove if already exists to bump to front
    const filtered = existing.filter((item) => item.query.toLowerCase() !== query.toLowerCase());
    const newItem: LocalHistoryItem = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      query: query.trim(),
      category: category as any,
      timestamp: Date.now(),
      resultCount,
    };
    const updated = [newItem, ...filtered].slice(0, 50); // keep last 50
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // localStorage full or disabled
  }
}

export function removeLocalHistoryItem(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalHistory();
    const updated = existing.filter((item) => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export function clearAllLocalHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function getSavedBookmarks(): SavedBookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleSaveBookmark(bookmark: Omit<SavedBookmark, 'id' | 'savedAt'>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const existing = getSavedBookmarks();
    const idx = existing.findIndex((b) => b.url === bookmark.url);
    if (idx >= 0) {
      // Remove
      existing.splice(idx, 1);
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(existing));
      return false; // unbookmarked
    } else {
      // Add
      const newItem: SavedBookmark = {
        ...bookmark,
        id: `bm-${Date.now()}`,
        savedAt: Date.now(),
      };
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([newItem, ...existing]));
      return true; // bookmarked
    }
  } catch {
    return false;
  }
}

export function isUrlBookmarked(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const existing = getSavedBookmarks();
    return existing.some((b) => b.url === url);
  } catch {
    return false;
  }
}

export function clearAllLocalData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(BOOKMARKS_KEY);
    localStorage.removeItem('searx_query_cache');
    localStorage.removeItem(USER_PROVIDER_CONFIG_KEY);
  } catch {
    // ignore
  }
}

export function getStoredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const val = localStorage.getItem(THEME_KEY);
    return val === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setStoredTheme(theme: 'dark' | 'light'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch {
    // ignore
  }
}

export function getStoredColorTheme(): ColorTheme {
  if (typeof window === 'undefined') return 'slate';
  try {
    const val = localStorage.getItem(COLOR_THEME_KEY) as ColorTheme;
    if (val === 'blue' || val === 'green') return val;
    return 'slate';
  } catch {
    return 'slate';
  }
}

export function setStoredColorTheme(theme: ColorTheme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COLOR_THEME_KEY, theme);
  } catch {
    // ignore
  }
}

const ENGINES_KEY = 'searx_active_engines';
const ENGINES_VERSION_KEY = 'searx_active_engines_v';
const TIME_RANGE_KEY = 'searx_time_range';

export const KEYLESS_AI_ENGINES = [
  'exa',
  'parallel',
  'tavily',
  'firecrawl',
  'freeserp',
  'keenable',
  'tinyfish',
];

export const KEYLESS_DEV_AND_SCIENCE_ENGINES = [
  'exa-code',
  'context7',
  'deepwiki',
  'gitmcp',
  'mdn',
  'npm',
  'crates',
  'pypi',
  'openalex',
  'europepmc',
  'pubmed',
  'arxiv',
  'crossref',
  'hal',
  'semanticscholar',
  'openaire',
  'datacite',
  'inspire',
];

export const DEFAULT_ACTIVE_ENGINES = [
  'serper',
  'brave',
  'google',
  'duckduckgo',
  'bing',
  'wikipedia',
  'marginalia',
  'github',
  'stackoverflow',
  'hackernews',
  ...KEYLESS_AI_ENGINES,
  ...KEYLESS_DEV_AND_SCIENCE_ENGINES,
];

export function getStoredWeatherCity(): string {
  if (typeof window === 'undefined') return 'London';
  try {
    return localStorage.getItem(WEATHER_CITY_KEY) || 'London';
  } catch {
    return 'London';
  }
}

export function setStoredWeatherCity(city: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WEATHER_CITY_KEY, city);
  } catch {
    // ignore
  }
}

export function getStoredActiveEngines(): string[] {
  if (typeof window === 'undefined') return DEFAULT_ACTIVE_ENGINES;
  try {
    const raw = localStorage.getItem(ENGINES_KEY);
    if (!raw) return DEFAULT_ACTIVE_ENGINES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ACTIVE_ENGINES;

    // Upgrade existing sessions for Google, optional BYOK SERP engines, and keyless dev/science engines
    const ver = localStorage.getItem(ENGINES_VERSION_KEY);
    if (ver !== '5') {
      const merged = Array.from(
        new Set([...parsed, 'serper', 'brave', 'google', ...KEYLESS_AI_ENGINES, ...KEYLESS_DEV_AND_SCIENCE_ENGINES])
      );
      localStorage.setItem(ENGINES_KEY, JSON.stringify(merged));
      localStorage.setItem(ENGINES_VERSION_KEY, '5');
      return merged;
    }

    return parsed;
  } catch {
    return DEFAULT_ACTIVE_ENGINES;
  }
}

export function setStoredActiveEngines(engines: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ENGINES_KEY, JSON.stringify(engines));
    localStorage.setItem(ENGINES_VERSION_KEY, '5');
  } catch {
    // ignore
  }
}

export function getStoredTimeRange(): 'all' | 'day' | 'week' | 'month' | 'year' {
  if (typeof window === 'undefined') return 'all';
  try {
    const val = localStorage.getItem(TIME_RANGE_KEY);
    if (val === 'day' || val === 'week' || val === 'month' || val === 'year') return val;
    return 'all';
  } catch {
    return 'all';
  }
}

export function setStoredTimeRange(range: 'all' | 'day' | 'week' | 'month' | 'year'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TIME_RANGE_KEY, range);
  } catch {
    // ignore
  }
}

const NEWS_ACCESS_KEY = 'searx_news_access_filter';

export function getStoredNewsAccessFilter(): NewsAccessFilter {
  if (typeof window === 'undefined') return 'free';
  try {
    const val = localStorage.getItem(NEWS_ACCESS_KEY);
    if (val === 'all' || val === 'free' || val === 'open-wire') return val;
    return 'free';
  } catch {
    return 'free';
  }
}

export function setStoredNewsAccessFilter(filter: NewsAccessFilter): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NEWS_ACCESS_KEY, filter);
  } catch {
    // ignore
  }
}

const REGION_KEY = 'searx_region';
const VALID_REGIONS = new Set([
  'auto',
  'global',
  'pt-PT',
  'pt-BR',
  'en-US',
  'en-GB',
  'es-ES',
  'fr-FR',
  'de-DE',
]);

export function getStoredRegion(): import('./search-types').SearchRegion {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = localStorage.getItem(REGION_KEY);
    if (val && VALID_REGIONS.has(val)) {
      return val as import('./search-types').SearchRegion;
    }
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function setStoredRegion(region: import('./search-types').SearchRegion): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(REGION_KEY, region);
  } catch {
    // ignore
  }
}

export function purgeLegacyProviderKeys(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(USER_PROVIDER_CONFIG_KEY); } catch { /* storage disabled */ }
}
