'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, X, Globe, FileText, Search, Clock, Zap } from 'lucide-react';
import { BANG_SHORTCUTS } from '@/lib/search-engine';
import { EngineHealth, TimeRange } from '@/lib/search-types';

interface AdvancedSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onUpdateQuery: (newQuery: string) => void;
  onApplyAndSearch: () => void;
  activeEngines: string[];
  onToggleEngine: (engine: string) => void;
  timeRange: TimeRange;
  onChangeTimeRange: (range: TimeRange) => void;
  engineHealth?: EngineHealth[];
}

export function AdvancedSearchPanel({
  isOpen,
  onClose,
  query,
  onUpdateQuery,
  onApplyAndSearch,
  activeEngines,
  onToggleEngine,
  timeRange,
  onChangeTimeRange,
  engineHealth = [],
}: AdvancedSearchPanelProps) {
  const [customSite, setCustomSite] = useState('');
  const [excludeTerm, setExcludeTerm] = useState('');

  if (!isOpen) return null;

  const insertBangIntoSearchBar = (bangToken: string) => {
    const stripped = query
      .replace(/(?:^|\s)![a-zA-Z0-9]+(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const alreadyActive = new RegExp(`(?:^|\\s)${bangToken}(?=\\s|$)`, 'i').test(query);
    if (alreadyActive) {
      onUpdateQuery(stripped);
    } else {
      onUpdateQuery(stripped ? `${stripped} ${bangToken}` : `${bangToken} `);
    }
  };

  const appendSyntax = (syntax: string) => {
    let clean = query.trim();
    if (clean.includes(syntax)) {
      clean = clean.replace(syntax, '').replace(/\s+/g, ' ').trim();
    } else {
      clean = clean ? `${clean} ${syntax}` : syntax;
    }
    onUpdateQuery(clean);
  };

  const setSiteFilter = (domain: string) => {
    const clean = query.replace(/\bsite:[^\s]+/gi, '').replace(/\s+/g, ' ').trim();
    if (!domain) {
      onUpdateQuery(clean);
    } else {
      onUpdateQuery(clean ? `${clean} site:${domain}` : `site:${domain}`);
    }
  };

  const setFiletypeFilter = (ext: string) => {
    const clean = query.replace(/\b(?:filetype|ext):[^\s]+/gi, '').replace(/\s+/g, ' ').trim();
    if (!ext) {
      onUpdateQuery(clean);
    } else {
      onUpdateQuery(clean ? `${clean} filetype:${ext}` : `filetype:${ext}`);
    }
  };

  const addExclusion = (term: string) => {
    if (!term.trim()) return;
    const cleanTerm = term.trim().replace(/^-/, '');
    const op = `-${cleanTerm}`;
    if (!query.includes(op)) {
      const clean = query.trim() ? `${query.trim()} ${op}` : op;
      onUpdateQuery(clean);
    }
    setExcludeTerm('');
  };

  const addExactQuotes = () => {
    if (query.trim() && !query.includes('"')) {
      onUpdateQuery(`"${query.trim()}"`);
    }
  };

  const coreEngines = [
    { id: 'serper', label: 'Serper (Google)' },
    { id: 'brave', label: 'Brave Search' },
    { id: 'google', label: 'Google' },
    { id: 'duckduckgo', label: 'DuckDuckGo' },
    { id: 'bing', label: 'Bing Web' },
    { id: 'wikipedia', label: 'Wikipedia' },
    { id: 'marginalia', label: 'Marginalia' },
  ];

  const devEngines = [
    { id: 'github', label: 'GitHub' },
    { id: 'exa-code', label: 'Exa Code' },
    { id: 'context7', label: 'Context7' },
    { id: 'deepwiki', label: 'DeepWiki' },
    { id: 'gitmcp', label: 'GitMCP' },
    { id: 'mdn', label: 'MDN Docs' },
    { id: 'npm', label: 'npm' },
    { id: 'crates', label: 'Crates.io' },
    { id: 'pypi', label: 'PyPI' },
    { id: 'stackoverflow', label: 'Stack Overflow' },
    { id: 'hackernews', label: 'Hacker News' },
  ];

  const scienceEngines = [
    { id: 'openalex', label: 'OpenAlex' },
    { id: 'semanticscholar', label: 'Semantic Scholar' },
    { id: 'openaire', label: 'OpenAIRE' },
    { id: 'europepmc', label: 'Europe PMC' },
    { id: 'pubmed', label: 'PubMed' },
    { id: 'arxiv', label: 'arXiv' },
    { id: 'inspire', label: 'INSPIRE-HEP' },
    { id: 'crossref', label: 'CrossRef' },
    { id: 'hal', label: 'HAL Archive' },
    { id: 'datacite', label: 'DataCite' },
  ];

  const keylessAiEngines = [
    { id: 'exa', label: 'Exa MCP' },
    { id: 'parallel', label: 'Parallel MCP' },
    { id: 'tavily', label: 'Tavily Keyless' },
    { id: 'firecrawl', label: 'Firecrawl Keyless' },
    { id: 'freeserp', label: 'FreeSerp' },
    { id: 'keenable', label: 'Keenable' },
    { id: 'tinyfish', label: 'TinyFish Keyless' },
  ];

  const timeRanges: Array<{ id: TimeRange; label: string }> = [
    { id: 'all', label: 'Any time' },
    { id: 'day', label: '24h' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ];

  const quickSites = ['wikipedia.org', 'github.com', 'arxiv.org', 'news.ycombinator.com', 'gov', 'edu'];
  const filetypes = ['pdf', 'doc', 'txt', 'csv', 'epub'];

  const healthById = new Map(engineHealth.map((h) => [h.engine.toLowerCase(), h]));

  const renderEngineButton = (eng: { id: string; label: string }) => {
    const active = activeEngines.includes(eng.id);
    const health = healthById.get(eng.id);
    const statusText = !active
      ? 'OFF'
      : health
      ? health.status === 'ok'
        ? `${health.count} hits`
        : health.status === 'cooldown'
        ? 'cooldown'
        : health.status === 'timeout'
        ? 'timeout'
        : health.status === 'error'
        ? 'error'
        : '0 hits'
      : 'ON';

    return (
      <button
        key={eng.id}
        type="button"
        onClick={() => onToggleEngine(eng.id)}
        title={
          health
            ? `${eng.label}: ${health.status} (${health.count} hits in ${health.durationMs}ms)`
            : `Toggle ${eng.label}`
        }
        className={`flex items-center justify-between gap-1.5 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
          active
            ? 'pharol-glass-chip font-medium text-neutral-950 dark:text-white ring-1 ring-white/30'
            : 'pharol-glass-inset text-neutral-500 dark:text-neutral-400 opacity-75'
        }`}
      >
        <span className="truncate">{eng.label}</span>
        <span
          className={`text-[10px] font-mono tabular-nums shrink-0 ${
            health &&
            active &&
            (health.status === 'timeout' ||
              health.status === 'error' ||
              health.status === 'cooldown')
              ? 'text-amber-600 dark:text-amber-400'
              : health && active && health.status === 'ok'
              ? 'text-emerald-700 dark:text-emerald-400'
              : ''
          }`}
        >
          {statusText}
        </span>
      </button>
    );
  };

  return (
    <div className="relative rounded-[20px] pharol-frosted-pane pharol-liquid-iridescent p-5 sm:p-6 transition-all mb-6">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-900/10 dark:border-white/[0.08]">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
          <h2 className="text-xs font-semibold text-neutral-900 dark:text-[#f0f4f8]">
            Search Syntax, !Bangs &amp; Upstream Engines
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-neutral-500 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] transition-colors"
          aria-label="Close advanced search panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Clickable !Bang Shortcuts (inserts directly into the visible search bar) */}
      <div className="pt-4 pb-4 border-b border-neutral-900/10 dark:border-white/[0.08] text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="font-medium text-neutral-900 dark:text-[#d8e3ec] flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" style={{ color: 'var(--accent-signal)' }} />
            <span>!Bang Quick Targets</span>
          </div>
          <span className="text-[11px] text-neutral-500 dark:text-[#6c7a89]">
            Click to insert or remove from query
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BANG_SHORTCUTS.map((b) => {
            const active = new RegExp(`(?:^|\\s)${b.bang}(?=\\s|$)`, 'i').test(query);
            return (
              <button
                key={b.bang}
                type="button"
                onClick={() => insertBangIntoSearchBar(b.bang)}
                title={b.description}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all ${
                  active
                    ? 'pharol-nav-pill font-medium text-neutral-950 dark:text-[#f0f4f8]'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] hover:bg-neutral-900/5 dark:hover:bg-[#d8eaf4]/[0.05]'
                }`}
              >
                <span className="font-mono font-semibold" style={active ? { color: 'var(--accent-primary)' } : undefined}>{b.bang}</span>
                <span className="text-[11px] opacity-75">{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 text-xs">
        {/* Column 1: Domain & Time Range */}
        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="font-medium text-neutral-900 dark:text-neutral-200 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-neutral-500" />
              <span>Domain Filter (site:)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickSites.map((site) => {
                const active = query.includes(`site:${site}`);
                return (
                  <button
                    key={site}
                    type="button"
                    onClick={() => setSiteFilter(active ? '' : site)}
                    className={`rounded-full px-3 py-1 text-xs font-mono transition-colors ${
                      active
                        ? 'pharol-liquid-btn font-medium'
                        : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                    }`}
                  >
                    site:{site}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Custom domain (e.g. bbc.com)"
                value={customSite}
                onChange={(e) => setCustomSite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (customSite) {
                      setSiteFilter(customSite.trim());
                      setCustomSite('');
                    }
                  }
                }}
                className="flex-1 rounded-full pharol-glass-inset px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-white/40"
              />
              <button
                type="button"
                onClick={() => {
                  if (customSite) {
                    setSiteFilter(customSite.trim());
                    setCustomSite('');
                  }
                }}
                className="rounded-full pharol-glass-chip px-3.5 py-1.5 font-medium text-neutral-800 dark:text-neutral-100"
              >
                Set
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-neutral-900 dark:text-neutral-200 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-neutral-500" />
              <span>Freshness / Time Range</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {timeRanges.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => onChangeTimeRange(tr.id)}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    timeRange === tr.id
                      ? 'pharol-liquid-btn font-medium'
                      : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                  }`}
                >
                  {tr.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Column 2: Filetypes & Match Operators */}
        <div className="space-y-3">
          <div className="font-medium text-neutral-900 dark:text-neutral-200 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-neutral-500" />
            <span>Filetypes &amp; Match Operators</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {filetypes.map((ext) => {
              const active = query.includes(`filetype:${ext}`);
              return (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setFiletypeFilter(active ? '' : ext)}
                  className={`rounded-full px-3 py-1 text-xs font-mono transition-colors ${
                    active
                      ? 'pharol-liquid-btn font-medium'
                      : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                  }`}
                >
                  filetype:{ext}
                </button>
              );
            })}
          </div>

          <div className="pt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addExactQuotes}
              className="rounded-full pharol-glass-chip px-3 py-1 text-xs text-neutral-700 dark:text-neutral-200"
            >
              Exact Match (&quot;phrase&quot;)
            </button>
            <button
              type="button"
              onClick={() => appendSyntax('intitle:')}
              className="rounded-full pharol-glass-chip px-3 py-1 text-xs font-mono text-neutral-700 dark:text-neutral-200"
            >
              intitle:
            </button>
          </div>

          <div className="flex gap-1.5 pt-1">
            <input
              type="text"
              placeholder="Exclude term (e.g. ads)"
              value={excludeTerm}
              onChange={(e) => setExcludeTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addExclusion(excludeTerm);
                }
              }}
              className="flex-1 rounded-full pharol-glass-inset px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
            <button
              type="button"
              onClick={() => addExclusion(excludeTerm)}
              className="rounded-full pharol-glass-chip px-3.5 py-1.5 font-medium text-neutral-800 dark:text-neutral-100"
            >
              Exclude
            </button>
          </div>
        </div>

        {/* Column 3: Upstream Sources + Live Engine Health */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium text-neutral-900 dark:text-neutral-200 flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-neutral-500" />
              <span>Upstream Sources</span>
            </div>
            <span className="text-[10px] text-neutral-400">Saved locally</span>
          </div>

          <div className="space-y-3 max-h-[280px] overflow-y-auto pharol-scroll pr-1">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 mb-1.5">
                Core Web &amp; Reference
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {coreEngines.map(renderEngineButton)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 mb-1.5">
                Developer, Docs &amp; Packages
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {devEngines.map(renderEngineButton)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 mb-1.5">
                Academic &amp; Data Repositories
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {scienceEngines.map(renderEngineButton)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 mb-1.5">
                Keyless AI &amp; MCP Endpoints
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {keylessAiEngines.map(renderEngineButton)}
              </div>
            </div>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={onApplyAndSearch}
              className="w-full flex items-center justify-center gap-2 rounded-full pharol-liquid-btn py-2 text-xs font-medium"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Apply Filters &amp; Search</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
