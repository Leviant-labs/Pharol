'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  Bookmark,
  Share2,
  ExternalLink,
  BookOpen,
  Newspaper,
  Check,
  ChevronDown,
  Calculator,
  ArrowLeftRight,
  Clock,
  Palette,
  Terminal,
  Copy,
  Code2,
  FlaskConical,
  ArrowRight,
} from 'lucide-react';
import {
  AnswerFollowUpTurn,
  SearchCategory,
  SearchResponse,
  SearchResult,
  TimeRange,
  UnifiedAnswer,
} from '@/lib/search-types';
import { AdvancedSearchPanel } from './AdvancedSearchPanel';
import { ReaderModeModal } from './ReaderModeModal';
import { UnifiedAnswerBox } from './UnifiedAnswerBox';

interface RegularSearchPageProps {
  searchResponse: SearchResponse | null;
  loading: boolean;
  unifiedAnswer: UnifiedAnswer | null;
  answerLoading: boolean;
  onRegenerateAnswer: () => void;
  followUpTurns?: AnswerFollowUpTurn[];
  followUpLoading?: boolean;
  onAskFollowUp?: (question: string) => void;
  onSearchOpenCoverage?: (headline: string) => void;
  onSelectCategory?: (category: SearchCategory) => void;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
  isAdvancedOpen: boolean;
  onToggleAdvanced: () => void;
  onCloseAdvanced: () => void;
  activeEngines: string[];
  onToggleEngine: (eng: string) => void;
  timeRange: TimeRange;
  onChangeTimeRange: (range: TimeRange) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
}

export function RegularSearchPage({
  searchResponse,
  loading,
  unifiedAnswer,
  answerLoading,
  onRegenerateAnswer,
  followUpTurns = [],
  followUpLoading = false,
  onAskFollowUp,
  onSearchOpenCoverage,
  onSelectCategory,
  query,
  onUpdateQuery,
  onSearch,
  isAdvancedOpen,
  onToggleAdvanced,
  onCloseAdvanced,
  activeEngines,
  onToggleEngine,
  timeRange,
  onChangeTimeRange,
  hasMore,
  loadingMore,
  onLoadMore,
  isBookmarked,
  onToggleBookmark,
}: RegularSearchPageProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedUrl, setHighlightedUrl] = useState<string | null>(null);
  const [activeReaderResult, setActiveReaderResult] = useState<SearchResult | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [selectedKbImage, setSelectedKbImage] = useState<{ url: string; forTitle: string } | null>(null);
  const [kbExpanded, setKbExpanded] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleCiteClick = (url: string) => {
    setHighlightedUrl(url);
    const el = document.querySelector(`[data-result-url="${CSS.escape(url)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => setHighlightedUrl(null), 2400);
  };

  const results = useMemo(() => searchResponse?.results || [], [searchResponse]);
  const knowledge = searchResponse?.knowledgeBox;
  const news = searchResponse?.newsHighlights || [];

  // Keyboard-first navigation: j/k to move, r for Reader Preview, Enter to open, / to focus search, Esc to clear
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (activeReaderResult) return;

      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (isTyping) return;

      if (e.key === 'Escape') {
        setFocusedIndex(-1);
        return;
      }

      if (results.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < results.length - 1 ? prev + 1 : 0;
          const el = document.querySelector(`[data-result-index="${next}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : results.length - 1;
          const el = document.querySelector(`[data-result-index="${next}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'r' && focusedIndex >= 0 && results[focusedIndex]) {
        e.preventDefault();
        setActiveReaderResult(results[focusedIndex]);
      } else if (
        e.key === 'Enter' &&
        focusedIndex >= 0 &&
        results[focusedIndex] &&
        target?.tagName !== 'BUTTON' &&
        target?.tagName !== 'A'
      ) {
        const link = document.querySelector<HTMLAnchorElement>(
          `[data-result-index="${focusedIndex}"] a[data-result-link]`
        );
        if (link) {
          e.preventDefault();
          link.click();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [results, focusedIndex, activeReaderResult]);

  const isLogoLikeImage = (src: string) =>
    /\.svg(?:\.png)?(?:$|\?)|logo|emblem|coat_of_arms|flag_of|wordmark|icon/i.test(src);

  const kbImagesList = useMemo(() => {
    if (!knowledge) return [];
    const list = [
      ...(knowledge.thumbnail ? [knowledge.thumbnail] : []),
      ...(knowledge.images || []),
    ];
    const unique: string[] = [];
    const seenKeys = new Set<string>();
    const canonicalImgKey = (src: string) => {
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
    for (const img of list) {
      if (!img || failedImages[img]) continue;
      const key = canonicalImgKey(img);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        unique.push(img);
      }
    }
    return unique.slice(0, 4);
  }, [knowledge, failedImages]);

  const activeKbImage =
    selectedKbImage &&
    knowledge &&
    selectedKbImage.forTitle === knowledge.title &&
    !failedImages[selectedKbImage.url]
      ? selectedKbImage.url
      : kbImagesList[0];

  const isKbExtractExpanded = Boolean(knowledge && kbExpanded === knowledge.title);

  const timeRangeLabels: Record<TimeRange, string> = {
    all: '',
    day: 'Past 24h',
    week: 'Past week',
    month: 'Past month',
    year: 'Past year',
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Search Bar Header */}
      <div className="mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(query);
          }}
          className="flex items-center gap-2 max-w-4xl"
        >
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400">
              <Search className="h-4 w-4" />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => onUpdateQuery(e.target.value)}
              placeholder="Search, use operators (site:, filetype:), or !bangs (!gh, !docs, !deepwiki, !pkg, !arxiv, !dataset)..."
              aria-label="Search query"
              className="w-full rounded-full pharol-glass-inset py-2.5 pl-10 pr-14 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-neutral-100 dark:placeholder:text-neutral-400 dark:focus:border-white/40 dark:focus:ring-sky-400/20 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => onUpdateQuery('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Clear
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleAdvanced}
            aria-expanded={isAdvancedOpen}
            aria-label="Toggle advanced search options"
            className={`flex items-center gap-1.5 rounded-full pharol-glass-chip px-4 py-2.5 text-xs font-medium shrink-0 whitespace-nowrap ${
              isAdvancedOpen
                ? 'ring-1 ring-neutral-900/35 text-neutral-950 dark:ring-white/50 dark:text-white'
                : 'text-neutral-700 dark:text-neutral-100'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
          </button>

          <button
            type="submit"
            className="rounded-full pharol-liquid-btn px-5 py-2.5 text-xs font-medium shrink-0 whitespace-nowrap"
          >
            Search
          </button>
        </form>

        {searchResponse && (
          <div className="flex items-center justify-between gap-4 text-xs text-neutral-500 dark:text-neutral-400 mt-2.5 px-0.5 max-w-4xl">
            <div className="flex items-center gap-2 min-w-0">
              <span className="tabular-nums font-mono text-[11px] shrink-0">
                {searchResponse.totalResults} results ·{' '}
                {searchResponse.cacheHit ? `cached · ${searchResponse.timeTakenMs} ms` : `${searchResponse.timeTakenMs} ms`}
              </span>
              {timeRange !== 'all' && (
                <>
                  <span aria-hidden="true" className="shrink-0">·</span>
                  <span className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200 shrink-0">
                    {timeRangeLabels[timeRange]}
                  </span>
                </>
              )}
              {searchResponse.enginesUsed.length > 0 && (
                <>
                  <span aria-hidden="true" className="shrink-0 hidden sm:inline">·</span>
                  <span className="truncate text-[11px] hidden sm:inline">
                    {searchResponse.enginesUsed.join(', ')}
                  </span>
                </>
              )}
            </div>
            <span className="hidden md:inline shrink-0 font-mono text-[11px] text-neutral-400">
              j/k navigate · r preview · / search
            </span>
          </div>
        )}
      </div>

      <AdvancedSearchPanel
        isOpen={isAdvancedOpen}
        onClose={onCloseAdvanced}
        query={query}
        onUpdateQuery={onUpdateQuery}
        onApplyAndSearch={() => onSearch(query)}
        activeEngines={activeEngines}
        onToggleEngine={onToggleEngine}
        timeRange={timeRange}
        onChangeTimeRange={onChangeTimeRange}
        engineHealth={searchResponse?.engineHealth}
      />

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <main className="lg:col-span-8" aria-label="Search Results">
          {/* Zero-Hop Deterministic Utility Card (Calculator / Converter / Clock / Color / Dev) */}
          {searchResponse?.instantAnswer?.kind &&
            searchResponse.instantAnswer.kind !== 'encyclopedia' && (
              <section
                aria-label={searchResponse.instantAnswer.source}
                className="relative mb-6 rounded-3xl pharol-liquid-glass pharol-liquid-iridescent px-5 py-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="mt-0.5 rounded-xl pharol-glass-chip p-2 text-neutral-700 dark:text-neutral-200 shrink-0">
                    {searchResponse.instantAnswer.kind === 'calculator' ? (
                      <Calculator className="h-4 w-4" />
                    ) : searchResponse.instantAnswer.kind === 'converter' ? (
                      <ArrowLeftRight className="h-4 w-4" />
                    ) : searchResponse.instantAnswer.kind === 'timezone' ? (
                      <Clock className="h-4 w-4" />
                    ) : searchResponse.instantAnswer.kind === 'color' ? (
                      <Palette className="h-4 w-4" />
                    ) : (
                      <Terminal className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      {searchResponse.instantAnswer.source}
                      {searchResponse.instantAnswer.heading
                        ? ` · ${searchResponse.instantAnswer.heading}`
                        : ''}
                    </div>
                    <div className="mt-0.5 text-xl font-bold tracking-tight text-neutral-950 dark:text-white font-mono break-all">
                      {searchResponse.instantAnswer.text}
                    </div>
                    {searchResponse.instantAnswer.detail && (
                      <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {searchResponse.instantAnswer.detail}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyLink(searchResponse.instantAnswer!.text, 'instant-util')}
                  className="inline-flex items-center gap-1.5 rounded-xl pharol-glass-chip px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 shrink-0"
                  aria-label="Copy utility result"
                >
                  {copiedId === 'instant-util' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </section>
            )}

          {/* Unified AI Answer Box */}
          {!loading && results.length > 0 && (
            <UnifiedAnswerBox
              answer={unifiedAnswer}
              loading={answerLoading}
              onRegenerate={onRegenerateAnswer}
              onCiteClick={handleCiteClick}
              followUpTurns={followUpTurns}
              followUpLoading={followUpLoading}
              onAskFollowUp={onAskFollowUp}
              onPreviewCitation={(cite) =>
                setActiveReaderResult({
                  id: `cite-${cite.url}`,
                  title: cite.title,
                  url: cite.url,
                  displayedUrl: cite.domain,
                  snippet: '',
                  engine: 'source',
                  category: 'all',
                })
              }
            />
          )}

          {/* Cross-Vertical Intent Sections (`Docs, Wikis & Repositories` / `Scholarly Literature`) */}
          {!loading &&
            searchResponse?.intentSections &&
            searchResponse.intentSections.length > 0 &&
            searchResponse.intentSections.map((strip) => (
              <section
                key={strip.id}
                aria-label={strip.title}
                className="mb-6 rounded-3xl pharol-liquid-glass pharol-liquid-iridescent p-4 sm:p-5 text-left"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-900/10 dark:border-white/12">
                  <div className="flex items-center gap-2 text-xs">
                    {strip.category === 'code' ? (
                      <Code2 className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    ) : (
                      <FlaskConical className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    <span className="font-semibold text-neutral-950 dark:text-white">
                      {strip.title}
                    </span>
                    <span className="hidden sm:inline text-neutral-400">·</span>
                    <span className="hidden sm:inline text-[11px] text-neutral-500 dark:text-neutral-400">
                      {strip.subtitle}
                    </span>
                  </div>
                  {onSelectCategory && (
                    <button
                      type="button"
                      onClick={() => onSelectCategory(strip.category)}
                      className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-3 py-1 text-[11px] font-medium text-neutral-800 dark:text-neutral-100"
                    >
                      <span>View all in {strip.category === 'code' ? 'Code' : 'Science'}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {strip.items.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl pharol-glass-inset p-3 flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-neutral-500 dark:text-neutral-400 mb-1">
                          <span className="truncate">{item.engine}</span>
                          {item.version && <span>v{item.version}</span>}
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-neutral-950 dark:text-white hover:underline line-clamp-2 leading-snug"
                        >
                          {item.title}
                        </a>
                        <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300 line-clamp-2 leading-snug">
                          {item.snippet}
                        </p>
                      </div>
                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveReaderResult(item)}
                          className="font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                        >
                          Preview
                        </button>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                        >
                          <span>Open</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}

          {loading ? (
            <div className="rounded-3xl pharol-liquid-glass px-5 sm:px-6 py-2 divide-y divide-neutral-900/10 dark:divide-white/12">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="py-5 animate-pulse space-y-2.5">
                  <div className="h-3 w-48 rounded bg-neutral-900/10 dark:bg-white/10" />
                  <div className="h-5 w-3/4 rounded bg-neutral-900/15 dark:bg-white/15" />
                  <div className="h-3.5 w-full rounded bg-neutral-900/10 dark:bg-white/10" />
                  <div className="h-3.5 w-5/6 rounded bg-neutral-900/10 dark:bg-white/10" />
                </div>
              ))}
            </div>
          ) : results.length > 0 ? (
            <>
              <div className="rounded-3xl pharol-liquid-glass px-5 sm:px-6 py-2 divide-y divide-neutral-900/10 dark:divide-white/12">
                {results.map((result, idx) => {
                  const bookmarked = isBookmarked(result.url);
                  const isHighlighted = highlightedUrl === result.url;
                  const isFocused = focusedIndex === idx;
                  return (
                    <article
                      key={result.id}
                      data-result-url={result.url}
                      data-result-index={idx}
                      onClick={() => setFocusedIndex(idx)}
                      className={`group py-5 transition-colors text-left ${
                        isHighlighted || isFocused
                          ? 'bg-white/50 dark:bg-white/10 -mx-3 px-3 rounded-2xl ring-1 ring-neutral-900/15 dark:ring-white/25'
                          : ''
                      }`}
                    >
                      {/* Quiet unboxed metadata line */}
                      <div className="flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                        <span className="truncate font-mono text-[11px]">
                          {result.displayedUrl}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-neutral-400">
                          <span>{result.engine}</span>
                          {result.publishedDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{result.publishedDate}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {/* Title */}
                          <h3 className="text-[17px] font-semibold text-neutral-950 dark:text-neutral-100 leading-snug">
                            <a
                              data-result-link="true"
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {result.title}
                            </a>
                          </h3>

                          {/* Snippet */}
                          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-3">
                            {result.snippet}
                          </p>
                        </div>

                        {result.thumbnail && !failedImages[result.thumbnail] && (
                          <button
                            type="button"
                            onClick={() => setActiveReaderResult(result)}
                            aria-label={`Preview ${result.title}`}
                            className="shrink-0 mt-0.5 h-16 w-22 overflow-hidden rounded-xl border border-neutral-200/70 dark:border-white/10 bg-white/50 dark:bg-white/5"
                          >
                            <img
                              src={result.thumbnail}
                              alt={result.title}
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setFailedImages((prev) => ({
                                  ...prev,
                                  [result.thumbnail!]: true,
                                }))
                              }
                              className={`h-full w-full ${
                                isLogoLikeImage(result.thumbnail)
                                  ? 'object-contain p-1.5'
                                  : 'object-cover'
                              }`}
                            />
                          </button>
                        )}
                      </div>

                    {/* Quiet inline actions */}
                    <div className="mt-2.5 flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                      <button
                        onClick={() => setActiveReaderResult(result)}
                        className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:text-neutral-950 hover:underline dark:text-neutral-200 dark:hover:text-white transition-colors"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>Read Preview</span>
                      </button>

                      <button
                        onClick={() => onToggleBookmark(result)}
                        className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white transition-colors ${
                          bookmarked ? 'font-medium text-neutral-950 dark:text-white' : ''
                        }`}
                      >
                        <Bookmark
                          className={`h-3.5 w-3.5 ${bookmarked ? 'fill-current' : ''}`}
                        />
                        <span>{bookmarked ? 'Saved' : 'Save'}</span>
                      </button>

                      <button
                        onClick={() => handleCopyLink(result.url, result.id)}
                        className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white transition-colors"
                      >
                        {copiedId === result.id ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-[11px] hover:underline hover:text-neutral-900 dark:hover:text-neutral-200"
                      >
                        <span>Open</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </article>
                  );
                })}
              </div>

              {hasMore && (
                <div className="pt-6 pb-2 flex justify-center">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 rounded-full pharol-glass-chip px-5 py-2.5 text-xs font-medium text-neutral-800 disabled:opacity-60 dark:text-neutral-100"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span>{loadingMore ? 'Loading more results...' : 'Load More Results'}</span>
                  </button>
                </div>
              )}

              {searchResponse?.relatedTopics && searchResponse.relatedTopics.length > 0 && (
                <section
                  aria-label="Related Searches"
                  className="mt-7 rounded-3xl pharol-liquid-glass p-5 text-left"
                >
                  <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-3">
                    Related Searches
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searchResponse.relatedTopics.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => {
                          onUpdateQuery(topic);
                          onSearch(topic);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full pharol-glass-chip px-3.5 py-1.5 text-xs font-medium text-neutral-800 hover:text-neutral-950 dark:text-neutral-100 dark:hover:text-white"
                      >
                        <Search className="h-3 w-3 text-neutral-400 shrink-0" />
                        <span>{topic}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="rounded-3xl pharol-liquid-glass p-10 text-center">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                No matching results found
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Try broader keywords or adjust your active filters.
              </p>
            </div>
          )}
        </main>

        {/* Right Rail: Encyclopedia Knowledge + News Highlights */}
        <aside className="lg:col-span-4 space-y-6" aria-label="Knowledge and News Highlights">
          {knowledge && (
            <div className="relative rounded-3xl pharol-liquid-glass pharol-liquid-iridescent p-5">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-900/10 dark:border-white/10 text-xs">
                <div className="flex items-center gap-2 font-semibold text-neutral-900 dark:text-neutral-100">
                  <BookOpen className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                  <span>{knowledge.source || 'Encyclopedia'}</span>
                </div>
                <a
                  href={knowledge.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  aria-label="Open encyclopedia entry"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="pt-3.5 text-left">
                {activeKbImage && (
                  <div className="mb-3.5 space-y-2">
                    <div className="overflow-hidden rounded-xl border border-neutral-900/10 dark:border-white/10 bg-white/45 dark:bg-black/25">
                      <img
                        key={activeKbImage}
                        src={activeKbImage}
                        alt={knowledge.title}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedImages((prev) => ({ ...prev, [activeKbImage]: true }))
                        }
                        className={`w-full ${
                          isLogoLikeImage(activeKbImage)
                            ? 'h-40 object-contain p-3'
                            : 'h-44 object-cover object-center'
                        }`}
                      />
                    </div>
                    {kbImagesList.length > 1 && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {kbImagesList.map((imgUrl, idx) => {
                          const selected = imgUrl === activeKbImage;
                          return (
                            <button
                              key={imgUrl}
                              type="button"
                              onClick={() =>
                                setSelectedKbImage({ url: imgUrl, forTitle: knowledge.title })
                              }
                              aria-label={`View image ${idx + 1} for ${knowledge.title}`}
                              className={`overflow-hidden rounded-lg border h-12 bg-white/40 dark:bg-black/25 transition-all ${
                                selected
                                  ? 'border-neutral-900 dark:border-white ring-1 ring-neutral-900/30 dark:ring-white/30'
                                  : 'border-neutral-900/10 dark:border-white/10 opacity-75 hover:opacity-100'
                              }`}
                            >
                              <img
                                src={imgUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setFailedImages((prev) => ({ ...prev, [imgUrl]: true }))
                                }
                                className={`h-full w-full ${
                                  isLogoLikeImage(imgUrl)
                                    ? 'object-contain p-1'
                                    : 'object-cover object-center'
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <h4 className="text-base font-semibold text-neutral-950 dark:text-white">
                  {knowledge.title}
                </h4>

                {knowledge.subtitle && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {knowledge.subtitle}
                  </div>
                )}

                {knowledge.extract && (
                  <div className="mt-2.5">
                    <p
                      className={`text-xs sm:text-[13px] text-neutral-700 dark:text-neutral-200 leading-relaxed ${
                        isKbExtractExpanded ? '' : 'line-clamp-6'
                      }`}
                    >
                      {knowledge.extract}
                    </p>
                    {knowledge.extract.length > 260 && (
                      <button
                        type="button"
                        onClick={() =>
                          setKbExpanded(isKbExtractExpanded ? null : knowledge.title)
                        }
                        className="mt-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                      >
                        {isKbExtractExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}

                {knowledge.attributes && knowledge.attributes.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-neutral-900/10 pt-3 dark:border-white/10 text-xs">
                    {knowledge.attributes.map((attr, idx) => (
                      <div key={idx} className="flex justify-between gap-2 text-neutral-500 dark:text-neutral-400">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">{attr.label}</span>
                        <span className="truncate">{attr.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-neutral-900/10 dark:border-white/10 flex items-center justify-between text-xs">
                  <button
                    onClick={() =>
                      setActiveReaderResult({
                        id: 'wiki-lead',
                        title: knowledge.title,
                        url: knowledge.url,
                        displayedUrl: knowledge.source || 'Wikipedia',
                        snippet: knowledge.extract,
                        engine: 'wikipedia',
                        category: 'all',
                        thumbnail: activeKbImage || knowledge.thumbnail,
                      })
                    }
                    className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>Read Full Entry</span>
                  </button>
                  <a
                    href={knowledge.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 hover:underline"
                  >
                    Source →
                  </a>
                </div>
              </div>
            </div>
          )}

          {news && news.length > 0 && (
            <div className="rounded-3xl pharol-liquid-glass p-5">
              <div className="flex items-center gap-2 pb-3 border-b border-neutral-900/10 dark:border-white/10 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                <Newspaper className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                <span>Recent Coverage</span>
              </div>

              <div className="pt-3 divide-y divide-neutral-900/10 dark:divide-white/10">
                {news.slice(0, 4).map((item, idx) => {
                  const hasThumb = Boolean(item.thumbnail) && !failedImages[item.thumbnail!];
                  const showSnippet =
                    item.snippet &&
                    item.snippet.trim().toLowerCase() !== item.title.trim().toLowerCase();
                  return (
                    <div key={item.id || idx} className={`${idx > 0 ? 'pt-3' : ''} pb-3 last:pb-0 text-left`}>
                      <div className="flex items-start gap-2.5">
                        {hasThumb && (
                          <button
                            type="button"
                            onClick={() => setActiveReaderResult(item)}
                            className="shrink-0 mt-0.5 h-12 w-14 overflow-hidden rounded-lg border border-neutral-900/10 dark:border-white/10 bg-white/40 dark:bg-black/25"
                            aria-label={`Preview ${item.title}`}
                          >
                            <img
                              src={item.thumbnail}
                              alt=""
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setFailedImages((prev) => ({
                                  ...prev,
                                  [item.thumbnail!]: true,
                                }))
                              }
                              className="h-full w-full object-cover"
                            />
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setActiveReaderResult(item)}
                            className="text-left text-xs font-medium text-neutral-900 hover:underline dark:text-neutral-100 line-clamp-2 leading-snug"
                          >
                            {item.title}
                          </button>
                          {showSnippet && (
                            <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-snug">
                              {item.snippet}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
                        <span className="truncate max-w-[140px]">{item.displayedUrl}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.publishedDate && <span>{item.publishedDate}</span>}
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-neutral-900 dark:hover:text-neutral-100"
                            aria-label={`Open ${item.title}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>

      {activeReaderResult && (
        <ReaderModeModal
          url={activeReaderResult.url}
          initialTitle={activeReaderResult.title}
          initialSnippet={activeReaderResult.snippet}
          initialThumbnail={activeReaderResult.thumbnail}
          onClose={() => setActiveReaderResult(null)}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onSearchOpenCoverage={onSearchOpenCoverage}
        />
      )}
    </div>
  );
}
