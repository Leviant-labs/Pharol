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
    <header className="sticky top-0 z-40 w-full border-b pharol-glass transition-colors">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          onClick={onGoHome}
          className="text-base font-bold tracking-tight text-neutral-950 dark:text-white hover:opacity-75 transition-opacity whitespace-nowrap shrink-0"
          aria-label="Pharol Home"
        >
          Pharol
        </button>

        {/* Zone 2 (Desktop): Clean single-line category navigation */}
        <nav
          className="hidden md:flex items-center gap-5 h-full"
          aria-label="Search Categories"
        >
          {categories.map((cat) => {
            const active = currentCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`relative h-full flex items-center px-2 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'text-neutral-950 dark:text-white'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
                }`}
              >
                <span>{cat.label}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-neutral-950 dark:bg-white"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Region Selector + Local Privacy Controls + Theme Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center rounded-full pharol-glass-chip px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200">
            <Globe className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-300 shrink-0 mr-1.5" aria-hidden="true" />
            <select
              value={region}
              onChange={(e) => onChangeRegion(e.target.value as SearchRegion)}
              aria-label="Search Region"
              title="Country & language targeting (Auto detects query/browser locale)"
              className="bg-transparent pr-1 text-xs font-medium text-neutral-800 dark:text-neutral-100 focus:outline-none cursor-pointer"
            >
              {REGION_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-white dark:bg-black">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onOpenPrivacyModal}
            className="flex items-center gap-1.5 rounded-full pharol-glass-chip px-3 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white whitespace-nowrap shrink-0"
            title="Local Storage, Appearance & Privacy Controls"
            aria-label="Local Privacy"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Local Privacy</span>
          </button>

          <button
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="flex h-8 w-8 items-center justify-center rounded-full pharol-glass-chip text-neutral-700 dark:text-neutral-200 shrink-0"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Category Bar (< md) so all 6 tabs remain readable & tappable */}
      <nav
        className="flex md:hidden items-center justify-between gap-1 border-t border-neutral-900/10 dark:border-white/15 px-3 h-10 overflow-x-auto scrollbar-none"
        aria-label="Mobile Search Categories"
      >
        {categories.map((cat) => {
          const active = currentCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`relative h-full flex items-center px-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'text-neutral-950 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
            >
              <span>{cat.label}</span>
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-1 right-1 h-0.5 bg-neutral-950 dark:bg-white"
                />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
