'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GLOSSARY, type GlossaryTerm } from '@/lib/glossary';

interface TermProps {
  term: GlossaryTerm;
  /** What to render as the visible label. Defaults to the term itself. */
  children?: React.ReactNode;
  /** Optional explicit definition (overrides the glossary lookup). */
  definition?: string;
}

/**
 * Inline glossary chip with hover-and-tap tooltip.
 * Desktop: hovering the ⓘ shows the definition.
 * Mobile: tapping the ⓘ pins the popover open; tap outside or tap again closes it.
 * Edge-aware: flips to right anchor / above when the popover would overflow the viewport.
 */
export function Term({ term, children, definition }: TermProps) {
  const text = definition ?? GLOSSARY[term];
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [hAnchor, setHAnchor] = useState<'left' | 'center' | 'right'>('center');
  const [vAnchor, setVAnchor] = useState<'below' | 'above'>('below');
  const open = pinned || hovering;

  // Close on outside click when pinned
  useEffect(() => {
    if (!pinned) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setPinned(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pinned]);

  // Edge-aware positioning: measure once the tooltip is visible and flip if needed
  useLayoutEffect(() => {
    if (!open || !containerRef.current || !tooltipRef.current) return;
    const button = containerRef.current.querySelector('button');
    if (!button) return;
    const btnRect = button.getBoundingClientRect();
    const ttRect = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    // Horizontal: prefer center; if overflowing right, anchor right; if overflowing left, anchor left
    const centerLeft = btnRect.left + btnRect.width / 2 - ttRect.width / 2;
    const centerRight = centerLeft + ttRect.width;
    if (centerRight > vw - margin) setHAnchor('right');
    else if (centerLeft < margin) setHAnchor('left');
    else setHAnchor('center');

    // Vertical: prefer below; if overflowing bottom AND there's room above, flip to above
    const belowBottom = btnRect.bottom + 6 + ttRect.height;
    const spaceAbove = btnRect.top;
    if (belowBottom > vh - margin && spaceAbove > ttRect.height + 12) setVAnchor('above');
    else setVAnchor('below');
  }, [open]);

  const hClass =
    hAnchor === 'left'
      ? 'left-0'
      : hAnchor === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';
  const vClass = vAnchor === 'above' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <span ref={containerRef} className="relative inline-flex items-center gap-0.5 align-baseline">
      <span>{children ?? term}</span>
      <button
        type="button"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold text-slate-500 leading-none align-baseline hover:border-indigo-400 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        i
      </button>
      {open && (
        <span
          ref={tooltipRef}
          role="tooltip"
          className={`absolute ${hClass} ${vClass} z-50 w-[min(18rem,calc(100vw-1rem))] rounded-md border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-normal text-white shadow-lg leading-snug whitespace-normal`}
        >
          <span className="font-semibold">{term}: </span>
          {text}
        </span>
      )}
    </span>
  );
}
