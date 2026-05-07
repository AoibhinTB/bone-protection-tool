'use client';

import { useEffect, useRef, useState } from 'react';
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
 */
export function Term({ term, children, definition }: TermProps) {
  const text = definition ?? GLOSSARY[term];
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = pinned || hovering;

  useEffect(() => {
    if (!pinned) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setPinned(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pinned]);

  return (
    <span ref={ref} className="relative inline-flex items-center gap-0.5 align-baseline">
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
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-normal text-white shadow-lg leading-snug"
        >
          <span className="font-semibold">{term}: </span>
          {text}
        </span>
      )}
    </span>
  );
}
