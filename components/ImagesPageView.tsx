'use client';

import React, { useState } from 'react';
import { Search, Image as ImageIcon, ExternalLink, X, ChevronDown } from 'lucide-react';
import { SearchResult } from '@/lib/search-types';

interface ImagesPageViewProps {
  images: SearchResult[];
  loading: boolean;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function ImagesPageView({
  images,
  loading,
  query,
  onUpdateQuery,
  onSearch,
  hasMore,
  loadingMore,
  onLoadMore,
}: ImagesPageViewProps) {
  const [selectedImage, setSelectedImage] = useState<SearchResult | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

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
              placeholder="Search Openverse & Wikimedia Commons images..."
              aria-label="Search images"
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
            Search Images
          </button>
        </form>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 py-4">
          {Array.from({ length: 12 }).map((_, n) => (
            <div
              key={n}
              className="aspect-square rounded-2xl pharol-liquid-glass animate-pulse"
            />
          ))}
        </div>
      ) : images.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {images.map((img) => {
            const broken = failedImages[img.id];
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => setSelectedImage(img)}
                className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/30 dark:border-white/20 dark:bg-white/5 shadow-md aspect-square text-left"
              >
                {!broken ? (
                  <img
                    src={img.thumbnail || img.url}
                    alt={img.title}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={() => setFailedImages((prev) => ({ ...prev, [img.id]: true }))}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center p-2 text-neutral-400">
                    <ImageIcon className="h-6 w-6 mb-1" />
                    <span className="text-[11px] line-clamp-2 text-center">{img.title}</span>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end">
                  <p className="text-[11px] font-medium text-white line-clamp-1">
                    {img.title}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-neutral-300 font-mono mt-0.5">
                    <span className="truncate">{img.displayedUrl}</span>
                    {img.imageWidth && img.imageHeight && (
                      <span className="tabular-nums shrink-0 ml-1">
                        {img.imageWidth}×{img.imageHeight}
                      </span>
                    )}
                  </div>
                </div>
              </button>
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
              <span>{loadingMore ? 'Loading more images...' : 'Load More Images'}</span>
            </button>
          </div>
        )}
      </>
      ) : (
        <div className="rounded-3xl pharol-liquid-glass p-12 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No images found. Search for a topic to browse Openverse &amp; Wikimedia repositories.
        </div>
      )}

      {selectedImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-[#040507]/82 backdrop-blur-md p-4"
        >
          <div className="relative max-w-4xl w-full rounded-[20px] pharol-reader-glass overflow-hidden flex flex-col md:flex-row">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-3 right-3 z-10 rounded-full pharol-glass-chip p-1.5 text-neutral-800 dark:text-white"
              aria-label="Close image preview"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex-1 bg-black/75 flex items-center justify-center p-4 min-h-[320px] max-h-[70vh]">
              <img
                src={selectedImage.thumbnail || selectedImage.url}
                alt={selectedImage.title}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain rounded-xl"
              />
            </div>

            <div className="w-full md:w-80 p-5 flex flex-col justify-between border-t md:border-t-0 md:border-l border-neutral-900/10 dark:border-white/15 text-left text-xs">
              <div className="space-y-3">
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">Image Details</div>
                <h3 className="text-sm font-semibold text-neutral-950 dark:text-white leading-snug">
                  {selectedImage.title}
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed text-xs">
                  {selectedImage.snippet}
                </p>

                <div className="space-y-2 pt-3 border-t border-neutral-900/10 dark:border-white/15 text-neutral-500 dark:text-neutral-400">
                  <div className="flex justify-between">
                    <span>Source</span>
                    <span className="font-mono text-neutral-900 dark:text-neutral-100">{selectedImage.engine}</span>
                  </div>
                  {selectedImage.imageWidth && selectedImage.imageHeight && (
                    <div className="flex justify-between">
                      <span>Dimensions</span>
                      <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                        {selectedImage.imageWidth} × {selectedImage.imageHeight}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Host</span>
                    <span className="truncate max-w-[150px] text-neutral-900 dark:text-neutral-100">{selectedImage.displayedUrl}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-neutral-900/10 dark:border-white/15">
                <a
                  href={selectedImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 rounded-full pharol-liquid-btn py-2 text-xs font-medium"
                >
                  <span>Visit Source</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
