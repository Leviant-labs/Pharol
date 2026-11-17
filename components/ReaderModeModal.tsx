'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Bookmark,
  Share2,
  Clock,
  BookOpen,
  FileText,
  Check,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import { ReaderContent, SearchResult } from '@/lib/search-types';

interface ReaderModeModalProps {
  url: string | null;
  initialTitle?: string;
  initialSnippet?: string;
  initialThumbnail?: string;
  onClose: () => void;
  isBookmarked: (url: string) => boolean;
  onToggleBookmark: (result: SearchResult) => void;
  onSearchOpenCoverage?: (query: string) => void;
}

export function ReaderModeModal({
  url,
  initialTitle,
  initialSnippet,
  initialThumbnail,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onSearchOpenCoverage,
}: ReaderModeModalProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>('serif');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!url) return;

    let active = true;

    fetch(`/api/reader?url=${encodeURIComponent(url)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.json();
      })
      .then((data: ReaderContent) => {
        if (active) {
          if (!data.heroImage && initialThumbnail) {
            data.heroImage = initialThumbnail;
          }
          setImgError(false);
          setContent(data);
        }
      })
      .catch(() => {
        if (active) {
          let host = 'article';
          try {
            host = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            // ignore
          }
          setContent({
            url,
            title: initialTitle || 'Readable Web Content',
            siteName: host,
            heroImage: initialThumbnail,
            paragraphs: initialSnippet
              ? [initialSnippet]
              : ['Direct readable stream unavailable. Open the original webpage to view full content.'],
            readingTimeMinutes: 1,
            type: 'article',
            isFallback: true,
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [url, initialTitle, initialSnippet, initialThumbnail]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!url) return null;

  const targetHref = content?.resolvedUrl || url;

  const handleCopy = () => {
    navigator.clipboard.writeText(targetHref);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getFontSizeClass = () => {
    if (fontSize === 'sm') return 'text-[15px] leading-[1.7]';
    if (fontSize === 'lg') return 'text-[19px] leading-[1.8]';
    return 'text-[17px] leading-[1.75]';
  };

  const currentTitle = content?.title || initialTitle || 'Readable Document';
  const bookmarked = isBookmarked(targetHref) || isBookmarked(url);

  const extractorLabel =
    content?.extractor === 'wikipedia'
      ? 'Wikipedia Full Article'
      : content?.extractor === 'arxiv'
      ? 'arXiv Paper Record'
      : content?.extractor === 'deepwiki'
      ? 'DeepWiki Architecture MCP'
      : content?.extractor === 'github'
      ? 'GitHub Repository README'
      : content?.extractor === 'jina-reader'
      ? 'Jina Markdown Extract'
      : content?.extractor === 'firecrawl'
      ? 'Firecrawl Keyless Extract'
      : content?.extractor === 'keenable'
      ? 'Keenable Reader Extract'
      : content?.extractor === 'direct'
      ? 'Extracted Article'
      : 'Summary View';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reader view: ${currentTitle}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 dark:bg-black/75 backdrop-blur-xl p-2 sm:p-5 overflow-y-auto"
    >
      <div
        className={`relative w-full ${
          isFullscreen ? 'max-w-6xl h-[94vh]' : 'max-w-3xl max-h-[90vh]'
        } flex flex-col rounded-3xl pharol-reader-glass pharol-liquid-iridescent transition-all overflow-hidden`}
      >
        {/* Top Controls Toolbar */}
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-900/10 dark:border-white/15 bg-white/35 dark:bg-white/[0.04] backdrop-blur-2xl px-4 py-2.5 text-xs text-neutral-600 dark:text-neutral-300">
          <div className="flex items-center gap-2 truncate pr-2">
            <BookOpen className="h-3.5 w-3.5 text-neutral-800 dark:text-neutral-200 shrink-0" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {content?.siteName || 'Reader'}
            </span>
            {content?.readingTimeMinutes && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums whitespace-nowrap">
                  <Clock className="h-3 w-3" />
                  {content.readingTimeMinutes} min
                </span>
              </>
            )}
            {content?.extractor && (
              <>
                <span className="hidden sm:inline" aria-hidden="true">·</span>
                <span className="hidden sm:inline text-[11px] text-neutral-400 whitespace-nowrap">
                  {extractorLabel}
                </span>
              </>
            )}
            {content?.accessType === 'open' && (
              <>
                <span className="hidden md:inline" aria-hidden="true">·</span>
                <span className="hidden md:inline font-mono text-[11px] text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                  Open Access
                </span>
              </>
            )}
            {content?.accessType === 'subscription' && (
              <>
                <span className="hidden md:inline" aria-hidden="true">·</span>
                <span className="hidden md:inline font-mono text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  Subscription Publisher
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setFontFamily(fontFamily === 'sans' ? 'serif' : 'sans')}
              className="rounded-full pharol-glass-chip px-2.5 py-1 text-[11px] font-medium text-neutral-800 dark:text-neutral-100"
              title="Toggle Serif / Sans typography"
            >
              {fontFamily === 'serif' ? 'Serif' : 'Sans'}
            </button>

            <div className="hidden sm:flex items-center pharol-glass-inset rounded-full p-0.5">
              {(['sm', 'base', 'lg'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setFontSize(sz)}
                  className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${
                    fontSize === sz
                      ? 'pharol-liquid-btn font-semibold'
                      : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white'
                  }`}
                >
                  {sz === 'sm' ? 'A-' : sz === 'lg' ? 'A+' : 'A'}
                </button>
              ))}
            </div>

            <button
              onClick={() =>
                onToggleBookmark({
                  id: `reader-${Date.now()}`,
                  title: currentTitle,
                  url: targetHref,
                  displayedUrl: content?.siteName || targetHref,
                  snippet: content?.excerpt || initialSnippet || '',
                  engine: 'reader',
                  category: 'all',
                })
              }
              className={`rounded-full p-1.5 transition-colors ${
                bookmarked
                  ? 'pharol-liquid-btn'
                  : 'pharol-glass-chip text-neutral-700 dark:text-neutral-200'
              }`}
              aria-label={bookmarked ? 'Remove bookmark' : 'Save bookmark'}
            >
              <Bookmark className={`h-3.5 w-3.5 ${bookmarked ? 'fill-current' : ''}`} />
            </button>

            <button
              onClick={handleCopy}
              className="rounded-full pharol-glass-chip p-1.5 text-neutral-700 dark:text-neutral-200"
              aria-label="Copy article URL"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Share2 className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="hidden sm:flex rounded-full pharol-glass-chip p-1.5 text-neutral-700 dark:text-neutral-200"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand reader'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>

            <a
              href={targetHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full pharol-liquid-btn px-3 py-1 text-xs font-medium whitespace-nowrap"
            >
              <span className="hidden sm:inline">Original</span>
              <ExternalLink className="h-3 w-3" />
            </a>

            <button
              onClick={onClose}
              className="rounded-full pharol-glass-chip p-1.5 text-neutral-700 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
              aria-label="Close reader mode"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Reading Canvas */}
        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-12 sm:py-10 text-left">
          {loading ? (
            <div className="space-y-5 py-8 max-w-[68ch] mx-auto animate-pulse">
              <div className="h-8 w-4/5 bg-neutral-200 dark:bg-neutral-800 rounded" />
              <div className="h-4 w-1/3 bg-neutral-200 dark:bg-neutral-800 rounded" />
              <div className="h-52 w-full bg-neutral-200 dark:bg-neutral-800 rounded-lg" />
              <div className="space-y-3 pt-2">
                <div className="h-4 w-full bg-neutral-200 dark:bg-neutral-800 rounded" />
                <div className="h-4 w-11/12 bg-neutral-200 dark:bg-neutral-800 rounded" />
                <div className="h-4 w-5/6 bg-neutral-200 dark:bg-neutral-800 rounded" />
                <div className="h-4 w-full bg-neutral-200 dark:bg-neutral-800 rounded" />
              </div>
            </div>
          ) : content ? (
            <article
              className={`max-w-[68ch] mx-auto ${
                fontFamily === 'serif' ? 'font-serif' : 'font-sans'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mb-3 font-sans">
                {content.siteName && <span className="font-medium text-neutral-700 dark:text-neutral-300">{content.siteName}</span>}
                {content.publishedTime && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{content.publishedTime}</span>
                  </>
                )}
                {content.byline && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{content.byline}</span>
                  </>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950 dark:text-white leading-tight [text-wrap:balance]">
                {currentTitle}
              </h1>

              {content.excerpt && (
                <p className="mt-4 text-base text-neutral-600 dark:text-neutral-400 leading-relaxed font-sans">
                  {content.excerpt}
                </p>
              )}

              {(content.accessBlocked || content.isFallback || content.fallbackNotice) && (
                <div className="my-5 rounded-2xl pharol-glass-inset border-amber-400/40 px-4 py-3 text-xs font-sans text-amber-800 dark:text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    {content.fallbackNotice
                      ? content.fallbackNotice
                      : content.accessType === 'subscription'
                      ? `Subscription publisher detected — preview is limited to the public summary.`
                      : `Full extraction was blocked by ${content.siteName || 'this publisher'}. Open Original or search open-access coverage.`}
                  </div>
                  {!content.fallbackNotice && onSearchOpenCoverage && currentTitle && (
                    <button
                      type="button"
                      onClick={() => {
                        const cleanHeadline = currentTitle.replace(/\s*[|\-–—]\s*[^|\-–—]{2,36}$/, '').trim();
                        onClose();
                        onSearchOpenCoverage(cleanHeadline || currentTitle);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full pharol-liquid-btn px-3.5 py-1.5 text-[11px] font-medium shrink-0 whitespace-nowrap"
                    >
                      <Search className="h-3 w-3" />
                      <span>Find Open Coverage</span>
                    </button>
                  )}
                </div>
              )}

              {content.type === 'video' && content.embedUrl && (
                <div className="my-6 aspect-video w-full rounded-2xl overflow-hidden bg-black border border-neutral-900/15 dark:border-white/20 shadow-lg">
                  <iframe
                    src={content.embedUrl}
                    title={currentTitle}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full border-0"
                  />
                </div>
              )}

              {content.heroImage && !imgError && content.type !== 'video' && (
                <div className="my-6 rounded-2xl overflow-hidden border border-neutral-900/10 dark:border-white/20 bg-white/30 dark:bg-black/30 shadow-lg">
                  <img
                    src={content.heroImage}
                    alt={currentTitle}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full max-h-[380px] object-cover"
                  />
                </div>
              )}

              {(content.type === 'pdf' || content.pdfUrl) && (
                <div className="my-6 p-5 rounded-2xl pharol-glass-inset flex items-center justify-between gap-4 font-sans">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-neutral-500 dark:text-neutral-300 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                        Full PDF Document Available
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        Direct publisher / open-access PDF link
                      </p>
                    </div>
                  </div>
                  <a
                    href={content.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full pharol-liquid-btn px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    <span>Open PDF</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}

              {/* Structured Content Blocks */}
              <div className={`mt-7 space-y-5 text-neutral-800 dark:text-neutral-200 ${getFontSizeClass()}`}>
                {content.blocks && content.blocks.length > 0 ? (
                  content.blocks.map((block, idx) => {
                    if (block.type === 'h2') {
                      return (
                        <h2
                          key={idx}
                          className="pt-4 text-xl sm:text-2xl font-bold tracking-tight text-neutral-950 dark:text-white font-sans"
                        >
                          {block.text}
                        </h2>
                      );
                    }
                    if (block.type === 'h3') {
                      return (
                        <h3
                          key={idx}
                          className="pt-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100 font-sans"
                        >
                          {block.text}
                        </h3>
                      );
                    }
                    if (block.type === 'quote') {
                      return (
                        <blockquote
                          key={idx}
                          className="rounded-2xl pharol-glass-inset px-5 py-3.5 italic text-neutral-700 dark:text-neutral-200"
                        >
                          {block.text}
                        </blockquote>
                      );
                    }
                    if (block.type === 'code') {
                      return (
                        <pre
                          key={idx}
                          className="overflow-x-auto rounded-2xl bg-black/85 border border-white/15 text-neutral-100 p-4 text-xs font-mono leading-relaxed backdrop-blur-md"
                        >
                          <code>{block.text}</code>
                        </pre>
                      );
                    }
                    if (block.type === 'ul' && block.items) {
                      return (
                        <ul key={idx} className="space-y-2 pl-5 list-disc marker:text-neutral-400">
                          {block.items.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    return <p key={idx}>{block.text}</p>;
                  })
                ) : content.paragraphs && content.paragraphs.length > 0 ? (
                  content.paragraphs.map((para, idx) => <p key={idx}>{para}</p>)
                ) : (
                  <p className="text-neutral-500 italic">No additional readable text extracted.</p>
                )}
              </div>

              {/* Footer */}
              <div className="mt-12 pt-6 border-t border-neutral-900/10 dark:border-white/15 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-sans">
                <span className="text-neutral-500 dark:text-neutral-400">
                  Private client-side reader · {content.siteName || 'External source'}
                </span>
                <a
                  href={targetHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full pharol-glass-chip px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100"
                >
                  <span>Read Original Page</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}
