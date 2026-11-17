'use client';

import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, ExternalLink, RefreshCw, CornerDownLeft } from 'lucide-react';
import { UnifiedAnswer, SearchResult, AnswerFollowUpTurn } from '@/lib/search-types';

interface UnifiedAnswerBoxProps {
  answer: UnifiedAnswer | null;
  loading: boolean;
  onRegenerate: () => void;
  onCiteClick: (url: string) => void;
  onPreviewCitation: (citation: { url: string; title: string; domain: string }) => void;
  results?: SearchResult[];
  followUpTurns?: AnswerFollowUpTurn[];
  followUpLoading?: boolean;
  onAskFollowUp?: (question: string) => void;
}

export function UnifiedAnswerBox({
  answer,
  loading,
  onRegenerate,
  onCiteClick,
  onPreviewCitation,
  followUpTurns = [],
  followUpLoading = false,
  onAskFollowUp,
}: UnifiedAnswerBoxProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');

  if (!loading && !answer) return null;

  // Render inline [1], [2] markers as interactive citation buttons
  const renderWithCitations = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const citeNum = Number(match[1]);
        const cited = answer?.citations.find((c) => c.index === citeNum);
        if (cited) {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onCiteClick(cited.url)}
              title={`${cited.title} (${cited.domain})`}
              className="mx-0.5 inline-flex items-center justify-center rounded px-1 py-0.2 font-mono text-[11px] font-medium text-neutral-700 bg-neutral-200/70 hover:bg-neutral-300 dark:text-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 transition-colors align-baseline"
            >
              {citeNum}
            </button>
          );
        }
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = followUpInput.trim();
    if (!q || followUpLoading || !onAskFollowUp) return;
    setFollowUpInput('');
    onAskFollowUp(q);
  };

  return (
    <section
      aria-label="Unified Answer Synthesis"
      className="relative mb-7 rounded-3xl pharol-liquid-glass pharol-liquid-iridescent transition-colors"
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-900/10 dark:border-white/10">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          <Sparkles className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-400" />
          <span>Unified Answer</span>
          {answer && (
            <>
              <span className="text-neutral-300 dark:text-neutral-700" aria-hidden="true">·</span>
              <span className="font-normal text-neutral-500 dark:text-neutral-400">
                {answer.provider === 'gemini-grounded'
                  ? `Synthesized across ${answer.citations.length || 1} sources`
                  : 'Instant synthesis'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!loading && answer && (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full pharol-glass-chip p-1.5 text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white transition-colors"
              aria-label="Regenerate unified answer"
              title="Regenerate answer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-full pharol-glass-chip p-1.5 text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white transition-colors"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand unified answer' : 'Collapse unified answer'}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 py-4 text-left">
          {loading ? (
            <div className="space-y-2.5 animate-pulse">
              <div className="h-3.5 w-11/12 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3.5 w-4/5 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3.5 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
          ) : answer ? (
            <div className="space-y-3.5">
              <p className="text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                {renderWithCitations(answer.summary)}
              </p>

              {answer.keyPoints && answer.keyPoints.length > 0 && (
                <ul className="space-y-1.5 pt-1 text-[13.5px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {answer.keyPoints.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-2 h-1 w-1 rounded-full bg-neutral-400 dark:bg-neutral-600 shrink-0" />
                      <span>{renderWithCitations(point)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {answer.citations && answer.citations.length > 0 && (
                <div className="pt-3 border-t border-neutral-900/10 dark:border-white/10 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                    Sources
                  </span>
                  {answer.citations.map((cite) => (
                    <div key={cite.index} className="inline-flex items-center gap-1.5 max-w-[220px]">
                      <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
                        [{cite.index}]
                      </span>
                      <button
                        type="button"
                        onClick={() => onPreviewCitation({ url: cite.url, title: cite.title, domain: cite.domain })}
                        className="truncate text-xs font-medium text-neutral-700 hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white"
                        title={`Read preview: ${cite.title}`}
                      >
                        {cite.domain}
                      </button>
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
                        aria-label={`Open ${cite.domain} in new tab`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {followUpTurns.length > 0 && (
                <div className="pt-3 border-t border-neutral-900/10 dark:border-white/10 space-y-3">
                  {followUpTurns.map((turn, idx) => (
                    <div key={idx} className="space-y-1 text-xs sm:text-[13.5px]">
                      <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {turn.question}
                      </div>
                      <p className="leading-relaxed text-neutral-600 dark:text-neutral-300">
                        {renderWithCitations(turn.answer)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {followUpLoading && (
                <div className="pt-2 space-y-2 animate-pulse">
                  <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
                </div>
              )}

              {onAskFollowUp && (
                <form
                  onSubmit={handleFollowUpSubmit}
                  className="pt-2 flex items-center gap-2 border-t border-neutral-900/10 dark:border-white/10"
                >
                  <input
                    type="text"
                    value={followUpInput}
                    onChange={(e) => setFollowUpInput(e.target.value)}
                    placeholder="Ask a follow-up grounded in these sources..."
                    aria-label="Ask a follow-up question"
                    disabled={followUpLoading}
                    className="flex-1 bg-transparent py-1.5 text-xs sm:text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  />
                  <button
                    type="submit"
                    disabled={!followUpInput.trim() || followUpLoading}
                    aria-label="Submit follow-up question"
                    className="inline-flex items-center gap-1 rounded-lg pharol-glass-chip px-3 py-1 text-[11px] font-medium text-neutral-700 disabled:opacity-40 dark:text-neutral-200"
                  >
                    <span>Ask</span>
                    <CornerDownLeft className="h-3 w-3" />
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
