'use client';

import React from 'react';
import { History, Bookmark, Trash2, ArrowUpRight, Search } from 'lucide-react';
import { LocalHistoryItem, SavedBookmark } from '@/lib/search-types';

interface LocalHistoryWidgetProps {
  history: LocalHistoryItem[];
  bookmarks: SavedBookmark[];
  onSelectQuery: (query: string) => void;
  onRemoveHistory: (id: string) => void;
  onClearHistory: () => void;
}

export function LocalHistoryWidget({
  history,
  bookmarks,
  onSelectQuery,
  onRemoveHistory,
  onClearHistory,
}: LocalHistoryWidgetProps) {
  const [tab, setTab] = React.useState<'history' | 'bookmarks'>('history');

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return 'Recent';
    }
  };

  return (
    <div className="rounded-3xl pharol-liquid-glass p-5 transition-colors">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-900/10 dark:border-white/10">
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setTab('history')}
            className={`flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap ${
              tab === 'history'
                ? 'text-neutral-950 dark:text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>History</span>
            <span className="font-mono text-[11px] tabular-nums text-neutral-400">
              {history.length}
            </span>
          </button>

          <span className="text-neutral-300 dark:text-neutral-700" aria-hidden="true">·</span>

          <button
            onClick={() => setTab('bookmarks')}
            className={`flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap ${
              tab === 'bookmarks'
                ? 'text-neutral-950 dark:text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>Saved</span>
            <span className="font-mono text-[11px] tabular-nums text-neutral-400">
              {bookmarks.length}
            </span>
          </button>
        </div>

        {tab === 'history' && history.length > 0 && (
          <button
            onClick={onClearHistory}
            className="text-[11px] text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 flex items-center gap-1 transition-colors"
            title="Clear all browser search history"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      <div className="pt-3">
        {tab === 'history' ? (
          history.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-400 leading-relaxed">
              No recent searches yet. Queries remain locally in your browser.
            </div>
          ) : (
            <div className="space-y-1">
              {history.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50 transition-colors"
                >
                  <button
                    onClick={() => onSelectQuery(item.query)}
                    className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white truncate text-left"
                  >
                    <Search className="h-3 w-3 text-neutral-400 shrink-0" />
                    <span className="truncate">{item.query}</span>
                  </button>
                  <div className="flex items-center gap-2 text-[11px] text-neutral-400 shrink-0">
                    <span className="tabular-nums">{formatTime(item.timestamp)}</span>
                    <button
                      onClick={() => onRemoveHistory(item.id)}
                      className="opacity-0 group-hover:opacity-100 hover:text-neutral-800 dark:hover:text-neutral-200"
                      aria-label={`Remove ${item.query} from history`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : bookmarks.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-400 leading-relaxed">
            No saved results yet. Save any result to access it locally.
          </div>
        ) : (
          <div className="space-y-2.5">
            {bookmarks.slice(0, 5).map((bm) => (
              <div key={bm.id} className="text-left text-xs">
                <a
                  href={bm.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-neutral-800 hover:text-neutral-950 hover:underline dark:text-neutral-200 dark:hover:text-white line-clamp-1 flex items-center gap-1"
                >
                  <span className="truncate">{bm.title}</span>
                  <ArrowUpRight className="h-3 w-3 text-neutral-400 shrink-0" />
                </a>
                <div className="text-[11px] text-neutral-400 truncate font-mono">{bm.url}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
