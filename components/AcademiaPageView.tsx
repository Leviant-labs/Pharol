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
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400">
              <Search className="h-4 w-4" />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => onUpdateQuery(e.target.value)}
              placeholder="Search OpenAlex, Semantic Scholar, OpenAIRE, PubMed, arXiv, INSPIRE-HEP, DataCite..."
              aria-label="Search academic literature"
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
            Search Papers
          </button>
        </form>

        {/* Science Section tabs */}
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
                className={`rounded-full px-3.5 py-1.5 font-medium transition-colors shrink-0 whitespace-nowrap ${
                  sectionFilter === sec.id
                    ? 'pharol-liquid-btn'
                    : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                }`}
              >
                {sec.label} {results.length > 0 ? `(${count})` : ''}
              </button>
            );
          })}
        </div>

        {/* Dynamic Repository source filter chips */}
        {results.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto scrollbar-none text-[11px]">
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
                  className={`rounded-full px-3 py-1 transition-colors shrink-0 whitespace-nowrap ${
                    sourceFilter === src.id
                      ? 'pharol-glass-chip font-semibold text-neutral-950 dark:text-white ring-1 ring-neutral-900/20 dark:ring-white/35'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                >
                  {src.label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Separated Concept Overview / Academic Wiki Card (explicitly isolated from paper rankings) */}
      {!loading && conceptOverview && (
        <section
          aria-label="Background Concept Reference"
          className="relative mb-6 rounded-3xl pharol-liquid-glass pharol-liquid-iridescent p-5 sm:p-6 text-left"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-900/10 dark:border-white/12 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Library className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="font-semibold text-neutral-900 dark:text-white">
                {conceptOverview.source}
              </span>
              {conceptOverview.taxonomy && conceptOverview.taxonomy.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-neutral-400">·</span>
                  <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {conceptOverview.taxonomy.join(' › ')}
                  </span>
                </>
              )}
            </div>
            <span className="rounded-full pharol-glass-chip px-2.5 py-0.5 text-[10px] font-mono text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
              Background Concept Reference · Excluded from Paper Ranking
            </span>
          </div>

          <div className="pt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className={conceptOverview.secondaryReference ? 'lg:col-span-8' : 'lg:col-span-12'}>
              <h2 className="text-lg font-bold tracking-tight text-neutral-950 dark:text-white">
                {conceptOverview.title}
              </h2>
              <p className="mt-2 text-xs sm:text-[13px] text-neutral-700 dark:text-neutral-200 leading-relaxed line-clamp-4">
                {conceptOverview.summary}
              </p>

              {conceptOverview.attributes && conceptOverview.attributes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {conceptOverview.attributes.map((attr, idx) => (
                    <span
                      key={idx}
                      className="rounded-full pharol-glass-inset px-2.5 py-0.5 text-neutral-700 dark:text-neutral-200 font-mono"
                    >
                      <span className="text-neutral-500 dark:text-neutral-400">{attr.label}: </span>
                      <span className="font-semibold">{attr.value}</span>
                    </span>
                  ))}
                </div>
              )}

              {conceptOverview.relatedConcepts && conceptOverview.relatedConcepts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-neutral-500 dark:text-neutral-400 mr-1">Related topics:</span>
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
                        className="rounded-full pharol-glass-chip px-2.5 py-0.5 text-neutral-700 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white transition-colors"
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
                  className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Read Full Concept Entry</span>
                </button>
                <a
                  href={conceptOverview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:underline"
                >
                  <span>Open Reference</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {conceptOverview.secondaryReference && (
              <div className="lg:col-span-4 rounded-2xl pharol-glass-inset p-4 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  {conceptOverview.secondaryReference.source}
                </div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-white leading-snug">
                  {conceptOverview.secondaryReference.title}
                </div>
                {conceptOverview.secondaryReference.snippet && (
                  <p className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-3">
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
                    className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    Read Preview
                  </button>
                  <a
                    href={conceptOverview.secondaryReference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:underline"
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

      {!loading && results.length > 0 && (
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
      )}

      {loading ? (
        <div className="rounded-3xl pharol-liquid-glass px-5 sm:px-6 py-2 divide-y divide-neutral-900/10 dark:divide-white/12">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="py-5 space-y-2.5 animate-pulse">
              <div className="h-4 w-1/2 rounded bg-neutral-900/15 dark:bg-white/15" />
              <div className="h-3.5 w-full rounded bg-neutral-900/10 dark:bg-white/10" />
              <div className="h-3.5 w-4/5 rounded bg-neutral-900/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
      ) : displayedResults.length > 0 ? (
        <>
          <main aria-label="Academic Results" className="rounded-3xl pharol-liquid-glass px-5 sm:px-6 py-2 divide-y divide-neutral-900/10 dark:divide-white/12">
            {displayedResults.map((paper, idx) => {
              const sec = inferScienceSection(paper);
              return (
                <article
                  key={paper.id}
                  data-paper-index={idx}
                  onClick={() => setFocusedIndex(idx)}
                  className={`py-5 text-left transition-colors ${
                    focusedIndex === idx
                      ? 'bg-white/50 dark:bg-white/10 -mx-3 px-3 rounded-2xl ring-1 ring-neutral-900/15 dark:ring-white/25'
                      : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                        {paper.engine}
                      </span>
                      {sec !== 'papers' && (
                        <span className="rounded-full pharol-glass-inset px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
                          {sec === 'preprints' ? 'Preprint' : 'Dataset'}
                        </span>
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
                      <span className="text-[11px] font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                        {paper.citations.toLocaleString()} citations
                      </span>
                    )}
                  </div>

                  <h3 className="text-[17px] font-semibold text-neutral-950 dark:text-white leading-snug">
                    <a
                      href={paper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {paper.title}
                    </a>
                  </h3>

                  {Boolean(paper.authors?.length || paper.journal) && (
                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
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
                    <div className="mt-2 rounded-2xl pharol-glass-inset px-3.5 py-2 text-xs text-neutral-800 dark:text-neutral-200 flex items-start gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong className="font-semibold">TL;DR:</strong> {paper.tldr}
                      </span>
                    </div>
                  )}

                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-3">
                    {paper.snippet}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                    <button
                      onClick={() => setActivePaper(paper)}
                      className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>Read Preview</span>
                    </button>

                    {paper.pdfUrl && (
                      <a
                        href={paper.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>PDF</span>
                      </a>
                    )}

                    <button
                      onClick={() => handleCopyCitation(paper)}
                      className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white"
                    >
                      {copiedId === paper.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
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
                      className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white ${
                        isBookmarked(paper.url) ? 'font-medium text-neutral-950 dark:text-white' : ''
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
                      className="ml-auto inline-flex items-center gap-1 text-[11px] hover:underline hover:text-neutral-900 dark:hover:text-white"
                    >
                      <span>Publisher</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </article>
              );
            })}
          </main>

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
