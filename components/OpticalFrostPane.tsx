'use client';

import React, { useEffect, useId, useRef } from 'react';

interface OpticalFrostPaneProps {
  children: React.ReactNode;
  className?: string;
  /** Border radius of recessed aperture cutouts in px (matches .pharol-aperture). */
  apertureRadius?: number;
  ariaLabel?: string;
  as?: 'div' | 'main' | 'section';
}

/**
 * Layer 2 Frosted Pane with Layer 2B Recessed Optical Aperture support.
 *
 * Renders the frosted backdrop on a sibling `.pane-frost` overlay behind the
 * content and punches clean SVG `<mask maskUnits="userSpaceOnUse">` cutouts
 * wherever descendant `[data-optical-aperture]` elements sit — synced via
 * ResizeObserver + MutationObserver + requestAnimationFrame using direct DOM
 * refs (zero React re-renders).
 */
export function OpticalFrostPane({
  children,
  className = '',
  apertureRadius = 14,
  ariaLabel,
  as = 'div',
}: OpticalFrostPaneProps) {
  const rawId = useId();
  const maskId = `optical-mask-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const maskRef = useRef<SVGMaskElement | null>(null);
  const bgRectRef = useRef<SVGRectElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const maskEl = maskRef.current;
    const bgRect = bgRectRef.current;
    if (!container || !maskEl || !bgRect) return;

    let rafId = 0;

    const syncHoles = () => {
      rafId = 0;
      const paneRect = container.getBoundingClientRect();
      const width = Math.max(0, paneRect.width);
      const height = Math.max(0, paneRect.height);

      bgRect.setAttribute('width', String(width));
      bgRect.setAttribute('height', String(height));

      // Clear previous cutout rects (keep first child = white background rect)
      while (maskEl.childNodes.length > 1) {
        maskEl.removeChild(maskEl.lastChild!);
      }

      const apertures = container.querySelectorAll<HTMLElement>('[data-optical-aperture]');
      apertures.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hole.setAttribute('x', String(r.left - paneRect.left));
        hole.setAttribute('y', String(r.top - paneRect.top));
        hole.setAttribute('width', String(r.width));
        hole.setAttribute('height', String(r.height));
        hole.setAttribute('rx', String(apertureRadius));
        hole.setAttribute('ry', String(apertureRadius));
        hole.setAttribute('fill', 'black');
        maskEl.appendChild(hole);
      });
    };

    const scheduleSync = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(syncHoles);
    };

    syncHoles();

    const ro = new ResizeObserver(scheduleSync);
    ro.observe(container);

    const mo = new MutationObserver(scheduleSync);
    mo.observe(container, { childList: true, subtree: true, attributes: true });

    window.addEventListener('resize', scheduleSync, { passive: true });

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', scheduleSync);
    };
  }, [apertureRadius]);

  const Tag = as;

  return (
    <Tag
      ref={containerRef as React.RefObject<HTMLDivElement>}
      aria-label={ariaLabel}
      className={`relative rounded-[20px] ${className}`}
    >
      {/* Inline zero-size SVG mask defining punched aperture holes */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <mask id={maskId} ref={maskRef} maskUnits="userSpaceOnUse">
            <rect ref={bgRectRef} x="0" y="0" width="100%" height="100%" fill="white" />
          </mask>
        </defs>
      </svg>

      {/* Sibling frost layer (Layer 2) with holes punched behind apertures */}
      <div
        aria-hidden="true"
        className="pharol-frosted-pane pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
        style={{
          mask: `url(#${maskId})`,
          WebkitMask: `url(#${maskId})`,
        }}
      />

      {/* Foreground workspace content */}
      <div className="relative z-10">{children}</div>
    </Tag>
  );
}
