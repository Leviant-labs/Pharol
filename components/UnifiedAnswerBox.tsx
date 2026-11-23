'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  CornerDownLeft,
} from 'lucide-react';
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

/**
 * Layer 2B — Recessed Optical Aperture for Unified Synthesis.
 * Punches cleanly through its enclosing OpticalFrostPane via [data-optical-aperture],
 * resting over a calm ~68% smoked veil with inverted inner bevel for 8-hour comfort.
 */
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
              className="mx-0.5 inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--accent-primary)] bg-[#38a3b8]/12 hover:bg-[#38a3b8]/22 transition-colors align-baseline"
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
      data-optical-aperture="true"
      aria-label="Unified Answer Synthesis"
      className="pharol-aperture relative mb-6 transition-colors"
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-900 dark:text-[#f0f4f8]">
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--accent-signal)' }} />
          <span>Unified Answer</span>
          {answer && (
            <>
              <span className="text-neutral-300 dark:text-white/15" aria-hidden="true">
                ·
              </span>
              <span className="font-normal text-neutral-500 dark:text-[#9aa7b4]">
                {answer.provider === 'gemini-grounded'
                  ? `Synthesized across ${answer.citations.length || 1} sources`
                  : 'Instant synthesis'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!loading && answer && (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full p-1.5 text-neutral-500 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] transition-colors"
              aria-label="Regenerate unified answer"
              title="Regenerate answer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-full p-1.5 text-neutral-500 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8] transition-colors"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand unified answer' : 'Collapse unified answer'}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 pb-4 pt-1 text-left">
          {loading ? (
            <div className="space-y-2.5 animate-pulse py-1">
              <div className="h-3.5 w-11/12 rounded bg-neutral-200 dark:bg-white/10" />
              <div className="h-3.5 w-4/5 rounded bg-neutral-200 dark:bg-white/10" />
              <div className="h-3.5 w-2/3 rounded bg-neutral-200 dark:bg-white/10" />
            </div>
          ) : answer ? (
            <div className="space-y-3.5">
              <p className="text-[15px] leading-relaxed text-neutral-800 dark:text-[#e6edf4]">
                {renderWithCitations(answer.summary)}
              </p>

              {answer.keyPoints && answer.keyPoints.length > 0 && (
                <ul className="space-y-1.5 pt-0.5 text-[13.5px] leading-relaxed text-neutral-600 dark:text-[#c4d0dc]">
                  {answer.keyPoints.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span
                        className="mt-2 h-1 w-1 rounded-full shrink-0"
                        style={{ backgroundColor: 'var(--accent-primary)' }}
                      />
                      <span>{renderWithCitations(point)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {answer.citations && answer.citations.length > 0 && (
                <div className="pt-3 border-t border-neutral-900/10 dark:border-white/[0.08] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-[11px] font-medium text-neutral-400 dark:text-[#6c7a89]">
                    Sources
                  </span>
                  {answer.citations.map((cite) => (
                    <div key={cite.index} className="inline-flex items-center gap-1.5 max-w-[220px]">
                      <span
                        className="font-mono text-[11px] tabular-nums"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        [{cite.index}]
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewCitation({
                            url: cite.url,
                            title: cite.title,
                            domain: cite.domain,
                          })
                        }
                        className="truncate text-xs font-medium text-neutral-700 hover:text-neutral-950 hover:underline dark:text-[#d2dde7] dark:hover:text-[#f0f4f8]"
                        title={`Read preview: ${cite.title}`}
                      >
                        {cite.domain}
                      </button>
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-400 hover:text-neutral-700 dark:text-[#6c7a89] dark:hover:text-[#f0f4f8] shrink-0"
                        aria-label={`Open ${cite.domain} in new tab`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {followUpTurns.length > 0 && (
                <div className="pt-3 border-t border-neutral-900/10 dark:border-white/[0.08] space-y-3">
                  {followUpTurns.map((turn, idx) => (
                    <div key={idx} className="space-y-1 text-xs sm:text-[13.5px]">
                      <div className="font-semibold text-neutral-900 dark:text-[#f0f4f8]">
                        {turn.question}
                      </div>
                      <p className="leading-relaxed text-neutral-600 dark:text-[#c4d0dc]">
                        {renderWithCitations(turn.answer)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {followUpLoading && (
                <div className="pt-2 space-y-2 animate-pulse">
                  <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-white/10" />
                  <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-white/10" />
                </div>
              )}

              {onAskFollowUp && (
                <form
                  onSubmit={handleFollowUpSubmit}
                  className="pt-2.5 flex items-center gap-2 border-t border-neutral-900/10 dark:border-white/[0.08]"
                >
                  <input
                    type="text"
                    value={followUpInput}
                    onChange={(e) => setFollowUpInput(e.target.value)}
                    placeholder="Ask a follow-up grounded in these sources..."
                    aria-label="Ask a follow-up question"
                    disabled={followUpLoading}
                    className="flex-1 bg-transparent py-1.5 text-xs sm:text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-[#f0f4f8] dark:placeholder:text-[#6c7a89]"
                  />
                  <button
                    type="submit"
                    disabled={!followUpInput.trim() || followUpLoading}
                    aria-label="Submit follow-up question"
                    className="inline-flex items-center gap-1 rounded-full pharol-glass-chip px-3 py-1 text-[11px] font-medium text-neutral-700 disabled:opacity-40 dark:text-[#d8e3ec]"
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
