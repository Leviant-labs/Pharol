import { SearchResponse } from './search-types';

interface CacheEntry {
  value: SearchResponse;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 100;
const MAX_NEWS_CACHE_ENTRIES = 60;
const searchCache = new Map<string, CacheEntry>();
const newsCache = new Map<string, { value: unknown; expiresAt: number }>();
const engineCooldownUntil = new Map<string, number>();

export function buildSearchCacheKey(params: {
  query: string;
  category: string;
  region: string;
  timeRange: string;
  page: number;
  engines: string;
  providerScope?: string;
  mode?: 'fast' | 'full';
}): string {
  return JSON.stringify([
    params.query.trim().toLowerCase(),
    params.category,
    params.region,
    params.timeRange,
    params.page,
    params.engines,
    params.mode || 'full',
    params.providerScope || '',
  ]);
}

export function getCachedSearchResponse(
  key: string,
  nowMs: number = Date.now()
): SearchResponse | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    searchCache.delete(key);
    return null;
  }
  // Refresh LRU order
  searchCache.delete(key);
  searchCache.set(key, entry);
  return {
    ...entry.value,
    cacheHit: true,
    timeTakenMs: 1,
  };
}

export function setCachedSearchResponse(
  key: string,
  value: SearchResponse,
  ttlMs: number = 180_000,
  nowMs: number = Date.now()
): void {
  if (!value.results || value.results.length === 0) return;
  if (searchCache.has(key)) {
    searchCache.delete(key);
  }
  searchCache.set(key, {
    value: {
      ...value,
      cacheHit: false,
    },
    expiresAt: nowMs + ttlMs,
  });

  if (searchCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey !== undefined) {
      searchCache.delete(oldestKey);
    }
  }
}

export function clearSearchCache(): void {
  searchCache.clear();
  newsCache.clear();
  engineCooldownUntil.clear();
}

export function buildNewsCacheKey(params: {
  query: string;
  topic: string;
  region: string;
  access: string;
  timeRange: string;
  page: number;
  engines: string;
  providerScope?: string;
}): string {
  return JSON.stringify([
    params.query.trim().toLowerCase(),
    params.topic.trim().toUpperCase(),
    params.region,
    params.access,
    params.timeRange,
    params.page,
    params.engines,
    params.providerScope || '',
  ]);
}

export function getCachedNewsResponse<T extends { cacheHit?: boolean; timeTakenMs?: number }>(
  key: string,
  nowMs: number = Date.now()
): T | null {
  const entry = newsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    newsCache.delete(key);
    return null;
  }
  newsCache.delete(key);
  newsCache.set(key, entry);
  return {
    ...(entry.value as T),
    cacheHit: true,
    timeTakenMs: 1,
  };
}

export function setCachedNewsResponse<T extends { cacheHit?: boolean }>(
  key: string,
  value: T,
  ttlMs: number = 120_000,
  nowMs: number = Date.now()
): void {
  if (newsCache.has(key)) newsCache.delete(key);
  newsCache.set(key, {
    value: { ...value, cacheHit: false },
    expiresAt: nowMs + ttlMs,
  });
  if (newsCache.size > MAX_NEWS_CACHE_ENTRIES) {
    const oldestKey = newsCache.keys().next().value;
    if (oldestKey !== undefined) newsCache.delete(oldestKey);
  }
}

export function isEngineCoolingDown(engineId: string, nowMs: number = Date.now()): boolean {
  const id = engineId.toLowerCase();
  const until = engineCooldownUntil.get(id);
  if (!until) return false;
  if (until <= nowMs) {
    engineCooldownUntil.delete(id);
    return false;
  }
  return true;
}

export function recordEngineRateLimit(
  engineId: string,
  cooldownMs: number = 180_000,
  nowMs: number = Date.now()
): void {
  engineCooldownUntil.set(engineId.toLowerCase(), nowMs + cooldownMs);
}

export function recordEngineSuccess(engineId: string): void {
  engineCooldownUntil.delete(engineId.toLowerCase());
}
