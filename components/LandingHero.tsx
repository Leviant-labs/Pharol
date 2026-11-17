'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import { SearchCategory, LocalHistoryItem, SavedBookmark, SearchResult, SearchRegion } from '@/lib/search-types';
import { WeatherWidget } from './WeatherWidget';
import { NewsWidget } from './NewsWidget';
import { LocalHistoryWidget } from './LocalHistoryWidget';
import { ReaderModeModal } from './ReaderModeModal';

interface LandingHeroProps {
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string, category?: SearchCategory) => void;
  category: SearchCategory;
  region: SearchRegion;
  onSelectCategory: (cat: SearchCategory) => void;
  history: LocalHistoryItem[];
  bookmarks: SavedBookmark[];
  onRemoveHistory: (id: string) => void;
  onClearHistory: () => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
}

export function LandingHero({
  query,
  onUpdateQuery,
  onSearch,
  category,
  region,
  history,
  bookmarks,
  onRemoveHistory,
  onClearHistory,
  isBookmarked,
  onToggleBookmark,
}: LandingHeroProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [activeReaderItem, setActiveReaderItem] = useState<SearchResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input on '/' shortcut
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    const trimmed = query?.trim() || '';
    const withoutBang = trimmed
      .replace(/(?:^|\s)![a-zA-Z0-9]+(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (withoutBang.length < 2 || /^![a-zA-Z0-9]*$/i.test(trimmed)) {
      const clearTimer = setTimeout(() => {
        setShowSuggestions(false);
        setSuggestions([]);
      }, 0);
      return () => clearTimeout(clearTimer);
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
        const res = await fetch(
          `/api/suggest?q=${encodeURIComponent(withoutBang)}&region=${encodeURIComponent(region)}&lang=${encodeURIComponent(lang)}`
        );
        if (res.ok && active) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions(true);
        }
      } catch {
        // ignore
      }
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, region]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        const selected = suggestions[selectedIndex];
        onUpdateQuery(selected);
        setShowSuggestions(false);
        onSearch(selected, category);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const quickOperators = [
    { label: 'site:github.com', append: 'site:github.com' },
    { label: 'filetype:pdf', append: 'filetype:pdf' },
    { label: '"exact phrase"', append: '""' },
    { label: '-exclude', append: '-' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 sm:pt-20">
      {/* Centered Architectural Search Hero */}
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-neutral-950 dark:text-white [text-wrap:balance]">
          Pharol
        </h1>
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          Private metasearch · Keyless multi-engine ranking · Zero server retention
        </p>

        {/* Search Input */}
        <div ref={containerRef} className="relative mt-8">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowSuggestions(false);
              onSearch(query, category);
            }}
            className="flex items-center"
          >
            <div className="relative w-full">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-neutral-400">
                <Search className="h-4.5 w-4.5" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  onUpdateQuery(e.target.value);
                  setSelectedIndex(-1);
                }}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Search ${category === 'all' ? 'the web, papers, code, news' : category}...`}
                aria-label="Search query"
                className="w-full rounded-full pharol-glass-inset py-3.5 pl-12 pr-32 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-neutral-100 dark:placeholder:text-neutral-400 dark:focus:border-white/40 dark:focus:ring-sky-400/20 transition-all"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateQuery('');
                    setSuggestions([]);
                  }}
                  className="absolute inset-y-0 right-28 flex items-center pr-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  aria-label="Clear input"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                type="submit"
                className="absolute inset-y-1.5 right-1.5 flex items-center gap-1.5 rounded-full pharol-liquid-btn px-5 text-xs font-medium"
              >
                <span>Search</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-3xl pharol-reader-glass pharol-liquid-iridescent text-left">
              {suggestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onUpdateQuery(item);
                    setShowSuggestions(false);
                    onSearch(item, category);
                  }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
                    idx === selectedIndex
                      ? 'bg-neutral-900/10 text-neutral-950 dark:bg-white/10 dark:text-white'
                      : 'text-neutral-700 hover:bg-neutral-900/5 dark:text-neutral-300 dark:hover:bg-white/5'
                  }`}
                >
                  <Search className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                  <span className="truncate">{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clean inline operator & !bang shortcuts */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <span>Operators:</span>
          {quickOperators.map((op) => (
            <button
              key={op.label}
              type="button"
              onClick={() => {
                const clean = query.trim() ? `${query.trim()} ${op.append}` : op.append;
                setShowSuggestions(false);
                onUpdateQuery(clean);
                inputRef.current?.focus();
              }}
              className="font-mono text-[11px] text-neutral-600 hover:text-neutral-950 hover:underline dark:text-neutral-400 dark:hover:text-white transition-colors"
            >
              {op.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <span>!Bangs:</span>
          {[
            { bang: '!gh', title: 'GitHub repositories' },
            { bang: '!docs', title: 'Context7, Exa Code, GitMCP & MDN docs' },
            { bang: '!deepwiki', title: 'DeepWiki & Google Code Wiki architecture' },
            { bang: '!pkg', title: 'npm, Crates.io & PyPI packages' },
            { bang: '!so', title: 'Stack Overflow Q&A' },
            { bang: '!arxiv', title: 'arXiv preprints' },
            { bang: '!paper', title: 'All scholarly repositories' },
            { bang: '!dataset', title: 'Open datasets & DOIs' },
            { bang: '!news', title: 'Direct news wire' },
            { bang: '!img', title: 'Openverse & Wikimedia images' },
            { bang: '!wiki', title: 'Wikipedia encyclopedia' },
          ].map((b) => (
            <button
              key={b.bang}
              type="button"
              title={`Insert ${b.bang} (${b.title}) into search bar`}
              onClick={() => {
                const stripped = query
                  .replace(/(?:^|\s)![a-zA-Z0-9]+(?=\s|$)/gi, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                const already = new RegExp(`(?:^|\\s)${b.bang}(?=\\s|$)`, 'i').test(query);
                setShowSuggestions(false);
                onUpdateQuery(already ? stripped : stripped ? `${stripped} ${b.bang}` : `${b.bang} `);
                inputRef.current?.focus();
              }}
              className={`font-mono text-[11px] transition-colors hover:underline ${
                new RegExp(`(?:^|\\s)${b.bang}(?=\\s|$)`, 'i').test(query)
                  ? 'font-semibold text-neutral-950 dark:text-white underline'
                  : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              {b.bang}
            </button>
          ))}
        </div>
      </div>

      {/* Local Briefing Strip */}
      <div className="mt-16 pt-8 border-t border-neutral-900/10 dark:border-white/15">
        <div className="flex items-center justify-between mb-5 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            Local Briefing
          </span>
          <span>Stored strictly in browser cache</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <WeatherWidget region={region} />
          <NewsWidget
            region={region}
            onSearchQuery={(q) => onSearch(q, 'news')}
            onReadArticle={(item) => setActiveReaderItem(item)}
          />
          <LocalHistoryWidget
            history={history}
            bookmarks={bookmarks}
            onSelectQuery={(q) => onSearch(q, category)}
            onRemoveHistory={onRemoveHistory}
            onClearHistory={onClearHistory}
          />
        </div>
      </div>

      {activeReaderItem && (
        <ReaderModeModal
          url={activeReaderItem.url}
          initialTitle={activeReaderItem.title}
          initialSnippet={activeReaderItem.snippet}
          initialThumbnail={activeReaderItem.thumbnail}
          onClose={() => setActiveReaderItem(null)}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onSearchOpenCoverage={(headline) => onSearch(headline, 'news')}
        />
      )}
    </div>
  );
}
