'use client';

import React, { useEffect, useState } from 'react';
import { Newspaper, RefreshCw, ArrowUpRight, BookOpen } from 'lucide-react';
import { NewsAccessFilter, SearchRegion, SearchResult } from '@/lib/search-types';
import { filterNewsByAccess } from '@/lib/search-engine';

interface NewsWidgetProps {
  region?: SearchRegion;
  onSearchQuery: (query: string) => void;
  onReadArticle?: (item: SearchResult) => void;
}

export function NewsWidget({ region = 'auto', onSearchQuery, onReadArticle }: NewsWidgetProps) {
  const [news, setNews] = useState<SearchResult[]>([]);
  const [topic, setTopic] = useState<'TOP' | 'TECHNOLOGY' | 'SCIENCE' | 'BUSINESS'>('TOP');
  const [accessMode, setAccessMode] = useState<NewsAccessFilter>('free');
  const [loading, setLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const buildNewsUrl = (selectedTopic: string) => {
    const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return `/api/news?topic=${selectedTopic}&region=${encodeURIComponent(region)}&lang=${encodeURIComponent(lang)}`;
  };

  const fetchNews = async (selectedTopic: string) => {
    setLoading(true);
    try {
      const res = await fetch(buildNewsUrl(selectedTopic));
      if (res.ok) {
        const data = await res.json();
        setNews(data.items || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    fetch(`/api/news?topic=${topic}&region=${encodeURIComponent(region)}&lang=${encodeURIComponent(lang)}`)
      .then((res) => res.json())
      .then((data) => {
        if (active) {
          setNews(data.items || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [topic, region]);

  const topics: Array<{ id: 'TOP' | 'TECHNOLOGY' | 'SCIENCE' | 'BUSINESS'; label: string }> = [
    { id: 'TOP', label: 'Top' },
    { id: 'TECHNOLOGY', label: 'Tech' },
    { id: 'SCIENCE', label: 'Science' },
    { id: 'BUSINESS', label: 'Business' },
  ];

  return (
    <div className="transition-colors">
      <div className="pb-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900 dark:text-[#f0f4f8]">
            <Newspaper className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span>Headlines</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                setAccessMode((prev) =>
                  prev === 'free' ? 'open-wire' : prev === 'open-wire' ? 'all' : 'free'
                )
              }
              title="Cycle source filter: Free (no paywalls) / Open Wire Only / All"
              className="text-[11px] font-mono text-neutral-500 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] transition-colors"
            >
              {accessMode === 'open-wire' ? 'Wire' : accessMode === 'free' ? 'Free' : 'All'}
            </button>
            <button
              onClick={() => fetchNews(topic)}
              className="text-neutral-400 hover:text-neutral-800 dark:text-[#6c7a89] dark:hover:text-[#f0f4f8] p-0.5 transition-colors"
              aria-label="Refresh headlines"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => setTopic(t.id)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all whitespace-nowrap ${
                topic === t.id
                  ? 'pharol-nav-pill text-neutral-950 dark:text-[#f0f4f8]'
                  : 'text-neutral-500 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-1 space-y-1.5">
        {loading && news.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-400 dark:text-[#6c7a89]">Loading headlines...</div>
        ) : filterNewsByAccess(news, accessMode).length > 0 ? (
          filterNewsByAccess(news, accessMode).slice(0, 4).map((item) => {
            const hasThumb = Boolean(item.thumbnail) && !failedImages[item.id];
            return (
              <div key={item.id} className="group pharol-row-hover -mx-2 px-2 py-2 text-left flex items-start gap-2.5">
                {hasThumb ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImages((prev) => ({ ...prev, [item.id]: true }))}
                    className="h-10 w-10 shrink-0 rounded-lg object-cover bg-neutral-100 dark:bg-white/[0.04] mt-0.5"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-neutral-100/80 dark:bg-white/[0.04] flex items-center justify-center text-neutral-400 dark:text-[#6c7a89] mt-0.5">
                    <Newspaper className="h-3.5 w-3.5" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1.5">
                    {onReadArticle ? (
                      <button
                        type="button"
                        onClick={() => onReadArticle(item)}
                        className="text-left text-xs font-medium text-neutral-800 hover:text-neutral-950 dark:text-[#e6edf4] dark:hover:text-white line-clamp-2 leading-snug transition-colors"
                      >
                        {item.title}
                      </button>
                    ) : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-neutral-800 hover:text-neutral-950 dark:text-[#e6edf4] dark:hover:text-white line-clamp-2 leading-snug transition-colors"
                      >
                        {item.title}
                      </a>
                    )}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pharol-hover-actions text-neutral-400 hover:text-neutral-800 dark:text-[#6c7a89] dark:hover:text-[#f0f4f8] shrink-0"
                      aria-label={`Open ${item.title} directly`}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-neutral-500 dark:text-[#6c7a89]">
                    <span className="truncate max-w-[120px] font-medium dark:text-[#9aa7b4]">{item.displayedUrl}</span>
                    {item.publishedDate && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{item.publishedDate}</span>
                      </>
                    )}
                    {onReadArticle && (
                      <button
                        type="button"
                        onClick={() => onReadArticle(item)}
                        className="pharol-hover-actions ml-auto inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline shrink-0"
                      >
                        <BookOpen className="h-3 w-3" />
                        <span>Read</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-6 text-center text-xs text-neutral-400 dark:text-[#6c7a89]">
            No headlines available.{' '}
            <button onClick={() => onSearchQuery('world news')} className="underline text-[var(--accent-primary)]">
              Search news
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
