'use client';

import { useState } from 'react';
import type {
  ClinicalDecision,
  ClinicalFlag,
  PatientInput,
  TrafficLight,
  FlagSeverity,
  Urgency,
  PatientEducation,
  TreatmentRecommendation,
  SpecialistOption,
} from '@/lib/guidelines/types';
import { Term } from '@/components/Tooltip';
import { BLOOD_RANGES } from '@/lib/guidelines/thresholds';

interface Props {
  result: ClinicalDecision;
  patient: PatientInput;
  onReset: () => void;
  onBack: () => void;
  /** v1.34 — reveals the calculated FRAX when the no-RF gate has suppressed it.
   *  Called when the user toggles the "Show calculated FRAX anyway" control on the
   *  no-risk-factor gate result page. Re-runs the engine with noRiskFactorOverride=true. */
  onRevealNoRfFrax?: () => void;
}

const TL_CONFIG: Record<TrafficLight, { bg: string; border: string; text: string; label: string }> = {
  green:    { bg: 'bg-emerald-50',  border: 'border-emerald-500', text: 'text-emerald-900', label: 'Low Risk' },
  amber:    { bg: 'bg-amber-50',    border: 'border-amber-500',   text: 'text-amber-900',   label: 'Intermediate Risk' },
  red:      { bg: 'bg-red-50',      border: 'border-red-600',     text: 'text-red-900',     label: 'High Risk' },
  dark_red: { bg: 'bg-red-100',     border: 'border-red-800',     text: 'text-red-950',     label: 'Very High Risk' },
  grey:     { bg: 'bg-slate-100',   border: 'border-slate-400',   text: 'text-slate-800',   label: 'Out of Scope' },
};

const FLAG_CONFIG: Record<FlagSeverity, { bg: string; border: string; badge: string; text: string; ring: string; label: string }> = {
  urgent:  { bg: 'bg-red-50',   border: 'border-red-600',   badge: 'bg-red-600 text-white',         text: 'text-red-950',   ring: 'ring-2 ring-red-300', label: 'Urgent' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-500', badge: 'bg-amber-500 text-white',       text: 'text-amber-950', ring: '',                    label: 'Warning' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-400',  badge: 'bg-blue-100 text-blue-800',     text: 'text-blue-950',  ring: '',                    label: 'Info' },
};

const URGENCY_CONFIG: Record<Urgency, { label: string; color: string }> = {
  urgent:  { label: 'Urgent',  color: 'bg-red-600 text-white font-semibold' },
  soon:    { label: 'Soon',    color: 'bg-amber-500 text-white font-semibold' },
  routine: { label: 'Routine', color: 'bg-slate-100 text-slate-700' },
};

const SEVERITY_ORDER: Record<FlagSeverity, number> = { urgent: 0, warning: 1, info: 2 };
const URGENCY_ORDER: Record<Urgency, number> = { urgent: 0, soon: 1, routine: 2 };

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-3 mt-2">{children}</h2>;
}

function sourceText(flag: ClinicalFlag): string {
  return `${flag.source.guideline} ${flag.source.year}${flag.source.section ? ` §${flag.source.section}` : ''}`;
}

// ─── Clinical Alerts severity-clustering (v1.45) ──────────────────────────
// AlertCard renders full-size for Urgent cluster; collapsed-by-default
// (title + chevron) for Warning + Info clusters. Click anywhere on a collapsed
// card expands to the full layout (badge + body + source + rationale toggle).
//
// Cluster headers (small severity-coloured caps) and the cluster partition
// live at the section render site below; AlertCard is parameterised on a
// `collapsedDefault` prop driven by the cluster.
//
// Title for the collapsed state: prefer `flag.summary` if present (curated
// short hint); otherwise auto-truncate `flag.message` at first sentence
// boundary or 100 chars + ellipsis.

function truncateForTitle(text: string): string {
  // Split on first period+space to capture the first sentence cleanly.
  const dotIdx = text.indexOf('. ');
  if (dotIdx > 0 && dotIdx < 120) {
    return text.slice(0, dotIdx + 1);
  }
  if (text.length > 100) {
    return text.slice(0, 100).trimEnd() + '…';
  }
  return text;
}

function AlertCard({ flag, collapsedDefault }: { flag: ClinicalFlag; collapsedDefault: boolean }) {
  const [expanded, setExpanded] = useState(!collapsedDefault);
  const [showRationale, setShowRationale] = useState(false);
  const fc = FLAG_CONFIG[flag.severity];
  const isUrgent = flag.severity === 'urgent';

  // Collapsed-state render: button with severity-coloured 6px left border,
  // title only (summary if present else truncated message), chevron affordance.
  // No badge, no body, no source — those re-appear when expanded.
  if (!expanded) {
    const title = flag.summary ?? truncateForTitle(flag.message);
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`w-full text-left bg-white border-l-[6px] ${fc.border} rounded-r-lg px-3 py-2 hover:bg-slate-50 active:bg-slate-100 transition-colors min-h-[44px] flex items-center justify-between gap-3`}
        aria-expanded="false"
      >
        <span className={`text-sm font-semibold ${fc.text} leading-snug flex-1`}>
          {title}
        </span>
        <span className="shrink-0 text-slate-400 text-xs" aria-hidden="true">▾</span>
      </button>
    );
  }

  // Expanded-state render: full card layout (existing).
  return (
    <div className={`${fc.bg} border-l-[6px] ${fc.border} rounded-r-lg p-3 sm:p-4 ${fc.ring}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Badge className={fc.badge}>{fc.label}</Badge>
        {collapsedDefault && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="shrink-0 text-slate-400 hover:text-slate-700 text-xs"
            aria-label="Collapse alert"
          >
            ▴
          </button>
        )}
      </div>
      <p
        className={`${isUrgent ? 'text-base font-bold' : 'text-sm font-semibold'} ${fc.text} leading-snug`}
      >
        {flag.message}
      </p>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500">{sourceText(flag)}</p>
        <button
          type="button"
          onClick={() => setShowRationale((s) => !s)}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2"
        >
          {showRationale ? '▴ hide rationale' : '▾ show rationale'}
        </button>
      </div>
      {showRationale && (
        <div className="mt-2 pt-2 border-t border-slate-200/60">
          <p className={`text-xs ${fc.text} opacity-90 leading-snug`}>{flag.rationale}</p>
        </div>
      )}
    </div>
  );
}

// ─── Hoisted SpecialistReferralBanner ─────────────────────────────────────
// Visually distinct from AlertCard (full-bleed red, large heading-inline-with-
// badge) to function as a top-of-page headline for VHR patients. Rationale
// collapsed by default behind a "▾ show rationale" toggle matching AlertCard's
// pattern, so the banner reads as headline + action + source at a glance.

function SpecialistReferralBanner({ flag }: { flag: ClinicalFlag }) {
  const [showRationale, setShowRationale] = useState(false);
  return (
    <section className="mb-2 sm:mb-3">
      <div className="bg-red-600 text-white rounded-lg p-5 sm:p-6 shadow-lg ring-4 ring-red-200">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-white text-red-700">
            Urgent
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold leading-tight">
            Specialist referral required
          </h2>
        </div>
        <p className="text-base sm:text-lg font-semibold leading-snug mb-3">
          {flag.message}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[11px] text-red-100 opacity-80">{sourceText(flag)}</p>
          <button
            type="button"
            onClick={() => setShowRationale((s) => !s)}
            className="text-[11px] font-medium text-red-100 hover:text-white underline underline-offset-2"
          >
            {showRationale ? '▴ hide rationale' : '▾ show rationale'}
          </button>
        </div>
        {showRationale && (
          <div className="mt-3 pt-3 border-t border-red-300/40">
            <p className="text-sm text-red-50 opacity-95 leading-snug">{flag.rationale}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {open ? '▴ Hide' : '▾ Show'} {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

// ─── Collapsible card with one-line summary header ────────────────────────

function CollapsibleCard({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`bg-white border rounded-lg overflow-hidden transition-colors ${
        open ? 'border-indigo-300' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`group w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-indigo-50 hover:bg-indigo-50/60 transition-colors min-h-[48px] ${
          open ? 'bg-indigo-50/40' : ''
        }`}
        aria-expanded={open}
      >
        <span className="text-sm text-slate-800 flex-1 min-w-0">{summary}</span>
        <span
          className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 group-hover:border-indigo-400 group-hover:text-indigo-600 transition-transform ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && <div className="px-4 pb-3 pt-2 border-t border-slate-100">{children}</div>}
    </div>
  );
}

// ─── Bullet content for Tier 1 / Tier 2 blood investigation cards ─────────

const INVESTIGATION_BULLETS: Partial<Record<string, string[]>> = {
  calcium: [
    'Hypocalcaemia (<2.1 mmol/L): correct before starting bisphosphonate or denosumab',
    'Hypercalcaemia (>2.6 mmol/L): may indicate primary hyperparathyroidism — refer endocrinology',
    'Normal range: 2.1–2.6 mmol/L',
  ],
  vitamin_d: [
    'Not yet measured: check at baseline',
    'Target: ≥75 nmol/L',
    'Supplement 800–2,000 IU/day pending result (higher end for BMI ≥30 / malabsorption)',
    'Bisphosphonate may start alongside supplementation — do NOT delay treatment',
    'Do NOT administer denosumab until Vit D ≥50 nmol/L',
    'Safety ceiling: do not exceed 4,000 IU/day long-term without specialist supervision',
  ],
  egfr: [
    'Required to select safe agent',
    'eGFR <35: alendronate and zoledronate contraindicated',
    'eGFR <30: risedronate also contraindicated',
    'eGFR <35 on denosumab: mandatory corrected calcium check 2 weeks after every injection',
  ],
  alp: [
    'Bone turnover marker — useful baseline before treatment',
    'Elevated ALP + low calcium / Vit D: consider osteomalacia',
    'Markedly elevated ALP: investigate before starting treatment — may indicate Paget\'s disease',
    'Unexplained raised ALP: contraindication to teriparatide',
  ],
  fbc: [
    'Hb is the key FBC signal for myeloma exclusion (anaemia → SPEP/UPEP)',
    'Anaemia threshold: <120 g/L women, <130 g/L men',
    'Severe anaemia (<80 g/L) — investigate cause urgently before bone treatment',
    'Other FBC abnormalities (high WCC etc.) interpreted on their own merits',
  ],
  esr_crp: [
    'Either ESR or CRP — both screen for inflammation',
    'Elevated → SPEP/UPEP indicated to exclude myeloma',
    'Other differentials: RA, connective tissue disease, infection, malignancy generally',
  ],
};

// ─── Blood test result entries ───────────────────────────────────────────

interface BloodEntry {
  name: string;
  value: string;
  status: 'normal' | 'abnormal';
  statusLabel: string; // "insufficient", "elevated", "normal", etc.
  bullets: string[];
}

function buildBloodEntries(patient: PatientInput): BloodEntry[] {
  const entries: BloodEntry[] = [];
  const b = patient.bloodResults;
  if (!b) return entries;

  // Vitamin D
  if (b.vitaminDNmol !== null) {
    const v = b.vitaminDNmol;
    if (v < BLOOD_RANGES.vitaminD.deficient) {
      entries.push({
        name: 'Vitamin D (25-OH)',
        value: `${v} nmol/L`,
        status: 'abnormal',
        statusLabel: 'severe deficiency',
        bullets: [
          'Loading option A: 50,000 IU D3 once weekly × 6–8 weeks (300,000–400,000 IU total)',
          'Loading option B: 30,000 IU D3 twice weekly × 5 weeks (300,000 IU total)',
          'Recheck 25-OHD ~3 months after loading (target ≥75 nmol/L)',
          'Bisphosphonate may start alongside loading — do NOT delay',
          'Do NOT administer denosumab until Vit D ≥50 nmol/L',
        ],
      });
    } else if (v < BLOOD_RANGES.vitaminD.insufficient) {
      entries.push({
        name: 'Vitamin D (25-OH)',
        value: `${v} nmol/L`,
        status: 'abnormal',
        statusLabel: 'insufficient',
        bullets: [
          'Start 800–2,000 IU/day cholecalciferol (higher end for BMI ≥30 / malabsorption)',
          'Oral bisphosphonate can start alongside supplementation',
          'Do NOT administer denosumab until Vit D ≥50 nmol/L',
          'Recheck at ~3 months; target ≥75 nmol/L',
        ],
      });
    } else if (v < BLOOD_RANGES.vitaminD.target) {
      entries.push({
        name: 'Vitamin D (25-OH)',
        value: `${v} nmol/L`,
        status: 'normal',
        statusLabel: 'adequate, below target',
        bullets: [
          '800–2,000 IU/day maintenance',
          'Antiresorptive therapy can proceed',
          'Recheck in 6–12 months',
        ],
      });
    } else {
      entries.push({
        name: 'Vitamin D (25-OH)',
        value: `${v} nmol/L`,
        status: 'normal',
        statusLabel: 'target met',
        bullets: ['800–2,000 IU/day maintenance', 'No loading required'],
      });
    }
  }

  // Adjusted calcium
  if (b.adjustedCalciumMmol !== null) {
    const c = b.adjustedCalciumMmol;
    if (c > BLOOD_RANGES.adjustedCalcium.high) {
      entries.push({
        name: 'Adjusted calcium',
        value: `${c} mmol/L`,
        status: 'abnormal',
        statusLabel: 'hypercalcaemia',
        bullets: [
          'Investigate cause (PTH, malignancy) BEFORE bone treatment',
          'Bisphosphonate / denosumab contraindicated in untreated hypercalcaemia of malignancy',
          'Refer endocrinology if PTH-driven',
        ],
      });
    } else if (c < BLOOD_RANGES.adjustedCalcium.low) {
      entries.push({
        name: 'Adjusted calcium',
        value: `${c} mmol/L`,
        status: 'abnormal',
        statusLabel: 'hypocalcaemia',
        bullets: [
          'Correct before bisphosphonate or denosumab',
          'Likely cause: vitamin D deficiency / secondary hyperparathyroidism',
          'Replace Vit D first; recheck calcium at 6–8 weeks',
          'Consider PTH measurement',
        ],
      });
    } else {
      entries.push({
        name: 'Adjusted calcium',
        value: `${c} mmol/L`,
        status: 'normal',
        statusLabel: 'normal',
        bullets: ['Within reference range (2.10–2.60 mmol/L)', 'No barrier to antiresorptive therapy'],
      });
    }
  }

  // eGFR
  const egfr = b.egfr ?? null;
  if (egfr !== null) {
    if (egfr <= 35) {
      entries.push({
        name: 'eGFR',
        value: `${egfr} ml/min/1.73 m²`,
        status: 'abnormal',
        statusLabel: 'bisphosphonate boundary',
        bullets: [
          'Alendronate / zoledronate contraindicated at this level',
          'Risedronate contraindicated below 30',
          'Denosumab preferred (not renally cleared)',
          'Mandatory adjusted calcium check 2 weeks after every denosumab injection',
        ],
      });
    } else if (egfr < 50) {
      entries.push({
        name: 'eGFR',
        value: `${egfr} ml/min/1.73 m²`,
        status: 'abnormal',
        statusLabel: 'borderline renal function',
        bullets: [
          'Oral bisphosphonate (alendronate or risedronate) preferred over IV zoledronate',
          'Avoid IV zoledronate when eGFR <45',
          'Monitor eGFR at least annually',
        ],
      });
    } else {
      entries.push({
        name: 'eGFR',
        value: `${egfr} ml/min/1.73 m²`,
        status: 'normal',
        statusLabel: 'adequate',
        bullets: ['No renal restrictions on bisphosphonate or denosumab'],
      });
    }
  }

  // ALP
  if (b.alp !== null) {
    const a = b.alp;
    if (a > 200) {
      entries.push({
        name: 'ALP',
        value: `${a} U/L`,
        status: 'abnormal',
        statusLabel: 'markedly elevated',
        bullets: [
          'Exclude Paget\'s disease and osteomalacia BEFORE bone treatment',
          'Check LFTs, vitamin D, calcium, PTH, isoenzymes',
          'Unexplained raised ALP is a contraindication to teriparatide',
        ],
      });
    } else if (a > 130) {
      entries.push({
        name: 'ALP',
        value: `${a} U/L`,
        status: 'abnormal',
        statusLabel: 'mildly elevated',
        bullets: [
          'Non-specific — consider Vit D deficiency, recent fracture, mild liver disease',
          'Check LFTs / GGT to differentiate hepatic vs bone source',
          'Recheck after Vit D repletion',
        ],
      });
    } else if (a < 30) {
      entries.push({
        name: 'ALP',
        value: `${a} U/L`,
        status: 'abnormal',
        statusLabel: 'low',
        bullets: [
          'Consider hypophosphatasia (heritable) — bisphosphonate may worsen',
          'Also: zinc deficiency, malnutrition, hypothyroidism',
          'Discuss with specialist before antiresorptive',
        ],
      });
    } else {
      entries.push({
        name: 'ALP',
        value: `${a} U/L`,
        status: 'normal',
        statusLabel: 'normal',
        bullets: ['Within reference range (30–130 U/L)'],
      });
    }
  }

  // TSH
  if (b.tshMUL !== null) {
    const t = b.tshMUL;
    const onLevo = patient.onThyroidReplacement;
    if (t < 0.1) {
      entries.push({
        name: 'TSH',
        value: `${t} mU/L`,
        status: 'abnormal',
        statusLabel: 'fully suppressed',
        bullets: onLevo
          ? [
              'Levothyroxine over-replacement — reduce dose',
              'Recheck TSH in 6 weeks',
              'Bone density gains follow dose reduction',
            ]
          : [
              'Investigate hyperthyroidism BEFORE bone treatment',
              'Endogenous causes: Graves, toxic nodule',
              'Refer endocrinology',
            ],
      });
    } else if (t < 0.4) {
      entries.push({
        name: 'TSH',
        value: `${t} mU/L`,
        status: 'abnormal',
        statusLabel: 'mildly suppressed',
        bullets: [
          'Subclinical hyperthyroidism — increased fracture risk in older adults',
          onLevo ? 'Consider levothyroxine dose reduction' : 'Recheck in 6–8 weeks',
          'Endocrinology input if persistent',
        ],
      });
    } else if (t > 10) {
      entries.push({
        name: 'TSH',
        value: `${t} mU/L`,
        status: 'abnormal',
        statusLabel: 'markedly elevated',
        bullets: onLevo
          ? [
              'Levothyroxine under-replacement — increase dose',
              'Recheck in 6 weeks',
              'Optimise thyroid status before/alongside bone therapy',
            ]
          : [
              'Likely overt hypothyroidism',
              'Treat before or alongside bone therapy',
              'Recheck after thyroid optimisation',
            ],
      });
    } else if (t > 4.0) {
      entries.push({
        name: 'TSH',
        value: `${t} mU/L`,
        status: 'abnormal',
        statusLabel: 'mildly elevated',
        bullets: [
          'Subclinical hypothyroidism',
          onLevo ? 'Consider dose increase; recheck in 6 weeks' : 'Recheck and consider treatment if persistent or symptomatic',
        ],
      });
    } else {
      entries.push({
        name: 'TSH',
        value: `${t} mU/L`,
        status: 'normal',
        statusLabel: 'normal',
        bullets: ['Within reference range (0.4–4.0 mU/L)'],
      });
    }
  }

  // Hb / anaemia
  if (b.hbGramsPerLitre !== null) {
    const hb = b.hbGramsPerLitre;
    const threshold = patient.sex === 'female' ? 120 : 130;
    if (hb < 80) {
      entries.push({
        name: 'Hb',
        value: `${hb} g/L`,
        status: 'abnormal',
        statusLabel: 'severe anaemia',
        bullets: [
          'Severe anaemia — investigate urgently',
          'Add SPEP/UPEP, serum free light chains, full myeloma workup',
          'Consider GI bleeding, B12/folate, iron, chronic disease',
          'Hold elective bone treatment pending diagnosis',
        ],
      });
    } else if (hb < threshold) {
      entries.push({
        name: 'Hb',
        value: `${hb} g/L`,
        status: 'abnormal',
        statusLabel: 'anaemia',
        bullets: [
          `Below sex-specific threshold (<${threshold} g/L for ${patient.sex})`,
          'Add SPEP/UPEP and serum free light chains — exclude myeloma',
          'Investigate other causes (B12/folate, iron, chronic disease)',
        ],
      });
    } else {
      entries.push({
        name: 'Hb',
        value: `${hb} g/L`,
        status: 'normal',
        statusLabel: 'normal',
        bullets: [`At/above sex threshold (≥${threshold} g/L for ${patient.sex})`, 'No anaemia flag'],
      });
    }
  }

  // ESR or CRP
  if (b.esrOrCrp !== null) {
    if (b.esrOrCrp === 'elevated') {
      entries.push({
        name: 'ESR / CRP',
        value: 'Elevated',
        status: 'abnormal',
        statusLabel: 'elevated',
        bullets: [
          'Add SPEP/UPEP — exclude myeloma',
          'Other differentials: RA, connective tissue disease, infection, malignancy generally',
          'Investigate alongside FBC and SPEP/UPEP',
        ],
      });
    } else {
      entries.push({
        name: 'ESR / CRP',
        value: 'Normal',
        status: 'normal',
        statusLabel: 'normal',
        bullets: ['No inflammatory flag'],
      });
    }
  }

  return entries;
}

function PatientEducationPanel({ edu }: { edu: PatientEducation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-teal-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-teal-50 active:bg-teal-100 hover:bg-teal-100 transition-colors text-left min-h-[44px]"
      >
        <span className="text-xs font-semibold text-teal-700">Patient education information</span>
        <span className="text-teal-500 text-xs">{open ? '▴ hide' : '▾ show'}</span>
      </button>
      {open && (
        <div className="px-3 py-3 bg-white space-y-3">
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">What this medicine does</p>
            <p className="text-xs text-slate-700">{edu.whatItDoes}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">How to take it</p>
            <p className="text-xs text-slate-700">{edu.howToTake}</p>
          </div>
          {edu.sideEffects.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-teal-700 mb-0.5">Common side effects</p>
              <ul className="text-xs text-slate-700 space-y-0.5 list-disc list-inside">
                {edu.sideEffects.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {edu.warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-800 mb-0.5">Important warnings</p>
              <ul className="text-xs text-amber-900 space-y-0.5 list-disc list-inside font-medium">
                {edu.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One card layout for both primary and bridging treatment entries. Bridging variant is
// used for VHR patients where oral BP is interim cover while awaiting specialist anabolic
// initiation — visually de-emphasised, "First-line"/"Strong" badges dropped (misleading
// at this risk level), but full prescribing detail preserved so the GP can safely start
// the bridging therapy.
function TreatmentCard({ tr, variant }: { tr: TreatmentRecommendation; variant: 'primary' | 'bridging' | 'patient_preference_fallback' }) {
  const isAlt = tr.priority === 'alternative';
  const isBridging = variant === 'bridging';
  const isPatientPref = variant === 'patient_preference_fallback';
  const muted = isBridging || isPatientPref;
  return (
    <div
      className={`rounded-lg shadow-sm ${
        muted
          ? 'bg-slate-50 border border-slate-200 p-3.5'
          : isAlt
            ? 'bg-white border border-slate-200 opacity-95 p-4'
            : 'bg-white border border-slate-300 p-4'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={`${
              muted ? 'text-base' : 'text-lg sm:text-xl'
            } font-bold text-slate-900 capitalize leading-tight`}
          >
            {tr.agent}
          </p>
          {isBridging ? (
            <Badge className="bg-amber-100 text-amber-800">Interim cover</Badge>
          ) : isPatientPref ? (
            // v1.44 — badge flipped from "Patient-preference option" to "Pending specialist
            // review" for the VHR-non-GC + refusal variant. Section title at the parent
            // section (ResultsView Treatment block) still reads "Patient-preference option"
            // — the concept stays; the badge carries the gate signal ("do not initiate
            // before specialist consultation"). Engine entries' rich content (dose,
            // contraindications, monitoring, patient education) is preserved on the
            // TreatmentRecommendation but suppressed from the patient-preference card
            // render below — these cards are documentation/handoff notes for the
            // specialist referral, not prescribing cards.
            <Badge className="bg-amber-100 text-amber-800">Pending specialist review</Badge>
          ) : isAlt ? (
            <Badge className="bg-slate-200 text-slate-700">Second-line alternative</Badge>
          ) : (
            <Badge className="bg-indigo-600 text-white">First-line</Badge>
          )}
        </div>
        {!muted && (
          <Badge
            className={
              tr.strength === 'strong'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-600'
            }
          >
            {tr.strength === 'strong' ? 'Strong' : 'Conditional'}
          </Badge>
        )}
      </div>
      {!isPatientPref && (
        <p className="text-sm font-semibold text-slate-800 mb-1">
          {tr.dose} · {tr.frequency}
        </p>
      )}
      <p className="text-xs text-slate-600 mb-2 leading-snug">{tr.rationale}</p>

      {!isPatientPref && tr.irishPrescribingNote && (
        <div className="bg-indigo-50 border border-indigo-200 rounded px-3 py-2 mb-2">
          <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide mb-0.5">
            Ireland prescribing
          </p>
          <p className="text-xs text-indigo-900 leading-snug">{tr.irishPrescribingNote}</p>
        </div>
      )}

      {!isPatientPref && tr.contraindications.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-r px-3 py-2 mb-2">
          <p className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-1">
            Contraindications
          </p>
          <ul className="text-xs text-red-900 font-medium space-y-1 list-disc list-inside leading-snug">
            {tr.contraindications.map((c, j) => (
              <li key={j}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {!isPatientPref && tr.monitoring.length > 0 && (
        <Disclosure label="monitoring details">
          <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside leading-snug">
            {tr.monitoring.map((m, j) => (
              <li key={j}>{m}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <p className="text-[11px] text-slate-400 mt-2">
        {tr.source.guideline} {tr.source.year}
      </p>

      {!isPatientPref && tr.patientEducation && <PatientEducationPanel edu={tr.patientEducation} />}
    </div>
  );
}

// v1.43 Shape B — specialist-menu card. Visually distinct from TreatmentCard
// (indigo/violet accent vs neutral white) to make clear these are NOT
// GP-prescribable. Abaloparatide's reimbursementNote surfaces in an amber
// tint so the reimbursement caveat is unmissable. preReferralChecks render
// collapsibly via the existing Disclosure pattern.
function SpecialistOptionCard({ opt }: { opt: SpecialistOption }) {
  const isFirstLine = opt.tier === 'first_line';
  return (
    <div className="rounded-lg shadow-sm bg-violet-50 border border-violet-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-lg font-bold text-violet-900 capitalize leading-tight">
            {opt.drug}
          </p>
          <Badge className="bg-violet-600 text-white">Specialist option</Badge>
        </div>
        {isFirstLine && (
          <Badge className="bg-violet-200 text-violet-900">First-line anabolic</Badge>
        )}
      </div>
      <p className="text-xs text-slate-700 mb-2 leading-snug">{opt.rationale}</p>
      {opt.reimbursementNote && (
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r px-3 py-2 mb-2">
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-0.5">
            Reimbursement
          </p>
          <p className="text-xs text-amber-950 font-medium leading-snug">
            {opt.reimbursementNote}
          </p>
        </div>
      )}
      {opt.preReferralChecks && (
        <Disclosure label="pre-referral checks (GP)">
          <p className="text-xs text-slate-700 leading-snug">{opt.preReferralChecks}</p>
        </Disclosure>
      )}
      {opt.contextNotes && (
        <p className="text-xs text-slate-600 italic mt-1.5 leading-snug">{opt.contextNotes}</p>
      )}
      <p className="text-[11px] text-slate-500 mt-2">{opt.reference}</p>
    </div>
  );
}

// v1.43 Shape B — "Specialist may consider" section, extracted as a top-level
// component so the Treatment-block render can position it conditionally. For most
// VHR profiles it renders below the Treatment block as a standalone section. For
// VHR-non-GC + refusal patients (fallback is the only Treatment-block content), it
// renders ABOVE the Patient-preference fallback cards — the specialist menu is
// the clinically primary surface, fallback cards are documentation/handoff only.
function SpecialistMayConsiderSection({ options }: { options: SpecialistOption[] }) {
  if (options.length === 0) return null;
  const firstLine = options.filter((o) => o.tier === 'first_line');
  const further = options.filter((o) => o.tier === 'further_option');
  return (
    <section>
      <SectionTitle>Specialist may consider</SectionTitle>
      <p className="text-xs text-slate-600 -mt-2 mb-3 leading-snug">
        Options the specialist may consider after your referral. GP does not prescribe these in primary care.
      </p>
      {firstLine.length > 0 && (
        <div className="space-y-3">
          {firstLine.map((opt, i) => (
            <SpecialistOptionCard key={`first-${i}`} opt={opt} />
          ))}
        </div>
      )}
      {further.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 mt-4 mb-2">
            Further options
          </p>
          <div className="space-y-3">
            {further.map((opt, i) => (
              <SpecialistOptionCard key={`further-${i}`} opt={opt} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function ResultsView({ result, patient, onReset, onBack, onRevealNoRfFrax }: Props) {
  const bloodEntries = buildBloodEntries(patient);
  const rs = result.riskStratification;
  const tl = TL_CONFIG[rs.trafficLight];

  const sortedFlags = [...result.flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const sortedInvestigations = [...result.investigationsNeeded].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
  );
  const sortedReferrals = [...result.referrals].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
  );

  const mofChanged =
    rs.adjustedFraxMOFPercent !== null &&
    rs.fraxMOFPercent !== null &&
    rs.adjustedFraxMOFPercent !== rs.fraxMOFPercent;
  const hipChanged =
    rs.adjustedFraxHipPercent !== null &&
    rs.fraxHipPercent !== null &&
    rs.adjustedFraxHipPercent !== rs.fraxHipPercent;

  // v1.34 — the NOGG Rec 1 no-risk-factor gate sets riskStratification.gatedNoRfs.
  // When the gate has fired AND a reveal callback is provided, render the
  // "Show calculated FRAX anyway" toggle.
  const noRfGateActive = typeof onRevealNoRfFrax === 'function' && rs.gatedNoRfs;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Hoisted SPECIALIST REFERRAL — for ALL VHR patients, the specialist referral is
          THE action. Rendered as the very first child so a clinician scrolling the page
          top-to-bottom cannot miss it. Flag remains duplicated below in Clinical alerts
          for consistency with the unified flag rendering.
          Severity check intentionally absent: the flag is gated engine-side on
          riskCategory === 'very_high' at both push sites (standard VHR block +
          GIOP Option B mirror), so it ONLY fires for VHR patients. Severity is
          'urgent' for GC-driven VHR and 'warning' otherwise — the GP action
          (specialist referral now) is the same in both cases, so visual treatment
          is unified. The GC-driven bridging-bisphosphonate instruction is carried
          in the flag message text itself, not by severity styling. */}
      {(() => {
        const specRefFlag = sortedFlags.find(
          (f) => f.id === 'vhr_specialist_referral',
        );
        return specRefFlag ? <SpecialistReferralBanner flag={specRefFlag} /> : null;
      })()}

      {/* Traffic light banner */}
      <div className={`${tl.bg} border-l-4 ${tl.border} rounded-r-lg p-4 sm:p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-2xl sm:text-3xl font-extrabold ${tl.text} leading-tight`}>{tl.label}</p>
            <p className={`text-sm mt-2 ${tl.text} opacity-90 leading-snug`}>{rs.rationale}</p>
          </div>
          {result.outOfScope && (
            <Badge className="bg-slate-200 text-slate-700 mt-1">Out of scope</Badge>
          )}
        </div>

        {(rs.fraxMOFPercent !== null || rs.fraxHipPercent !== null) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {rs.fraxMOFPercent !== null && (
              <div>
                <span className={`${tl.text} opacity-70`}>MOF </span>
                <span className={`font-bold ${tl.text}`}>{rs.fraxMOFPercent.toFixed(1)}%</span>
                {mofChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxMOFPercent!.toFixed(1)}% adj
                  </span>
                )}
              </div>
            )}
            {rs.fraxHipPercent !== null && (
              <div>
                <Term term="Hip">
                  <span className={`${tl.text} opacity-70`}>Hip</span>
                </Term>
                <span className={`${tl.text} opacity-70`}> </span>
                <span className={`font-bold ${tl.text}`}>{rs.fraxHipPercent.toFixed(1)}%</span>
                {hipChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxHipPercent!.toFixed(1)}% adj
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {rs.fraxAdjustments.length > 0 && (
          <p className={`text-xs mt-2 ${tl.text} opacity-70`}>
            Adjustments:{' '}
            {rs.fraxAdjustments.map((a) => `${a.factor} ×${a.multiplier} (${a.appliedTo})`).join(' · ')}
          </p>
        )}

        {noRfGateActive && (
          <button
            type="button"
            onClick={onRevealNoRfFrax}
            className={`mt-3 text-xs font-medium ${tl.text} opacity-80 hover:opacity-100 underline underline-offset-2`}
          >
            Show calculated FRAX anyway →
          </button>
        )}
      </div>

      {/* Patient summary */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Patient</p>
        <p className="text-sm text-slate-800">{result.patientSummary}</p>
      </div>

      {/* Risk factors identified — only those that materially changed the recommendation */}
      {result.riskFactorsIdentified.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-2">
            Risk factors identified
          </p>
          <ul className="space-y-1.5">
            {result.riskFactorsIdentified.map((rf, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-800 leading-snug">
                <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                <span>
                  <span className="font-semibold">{rf.factor}</span>
                  <span className="text-slate-600"> — {rf.effect}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* TREATMENT block + SPECIALIST MAY CONSIDER — coordinated render. The
          Treatment block contains: primary entries (GP-prescribable); bridging
          entries (GC-driven VHR oral-BP interim cover, v1.43 Shape B);
          patient-preference-fallback entries (VHR-non-GC + refusal oral-BP
          documentation, v1.43 Shape B + v1.44 content variant). The Specialist
          may consider section renders BELOW Treatment in the standard case;
          for VHR-non-GC + refusal patients (fallback is the only Treatment-block
          content, v1.44 §2c ordering), it renders ABOVE the fallback section
          because anabolic-referral is the clinically primary surface — fallback
          cards are documentation/handoff for the specialist letter. */}
      {(() => {
        const recs = result.treatmentRecommendations;
        const primary = recs.filter((tr) => tr.category !== 'bridging' && tr.category !== 'patient_preference_fallback');
        const bridging = recs.filter((tr) => tr.category === 'bridging');
        const fallback = recs.filter((tr) => tr.category === 'patient_preference_fallback');
        const hasAnyVHRSpecialistOptions = result.specialistOptions.length > 0;
        // Empty Treatment + specialistOptions populated → render placeholder. The hoist
        // banner above already states "Specialist referral required"; this placeholder
        // keeps the page narrative intact between Risk factors and "Specialist may
        // consider" below.
        const showEmptyTreatmentPlaceholder =
          recs.length === 0 && hasAnyVHRSpecialistOptions;
        // v1.44 §2c — when fallback is the only Treatment-block content, the
        // Specialist may consider section renders ABOVE the fallback section.
        const fallbackOnly =
          fallback.length > 0 && primary.length === 0 && bridging.length === 0;
        return (
          <>
            {primary.length > 0 && (
              <section>
                <SectionTitle>Treatment</SectionTitle>
                <div className="space-y-3">
                  {primary.map((tr, i) => (
                    <TreatmentCard key={`primary-${i}`} tr={tr} variant="primary" />
                  ))}
                </div>
              </section>
            )}
            {bridging.length > 0 && (
              <section>
                <SectionTitle>Start now while awaiting specialist</SectionTitle>
                <p className="text-xs text-slate-600 -mt-2 mb-3 leading-snug">
                  Interim cover until specialist initiates anabolic therapy. Full prescribing detail below.
                </p>
                <div className="space-y-3">
                  {bridging.map((tr, i) => (
                    <TreatmentCard key={`bridging-${i}`} tr={tr} variant="bridging" />
                  ))}
                </div>
              </section>
            )}
            {fallbackOnly && (
              <SpecialistMayConsiderSection options={result.specialistOptions} />
            )}
            {fallback.length > 0 && (
              <section>
                <SectionTitle>Patient-preference option</SectionTitle>
                <p className="text-xs text-slate-600 -mt-2 mb-3 leading-snug">
                  Patient has declined injectable therapy. Oral bisphosphonates are the documented patient-preference path pending specialist review. GP does not initiate before specialist consultation.
                </p>
                <div className="space-y-3">
                  {fallback.map((tr, i) => (
                    <TreatmentCard key={`fallback-${i}`} tr={tr} variant="patient_preference_fallback" />
                  ))}
                </div>
              </section>
            )}
            {showEmptyTreatmentPlaceholder && (
              <section>
                <SectionTitle>Treatment</SectionTitle>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-sm text-slate-700 leading-snug">
                    Treatment will be initiated by the specialist after referral — see specialist options below.
                  </p>
                </div>
              </section>
            )}
            {!fallbackOnly && (
              <SpecialistMayConsiderSection options={result.specialistOptions} />
            )}
          </>
        );
      })()}

      {/* Clinical alerts — v1.45 severity-clustering. Three clusters with
          severity-coloured sub-headers: Urgent (full-size cards), Warning
          (collapsed-by-default), Information (collapsed-by-default). Cluster
          headers render only when their cluster is non-empty. Within-cluster
          ordering preserved (sortedFlags is already severity-ordered via
          SEVERITY_ORDER; same-severity flags retain emission order via
          stable sort). */}
      {sortedFlags.length > 0 &&
        (() => {
          const urgentFlags  = sortedFlags.filter((f) => f.severity === 'urgent');
          const warningFlags = sortedFlags.filter((f) => f.severity === 'warning');
          const infoFlags    = sortedFlags.filter((f) => f.severity === 'info');
          return (
            <section>
              <SectionTitle>Clinical alerts</SectionTitle>
              {urgentFlags.length > 0 && (
                <>
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-red-700 mt-0 mb-2">
                    Urgent
                  </p>
                  <div className="space-y-2">
                    {urgentFlags.map((flag) => (
                      <AlertCard key={flag.id} flag={flag} collapsedDefault={false} />
                    ))}
                  </div>
                </>
              )}
              {warningFlags.length > 0 && (
                <>
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-700 mt-4 mb-2">
                    Warning
                  </p>
                  <div className="space-y-2">
                    {warningFlags.map((flag) => (
                      <AlertCard key={flag.id} flag={flag} collapsedDefault={true} />
                    ))}
                  </div>
                </>
              )}
              {infoFlags.length > 0 && (
                <>
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-blue-700 mt-4 mb-2">
                    Information
                  </p>
                  <div className="space-y-2">
                    {infoFlags.map((flag) => (
                      <AlertCard key={flag.id} flag={flag} collapsedDefault={true} />
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })()}

      {/* Investigations */}
      {sortedInvestigations.length > 0 &&
        (() => {
          const noTier = sortedInvestigations.filter((i) => !i.tier);
          const tier1 = sortedInvestigations.filter((i) => i.tier === 1);
          const tier2 = sortedInvestigations.filter((i) => i.tier === 2);
          const tier3 = sortedInvestigations.filter((i) => i.tier === 3);

          function formatInvestigationName(id: string): string {
            // Preserve canonical capitalisation (e.g. eGFR), expand abbreviations as needed.
            switch (id) {
              case 'egfr':       return 'eGFR';
              case 'frax':       return 'FRAX';
              case 'dexa':       return 'DEXA';
              case 'vfa':        return 'VFA';
              case 'alp':        return 'ALP';
              case 'fbc':        return 'FBC';
              case 'pth':        return 'PTH';
              case 'lh_fsh':     return 'LH / FSH';
              case 'spep_upep':  return 'SPEP / UPEP';
              case 'thyroid':    return 'Thyroid (TSH ± T4)';
              case 'testosterone': return 'Testosterone';
              case 'vitamin_d':  return 'Vitamin D';
              case 'calcium':    return 'Adjusted calcium';
              case 'phosphate':  return 'Serum phosphate';
              case 'lfts':       return 'Liver transaminases (ALT, AST)';
              case 'esr_crp':    return 'ESR or CRP';
              default:           return id.replace(/_/g, ' ');
            }
          }

          // Analytes that get a CollapsibleCard with the engine's `reason` rendered as a
          // paragraph inside the collapse (rather than curated bullets). Used for entries
          // where the engine's reason is already multi-sentence clinical content but no
          // curated bullets exist in INVESTIGATION_BULLETS. Keeps the collapsible UX
          // consistent with the bullets-based pattern without inventing new content.
          const COLLAPSIBLE_PARAGRAPH_ANALYTES = new Set(['pth', 'phosphate', 'lfts']);

          function InvCard({ inv }: { inv: typeof sortedInvestigations[0] }) {
            const uc = URGENCY_CONFIG[inv.urgency];
            const bullets = INVESTIGATION_BULLETS[inv.investigation];
            const summary = (
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-900">
                  {formatInvestigationName(inv.investigation)}
                </span>
                {inv.urgency !== 'routine' && <Badge className={uc.color}>{uc.label}</Badge>}
              </span>
            );

            // Tier 1 / Tier 2 blood tests with curated bullet content render as collapsibles
            if (bullets) {
              return (
                <CollapsibleCard summary={summary} defaultOpen={false}>
                  <ul className="space-y-1 mt-1">
                    {bullets.map((b, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-slate-700 leading-snug">
                        <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </CollapsibleCard>
              );
            }

            // PTH / phosphate / LFTs — engine `reason` rendered as paragraph inside a
            // CollapsibleCard. No curated bullets, no string-splitting; the multi-sentence
            // reason text is preserved verbatim behind the collapse toggle.
            if (COLLAPSIBLE_PARAGRAPH_ANALYTES.has(inv.investigation)) {
              return (
                <CollapsibleCard summary={summary} defaultOpen={false}>
                  <p className="text-xs text-slate-700 leading-snug mt-1">{inv.reason}</p>
                </CollapsibleCard>
              );
            }

            // Other investigations (DEXA, VFA, FRAX, testosterone, lh_fsh, thyroid, spep_upep)
            // keep the flat card. Not yet surfaced in live testing as problematic; cheap to
            // route through CollapsibleCard later if any do.
            return (
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-sm font-bold text-slate-900">
                    {formatInvestigationName(inv.investigation)}
                  </p>
                  {inv.urgency !== 'routine' && <Badge className={uc.color}>{uc.label}</Badge>}
                </div>
                <p className="text-xs text-slate-600 leading-snug">{inv.reason}</p>
              </div>
            );
          }

          function SubHeading({ label, color }: { label: string; color: string }) {
            return (
              <p
                className={`text-[11px] font-bold uppercase tracking-wide mb-2 mt-4 first:mt-0 ${color}`}
              >
                {label}
              </p>
            );
          }

          return (
            <section>
              <SectionTitle>Investigations</SectionTitle>

              {noTier.length > 0 && (
                <div className="space-y-2">
                  {noTier.map((inv, i) => (
                    <InvCard key={i} inv={inv} />
                  ))}
                </div>
              )}

              {tier1.length > 0 && (
                <>
                  <SubHeading label="Mandatory pre-treatment bloods" color="text-red-700" />
                  <div className="space-y-2">
                    {tier1.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}

              {tier2.length > 0 && (
                <>
                  <SubHeading label="Recommended baseline bloods" color="text-amber-700" />
                  <div className="space-y-2">
                    {tier2.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}

              {tier3.length > 0 && (
                <>
                  <SubHeading
                    label="Further investigations — if clinically indicated"
                    color="text-slate-500"
                  />
                  <div className="space-y-2">
                    {tier3.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })()}

      {/* Referrals */}
      {sortedReferrals.length > 0 && (
        <section>
          <SectionTitle>Referrals</SectionTitle>
          <div className="space-y-2">
            {sortedReferrals.map((ref, i) => {
              const uc = URGENCY_CONFIG[ref.urgency];
              const specialty = ref.specialty
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-bold text-slate-900">{specialty}</p>
                    <Badge className={uc.color}>{uc.label}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 leading-snug">{ref.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Blood test results — collapsible per-test entries */}
      {bloodEntries.length > 0 && (
        <section>
          <SectionTitle>Blood test results</SectionTitle>
          <div className="space-y-2">
            {bloodEntries.map((e, i) => (
              <CollapsibleCard
                key={i}
                summary={
                  <span>
                    <span className="font-semibold text-slate-900">{e.name}</span>
                    <span className="text-slate-700"> — {e.value}</span>
                    <span
                      className={`ml-1 text-xs ${
                        e.status === 'abnormal' ? 'text-red-700 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      ({e.statusLabel})
                    </span>
                  </span>
                }
                defaultOpen={false}
              >
                <ul className="space-y-1 mt-2">
                  {e.bullets.map((b, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-slate-700 leading-snug">
                      <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </CollapsibleCard>
            ))}
          </div>
        </section>
      )}

      {/* Supplements — bullet format, collapsed by default with one-line summary */}
      {result.supplements.length > 0 && (
        <section>
          <SectionTitle>Supplements</SectionTitle>
          <div className="space-y-2">
            {result.supplements.map((s, i) => (
              <CollapsibleCard
                key={i}
                summary={
                  <span>
                    <span className="font-semibold text-slate-900">
                      {s.supplement === 'calcium' ? 'Calcium' : 'Vitamin D'}
                    </span>
                    <span className="text-slate-700"> — {s.headline}</span>
                  </span>
                }
                defaultOpen={false}
              >
                {s.bullets.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {s.bullets.map((b, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-slate-700 leading-snug">
                        <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Disclosure label="rationale">
                  <p className="text-xs text-slate-500 leading-snug">{s.rationale}</p>
                </Disclosure>
              </CollapsibleCard>
            ))}
          </div>
        </section>
      )}

      {/* Lifestyle advice — collapsed by default */}
      {result.lifestyleAdvice.length > 0 && (
        <section>
          <SectionTitle>Lifestyle advice</SectionTitle>
          <CollapsibleCard
            summary={
              <span>
                <span className="font-semibold text-slate-900">Lifestyle advice</span>
                <span className="text-slate-700"> — {result.lifestyleAdvice.length} points (diet, exercise, falls prevention, calcium, Vit D, alcohol)</span>
              </span>
            }
            defaultOpen={false}
          >
            <ul className="space-y-2 mt-2">
              {result.lifestyleAdvice.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-snug">
                  <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </CollapsibleCard>
        </section>
      )}

      {/* Review schedule */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Review schedule</p>
        <p className="text-sm text-slate-800">{result.reviewSchedule}</p>
      </div>

      {/* Guidelines used */}
      <p className="text-[11px] text-slate-400 leading-snug">
        <span className="font-semibold">Guidelines: </span>
        {result.guidelinesUsed.join(' · ')}
      </p>

      {/* Navigation */}
      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-3 sm:py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 bg-white active:bg-slate-100 hover:bg-slate-50 transition-colors min-h-[44px]"
        >
          ← Edit inputs
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-5 py-3 sm:py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 bg-white active:bg-slate-100 hover:bg-slate-50 transition-colors min-h-[44px]"
        >
          New patient
        </button>
      </div>
    </div>
  );
}
