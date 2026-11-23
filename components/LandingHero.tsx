'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ArrowRight, Command } from 'lucide-react';
import {
  SearchCategory,
  LocalHistoryItem,
  SavedBookmark,
  SearchResult,
  SearchRegion,
} from '@/lib/search-types';
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

const QUICK_OPERATORS = [
  { label: 'site:github.com', append: 'site:github.com' },
  { label: 'filetype:pdf', append: 'filetype:pdf' },
  { label: '"exact phrase"', append: '""' },
  { label: '-exclude', append: '-' },
];

const QUICK_BANGS = [
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
];

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
  const [showSyntax, setShowSyntax] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [activeReaderItem, setActiveReaderItem] = useState<SearchResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input on '/' or Cmd/Ctrl+K
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setShowSyntax((prev) => !prev);
        return;
      }
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
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setShowSyntax(false);
      return;
    }
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
    }
  };

  const bangModeActive = query.trim().startsWith('!');
  const syntaxOpen = showSyntax || bangModeActive;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-24">
      {/* Centered Architectural Search Hero */}
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-neutral-950 dark:text-[#f0f4f8] [text-wrap:balance]">
          Pharol
        </h1>
        <p className="mt-3 text-[13px] tracking-wide text-neutral-500 dark:text-[#9aa7b4]">
          Private metasearch · Keyless multi-engine ranking · Zero server retention
        </p>

        {/* Layer 3 — Floating Liquid Glass Search Dock */}
        <div ref={containerRef} className="relative mt-9">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowSuggestions(false);
              onSearch(query, category);
            }}
            className="flex items-center"
          >
            <div className="relative w-full">
              <div
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4.5"
                style={{ color: 'var(--accent-primary)' }}
              >
                <Search className="h-4.5 w-4.5 opacity-85" />
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
                className="w-full rounded-full pharol-liquid-dock py-3.5 pl-12 pr-32 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#38a3b8]/35 dark:text-[#f0f4f8] dark:placeholder:text-[#6c7a89] transition-all"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateQuery('');
                    setSuggestions([]);
                  }}
                  className="absolute inset-y-0 right-28 flex items-center pr-2 text-neutral-400 hover:text-neutral-800 dark:text-[#6c7a89] dark:hover:text-[#f0f4f8] transition-colors"
                  aria-label="Clear input"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                type="submit"
                className="absolute inset-y-1.5 right-1.5 flex items-center gap-1.5 rounded-full pharol-cta px-5 text-xs font-medium"
              >
                <span>Search</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-2.5 overflow-hidden rounded-[20px] pharol-reader-glass text-left py-1.5">
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
                      ? 'bg-[#38a3b8]/14 text-neutral-950 dark:text-[#f0f4f8]'
                      : 'text-neutral-700 hover:bg-neutral-900/5 dark:text-[#d2dde7] dark:hover:bg-[#d8eaf4]/[0.05]'
                  }`}
                >
                  <Search className="h-3.5 w-3.5 text-neutral-400 dark:text-[#6c7a89] shrink-0" />
                  <span className="truncate">{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Progressive Disclosure: Quiet Syntax & !Bangs helper (hidden clutter at rest) */}
        <div className="mt-4 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setShowSyntax((prev) => !prev)}
            aria-expanded={syntaxOpen}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-[#6c7a89] dark:hover:text-[#d8e3ec] transition-colors"
          >
            <Command className="h-3 w-3" />
            <span>{syntaxOpen ? 'Hide !bangs & operators' : '!Bangs & search operators'}</span>
            <span className="hidden sm:inline font-mono text-[10px] opacity-70">⌘K</span>
          </button>

          {syntaxOpen && (
            <div className="mt-3 w-full rounded-[18px] pharol-frosted-pane px-4 py-3.5 text-left space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <span className="text-[11px] font-medium text-neutral-500 dark:text-[#6c7a89]">
                  Operators
                </span>
                {QUICK_OPERATORS.map((op) => (
                  <button
                    key={op.label}
                    type="button"
                    onClick={() => {
                      const clean = query.trim() ? `${query.trim()} ${op.append}` : op.append;
                      setShowSuggestions(false);
                      onUpdateQuery(clean);
                      inputRef.current?.focus();
                    }}
                    className="font-mono text-[11px] text-neutral-700 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] transition-colors"
                  >
                    {op.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <span className="text-[11px] font-medium text-neutral-500 dark:text-[#6c7a89]">
                  !Bangs
                </span>
                {QUICK_BANGS.map((b) => {
                  const isSelected = new RegExp(`(?:^|\\s)${b.bang}(?=\\s|$)`, 'i').test(query);
                  return (
                    <button
                      key={b.bang}
                      type="button"
                      title={`Insert ${b.bang} (${b.title}) into search bar`}
                      onClick={() => {
                        const stripped = query
                          .replace(/(?:^|\s)![a-zA-Z0-9]+(?=\s|$)/gi, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
                        setShowSuggestions(false);
                        onUpdateQuery(
                          isSelected ? stripped : stripped ? `${stripped} ${b.bang}` : `${b.bang} `
                        );
                        inputRef.current?.focus();
                      }}
                      className={`font-mono text-[11px] transition-colors ${
                        isSelected
                          ? 'font-semibold text-[var(--accent-primary)] underline underline-offset-4'
                          : 'text-neutral-700 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
                      }`}
                    >
                      {b.bang}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unified Layer 2 Local Briefing Workspace (No "equal boxed cards" grid) */}
      <section aria-label="Local Briefing" className="mt-16 sm:mt-20">
        <div className="flex items-center justify-between mb-3.5 px-1 text-[11px] text-neutral-500 dark:text-[#6c7a89]">
          <span className="font-medium tracking-wide uppercase text-neutral-700 dark:text-[#9aa7b4]">
            Local Briefing
          </span>
          <span>Browser-local only</span>
        </div>

        <div className="rounded-[20px] pharol-frosted-pane p-5 sm:p-7">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-7 items-start">
            <div className="md:col-span-3">
              <WeatherWidget region={region} />
            </div>
            <div className="md:col-span-5">
              <NewsWidget
                region={region}
                onSearchQuery={(q) => onSearch(q, 'news')}
                onReadArticle={(item) => setActiveReaderItem(item)}
              />
            </div>
            <div className="md:col-span-4">
              <LocalHistoryWidget
                history={history}
                bookmarks={bookmarks}
                onSelectQuery={(q) => onSearch(q, category)}
                onRemoveHistory={onRemoveHistory}
                onClearHistory={onClearHistory}
              />
            </div>
          </div>
        </div>
      </section>

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
