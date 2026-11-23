'use client';

import React, { useState } from 'react';
import { Search, Play, ExternalLink, X, Film, Eye } from 'lucide-react';
import { SearchResult } from '@/lib/search-types';

interface VideosPageViewProps {
  videos: SearchResult[];
  loading: boolean;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
}

export function VideosPageView({
  videos,
  loading,
  query,
  onUpdateQuery,
  onSearch,
}: VideosPageViewProps) {
  const [activeEmbed, setActiveEmbed] = useState<SearchResult | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(query);
          }}
          className="flex items-center gap-2 max-w-4xl"
        >
          <div className="relative flex-1">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4"
              style={{ color: 'var(--accent-primary)' }}
            >
              <Search className="h-4 w-4 opacity-85" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => onUpdateQuery(e.target.value)}
              placeholder="Search privacy-enhanced YouTube embeds & Internet Archive videos..."
              aria-label="Search videos"
              className="w-full rounded-full pharol-liquid-dock py-2.5 pl-11 pr-12 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#38a3b8]/35 dark:text-[#f0f4f8] dark:placeholder:text-[#6c7a89] transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => onUpdateQuery('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-neutral-400 hover:text-neutral-800 dark:text-[#6c7a89] dark:hover:text-[#f0f4f8]"
              >
                Clear
              </button>
            )}
          </div>
          <button
            type="submit"
            className="rounded-full pharol-cta px-5 py-2.5 text-xs font-medium shrink-0 whitespace-nowrap"
          >
            Search Videos
          </button>
        </form>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="rounded-3xl pharol-liquid-glass p-4 space-y-3 animate-pulse"
            >
              <div className="aspect-video rounded-xl bg-neutral-900/10 dark:bg-white/10" />
              <div className="h-4 w-3/4 rounded bg-neutral-900/15 dark:bg-white/15" />
              <div className="h-3 w-1/2 rounded bg-neutral-900/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
      ) : videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map((vid) => {
            const hasThumb = Boolean(vid.thumbnail) && !failedThumbs[vid.id];
            return (
              <article
                key={vid.id}
                className="group rounded-3xl pharol-liquid-glass p-4 flex flex-col justify-between transition-colors text-left"
              >
                <div>
                  <button
                    type="button"
                    onClick={() => setActiveEmbed(vid)}
                    className="relative aspect-video w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900 block"
                    aria-label={`Play ${vid.title}`}
                  >
                    {hasThumb ? (
                      <img
                        src={vid.thumbnail}
                        alt={vid.title}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedThumbs((prev) => ({ ...prev, [vid.id]: true }))
                        }
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-500">
                        <Film className="h-8 w-8" />
                      </div>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/10 transition-colors">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-neutral-950 shadow-md group-hover:scale-105 transition-transform">
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </button>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400 mb-1">
                      <span className="truncate font-mono">{vid.displayedUrl}</span>
                      {vid.publishedDate && <span className="shrink-0">{vid.publishedDate}</span>}
                    </div>

                    <h3 className="text-sm font-semibold text-neutral-950 dark:text-white line-clamp-2 leading-snug">
                      <button
                        type="button"
                        onClick={() => setActiveEmbed(vid)}
                        className="text-left hover:underline"
                      >
                        {vid.title}
                      </button>
                    </h3>

                    <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                      {vid.snippet}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-neutral-900/10 dark:border-white/10 flex items-center justify-between text-xs">
                  {vid.views ? (
                    <span className="text-[11px] text-neutral-500 inline-flex items-center gap-1 tabular-nums">
                      <Eye className="h-3 w-3" />
                      {vid.views}
                    </span>
                  ) : (
                    <span className="text-[11px] text-neutral-500">{vid.engine}</span>
                  )}

                  <a
                    href={vid.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
                  >
                    <span>Open Source</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl pharol-liquid-glass p-12 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No videos found. Search for a topic to browse privacy-enhanced video streams.
        </div>
      )}

      {activeEmbed && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-[#040507]/82 backdrop-blur-md p-4"
        >
          <div className="relative max-w-4xl w-full rounded-[20px] pharol-reader-glass overflow-hidden">
            <div className="flex items-center justify-between p-3.5 border-b border-neutral-900/10 dark:border-white/15 text-xs">
              <span className="font-semibold text-neutral-950 dark:text-neutral-100 truncate pr-4">
                {activeEmbed.title}
              </span>
              <button
                onClick={() => setActiveEmbed(null)}
                className="rounded-full pharol-glass-chip p-1.5 text-neutral-700 dark:text-neutral-200"
                aria-label="Close video player"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="aspect-video w-full bg-black">
              {activeEmbed.embedUrl ? (
                <iframe
                  src={activeEmbed.embedUrl}
                  title={activeEmbed.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-neutral-300 text-xs">
                  <p>In-page player unavailable for this stream.</p>
                  <a
                    href={activeEmbed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full pharol-liquid-btn px-4 py-2 font-medium"
                  >
                    Open Video Directly
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
