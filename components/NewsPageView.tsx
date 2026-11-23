'use client';

import React, { useState } from 'react';
import {
  Search,
  Newspaper,
  Clock,
  Layers,
  ArrowUpRight,
  Bookmark,
  BookOpen,
} from 'lucide-react';
import { NewsAccessFilter, SearchResult } from '@/lib/search-types';
import {
  classifySourceAccess,
  extractTopicClusters,
  filterNewsByAccess,
} from '@/lib/search-engine';
import { ReaderModeModal } from './ReaderModeModal';

interface NewsPageViewProps {
  newsItems: SearchResult[];
  loading: boolean;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
  onSelectTopic: (topicQuery: string) => void;
  accessFilter: NewsAccessFilter;
  onChangeAccessFilter: (filter: NewsAccessFilter) => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
}

export function NewsPageView({
  newsItems,
  loading,
  query,
  onUpdateQuery,
  onSearch,
  onSelectTopic,
  accessFilter,
  onChangeAccessFilter,
  isBookmarked,
  onToggleBookmark,
}: NewsPageViewProps) {
  const filteredNews = filterNewsByAccess(newsItems, accessFilter);
  const freeCount = filterNewsByAccess(newsItems, 'free').length;
  const openWireCount = filterNewsByAccess(newsItems, 'open-wire').length;
  const hiddenSubscriptionCount = Math.max(0, newsItems.length - freeCount);

  const featuredItem = filteredNews[0] || null;
  const streamItems = filteredNews.slice(1);
  const clusters = extractTopicClusters(filteredNews, query).slice(0, 3);

  const [activeTopicFilter, setActiveTopicFilter] = useState<string | null>(null);
  const [activeReaderArticle, setActiveReaderArticle] = useState<SearchResult | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const displayedStream = activeTopicFilter
    ? streamItems.filter(
        (i) =>
          i.title.toLowerCase().includes(activeTopicFilter.toLowerCase()) ||
          i.snippet.toLowerCase().includes(activeTopicFilter.toLowerCase())
      )
    : streamItems;

  const accessOptions: Array<{ id: NewsAccessFilter; label: string; count: number }> = [
    { id: 'free', label: 'Free & Open', count: freeCount },
    { id: 'open-wire', label: 'Open Wire Only', count: openWireCount },
    { id: 'all', label: 'All Sources', count: newsItems.length },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Editorial News Header */}
      <div className="mb-8 border-b border-neutral-900/10 dark:border-white/15 pb-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-white">
              Direct News Wire
            </h1>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Aggregated across RTP, Observador, ECO, Notícias ao Minuto, BBC, NPR, The Guardian, Exa News, Firecrawl News, Tavily News, TinyFish News, DuckDuckGo News &amp; Bing News · Direct publisher URLs
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0 whitespace-nowrap">
            <span>{filteredNews.length} stories</span>
            {accessFilter !== 'all' && hiddenSubscriptionCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[11px] text-neutral-400">
                  {hiddenSubscriptionCount} subscription gated hidden
                </span>
              </>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(query);
          }}
          className="mt-4 flex items-center gap-2 max-w-3xl"
        >
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => onUpdateQuery(e.target.value)}
              placeholder="Search breaking stories, publishers, or topics..."
              aria-label="Search news"
              className="w-full rounded-full pharol-glass-inset py-2.5 pl-10 pr-12 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-neutral-100 dark:placeholder:text-neutral-400 transition-colors"
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
            type="submit"
            className="rounded-full pharol-liquid-btn px-5 py-2.5 text-xs font-medium shrink-0 whitespace-nowrap"
          >
            Search News
          </button>
        </form>

        {/* Segmented Topic + Access Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTopicFilter(null)}
              className={`rounded-full px-3.5 py-1.5 font-medium transition-colors shrink-0 whitespace-nowrap ${
                activeTopicFilter === null
                  ? 'pharol-liquid-btn'
                  : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
              }`}
            >
              All ({filteredNews.length})
            </button>
            {clusters.map((c) => (
              <button
                key={c.topic}
                onClick={() =>
                  setActiveTopicFilter(activeTopicFilter === c.topic ? null : c.topic)
                }
                className={`rounded-full px-3.5 py-1.5 font-medium transition-colors shrink-0 whitespace-nowrap ${
                  activeTopicFilter === c.topic
                    ? 'pharol-liquid-btn'
                    : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                }`}
              >
                {c.topic} ({c.items.length})
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-1 rounded-full pharol-glass-inset p-1 shrink-0"
            role="group"
            aria-label="Source access filter"
          >
            {accessOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setActiveTopicFilter(null);
                  onChangeAccessFilter(opt.id);
                }}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  accessFilter === opt.id
                    ? 'pharol-liquid-btn'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white'
                }`}
              >
                {opt.label} ({opt.count})
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-4">
          <div className="lg:col-span-7 h-96 rounded-3xl pharol-liquid-glass p-6 space-y-4 animate-pulse">
            <div className="h-52 w-full rounded-2xl bg-neutral-900/10 dark:bg-white/10" />
            <div className="h-6 w-3/4 rounded bg-neutral-900/15 dark:bg-white/15" />
            <div className="h-4 w-5/6 rounded bg-neutral-900/10 dark:bg-white/10" />
          </div>
          <div className="lg:col-span-5 h-96 rounded-3xl pharol-liquid-glass px-5 py-4 divide-y divide-neutral-900/10 dark:divide-white/10 animate-pulse">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="py-3.5 space-y-2">
                <div className="h-3 w-1/3 rounded bg-neutral-900/10 dark:bg-white/10" />
                <div className="h-4 w-5/6 rounded bg-neutral-900/15 dark:bg-white/15" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Split Lead + Wire Stream */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-10">
            {/* Lead Story */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2.5">
                Lead Story
              </div>

              {featuredItem ? (
                <article className="relative flex-1 rounded-3xl pharol-liquid-glass pharol-liquid-iridescent p-5 sm:p-6 flex flex-col justify-between text-left">
                  <div>
                    {featuredItem.thumbnail && !failedImages[featuredItem.id] && (
                      <div
                        onClick={() => setActiveReaderArticle(featuredItem)}
                        className="relative aspect-16/9 w-full overflow-hidden rounded-2xl border border-neutral-900/10 dark:border-white/15 bg-white/30 dark:bg-black/30 mb-4 cursor-pointer group"
                      >
                        <img
                          src={featuredItem.thumbnail}
                          alt={featuredItem.title}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages((prev) => ({ ...prev, [featuredItem.id]: true }))
                          }
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-102"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {featuredItem.displayedUrl}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{featuredItem.engine}</span>
                      {(featuredItem.accessType || classifySourceAccess(featuredItem.url)) === 'open' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                            Open Wire
                          </span>
                        </>
                      )}
                      {(featuredItem.accessType || classifySourceAccess(featuredItem.url)) === 'subscription' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                            Subscription
                          </span>
                        </>
                      )}
                      {featuredItem.publishedDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {featuredItem.publishedDate}
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="font-serif text-2xl sm:text-[26px] font-bold tracking-tight text-neutral-950 dark:text-white leading-snug [text-wrap:balance]">
                      <button
                        type="button"
                        onClick={() => setActiveReaderArticle(featuredItem)}
                        className="text-left hover:underline"
                      >
                        {featuredItem.title}
                      </button>
                    </h2>

                    <p className="mt-3 text-sm sm:text-[15px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                      {featuredItem.snippet}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-neutral-900/10 dark:border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveReaderArticle(featuredItem)}
                        className="inline-flex items-center gap-1.5 rounded-full pharol-liquid-btn px-4 py-2 font-medium"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>Read Article</span>
                      </button>

                      <button
                        onClick={() => onToggleBookmark(featuredItem)}
                        className={`inline-flex items-center gap-1 rounded-full px-3.5 py-2 transition-colors ${
                          isBookmarked(featuredItem.url)
                            ? 'pharol-liquid-btn font-medium'
                            : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                        }`}
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                        <span>{isBookmarked(featuredItem.url) ? 'Saved' : 'Save'}</span>
                      </button>
                    </div>

                    <a
                      href={featuredItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white"
                    >
                      <span>Open Original Article</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              ) : (
                <div className="flex-1 rounded-3xl pharol-liquid-glass p-8 text-center text-xs text-neutral-500 dark:text-neutral-400 flex items-center justify-center">
                  No headline story available.
                </div>
              )}
            </div>

            {/* Wire Stream */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2.5 flex items-center justify-between">
                <span>Latest Wire</span>
                <span className="font-mono text-[11px] tabular-nums">
                  {displayedStream.length} articles
                </span>
              </div>

              <div
                className="flex-1 max-h-[580px] overflow-y-auto rounded-3xl pharol-liquid-glass px-4 divide-y divide-neutral-900/10 dark:divide-white/12"
                style={{ scrollbarWidth: 'thin' }}
                aria-label="Scrollable News List"
              >
                {displayedStream.length > 0 ? (
                  displayedStream.map((item) => {
                    const hasThumb = Boolean(item.thumbnail) && !failedImages[item.id];
                    return (
                      <div key={item.id} className="py-3.5 text-left group flex items-start gap-3">
                        {hasThumb ? (
                          <button
                            type="button"
                            onClick={() => setActiveReaderArticle(item)}
                            className="h-18 w-18 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
                            aria-label={`Read ${item.title}`}
                          >
                            <img
                              src={item.thumbnail}
                              alt=""
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              onError={() =>
                                setFailedImages((prev) => ({ ...prev, [item.id]: true }))
                              }
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActiveReaderArticle(item)}
                            className="h-18 w-18 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 flex items-center justify-center text-neutral-400"
                            aria-label={`Read ${item.title}`}
                          >
                            <Newspaper className="h-5 w-5" />
                          </button>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 mb-1">
                            <span className="font-semibold text-neutral-700 dark:text-neutral-300 truncate max-w-[140px]">
                              {item.displayedUrl}
                            </span>
                            {(item.accessType || classifySourceAccess(item.url)) === 'open' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 shrink-0">
                                  Open
                                </span>
                              </>
                            )}
                            {(item.accessType || classifySourceAccess(item.url)) === 'subscription' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
                                  Subscription
                                </span>
                              </>
                            )}
                            {item.publishedDate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{item.publishedDate}</span>
                              </>
                            )}
                          </div>

                          <h3 className="text-xs sm:text-[13px] font-semibold text-neutral-950 dark:text-neutral-100 line-clamp-2 leading-snug">
                            <button
                              type="button"
                              onClick={() => setActiveReaderArticle(item)}
                              className="text-left hover:underline"
                            >
                              {item.title}
                            </button>
                          </h3>

                          <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                            <button
                              onClick={() => setActiveReaderArticle(item)}
                              className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                            >
                              <BookOpen className="h-3 w-3" />
                              <span>Read</span>
                            </button>
                            <button
                              onClick={() => onToggleBookmark(item)}
                              className="hover:text-neutral-900 dark:hover:text-white"
                            >
                              {isBookmarked(item.url) ? 'Saved' : 'Save'}
                            </button>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto inline-flex items-center gap-0.5 hover:text-neutral-900 dark:hover:text-white"
                            >
                              <span>Source</span>
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-12 text-center text-xs text-neutral-400">
                    No additional news items match this filter.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3-Column Topic Clusters */}
          {clusters.length > 0 && (
            <div className="border-t border-neutral-900/10 dark:border-white/15 pt-8 text-left">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                  <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">
                    Topic Threads
                  </h3>
                </div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                  {clusters.length} key clusters
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.topic}
                    className="rounded-3xl pharol-liquid-glass p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-neutral-950 dark:text-white pb-3 mb-3 border-b border-neutral-900/10 dark:border-white/12">
                        <span className="truncate pr-2">{cluster.topic}</span>
                        <button
                          onClick={() => onSearch(`${query ? `${query} ` : ''}${cluster.topic}`)}
                          className="text-[11px] font-medium text-neutral-500 hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white shrink-0"
                        >
                          Filter Topic
                        </button>
                      </div>

                      <div className="divide-y divide-neutral-900/10 dark:divide-white/10">
                        {cluster.items.slice(0, 6).map((ci) => (
                          <div key={ci.id} className="py-2.5 first:pt-0 last:pb-0 text-left">
                            <button
                              type="button"
                              onClick={() => setActiveReaderArticle(ci)}
                              className="text-left text-xs font-medium text-neutral-800 hover:text-neutral-950 hover:underline dark:text-neutral-100 dark:hover:text-white line-clamp-2 leading-snug"
                            >
                              {ci.title}
                            </button>
                            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-1">
                              <span className="truncate max-w-[140px]">{ci.displayedUrl}</span>
                              <span aria-hidden="true">·</span>
                              <a
                                href={ci.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-neutral-700 dark:hover:text-neutral-200"
                              >
                                Direct
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-neutral-900/10 dark:border-white/12 text-right">
                      <button
                        onClick={() => onSelectTopic(cluster.topic)}
                        className="text-xs font-medium text-neutral-700 hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white"
                      >
                        Explore {cluster.items.length} stories →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeReaderArticle && (
        <ReaderModeModal
          url={activeReaderArticle.url}
          initialTitle={activeReaderArticle.title}
          initialSnippet={activeReaderArticle.snippet}
          initialThumbnail={activeReaderArticle.thumbnail}
          onClose={() => setActiveReaderArticle(null)}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onSearchOpenCoverage={(headline) => onSearch(headline)}
        />
      )}
    </div>
  );
}
