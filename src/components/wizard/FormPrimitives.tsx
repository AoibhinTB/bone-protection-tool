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
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-4 py-1.5 font-medium transition-colors ${
          value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-4 py-1.5 font-medium transition-colors border-l border-slate-300 ${
          !value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        {noLabel}
      </button>
    </div>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  indent?: boolean;
}

export function Field({ label, hint, children, indent }: FieldProps) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${indent ? 'pl-6 border-l-2 border-indigo-100' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
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

export function NumInput({ value, onChange, min, max, step = 1, unit, placeholder, width = 'w-24' }: NumInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={focused && value === 0 ? '' : (value ?? '')}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder ?? '—'}
        onFocus={e => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={e => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
        className={`${width} border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent`}
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

export function CheckboxGroup<T extends string>({ options, selected, onChange, columns = 2 }: CheckboxGroupProps<T>) {
  const toggle = (val: T) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {options.map(opt => (
        <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
      onChange={e => onChange(e.target.value as T)}
      className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-xs"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
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
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 py-1.5 font-medium transition-colors ${i > 0 ? 'border-l border-slate-300' : ''} ${
            value === opt.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
