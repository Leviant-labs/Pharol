'use client';

import React from 'react';
import { Sun, Moon, ShieldCheck, Globe } from 'lucide-react';
import { SearchCategory, SearchRegion } from '@/lib/search-types';

interface NavbarProps {
  currentCategory: SearchCategory;
  onSelectCategory: (cat: SearchCategory) => void;
  region: SearchRegion;
  onChangeRegion: (region: SearchRegion) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenPrivacyModal: () => void;
  onGoHome: () => void;
  isSearchActive: boolean;
}

const REGION_OPTIONS: Array<{ id: SearchRegion; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'pt-PT', label: 'Portugal' },
  { id: 'pt-BR', label: 'Brasil' },
  { id: 'global', label: 'Global' },
  { id: 'en-US', label: 'US' },
  { id: 'en-GB', label: 'UK' },
  { id: 'es-ES', label: 'España' },
  { id: 'fr-FR', label: 'France' },
  { id: 'de-DE', label: 'Deutschland' },
];

/**
 * Layer 1 — Recessed, Barless Navigation Chrome.
 * Floats directly on Layer 0 (#040507 void) with zero full-width strip,
 * box, or hairline divider. Only the active category receives a soft glass pill.
 */
export function Navbar({
  currentCategory,
  onSelectCategory,
  region,
  onChangeRegion,
  theme,
  onToggleTheme,
  onOpenPrivacyModal,
  onGoHome,
}: NavbarProps) {
  const categories: Array<{ id: SearchCategory; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'images', label: 'Images' },
    { id: 'videos', label: 'Videos' },
    { id: 'news', label: 'News' },
    { id: 'code', label: 'Code' },
    { id: 'science', label: 'Science' },
  ];

  return (
    <header className="relative z-40 w-full pt-3 sm:pt-4">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6">
        {/* Zone 1: Bare Lighthouse Wordmark floating on Layer 0 */}
        <button
          onClick={onGoHome}
          className="group flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-neutral-950 dark:text-[#f0f4f8] hover:opacity-85 transition-opacity whitespace-nowrap shrink-0"
          aria-label="Pharol Home"
        >
          <span
            aria-hidden="true"
            className="relative flex h-2.5 w-2.5 items-center justify-center"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background:
                  'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-signal) 100%)',
                boxShadow: '0 0 10px rgba(var(--accent-primary-rgb), 0.55)',
              }}
            />
          </span>
          <span>Pharol</span>
        </button>

        {/* Zone 2 (Desktop): Barless category nav — only active tab gets a subtle glass pill */}
        <nav
          className="hidden md:flex items-center gap-1"
          aria-label="Search Categories"
        >
          {categories.map((cat) => {
            const active = currentCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap shrink-0 transition-all ${
                  active
                    ? 'pharol-nav-pill text-neutral-950 dark:text-[#f0f4f8]'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Minimal Utility Triggers */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="relative flex items-center rounded-full px-2.5 py-1.5 text-xs text-neutral-700 dark:text-[#9aa7b4] hover:text-neutral-950 dark:hover:text-[#f0f4f8] transition-colors">
            <Globe
              className="h-3.5 w-3.5 shrink-0 mr-1.5"
              style={{ color: 'var(--accent-primary)' }}
              aria-hidden="true"
            />
            <select
              value={region}
              onChange={(e) => onChangeRegion(e.target.value as SearchRegion)}
              aria-label="Search Region"
              title="Country & language targeting (Auto detects query/browser locale)"
              className="bg-transparent pr-1 text-xs font-medium text-neutral-800 dark:text-[#d8e3ec] focus:outline-none cursor-pointer"
            >
              {REGION_OPTIONS.map((opt) => (
                <option
                  key={opt.id}
                  value={opt.id}
                  className="bg-white text-neutral-900 dark:bg-[#0b0e13] dark:text-[#f0f4f8]"
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onOpenPrivacyModal}
            className="flex items-center gap-1.5 rounded-full pharol-glass-chip px-3 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 dark:text-[#d8e3ec] dark:hover:text-[#f0f4f8] whitespace-nowrap shrink-0"
            title="Local Storage, Appearance & Privacy Controls"
            aria-label="Local Privacy"
          >
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span className="hidden sm:inline">Privacy</span>
          </button>

          <button
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="flex h-8 w-8 items-center justify-center rounded-full pharol-glass-chip text-neutral-700 dark:text-[#d8e3ec] hover:text-neutral-950 dark:hover:text-[#f0f4f8] shrink-0"
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" style={{ color: 'var(--accent-signal)' }} />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Barless Category Strip (< md): compact horizontal scroll directly on Layer 0 */}
      <nav
        className="flex md:hidden items-center gap-1.5 px-4 pt-2 pb-1 overflow-x-auto scrollbar-none"
        aria-label="Mobile Search Categories"
      >
        {categories.map((cat) => {
          const active = currentCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                active
                  ? 'pharol-nav-pill text-neutral-950 dark:text-[#f0f4f8]'
                  : 'text-neutral-600 hover:text-neutral-950 dark:text-[#9aa7b4] dark:hover:text-[#f0f4f8]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
