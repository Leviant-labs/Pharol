'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from '@/components/Navbar';
import { OpticalVoidBackdrop } from '@/components/OpticalVoidBackdrop';
import { LandingHero } from '@/components/LandingHero';
import { RegularSearchPage } from '@/components/RegularSearchPage';
import { NewsPageView } from '@/components/NewsPageView';
import { ImagesPageView } from '@/components/ImagesPageView';
import { VideosPageView } from '@/components/VideosPageView';
import { CodePageView } from '@/components/CodePageView';
import { AcademiaPageView } from '@/components/AcademiaPageView';
import { PrivacyModal } from '@/components/PrivacyModal';
import { parseSearchSyntax } from '@/lib/search-engine';
import {
  SearchCategory,
  SearchMode,
  SearchResponse,
  SearchResult,
  LocalHistoryItem,
  SavedBookmark,
  ColorTheme,
  UnifiedAnswer,
  AnswerFollowUpTurn,
  TimeRange,
  NewsAccessFilter,
  SearchRegion,
  ProviderKeyStatus,
} from '@/lib/search-types';
import {
  getLocalHistory,
  saveLocalHistoryItem,
  removeLocalHistoryItem,
  clearAllLocalHistory,
  getSavedBookmarks,
  toggleSaveBookmark,
  isUrlBookmarked,
  getStoredTheme,
  setStoredTheme,
  getStoredColorTheme,
  setStoredColorTheme,
  DEFAULT_ACTIVE_ENGINES,
  getStoredActiveEngines,
  setStoredActiveEngines,
  getStoredTimeRange,
  setStoredTimeRange,
  getStoredNewsAccessFilter,
  setStoredNewsAccessFilter,
  getStoredRegion,
  setStoredRegion,
  purgeLegacyProviderKeys,
} from '@/lib/local-storage';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const [searchMode, setSearchMode] = useState<SearchMode>('fast');
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [newsResults, setNewsResults] = useState<SearchResult[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Unified AI Answer state
  const [unifiedAnswer, setUnifiedAnswer] = useState<UnifiedAnswer | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [followUpTurns, setFollowUpTurns] = useState<AnswerFollowUpTurn[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const answerReqRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const searchReqIdRef = useRef(0);
  const activeSearchParamsRef = useRef<URLSearchParams | null>(null);

  // Advanced search options (persisted locally)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [activeEngines, setActiveEngines] = useState<string[]>(DEFAULT_ACTIVE_ENGINES);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [region, setRegion] = useState<SearchRegion>('auto');
  const [newsAccessFilter, setNewsAccessFilter] = useState<NewsAccessFilter>('free');

  // Theme & Appearance
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [colorTheme, setColorTheme] = useState<ColorTheme>('slate');

  // Privacy & Local Storage state
  const [history, setHistory] = useState<LocalHistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<SavedBookmark[]>([]);
  const [providerKeyStatus, setProviderKeyStatus] = useState<ProviderKeyStatus>({});
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState<'privacy' | 'keys' | 'mcp'>('privacy');

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setStoredTheme(next);
  };

  const handleChangeColorTheme = (newColor: ColorTheme) => {
    setColorTheme(newColor);
    setStoredColorTheme(newColor);
  };

  const handleToggleEngine = (eng: string) => {
    setActiveEngines((prev) => {
      const next = prev.includes(eng) ? prev.filter((e) => e !== eng) : [...prev, eng];
      setStoredActiveEngines(next);
      return next;
    });
  };

  const handleProviderKeysUpdated = useCallback((next: ProviderKeyStatus) => {
    setProviderKeyStatus(next);
  }, []);

  const fetchUnifiedAnswer = useCallback(
    async (searchData: SearchResponse, preserveExisting = false) => {
      if (!searchData.query || searchData.results.length === 0) return;
      const reqId = ++answerReqRef.current;
      if (!preserveExisting) {
        setAnswerLoading(true);
        setUnifiedAnswer(null);
      }

      try {
        const res = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchData.query,
            results: searchData.results.slice(0, 8),
            knowledgeBox: searchData.knowledgeBox,
            instantAnswer: searchData.instantAnswer,
          }),
        });
        if (res.ok) {
          const ans: UnifiedAnswer = await res.json();
          if (reqId === answerReqRef.current) setUnifiedAnswer(ans);
        }
      } catch {
        // ignore
      } finally {
        if (reqId === answerReqRef.current) {
          setAnswerLoading(false);
        }
      }
    },
    []
  );

  const executeSearch = useCallback(
    async (
      searchQuery: string,
      searchCategory?: SearchCategory,
      overrideTimeRange?: TimeRange,
      overrideEngines?: string[],
      overrideRegion?: SearchRegion,
      { mode = searchMode, restoreUrl = false }: { mode?: SearchMode; restoreUrl?: boolean } = {}
    ) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;

      // Cancel any previous streaming request
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
      const controller = new AbortController();
      streamAbortRef.current = controller;
      const reqId = ++searchReqIdRef.current;
      ++answerReqRef.current;

      const parsed = parseSearchSyntax(trimmed);
      const effectiveCategory: SearchCategory = parsed.bang
        ? parsed.bang.category
        : searchCategory ?? category;
      const isGeneralSearch = effectiveCategory === 'all' && !parsed.bang;
      const effectiveTimeRange = overrideTimeRange ?? timeRange;
      const effectiveEngines = overrideEngines ?? activeEngines;
      const effectiveRegion = overrideRegion ?? region;
      const browserLang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
      const regionParams = `&region=${encodeURIComponent(effectiveRegion)}&lang=${encodeURIComponent(browserLang)}`;

      setLoading(true);
      setIsSearching(true);
      setActiveQuery(trimmed);
      setCategory(effectiveCategory);
      if (isGeneralSearch) setSearchResponse(null);
      setUnifiedAnswer(null);
      setAnswerLoading(false);
      setFollowUpTurns([]);
      setFollowUpLoading(false);
      setCurrentPage(1);
      setHasMore(false);
      setLoadingMore(false);
      let earlyAnswerTriggered = false;
      let earlyAnswerTopKey = '';

      const url = new URL(window.location.href);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('category', effectiveCategory);
      url.searchParams.set('mode', mode);
      if (url.href !== window.location.href) {
        if (restoreUrl) window.history.replaceState({}, '', url);
        else window.history.pushState({}, '', url);
      }

      const searchParams = new URLSearchParams({
        q: trimmed,
        category: effectiveCategory,
        page: '1',
        timeRange: effectiveTimeRange,
        region: effectiveRegion,
        lang: browserLang,
      });
      if (effectiveCategory === 'all' || effectiveCategory === 'code' || effectiveCategory === 'science') {
        searchParams.set('engines', effectiveEngines.join(','));
      }
      if (isGeneralSearch) searchParams.set('mode', mode);
      activeSearchParamsRef.current = searchParams;

      try {
        if (effectiveCategory === 'news') {
          const newsQuery = parsed.cleanQuery || trimmed;
          const timeParam = effectiveTimeRange !== 'all' ? `&timeRange=${encodeURIComponent(effectiveTimeRange)}` : '';
          const endpoint =
            parsed.bang && !parsed.cleanQuery
              ? `/api/news?topic=TOP${regionParams}${timeParam}`
              : `/api/news?q=${encodeURIComponent(newsQuery)}${regionParams}${timeParam}`;
          const res = await fetch(endpoint, { signal: controller.signal });
          if (res.ok && reqId === searchReqIdRef.current) {
            const data = await res.json();
            const items: SearchResult[] = data.items || [];
            setNewsResults(items);
            saveLocalHistoryItem(trimmed, 'news', items.length);
            setHistory(getLocalHistory());
          }
          if (reqId === searchReqIdRef.current) {
            setLoading(false);
          }
          return;
        }

        const res = await fetch(`/api/search/stream?${searchParams}`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error('Streaming unavailable');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalPayload: SearchResponse | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (reqId !== searchReqIdRef.current) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let eventName = 'message';
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLine += line.slice(5).trim();
              }
            }
            if (!dataLine) continue;

            try {
              const parsedData = JSON.parse(dataLine);
              if (eventName === 'batch' && reqId === searchReqIdRef.current) {
                const batchResp = parsedData as SearchResponse;
                setSearchResponse(batchResp);
                if (batchResp.results.length > 0 || batchResp.instantAnswer) {
                  setLoading(false);
                }
                if (
                  !earlyAnswerTriggered &&
                  (effectiveCategory === 'all' || effectiveCategory === 'science') &&
                  batchResp.results.length >= 6 &&
                  batchResp.enginesUsed.some((e) =>
                    ['wikipedia', 'duckduckgo', 'exa', 'parallel', 'openalex', 'semanticscholar'].includes(e)
                  ) &&
                  !(
                    batchResp.instantAnswer?.kind &&
                    batchResp.instantAnswer.kind !== 'encyclopedia'
                  )
                ) {
                  earlyAnswerTriggered = true;
                  earlyAnswerTopKey = batchResp.results
                    .slice(0, 3)
                    .map((r) => r.url)
                    .join('|');
                  fetchUnifiedAnswer(batchResp, false);
                }
              } else if (eventName === 'done' && reqId === searchReqIdRef.current) {
                finalPayload = parsedData as SearchResponse;
                setSearchResponse(finalPayload);
                setCurrentPage(finalPayload.page || 1);
                setHasMore(Boolean(finalPayload.hasMore));
                setLoading(false);
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }

        if (reqId === searchReqIdRef.current) {
          if (!finalPayload) throw new Error('Search stream ended without a final response');
          setLoading(false);
          saveLocalHistoryItem(trimmed, effectiveCategory, finalPayload.totalResults);
          setHistory(getLocalHistory());
          if (
            (effectiveCategory === 'all' || effectiveCategory === 'science') &&
            finalPayload.results.length > 0 &&
            !(
              finalPayload.instantAnswer?.kind &&
              finalPayload.instantAnswer.kind !== 'encyclopedia'
            )
          ) {
            const finalTopKey = finalPayload.results
              .slice(0, 3)
              .map((r) => r.url)
              .join('|');
            if (!earlyAnswerTriggered) {
              fetchUnifiedAnswer(finalPayload, false);
            } else if (finalTopKey !== earlyAnswerTopKey) {
              fetchUnifiedAnswer(finalPayload, true);
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Fallback to standard JSON search endpoint if streaming fails
        if (reqId === searchReqIdRef.current && effectiveCategory !== 'news') {
          try {
            const fallbackRes = await fetch(`/api/search?${searchParams}`, { signal: controller.signal });
            if (fallbackRes.ok) {
              const data: SearchResponse = await fallbackRes.json();
              if (reqId !== searchReqIdRef.current) return;
              setSearchResponse(data);
              setCurrentPage(data.page || 1);
              setHasMore(Boolean(data.hasMore));
              saveLocalHistoryItem(trimmed, effectiveCategory, data.totalResults);
              setHistory(getLocalHistory());
              if (
                (effectiveCategory === 'all' || effectiveCategory === 'science') &&
                data.results.length > 0
              ) {
                fetchUnifiedAnswer(data);
              }
            }
          } catch {
            // ignore
          } finally {
            if (reqId === searchReqIdRef.current) {
              setLoading(false);
            }
          }
        } else if (reqId === searchReqIdRef.current) {
          setLoading(false);
        }
      }
    },
    [category, timeRange, activeEngines, region, searchMode, fetchUnifiedAnswer]
  );

  const isGeneralSearch = category === 'all' && !parseSearchSyntax(activeQuery).bang;

  const handleChangeSearchMode = (mode: SearchMode) => {
    if (!isGeneralSearch || !activeQuery || mode === searchMode) return;
    setSearchMode(mode);
    executeSearch(activeQuery, 'all', undefined, undefined, undefined, { mode });
  };

  const handleLoadMore = useCallback(async () => {
    if (!activeSearchParamsRef.current || loadingMore || !hasMore) return;
    const nextPage = currentPage + 1;
    const reqId = searchReqIdRef.current;
    const signal = streamAbortRef.current?.signal;
    const searchParams = new URLSearchParams(activeSearchParamsRef.current);
    searchParams.set('page', String(nextPage));
    setLoadingMore(true);

    try {
      const res = await fetch(`/api/search?${searchParams}`, { cache: 'no-store', signal });
      if (res.ok) {
        const data: SearchResponse = await res.json();
        if (reqId !== searchReqIdRef.current) return;
        setSearchResponse((prev) => {
          if (!prev) return data;
          const seen = new Set(
            prev.results.map((r) => r.url.replace(/\/$/, '').toLowerCase())
          );
          const appended = data.results.filter(
            (r) => !seen.has(r.url.replace(/\/$/, '').toLowerCase())
          );
          const mergedResults = [...prev.results, ...appended];
          const mergedEngines = Array.from(
            new Set([...prev.enginesUsed, ...data.enginesUsed])
          );
          return {
            ...prev,
            results: mergedResults,
            totalResults: mergedResults.length,
            enginesUsed: mergedEngines,
            page: nextPage,
            hasMore: Boolean(data.hasMore) && appended.length > 0,
            engineHealth: data.engineHealth || prev.engineHealth,
          };
        });
        setCurrentPage(nextPage);
        setHasMore(Boolean(data.hasMore) && data.results.length > 0);
      }
    } catch {
      // ignore
    } finally {
      if (reqId === searchReqIdRef.current) setLoadingMore(false);
    }
  }, [currentPage, hasMore, loadingMore]);

  const handleChangeTimeRange = (newRange: TimeRange) => {
    setTimeRange(newRange);
    setStoredTimeRange(newRange);
    const targetQ = query.trim() || activeQuery;
    if (isSearching && targetQ && category !== 'news') {
      executeSearch(targetQ, category, newRange, activeEngines, region);
    }
  };

  const handleChangeRegion = (newRegion: SearchRegion) => {
    setRegion(newRegion);
    setStoredRegion(newRegion);
    const targetQ = query.trim() || activeQuery;
    if (isSearching) {
      if (category === 'news' && !targetQ) {
        const browserLang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
        setLoading(true);
        fetch(`/api/news?topic=TOP&region=${encodeURIComponent(newRegion)}&lang=${encodeURIComponent(browserLang)}`)
          .then((res) => res.json())
          .then((data) => {
            setNewsResults(data.items || []);
          })
          .finally(() => setLoading(false));
      } else if (targetQ) {
        executeSearch(targetQ, category, timeRange, activeEngines, newRegion);
      }
    }
  };

  const executeSearchRef = useRef(executeSearch);
  useEffect(() => {
    executeSearchRef.current = executeSearch;
  }, [executeSearch]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const savedTheme = getStoredTheme();
      setTheme(savedTheme);
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      setColorTheme(getStoredColorTheme());
      setHistory(getLocalHistory());
      setBookmarks(getSavedBookmarks());

      const storedEngines = getStoredActiveEngines();
      const storedRange = getStoredTimeRange();
      const storedRegion = getStoredRegion();
      const storedNewsAccess = getStoredNewsAccessFilter();
      setActiveEngines(storedEngines);
      setTimeRange(storedRange);
      setRegion(storedRegion);
      setNewsAccessFilter(storedNewsAccess);
      purgeLegacyProviderKeys();
      fetch('/api/providers', { cache: 'no-store' }).then((r) => r.json()).then((data) => setProviderKeyStatus(data.configured || {})).catch(() => {});

      const params = new URLSearchParams(window.location.search);
      const urlQ = params.get('q');
      const urlCat = params.get('category') as SearchCategory;
      const mode = params.get('mode') === 'full' ? 'full' : 'fast';
      setSearchMode(mode);

      if (urlQ) {
        setQuery(urlQ);
        executeSearchRef.current(urlQ, urlCat || 'all', storedRange, storedEngines, storedRegion, {
          mode,
          restoreUrl: true,
        });
      }
    });

    const onPopState = () => {
      const p = new URLSearchParams(window.location.search);
      const qVal = p.get('q');
      const catVal = (p.get('category') as SearchCategory) || 'all';
      const mode = p.get('mode') === 'full' ? 'full' : 'fast';
      setSearchMode(mode);
      if (qVal) {
        setQuery(qVal);
        executeSearchRef.current(qVal, catVal, undefined, undefined, undefined, {
          mode,
          restoreUrl: true,
        });
      } else {
        streamAbortRef.current?.abort();
        ++searchReqIdRef.current;
        ++answerReqRef.current;
        setCategory(catVal);
        setIsSearching(false);
        setSearchResponse(null);
        setQuery('');
        setActiveQuery('');
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPopState);
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, []);

  const handleSelectCategory = (newCat: SearchCategory) => {
    setCategory(newCat);
    if (activeQuery) {
      // Strip any active !bang so switching tabs manually is never overridden
      const stripped = activeQuery
        .replace(/(?:^|\s)![a-zA-Z0-9]+(?=\s|$)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const nextQ = stripped || activeQuery;
      setQuery(nextQ);
      executeSearch(nextQ, newCat);
    } else if (newCat === 'news') {
      const browserLang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
      setIsSearching(true);
      setLoading(true);
      fetch(`/api/news?topic=TOP&region=${encodeURIComponent(region)}&lang=${encodeURIComponent(browserLang)}`)
        .then((res) => res.json())
        .then((data) => {
          setNewsResults(data.items || []);
        })
        .finally(() => setLoading(false));
    }
  };

  const handleGoHome = () => {
    streamAbortRef.current?.abort();
    ++searchReqIdRef.current;
    ++answerReqRef.current;
    setIsSearching(false);
    setSearchResponse(null);
    setNewsResults([]);
    setUnifiedAnswer(null);
    setFollowUpTurns([]);
    setFollowUpLoading(false);
    setCurrentPage(1);
    setHasMore(false);
    setQuery('');
    setActiveQuery('');
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('category');
    window.history.pushState({}, '', url.toString());
  };

  const handleBookmarkToggle = (result: SearchResult) => {
    toggleSaveBookmark({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      category: result.category,
    });
    setBookmarks(getSavedBookmarks());
  };

  const refreshLocalData = () => {
    setHistory(getLocalHistory());
    setBookmarks(getSavedBookmarks());
    setProviderKeyStatus({});
  };

  const getColorThemeContainerClass = () => {
    if (colorTheme === 'blue') {
      return 'selection:bg-sky-500/20 selection:text-sky-900 dark:selection:text-sky-200';
    }
    if (colorTheme === 'green') {
      return 'selection:bg-emerald-500/20 selection:text-emerald-900 dark:selection:text-emerald-200';
    }
    return 'selection:bg-neutral-500/20 selection:text-neutral-900 dark:selection:text-neutral-100';
  };

  const renderSearchResults = () => {
    const results = searchResponse?.results || [];

    if (category === 'images') {
      return (
        <ImagesPageView
          images={results}
          loading={loading}
          query={query}
          onUpdateQuery={setQuery}
          onSearch={(q) => executeSearch(q, 'images')}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
        />
      );
    }

    if (category === 'videos') {
      return (
        <VideosPageView
          videos={results}
          loading={loading}
          query={query}
          onUpdateQuery={setQuery}
          onSearch={(q) => executeSearch(q, 'videos')}
        />
      );
    }

    if (category === 'code') {
      return (
        <CodePageView
          results={results}
          sectionHint={searchResponse?.parsedQuery?.bang?.sectionHint}
          loading={loading}
          query={query}
          onUpdateQuery={setQuery}
          onSearch={(q) => executeSearch(q, 'code')}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
          isBookmarked={(url) => isUrlBookmarked(url)}
          onToggleBookmark={handleBookmarkToggle}
        />
      );
    }

    if (category === 'science') {
      return (
        <AcademiaPageView
          results={results}
          conceptOverview={searchResponse?.conceptOverview}
          sectionHint={searchResponse?.parsedQuery?.bang?.sectionHint}
          loading={loading}
          unifiedAnswer={unifiedAnswer}
          answerLoading={answerLoading}
          onRegenerateAnswer={() => searchResponse && fetchUnifiedAnswer(searchResponse)}
          query={query}
          onUpdateQuery={setQuery}
          onSearch={(q) => executeSearch(q, 'science')}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
          isBookmarked={(url) => isUrlBookmarked(url)}
          onToggleBookmark={handleBookmarkToggle}
        />
      );
    }

    if (category === 'news') {
      return (
        <NewsPageView
          newsItems={newsResults}
          loading={loading}
          query={query}
          onUpdateQuery={setQuery}
          onSearch={(q) => executeSearch(q, 'news')}
          onSelectTopic={(topic) => {
            setQuery(topic);
            executeSearch(topic, 'news');
          }}
          accessFilter={newsAccessFilter}
          onChangeAccessFilter={(next) => {
            setNewsAccessFilter(next);
            setStoredNewsAccessFilter(next);
          }}
          isBookmarked={(url) => isUrlBookmarked(url)}
          onToggleBookmark={handleBookmarkToggle}
        />
      );
    }

  const handleAskFollowUp = async (question: string) => {
    if (!searchResponse || !question.trim()) return;
    const reqId = searchReqIdRef.current;
    setFollowUpLoading(true);
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchResponse.query,
          results: searchResponse.results.slice(0, 8),
          knowledgeBox: searchResponse.knowledgeBox,
          instantAnswer: searchResponse.instantAnswer,
          followUpQuestion: question,
          followUpHistory: followUpTurns,
        }),
      });
      if (res.ok) {
        const turn: AnswerFollowUpTurn = await res.json();
        if (reqId === searchReqIdRef.current) setFollowUpTurns((prev) => [...prev, turn]);
      }
    } catch {
      // ignore
    } finally {
      if (reqId === searchReqIdRef.current) setFollowUpLoading(false);
    }
  };

    return (
      <RegularSearchPage
        searchResponse={searchResponse}
        loading={loading}
        unifiedAnswer={unifiedAnswer}
        answerLoading={answerLoading}
        onRegenerateAnswer={() => {
          setFollowUpTurns([]);
          if (searchResponse) fetchUnifiedAnswer(searchResponse);
        }}
        followUpTurns={followUpTurns}
        followUpLoading={followUpLoading}
        onAskFollowUp={handleAskFollowUp}
        onSearchOpenCoverage={(headline) => executeSearch(headline, 'news')}
        onSelectCategory={handleSelectCategory}
        query={query}
        onUpdateQuery={setQuery}
        onSearch={(q) => executeSearch(q, 'all')}
        searchMode={searchMode}
        onChangeSearchMode={isGeneralSearch ? handleChangeSearchMode : undefined}
        isAdvancedOpen={isAdvancedOpen}
        onToggleAdvanced={() => setIsAdvancedOpen(!isAdvancedOpen)}
        onCloseAdvanced={() => setIsAdvancedOpen(false)}
        activeEngines={activeEngines}
        onToggleEngine={handleToggleEngine}
        timeRange={timeRange}
        onChangeTimeRange={handleChangeTimeRange}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        isBookmarked={(url) => isUrlBookmarked(url)}
        onToggleBookmark={handleBookmarkToggle}
      />
    );
  };

  return (
    <div
      data-tone={colorTheme}
      className={`relative min-h-screen flex flex-col transition-colors duration-150 ${getColorThemeContainerClass()}`}
    >
      <OpticalVoidBackdrop active={loading || answerLoading || followUpLoading} />

      <div className="relative z-10 flex min-h-screen flex-col">
        <Navbar
          currentCategory={category}
          onSelectCategory={handleSelectCategory}
          region={region}
          onChangeRegion={handleChangeRegion}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenPrivacyModal={() => {
            setModalInitialTab('privacy');
            setIsPrivacyModalOpen(true);
          }}
          onGoHome={handleGoHome}
          isSearchActive={isSearching}
        />

        <div className="flex-1">
          {!isSearching ? (
            <LandingHero
              query={query}
              onUpdateQuery={setQuery}
              onSearch={(q, cat) => {
                if (cat) setCategory(cat);
                executeSearch(q, cat || category);
              }}
              category={category}
              region={region}
              onSelectCategory={handleSelectCategory}
              history={history}
              bookmarks={bookmarks}
              onRemoveHistory={(id) => {
                removeLocalHistoryItem(id);
                setHistory(getLocalHistory());
              }}
              onClearHistory={() => {
                clearAllLocalHistory();
                setHistory([]);
              }}
              isBookmarked={(url) => isUrlBookmarked(url)}
              onToggleBookmark={handleBookmarkToggle}
            />
          ) : (
            renderSearchResults()
          )}
        </div>

        <PrivacyModal
          isOpen={isPrivacyModalOpen}
          onClose={() => setIsPrivacyModalOpen(false)}
          initialTab={modalInitialTab}
          historyCount={history.length}
          bookmarksCount={bookmarks.length}
          onDataCleared={refreshLocalData}
          colorTheme={colorTheme}
          onChangeColorTheme={handleChangeColorTheme}
          providerKeyStatus={providerKeyStatus}
          onProviderKeysUpdated={handleProviderKeysUpdated}
        />

        <footer className="mt-auto py-7 text-xs text-neutral-500 dark:text-[#6c7a89]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-800 dark:text-[#9aa7b4]">Pharol</span>
              <span aria-hidden="true">·</span>
              <span>Private Metasearch</span>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span>Local-only history</span>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => {
                  setModalInitialTab('mcp');
                  setIsPrivacyModalOpen(true);
                }}
                className="hover:text-neutral-900 dark:hover:text-[#f0f4f8] transition-colors"
              >
                MCP &amp; Browser Search
              </button>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => {
                  setModalInitialTab('privacy');
                  setIsPrivacyModalOpen(true);
                }}
                className="hover:text-neutral-900 dark:hover:text-[#f0f4f8] transition-colors"
              >
                Privacy &amp; Preferences
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
