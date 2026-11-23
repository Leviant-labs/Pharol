'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  BookOpen,
  ExternalLink,
  Quote,
  Bookmark,
  Check,
  Download,
  ChevronDown,
  Library,
  Sparkles,
} from 'lucide-react';
import {
  ConceptOverview,
  ScienceSection,
  SearchResult,
  UnifiedAnswer,
} from '@/lib/search-types';
import { ReaderModeModal } from './ReaderModeModal';
import { OpticalFrostPane } from './OpticalFrostPane';
import { UnifiedAnswerBox } from './UnifiedAnswerBox';

interface AcademiaPageViewProps {
  results: SearchResult[];
  conceptOverview?: ConceptOverview | null;
  sectionHint?: string;
  loading: boolean;
  unifiedAnswer: UnifiedAnswer | null;
  answerLoading: boolean;
  onRegenerateAnswer: () => void;
  query: string;
  onUpdateQuery: (q: string) => void;
  onSearch: (q: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
}

export function AcademiaPageView({
  results,
  conceptOverview,
  sectionHint,
  loading,
  unifiedAnswer,
  answerLoading,
  onRegenerateAnswer,
  query,
  onUpdateQuery,
  onSearch,
  hasMore,
  loadingMore,
  onLoadMore,
  isBookmarked,
  onToggleBookmark,
}: AcademiaPageViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const contextKey = `${query}::${sectionHint || ''}`;
  const defaultSection: ScienceSection =
    sectionHint === 'papers' || sectionHint === 'preprints' || sectionHint === 'datasets'
      ? sectionHint
      : 'all';
  const [sectionOverride, setSectionOverride] = useState<{
    key: string;
    value: ScienceSection;
  } | null>(null);
  const [sourceOverride, setSourceOverride] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const sectionFilter =
    sectionOverride?.key === contextKey ? sectionOverride.value : defaultSection;
  const sourceFilter =
    sourceOverride?.key === contextKey ? sourceOverride.value : 'all';
  const [activePaper, setActivePaper] = useState<SearchResult | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleCopyCitation = (item: SearchResult) => {
    const authorsStr = item.authors?.length ? `${item.authors.join(', ')}. ` : '';
    const citation = `${authorsStr}${item.title}. ${item.journal || ''} (${item.publishedDate || 'n.d.'}). ${
      item.doi ? `https://doi.org/${item.doi}` : item.url
    }`;
    navigator.clipboard.writeText(citation);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const inferScienceSection = (item: SearchResult): Exclude<ScienceSection, 'all'> => {
    if (item.scienceSection) return item.scienceSection;
    const eng = item.engine.toLowerCase();
    if (eng.includes('arxiv') || eng.includes('hal') || eng.includes('inspire')) return 'preprints';
    if (eng.includes('datacite')) return 'datasets';
    return 'papers';
  };

  const sections: Array<{ id: ScienceSection; label: string }> = [
    { id: 'all', label: 'All Scholarly Works' },
    { id: 'papers', label: 'Peer-Reviewed Papers' },
    { id: 'preprints', label: 'Preprints' },
    { id: 'datasets', label: 'Datasets & Software' },
  ];

  const sources = [
    { id: 'all', label: 'All Sources' },
    { id: 'openalex', label: 'OpenAlex' },
    { id: 'semanticscholar', label: 'Semantic Scholar' },
    { id: 'openaire', label: 'OpenAIRE' },
    { id: 'europepmc', label: 'Europe PMC' },
    { id: 'pubmed', label: 'PubMed' },
    { id: 'arxiv', label: 'arXiv' },
    { id: 'inspire', label: 'INSPIRE-HEP' },
    { id: 'crossref', label: 'CrossRef' },
    { id: 'hal', label: 'HAL' },
    { id: 'datacite', label: 'DataCite' },
    { id: 'core', label: 'CORE' },
  ];

  const sectionFiltered =
    sectionFilter === 'all'
      ? results
      : results.filter((r) => inferScienceSection(r) === sectionFilter);

  const displayedResults =
    sourceFilter === 'all'
      ? sectionFiltered
      : sectionFiltered.filter((r) => r.engine.toLowerCase().includes(sourceFilter));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (activePaper) return;

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
            .querySelector(`[data-paper-index="${next}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : displayedResults.length - 1;
          document
            .querySelector(`[data-paper-index="${next}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return next;
        });
      } else if (e.key === 'r' && focusedIndex >= 0 && displayedResults[focusedIndex]) {
        e.preventDefault();
        setActivePaper(displayedResults[focusedIndex]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [displayedResults, focusedIndex, activePaper]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Search Header */}
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
              placeholder="Search OpenAlex, Semantic Scholar, OpenAIRE, PubMed, arXiv, INSPIRE-HEP..."
              aria-label="Search academic literature"
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
            Search Papers
          </button>
        </form>

        {/* Barless Science Section tabs (pills strictly on active selection) */}
        <div className="flex items-center gap-1.5 mt-4 overflow-x-auto scrollbar-none text-xs">
          {sections.map((sec) => {
            const count =
              sec.id === 'all'
                ? results.length
                : results.filter((r) => inferScienceSection(r) === sec.id).length;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  setSectionOverride({ key: contextKey, value: sec.id });
                  setSourceOverride({ key: contextKey, value: 'all' });
                }}
                className={`rounded-full px-3.5 py-1.5 font-medium transition-all shrink-0 whitespace-nowrap ${
                  sectionFilter === sec.id
                    ? 'pharol-nav-pill text-neutral-950 dark:text-[#f0f4f8]'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
                }`}
              >
                {sec.label} {results.length > 0 ? `(${count})` : ''}
              </button>
            );
          })}
        </div>

        {/* Dynamic Repository source filter links */}
        {results.length > 0 && (
          <div className="flex items-center gap-2 mt-2 overflow-x-auto scrollbar-none text-[11px]">
            {sources.map((src) => {
              const count =
                src.id === 'all'
                  ? sectionFiltered.length
                  : sectionFiltered.filter((r) => r.engine.toLowerCase().includes(src.id)).length;
              if (src.id !== 'all' && count === 0) return null;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => setSourceOverride({ key: contextKey, value: src.id })}
                  className={`rounded-full px-2.5 py-0.5 transition-colors shrink-0 whitespace-nowrap ${
                    sourceFilter === src.id
                      ? 'font-semibold text-[var(--accent-primary)] underline underline-offset-4'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-[#6c7a89] dark:hover:text-[#d8e3ec]'
                  }`}
                >
                  {src.label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Separated Concept Overview / Academic Wiki Card */}
      {!loading && conceptOverview && (
        <section
          aria-label="Background Concept Reference"
          className="relative mb-6 rounded-[20px] pharol-frosted-pane pharol-liquid-iridescent p-5 sm:p-6 text-left"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-900/10 dark:border-white/[0.08] text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Library className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span className="font-semibold text-neutral-900 dark:text-[#f0f4f8]">
                {conceptOverview.source}
              </span>
              {conceptOverview.taxonomy && conceptOverview.taxonomy.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-neutral-400 dark:text-[#6c7a89]">·</span>
                  <span className="truncate text-[11px] text-neutral-500 dark:text-[#9aa7b4]">
                    {conceptOverview.taxonomy.join(' › ')}
                  </span>
                </>
              )}
            </div>
            <span className="font-mono text-[10px] text-neutral-500 dark:text-[#6c7a89] whitespace-nowrap">
              Background Reference · Excluded from Ranking
            </span>
          </div>

          <div className="pt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className={conceptOverview.secondaryReference ? 'lg:col-span-8' : 'lg:col-span-12'}>
              <h2 className="text-lg font-bold tracking-tight text-neutral-950 dark:text-[#f0f4f8]">
                {conceptOverview.title}
              </h2>
              <p className="mt-2 text-xs sm:text-[13px] text-neutral-700 dark:text-[#c4d0dc] leading-relaxed line-clamp-4">
                {conceptOverview.summary}
              </p>

              {conceptOverview.attributes && conceptOverview.attributes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
                  {conceptOverview.attributes.map((attr, idx) => (
                    <span key={idx} className="text-neutral-700 dark:text-[#d2dde7]">
                      <span className="text-neutral-500 dark:text-[#6c7a89]">{attr.label}: </span>
                      <span className="font-semibold">{attr.value}</span>
                    </span>
                  ))}
                </div>
              )}

              {conceptOverview.relatedConcepts && conceptOverview.relatedConcepts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-neutral-500 dark:text-[#6c7a89]">Related:</span>
                  {conceptOverview.relatedConcepts.map((kw, idx) => {
                    const label =
                      typeof kw === 'string'
                        ? kw
                        : kw && typeof kw === 'object' && 'display_name' in (kw as object)
                          ? String((kw as { display_name?: unknown }).display_name || '')
                          : '';
                    if (!label) return null;
                    return (
                      <button
                        key={`${label}-${idx}`}
                        type="button"
                        onClick={() => {
                          onUpdateQuery(label);
                          onSearch(label);
                        }}
                        className="text-neutral-700 hover:text-[var(--accent-primary)] hover:underline dark:text-[#9aa7b4] dark:hover:text-[var(--accent-primary)] transition-colors"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-3.5 flex items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setActivePaper({
                      id: 'concept-overview-entry',
                      title: conceptOverview.title,
                      url: conceptOverview.url,
                      displayedUrl: conceptOverview.source,
                      snippet: conceptOverview.summary,
                      engine: 'wikipedia',
                      category: 'science',
                    })
                  }
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Read Full Concept Entry</span>
                </button>
                <a
                  href={conceptOverview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] hover:underline"
                >
                  <span>Open Reference</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {conceptOverview.secondaryReference && (
              <div className="lg:col-span-4 pharol-aperture p-4 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 dark:text-[#6c7a89]">
                  {conceptOverview.secondaryReference.source}
                </div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-[#f0f4f8] leading-snug">
                  {conceptOverview.secondaryReference.title}
                </div>
                {conceptOverview.secondaryReference.snippet && (
                  <p className="text-[11px] text-neutral-600 dark:text-[#b4c1ce] leading-relaxed line-clamp-3">
                    {conceptOverview.secondaryReference.snippet}
                  </p>
                )}
                <div className="pt-1 flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setActivePaper({
                        id: 'concept-sep-entry',
                        title: conceptOverview.secondaryReference!.title,
                        url: conceptOverview.secondaryReference!.url,
                        displayedUrl: 'plato.stanford.edu',
                        snippet: conceptOverview.secondaryReference!.snippet || '',
                        engine: 'sep',
                        category: 'science',
                      })
                    }
                    className="font-medium hover:underline"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    Read Preview
                  </button>
                  <a
                    href={conceptOverview.secondaryReference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] hover:underline"
                  >
                    <span>SEP Entry</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="rounded-[20px] pharol-frosted-pane p-5 sm:p-7 space-y-6">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="space-y-2.5 animate-pulse">
              <div className="h-4 w-1/2 rounded bg-neutral-900/15 dark:bg-white/[0.12]" />
              <div className="h-3.5 w-full rounded bg-neutral-900/10 dark:bg-white/[0.07]" />
              <div className="h-3.5 w-4/5 rounded bg-neutral-900/10 dark:bg-white/[0.07]" />
            </div>
          ))}
        </div>
      ) : displayedResults.length > 0 ? (
        <>
          <OpticalFrostPane as="main" ariaLabel="Academic Results" className="p-5 sm:p-7">
            <UnifiedAnswerBox
              answer={unifiedAnswer}
              loading={answerLoading}
              onRegenerate={onRegenerateAnswer}
              onCiteClick={(url) => {
                const match = results.find((r) => r.url === url);
                if (match) setActivePaper(match);
              }}
              onPreviewCitation={(cite) =>
                setActivePaper({
                  id: `cite-${cite.url}`,
                  title: cite.title,
                  url: cite.url,
                  displayedUrl: cite.domain,
                  snippet: '',
                  engine: 'science',
                  category: 'science',
                })
              }
            />

            <div className="space-y-1.5">
              {displayedResults.map((paper, idx) => {
                const sec = inferScienceSection(paper);
                return (
                  <article
                    key={paper.id}
                    data-paper-index={idx}
                    data-focused={focusedIndex === idx ? 'true' : undefined}
                    onClick={() => setFocusedIndex(idx)}
                    className={`group pharol-row-hover -mx-3 px-3.5 py-4 text-left ${
                      focusedIndex === idx
                        ? 'bg-[#38a3b8]/10 ring-1 ring-[#38a3b8]/30'
                        : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-[#6c7a89] mb-1.5">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span className="font-semibold text-neutral-700 dark:text-[#9aa7b4]">
                          {paper.engine}
                        </span>
                        {sec !== 'papers' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span
                              className="uppercase tracking-wide text-[10px]"
                              style={{ color: 'var(--accent-signal)' }}
                            >
                              {sec === 'preprints' ? 'Preprint' : 'Dataset'}
                            </span>
                          </>
                        )}
                        {paper.publishedDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{paper.publishedDate}</span>
                          </>
                        )}
                        {paper.doi && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>DOI: {paper.doi}</span>
                          </>
                        )}
                      </div>
                      {paper.citations !== undefined && (
                        <span className="text-[11px] font-mono tabular-nums text-neutral-500 dark:text-[#9aa7b4]">
                          {paper.citations.toLocaleString()} citations
                        </span>
                      )}
                    </div>

                    <h3 className="text-[16.5px] font-semibold text-neutral-950 dark:text-[#f0f4f8] leading-snug">
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[var(--accent-primary)] transition-colors"
                      >
                        {paper.title}
                      </a>
                    </h3>

                    {Boolean(paper.authors?.length || paper.journal) && (
                      <div className="mt-1 text-xs text-neutral-500 dark:text-[#9aa7b4]">
                        {paper.authors && paper.authors.length > 0 && (
                          <span>{paper.authors.join(', ')}</span>
                        )}
                        {Boolean(paper.authors?.length) && Boolean(paper.journal) && (
                          <span aria-hidden="true"> · </span>
                        )}
                        {paper.journal && <span className="italic font-serif">{paper.journal}</span>}
                      </div>
                    )}

                    {paper.tldr && (
                      <div className="mt-2.5 pharol-aperture px-3.5 py-2.5 text-xs text-neutral-800 dark:text-[#d8e3ec] flex items-start gap-2">
                        <Sparkles
                          className="h-3.5 w-3.5 shrink-0 mt-0.5"
                          style={{ color: 'var(--accent-signal)' }}
                        />
                        <span>
                          <strong className="font-semibold">TL;DR:</strong> {paper.tldr}
                        </span>
                      </div>
                    )}

                    <p className="mt-2 text-sm text-neutral-600 dark:text-[#b4c1ce] leading-relaxed line-clamp-3">
                      {paper.snippet}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-[#9aa7b4]">
                      <button
                        onClick={() => setActivePaper(paper)}
                        className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:text-[var(--accent-primary)] dark:text-[#d8e3ec] dark:hover:text-[var(--accent-primary)]"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>Read Preview</span>
                      </button>

                      {paper.pdfUrl && (
                        <a
                          href={paper.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                          style={{ color: 'var(--accent-primary)' }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>PDF</span>
                        </a>
                      )}

                      <button
                        onClick={() => handleCopyCitation(paper)}
                        className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-[#f0f4f8]"
                      >
                        {copiedId === paper.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                            <span style={{ color: 'var(--accent-primary)' }} className="font-medium">
                              Copied
                            </span>
                          </>
                        ) : (
                          <>
                            <Quote className="h-3.5 w-3.5" />
                            <span>Cite</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => onToggleBookmark(paper)}
                        className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-[#f0f4f8] ${
                          isBookmarked(paper.url) ? 'font-medium text-[var(--accent-signal)]' : ''
                        }`}
                      >
                        <Bookmark
                          className={`h-3.5 w-3.5 ${isBookmarked(paper.url) ? 'fill-current' : ''}`}
                        />
                        <span>{isBookmarked(paper.url) ? 'Saved' : 'Save'}</span>
                      </button>

                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-[11px] hover:underline hover:text-neutral-900 dark:hover:text-[#f0f4f8]"
                      >
                        <span>Publisher</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </OpticalFrostPane>

          {hasMore && (
            <div className="pt-6 pb-2 flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full pharol-glass-chip px-5 py-2.5 text-xs font-medium text-neutral-800 disabled:opacity-60 dark:text-neutral-100"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                <span>{loadingMore ? 'Loading more papers...' : 'Load More Papers'}</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-3xl pharol-liquid-glass p-12 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No scholarly papers found in this filter. Try switching to All Scholarly Works or refining your query.
        </div>
      )}

      {activePaper && (
        <ReaderModeModal
          url={activePaper.url}
          initialTitle={activePaper.title}
          initialSnippet={activePaper.snippet}
          onClose={() => setActivePaper(null)}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
        />
      )}
    </div>
  );
}
