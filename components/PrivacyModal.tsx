'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Trash2,
  X,
  Check,
  Lock,
  Terminal,
  Copy,
  Globe,
  Play,
  KeyRound,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';
import { clearAllLocalData, clearAllLocalHistory } from '@/lib/local-storage';
import { ColorTheme, UserProviderConfig } from '@/lib/search-types';
import { sanitizeTrustedBaseUrl } from '@/lib/search-engine';
import { SEARX_MCP_TOOLS } from '@/lib/mcp-tools';

type ModalTab = 'privacy' | 'keys' | 'mcp';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ModalTab;
  historyCount: number;
  bookmarksCount: number;
  onDataCleared: () => void;
  colorTheme: ColorTheme;
  onChangeColorTheme: (theme: ColorTheme) => void;
  userProviderConfig: UserProviderConfig;
  onUpdateUserProviderConfig: (next: UserProviderConfig) => void;
}

interface CapabilitiesPayload {
  envKeysActive: Record<string, boolean>;
  mcpEndpoint: string;
  openSearchUrl: string;
  searchTemplate: string;
}

function ProviderKeysForm({
  initialConfig,
  onSave,
}: {
  initialConfig: UserProviderConfig;
  onSave: (next: UserProviderConfig) => void;
}) {
  const [draft, setDraft] = useState<UserProviderConfig>(initialConfig);
  const [showSecrets, setShowSecrets] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const keyFields: Array<{
    field: keyof Omit<UserProviderConfig, 'openDeepWikiUrl'>;
    label: string;
    hint: string;
    placeholder: string;
  }> = [
    {
      field: 'context7ApiKey',
      label: 'Context7 API Key',
      hint: 'Keyless baseline active · optional key raises rate limits',
      placeholder: 'ctx7sk_...',
    },
    {
      field: 'semanticScholarApiKey',
      label: 'Semantic Scholar Key',
      hint: 'Unlocks higher quota & avoids shared-IP 429 throttling',
      placeholder: 'x-api-key...',
    },
    {
      field: 'coreApiKey',
      label: 'CORE v3 Academic Key',
      hint: 'Enables CORE open-access repository full-text search',
      placeholder: 'CORE API key...',
    },
    {
      field: 'openAlexApiKey',
      label: 'OpenAlex API Key',
      hint: 'Optional higher throughput key for OpenAlex works & topics',
      placeholder: 'OpenAlex key...',
    },
    {
      field: 'githubToken',
      label: 'GitHub Personal Token',
      hint: 'Raises GitHub repo search limits above unauthenticated quota',
      placeholder: 'ghp_... or github_pat_...',
    },
    {
      field: 'exaApiKey',
      label: 'Exa API Key',
      hint: 'Optional override for Exa Web & Exa Code Context MCP',
      placeholder: 'exa_...',
    },
    {
      field: 'firecrawlApiKey',
      label: 'Firecrawl API Key',
      hint: 'Optional override for Firecrawl developer & web search',
      placeholder: 'fc-...',
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedMsg(null);

    const rawWiki = draft.openDeepWikiUrl?.trim();
    if (rawWiki) {
      const sanitized = sanitizeTrustedBaseUrl(rawWiki);
      if (!sanitized) {
        setErrorMsg(
          'Trusted OpenDeepWiki URL must use https:// (or http://localhost / *.local) with no embedded credentials.'
        );
        return;
      }
      const next = { ...draft, openDeepWikiUrl: sanitized };
      setDraft(next);
      onSave(next);
    } else {
      const next = { ...draft, openDeepWikiUrl: undefined };
      onSave(next);
    }
    setSavedMsg('Saved strictly in your browser localStorage.');
    setTimeout(() => setSavedMsg(null), 2600);
  };

  const handleClearKeys = () => {
    setDraft({});
    setErrorMsg(null);
    onSave({});
    setSavedMsg('Cleared all optional keys and custom hosts.');
    setTimeout(() => setSavedMsg(null), 2400);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl pharol-glass-inset p-3.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <span className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-300" />
            <span>BYO Keys &amp; Trusted Self-Hosted Endpoints</span>
          </span>
          <button
            type="button"
            onClick={() => setShowSecrets(!showSecrets)}
            className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-2.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:text-neutral-200"
          >
            {showSecrets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            <span>{showSecrets ? 'Hide' : 'Reveal'}</span>
          </button>
        </div>
        <p className="leading-relaxed text-[11px] text-neutral-600 dark:text-neutral-300">
          All search engines work keyless by default. Optional keys stay strictly in browser{' '}
          <code className="font-mono text-[10px] bg-neutral-900/10 dark:bg-white/10 px-1 py-0.5 rounded">
            localStorage
          </code>{' '}
          and pass per-request via private HTTP headers (never in URLs or server storage).
        </p>
      </div>

      {/* Trusted Self-Hosted OpenDeepWiki URL */}
      <div className="rounded-2xl pharol-glass-inset p-3.5 space-y-2 border border-amber-500/20">
        <label
          htmlFor="opendeepwiki-url-input"
          className="block font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Self-Hosted OpenDeepWiki Base URL (Optional)
        </label>
        <input
          id="opendeepwiki-url-input"
          type="url"
          value={draft.openDeepWikiUrl || ''}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, openDeepWikiUrl: e.target.value }))
          }
          placeholder="https://opendeepwiki.internal.example (disabled by default)"
          className="w-full rounded-full pharol-glass-inset px-3.5 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-white/40"
        />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Pharol never sends queries to public third-party OpenDeepWiki mirrors. Leave blank unless you operate your own trusted instance.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {keyFields.map((item) => (
          <div key={item.field} className="rounded-2xl pharol-glass-inset p-3 space-y-1">
            <label
              htmlFor={`key-${item.field}`}
              className="block font-medium text-neutral-900 dark:text-neutral-100"
            >
              {item.label}
            </label>
            <input
              id={`key-${item.field}`}
              type={showSecrets ? 'text' : 'password'}
              autoComplete="off"
              value={draft[item.field] || ''}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [item.field]: e.target.value }))
              }
              placeholder={item.placeholder}
              className="w-full rounded-full pharol-glass-inset px-3 py-1.5 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-snug">
              {item.hint}
            </div>
          </div>
        ))}
      </div>

      {errorMsg && (
        <div className="rounded-2xl pharol-glass-inset border border-amber-500/40 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
          {errorMsg}
        </div>
      )}

      {savedMsg && (
        <div className="flex items-center gap-1.5 rounded-2xl pharol-glass-inset p-2.5 text-xs font-medium text-neutral-900 dark:text-neutral-100">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>{savedMsg}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="flex-1 rounded-full pharol-liquid-btn py-2 text-xs font-medium"
        >
          Save Local Keys &amp; Hosts
        </button>
        <button
          type="button"
          onClick={handleClearKeys}
          className="rounded-full pharol-glass-chip px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200"
        >
          Clear All
        </button>
      </div>
    </form>
  );
}

export function PrivacyModal({
  isOpen,
  onClose,
  initialTab = 'privacy',
  historyCount,
  bookmarksCount,
  onDataCleared,
  colorTheme,
  onChangeColorTheme,
  userProviderConfig,
  onUpdateUserProviderConfig,
}: PrivacyModalProps) {
  const [tabOverride, setTabOverride] = useState<{
    forInitial: ModalTab;
    tab: ModalTab;
  } | null>(null);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesPayload | null>(null);
  const [mcpTestState, setMcpTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [mcpTestMsg, setMcpTestMsg] = useState<string>('');

  const activeTab =
    tabOverride && tabOverride.forInitial === initialTab ? tabOverride.tab : initialTab;

  const setActiveTab = (tab: ModalTab) => {
    setTabOverride({ forInitial: initialTab, tab });
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetch('/api/capabilities')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setCapabilities(data);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setTabOverride(null);
    onClose();
  };

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleClearHistory = () => {
    clearAllLocalHistory();
    onDataCleared();
    setClearedMsg('Browser search history cleared.');
    setTimeout(() => setClearedMsg(null), 2500);
  };

  const handlePurgeAll = () => {
    clearAllLocalData();
    onDataCleared();
    setClearedMsg('All browser data purged completely.');
    setTimeout(() => setClearedMsg(null), 2500);
  };

  const handleTestMcp = async () => {
    setMcpTestState('testing');
    setMcpTestMsg('');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const count = Array.isArray(json?.result?.tools) ? json.result.tools.length : 0;
      const ms = Math.round(performance.now() - t0);
      setMcpTestState('ok');
      setMcpTestMsg(`Connected (${count} MCP tools ready in ${ms}ms)`);
    } catch {
      setMcpTestState('error');
      setMcpTestMsg('Unable to reach /api/mcp');
    }
  };

  const tones: Array<{ id: ColorTheme; label: string }> = [
    { id: 'slate', label: 'Neutral Slate' },
    { id: 'blue', label: 'Deep Cobalt' },
    { id: 'green', label: 'Forest Sage' },
  ];

  const localhostSearchUrl = 'http://localhost:3000/?q=%s';
  const currentSearchUrl = `${origin}/?q=%s`;
  const mcpUrl = `${origin}/api/mcp`;
  const mcpConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        pharol: {
          type: 'http',
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );

  const envProviders = [
    { id: 'context7', label: 'Context7', varName: 'CONTEXT7_API_KEY' },
    { id: 'semanticscholar', label: 'Semantic Scholar', varName: 'SEMANTIC_SCHOLAR_API_KEY' },
    { id: 'core', label: 'CORE v3', varName: 'CORE_API_KEY' },
    { id: 'openalex', label: 'OpenAlex', varName: 'OPENALEX_API_KEY' },
    { id: 'github', label: 'GitHub', varName: 'GITHUB_TOKEN' },
    { id: 'exa', label: 'Exa', varName: 'EXA_API_KEY' },
    { id: 'parallel', label: 'Parallel', varName: 'PARALLEL_API_KEY' },
    { id: 'tavily', label: 'Tavily', varName: 'TAVILY_API_KEY' },
    { id: 'firecrawl', label: 'Firecrawl', varName: 'FIRECRAWL_API_KEY' },
    { id: 'keenable', label: 'Keenable', varName: 'KEENABLE_API_KEY' },
    { id: 'tinyfish', label: 'TinyFish', varName: 'TINYFISH_API_KEY' },
  ];

  const configuredKeysCount = Object.values(userProviderConfig).filter(
    (v) => typeof v === 'string' && v.trim().length > 0
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 dark:bg-black/75 backdrop-blur-xl p-4"
    >
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl pharol-reader-glass pharol-liquid-iridescent text-left overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-neutral-900/10 dark:border-white/15">
          <div className="flex items-center gap-2">
            {activeTab === 'privacy' ? (
              <ShieldCheck className="h-4 w-4 text-neutral-700 dark:text-neutral-300" />
            ) : activeTab === 'keys' ? (
              <KeyRound className="h-4 w-4 text-neutral-700 dark:text-neutral-300" />
            ) : (
              <Terminal className="h-4 w-4 text-neutral-700 dark:text-neutral-300" />
            )}
            <h2 id="privacy-dialog-title" className="text-sm font-semibold text-neutral-950 dark:text-white">
              {activeTab === 'privacy'
                ? 'Local Privacy & Preferences'
                : activeTab === 'keys'
                ? 'BYO Keys & Custom Hosts'
                : 'MCP Server & Desktop Search'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full pharol-glass-chip p-1.5 text-neutral-600 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switch Tabs */}
        <div className="px-6 pt-3 pb-1 flex items-center gap-4 border-b border-neutral-900/10 dark:border-white/15 text-xs overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`pb-2 px-1 font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'privacy'
                ? 'border-neutral-950 text-neutral-950 dark:border-white dark:text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            Privacy &amp; Local
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={`pb-2 px-1 font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'keys'
                ? 'border-neutral-950 text-neutral-950 dark:border-white dark:text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            Keys &amp; Hosts {configuredKeysCount > 0 ? `(${configuredKeysCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mcp')}
            className={`pb-2 px-1 font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'mcp'
                ? 'border-neutral-950 text-neutral-950 dark:border-white dark:text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            MCP &amp; Browser Search
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-xs text-neutral-600 dark:text-neutral-300">
          {activeTab === 'privacy' ? (
            <>
              <div className="rounded-2xl pharol-glass-inset p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
                  <Lock className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-300" />
                  <span>Stateless Zero-Telemetry Search</span>
                </div>
                <p className="leading-relaxed text-neutral-600 dark:text-neutral-300">
                  No remote accounts, cookies, or tracking identifiers. History, bookmarks, and optional provider keys stay strictly inside your browser&apos;s{' '}
                  <code className="font-mono text-[11px] bg-neutral-900/10 dark:bg-white/10 px-1.5 py-0.5 rounded">
                    localStorage
                  </code>
                  .
                </p>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Accent Tone
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {tones.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onChangeColorTheme(t.id)}
                      className={`rounded-full px-2.5 py-2 text-xs font-medium whitespace-nowrap ${
                        colorTheme === t.id
                          ? 'pharol-liquid-btn'
                          : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Browser Storage Records
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-2xl pharol-glass-inset p-3">
                    <div className="text-lg font-bold text-neutral-950 dark:text-white tabular-nums font-mono">
                      {historyCount}
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">History Items</div>
                  </div>
                  <div className="rounded-2xl pharol-glass-inset p-3">
                    <div className="text-lg font-bold text-neutral-950 dark:text-white tabular-nums font-mono">
                      {bookmarksCount}
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">Saved Bookmarks</div>
                  </div>
                </div>
              </div>

              {clearedMsg && (
                <div className="flex items-center gap-1.5 rounded-2xl pharol-glass-inset p-2.5 text-xs font-medium text-neutral-900 dark:text-neutral-100">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{clearedMsg}</span>
                </div>
              )}

              <div className="pt-1 space-y-2">
                <button
                  onClick={handleClearHistory}
                  disabled={historyCount === 0}
                  className="w-full flex items-center justify-center gap-1.5 rounded-full pharol-glass-chip py-2 text-xs font-medium text-neutral-700 disabled:opacity-40 dark:text-neutral-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear Search History Only</span>
                </button>

                <button
                  onClick={handlePurgeAll}
                  className="w-full flex items-center justify-center gap-1.5 rounded-full pharol-liquid-btn py-2 text-xs font-medium"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Purge All Local Data</span>
                </button>
              </div>
            </>
          ) : activeTab === 'keys' ? (
            <ProviderKeysForm
              key={JSON.stringify(userProviderConfig)}
              initialConfig={userProviderConfig}
              onSave={onUpdateUserProviderConfig}
            />
          ) : (
            <>
              {/* Desktop Browser Default Search Engine URL */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
                  <Globe className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Desktop Browser Search Engine URL</span>
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Add this URL under Chrome / Brave / Firefox <strong>Search Engines → Site Search</strong>. OpenSearch autodiscovery is also active at{' '}
                  <a
                    href="/opensearch.xml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    /opensearch.xml
                  </a>
                  .
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 rounded-2xl pharol-glass-inset px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                        Localhost URL
                      </div>
                      <code className="block truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
                        {localhostSearchUrl}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText('localhost-url', localhostSearchUrl)}
                      className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-2.5 py-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 shrink-0"
                    >
                      {copiedKey === 'localhost-url' ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{copiedKey === 'localhost-url' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  {origin !== 'http://localhost:3000' && (
                    <div className="flex items-center justify-between gap-2 rounded-2xl pharol-glass-inset px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                          Current Instance URL
                        </div>
                        <code className="block truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
                          {currentSearchUrl}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText('current-url', currentSearchUrl)}
                        className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-2.5 py-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 shrink-0"
                      >
                        {copiedKey === 'current-url' ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'current-url' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* MCP Server Mode */}
              <div className="space-y-2.5 pt-2 border-t border-neutral-900/10 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
                    <Terminal className="h-3.5 w-3.5 text-neutral-500" />
                    <span>Hosted MCP Server Endpoint</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestMcp}
                    disabled={mcpTestState === 'testing'}
                    className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-3 py-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-200"
                  >
                    <Play className="h-3 w-3" />
                    <span>{mcpTestState === 'testing' ? 'Testing...' : 'Test MCP'}</span>
                  </button>
                </div>

                {mcpTestMsg && (
                  <div
                    className={`rounded-2xl pharol-glass-inset px-3 py-2 text-[11px] font-mono ${
                      mcpTestState === 'ok'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {mcpTestMsg}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 rounded-2xl pharol-glass-inset px-3 py-2">
                  <code className="truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
                    {mcpUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText('mcp-url', mcpUrl)}
                    className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-2.5 py-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 shrink-0"
                  >
                    {copiedKey === 'mcp-url' ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{copiedKey === 'mcp-url' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <div className="relative rounded-2xl border border-white/20 bg-black/85 backdrop-blur-md p-3 text-[11px] font-mono text-neutral-200 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => copyText('mcp-json', mcpConfigSnippet)}
                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] text-neutral-100 hover:bg-white/25"
                  >
                    {copiedKey === 'mcp-json' ? 'Copied' : 'Copy JSON'}
                  </button>
                  <pre className="leading-relaxed">{mcpConfigSnippet}</pre>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {SEARX_MCP_TOOLS.map((t) => (
                    <div
                      key={t.name}
                      className="rounded-2xl pharol-glass-inset px-2.5 py-1.5"
                    >
                      <div className="font-mono text-[11px] font-semibold text-neutral-900 dark:text-neutral-100">
                        {t.name}
                      </div>
                      <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                        {t.title}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional Server-Side Rate-Limit Keys (Read-Only Status) */}
              <div className="space-y-2 pt-2 border-t border-neutral-900/10 dark:border-white/10">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Upstream Rate-Limit Mode (Server Env)
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  All providers run keyless by default (except CORE v3). Add browser-local keys in the{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('keys')}
                    className="underline font-medium text-neutral-800 dark:text-neutral-200"
                  >
                    Keys &amp; Hosts
                  </button>{' '}
                  tab or set server keys in{' '}
                  <code className="font-mono text-[10px] bg-neutral-900/10 dark:bg-white/10 px-1 py-0.5 rounded">
                    .env
                  </code>
                  .
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {envProviders.map((p) => {
                    const active = Boolean(capabilities?.envKeysActive?.[p.id]);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-2xl pharol-glass-inset px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-neutral-800 dark:text-neutral-200">
                            {p.label}
                          </div>
                          <code className="block truncate font-mono text-[9px] text-neutral-400">
                            {p.varName}
                          </code>
                        </div>
                        <span
                          className={`font-mono text-[10px] shrink-0 ${
                            active
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-neutral-400'
                          }`}
                        >
                          {active ? 'Key Active' : 'Keyless'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-neutral-900/10 dark:border-white/15 flex justify-end">
          <button
            onClick={handleClose}
            className="rounded-full pharol-glass-chip px-4 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
