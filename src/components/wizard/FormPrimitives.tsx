'use client';

import { useState } from 'react';

// ─── Toggle (Yes / No) ────────────────────────────────────────────────────

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}

export function YesNo({ value, onChange, yesLabel = 'Yes', noLabel = 'No' }: ToggleProps) {
  return (
    <div className="inline-flex w-full sm:w-auto rounded-lg border border-slate-300 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex-1 sm:flex-initial px-5 sm:px-4 py-2.5 sm:py-1.5 font-medium transition-colors min-h-[44px] sm:min-h-0 ${
          value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 active:bg-slate-100 hover:bg-slate-50'
        }`}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex-1 sm:flex-initial px-5 sm:px-4 py-2.5 sm:py-1.5 font-medium transition-colors border-l border-slate-300 min-h-[44px] sm:min-h-0 ${
          !value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 active:bg-slate-100 hover:bg-slate-50'
        }`}
      >
        {noLabel}
      </button>
    </div>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────
// Mobile: label and control stack vertically. ≥sm: side-by-side.

interface FieldProps {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
  indent?: boolean;
}

export function Field({ label, hint, children, indent }: FieldProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 py-3 ${
        indent ? 'pl-4 sm:pl-6 border-l-2 border-indigo-100' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {hint && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div className="sm:flex-shrink-0">{children}</div>
    </div>
  );
}

// ─── Number input ─────────────────────────────────────────────────────────

interface NumInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  width?: string;
}

export function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
  width = 'w-24',
}: NumInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={focused && value === 0 ? '' : (value ?? '')}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder ?? '—'}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
        className={`${width} border border-slate-300 rounded-md px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[44px] sm:min-h-0`}
      />
      {unit && <span className="text-sm text-slate-500">{unit}</span>}
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold text-slate-900 mb-1 mt-6 first:mt-0">{children}</h2>
  );
}

export function Divider() {
  return <div className="border-t border-slate-100 my-1" />;
}

// ─── Multi-select checkboxes ──────────────────────────────────────────────

interface CheckboxGroupProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  columns?: 1 | 2;
}

export function CheckboxGroup<T extends string>({
  options,
  selected,
  onChange,
  columns = 2,
}: CheckboxGroupProps<T>) {
  const toggle = (val: T) => {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className={`grid gap-2 grid-cols-1 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-start gap-3 cursor-pointer group py-2 px-2 -mx-2 rounded-md active:bg-slate-100 sm:py-0 sm:px-0 sm:mx-0"
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-slate-700 group-hover:text-slate-900">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

// ─── Select dropdown ──────────────────────────────────────────────────────

interface SelectProps<T extends string> {
  value: T | '';
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
}

export function Select<T extends string>({ value, onChange, options, placeholder }: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full sm:w-auto sm:max-w-xs border border-slate-300 rounded-md px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Segmented picker (3+ options) ───────────────────────────────────────

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

export function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="inline-flex w-full sm:w-auto flex-wrap sm:flex-nowrap rounded-lg border border-slate-300 overflow-hidden text-sm">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2.5 sm:py-1.5 font-medium transition-colors min-h-[44px] sm:min-h-0 ${
            i > 0 ? 'border-l border-slate-300' : ''
          } ${
            value === opt.value
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-600 active:bg-slate-100 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
