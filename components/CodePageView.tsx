'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  GitFork,
  Star,
  ExternalLink,
  Bookmark,
  Share2,
  Check,
  BookOpen,
  ChevronDown,
  Package,
  Copy,
  FileCode2,
  Terminal,
} from 'lucide-react';
import { CodeSection, SearchResult } from '@/lib/search-types';
import { ReaderModeModal } from './ReaderModeModal';

interface CodePageViewProps {
  results: SearchResult[];
  sectionHint?: string;
  loading: boolean;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
}

export function CodePageView({
  results,
  sectionHint,
  loading,
  query,
  onUpdateQuery,
  onSearch,
  hasMore,
  loadingMore,
  onLoadMore,
  isBookmarked,
  onToggleBookmark,
}: CodePageViewProps) {
  const contextKey = `${query}::${sectionHint || ''}`;
  const defaultSection: CodeSection =
    sectionHint === 'docs' ||
    sectionHint === 'wikis' ||
    sectionHint === 'repos' ||
    sectionHint === 'packages' ||
    sectionHint === 'qa'
      ? sectionHint
      : 'all';
  const [sectionOverride, setSectionOverride] = useState<{
    key: string;
    value: CodeSection;
  } | null>(null);
  const section =
    sectionOverride?.key === contextKey ? sectionOverride.value : defaultSection;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeCodeItem, setActiveCodeItem] = useState<SearchResult | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const inferCodeSection = (item: SearchResult): Exclude<CodeSection, 'all'> => {
    if (item.codeSection) return item.codeSection;
    const eng = item.engine.toLowerCase();
    if (
      eng.includes('context7') ||
      eng.includes('exa-code') ||
      eng.includes('gitmcp') ||
      eng.includes('mdn') ||
      eng.includes('firecrawl-dev')
    ) {
      return 'docs';
    }
    if (eng.includes('deepwiki') || eng.includes('code-wiki') || eng.includes('opendeepwiki')) {
      return 'wikis';
    }
    if (eng.includes('npm') || eng.includes('crates') || eng.includes('pypi')) {
      return 'packages';
    }
    if (eng.includes('stackoverflow') || eng.includes('hackernews')) {
      return 'qa';
    }
    return 'repos';
  };

  const displayedResults =
    section === 'all'
      ? results
      : results.filter((r) => inferCodeSection(r) === section);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (activeCodeItem) return;

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
      if (displayedResults.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < displayedResults.length - 1 ? prev + 1 : 0;
          document
            .querySelector(`[data-code-index="${next}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : displayedResults.length - 1;
          document
            .querySelector(`[data-code-index="${next}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'r' && focusedIndex >= 0 && displayedResults[focusedIndex]) {
        e.preventDefault();
        setActiveCodeItem(displayedResults[focusedIndex]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [displayedResults, focusedIndex, activeCodeItem]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const sections: Array<{ id: CodeSection; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'docs', label: 'Docs & MCP' },
    { id: 'wikis', label: 'Repo Wikis' },
    { id: 'repos', label: 'Repositories' },
    { id: 'packages', label: 'Packages' },
    { id: 'qa', label: 'Q&A & Discussions' },
  ];

  const sectionBadgeLabel: Record<Exclude<CodeSection, 'all'>, string> = {
    docs: 'Docs & MCP',
    wikis: 'Repo Wiki',
    repos: 'Repository',
    packages: 'Package',
    qa: 'Q&A',
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => onUpdateQuery(e.target.value)}
              placeholder="Search Context7, Exa Code, DeepWiki, GitMCP, GitHub, npm/PyPI/Crates..."
              aria-label="Search code"
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
            Search Code
          </button>
        </form>

        {/* Barless section filter row: only active selection gets a glass pill */}
        <div className="flex items-center gap-1.5 mt-4 text-xs overflow-x-auto scrollbar-none">
          {sections.map((f) => {
            const count =
              f.id === 'all'
                ? results.length
                : results.filter((r) => inferCodeSection(r) === f.id).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSectionOverride({ key: contextKey, value: f.id })}
                className={`rounded-full px-3.5 py-1.5 font-medium transition-all whitespace-nowrap shrink-0 ${
                  section === f.id
                    ? 'pharol-nav-pill text-neutral-950 dark:text-[#f0f4f8]'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
                }`}
              >
                {f.label} {results.length > 0 ? `(${count})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="rounded-[20px] pharol-frosted-pane p-5 sm:p-7 space-y-6">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="space-y-2.5 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-neutral-900/15 dark:bg-white/[0.12]" />
              <div className="h-3.5 w-full rounded bg-neutral-900/10 dark:bg-white/[0.07]" />
            </div>
          ))}
        </div>
      ) : displayedResults.length > 0 ? (
        <>
          <div className="rounded-[20px] pharol-frosted-pane p-5 sm:p-7 space-y-1.5">
            {displayedResults.map((item, idx) => {
              const sec = inferCodeSection(item);
              const isSO = item.engine.includes('stackoverflow');
              const isGH = item.engine.includes('github');
              return (
                <article
                  key={item.id}
                  data-code-index={idx}
                  data-focused={focusedIndex === idx ? 'true' : undefined}
                  onClick={() => setFocusedIndex(idx)}
                  className={`group pharol-row-hover -mx-3 px-3.5 py-4 text-left ${
                    focusedIndex === idx
                      ? 'bg-[#38a3b8]/10 ring-1 ring-[#38a3b8]/30'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-[#6c7a89] mb-1">
                    <span className="font-mono text-[11px] truncate dark:text-[#9aa7b4]">
                      {item.displayedUrl}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] shrink-0">
                      <span style={{ color: 'var(--accent-primary)' }}>{sectionBadgeLabel[sec]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{item.engine}</span>
                      {item.publishedDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{item.publishedDate}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <h3 className="text-[16.5px] font-semibold text-neutral-950 dark:text-[#f0f4f8] leading-snug">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--accent-primary)] transition-colors"
                    >
                      {item.title}
                    </a>
                  </h3>

                  <p className="mt-1.5 text-sm text-neutral-600 dark:text-[#b4c1ce] leading-relaxed">
                    {item.snippet}
                  </p>

                  {/* Recessed code command aperture (zero pill spam) */}
                  {item.installCommand && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleCopy(item.installCommand!, `pkg-${item.id}`)}
                        className="pharol-aperture inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-neutral-800 dark:text-[#e6edf4] hover:text-[var(--accent-primary)] transition-colors"
                      >
                        <Package className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                        <span>{item.installCommand}</span>
                        {copiedId === `pkg-${item.id}` ? (
                          <Check className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} />
                        ) : (
                          <Copy className="h-3 w-3 text-neutral-400 dark:text-[#6c7a89]" />
                        )}
                      </button>
                      {item.version && (
                        <span className="text-[11px] font-mono text-neutral-500 dark:text-[#6c7a89]">
                          v{item.version}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Clean inline companion links (zero pill spam) */}
                  {(item.wikiUrls || item.mcpUrl) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      {item.wikiUrls?.deepwiki && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveCodeItem({
                                ...item,
                                title: `${item.title} — DeepWiki`,
                                url: item.wikiUrls!.deepwiki!,
                              })
                            }
                            className="inline-flex items-center gap-1 font-medium hover:underline"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            <FileCode2 className="h-3 w-3" />
                            <span>DeepWiki Preview</span>
                          </button>
                          <a
                            href={item.wikiUrls.deepwiki}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]"
                          >
                            <span>DeepWiki</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </>
                      )}

                      {item.wikiUrls?.googleCodeWiki && (
                        <a
                          href={item.wikiUrls.googleCodeWiki}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]"
                        >
                          <span>Google Code Wiki</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}

                      {item.wikiUrls?.openDeepWiki && (
                        <a
                          href={item.wikiUrls.openDeepWiki}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                          style={{ color: 'var(--accent-signal)' }}
                        >
                          <span>OpenDeepWiki</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}

                      {item.mcpUrl && (
                        <button
                          type="button"
                          onClick={() => handleCopy(item.mcpUrl!, `mcp-${item.id}`)}
                          className="inline-flex items-center gap-1 font-mono text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]"
                          title={`Copy GitMCP endpoint: ${item.mcpUrl}`}
                        >
                          {copiedId === `mcp-${item.id}` ? (
                            <>
                              <Check className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} />
                              <span style={{ color: 'var(--accent-primary)' }}>Copied GitMCP</span>
                            </>
                          ) : (
                            <>
                              <Terminal className="h-3 w-3 opacity-75" />
                              <span>Copy GitMCP</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                    {isGH && (
                      <div className="flex items-center gap-3 font-mono text-[11px]">
                        {item.stars !== undefined && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Star className="h-3.5 w-3.5" />
                            {item.stars.toLocaleString()}
                          </span>
                        )}
                        {item.forks !== undefined && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <GitFork className="h-3.5 w-3.5" />
                            {item.forks.toLocaleString()}
                          </span>
                        )}
                        {item.language && <span>{item.language}</span>}
                        {item.license && <span>{item.license}</span>}
                      </div>
                    )}

                    {isSO && item.tags && item.tags.length > 0 && (
                      <span className="font-mono text-[11px] text-neutral-500">
                        {item.tags.slice(0, 4).join(' · ')}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-3">
                      <button
                        onClick={() => setActiveCodeItem(item)}
                        className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>Preview</span>
                      </button>

                      <button
                        onClick={() => onToggleBookmark(item)}
                        className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white ${
                          isBookmarked(item.url) ? 'font-medium text-neutral-950 dark:text-white' : ''
                        }`}
                      >
                        <Bookmark
                          className={`h-3.5 w-3.5 ${isBookmarked(item.url) ? 'fill-current' : ''}`}
                        />
                        <span>{isBookmarked(item.url) ? 'Saved' : 'Save'}</span>
                      </button>

                      <button
                        onClick={() => handleCopy(item.url, item.id)}
                        className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] hover:underline"
                      >
                        <span>Open</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
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
                <span>{loadingMore ? 'Loading more results...' : 'Load More Code Results'}</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-3xl pharol-liquid-glass p-12 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No results in this code section. Switch to All or broaden your query.
        </div>
      )}

      {activeCodeItem && (
        <ReaderModeModal
          url={activeCodeItem.url}
          initialTitle={activeCodeItem.title}
          initialSnippet={activeCodeItem.snippet}
          onClose={() => setActiveCodeItem(null)}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
        />
      )}
    </div>
  );
}
