'use client';

import React from 'react';

interface OpticalVoidBackdropProps {
  /** Event-driven single sweep strictly while search/synthesis is actively streaming. Still by default. */
  active?: boolean;
}

/**
 * Layer 0 — OLED Void (#040507) + Crisp, Hard-Edged Geometric Fresnel Backlights.
 *
 * Critical Optical Law: Zero pre-blur on background geometry so edges stay
 * razor-sharp on the void and refract softly through Layer 2 frosted panes
 * and Layer 3 liquid docks. Strictly stationary at rest.
 */
export function OpticalVoidBackdrop({ active = false }: OpticalVoidBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* Crisp primary Atlantic Teal architectural beam crossing upper-left into workspace */}
      <div
        className="absolute inset-0 transition-opacity duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          clipPath: 'polygon(0% 0%, 44% 0%, 26% 100%, 0% 78%)',
          background:
            'linear-gradient(155deg, rgba(var(--accent-primary-rgb), 0.15) 0%, rgba(var(--accent-primary-rgb), 0.05) 56%, rgba(var(--accent-primary-rgb), 0.0) 100%)',
          opacity: active ? 1 : 0.84,
        }}
      />

      {/* Sharp Fresnel lens diagonal ribbon slicing horizontally behind Layer 2 / Layer 3 */}
      <div
        className="absolute inset-0 transition-opacity duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          clipPath: 'polygon(14% 12%, 92% 0%, 84% 22%, 6% 34%)',
          background:
            'linear-gradient(95deg, rgba(var(--accent-primary-rgb), 0.0) 0%, rgba(var(--accent-primary-rgb), 0.13) 44%, rgba(var(--accent-signal-rgb), 0.11) 82%, rgba(var(--accent-signal-rgb), 0.0) 100%)',
          opacity: active ? 1 : 0.78,
        }}
      />

      {/* Complementary Warm Fresnel Amber geometric counter-plane at lower-right */}
      <div
        className="absolute inset-0 transition-opacity duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          clipPath: 'polygon(64% 100%, 100% 38%, 100% 100%)',
          background:
            'linear-gradient(325deg, rgba(var(--accent-signal-rgb), 0.14) 0%, rgba(var(--accent-signal-rgb), 0.045) 52%, rgba(var(--accent-signal-rgb), 0.0) 100%)',
          opacity: active ? 1 : 0.8,
        }}
      />

      {/* Crisp geometric Fresnel arc hairlines (zero SVG blur, zero idle motion) */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <circle
          cx="1160"
          cy="180"
          r="420"
          fill="none"
          stroke="rgba(var(--accent-primary-rgb), 0.14)"
          strokeWidth="1"
        />
        <circle
          cx="1160"
          cy="180"
          r="290"
          fill="none"
          stroke="rgba(var(--accent-signal-rgb), 0.11)"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1="260"
          x2="1440"
          y2="110"
          stroke="rgba(var(--accent-primary-rgb), 0.12)"
          strokeWidth="1"
        />
      </svg>

      {/* Event-driven transient sweep strictly while streaming (unmounted at rest) */}
      {active && (
        <div
          className="pharol-beam-active absolute inset-0"
          style={{
            clipPath: 'polygon(22% 0%, 58% 0%, 42% 100%, 8% 100%)',
            background:
              'linear-gradient(120deg, rgba(var(--accent-primary-rgb), 0.0) 0%, rgba(var(--accent-primary-rgb), 0.14) 48%, rgba(var(--accent-signal-rgb), 0.12) 66%, rgba(var(--accent-signal-rgb), 0.0) 100%)',
          }}
        />
      )}
    </div>
  );
}
