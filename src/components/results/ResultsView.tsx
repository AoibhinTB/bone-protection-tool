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

// ─── Unified AlertCard ────────────────────────────────────────────────────
// One layout for urgent / warning / info. Visible: badge + 2-line action + source.
// Collapsible rationale via "show rationale" toggle.

function AlertCard({ flag }: { flag: ClinicalFlag }) {
  const [showRationale, setShowRationale] = useState(false);
  const fc = FLAG_CONFIG[flag.severity];
  const isUrgent = flag.severity === 'urgent';

  return (
    <div className={`${fc.bg} border-l-[6px] ${fc.border} rounded-r-lg p-3 sm:p-4 ${fc.ring}`}>
      <div className="flex items-start gap-2 mb-1.5">
        <Badge className={fc.badge}>{fc.label}</Badge>
      </div>
      <p
        className={`${isUrgent ? 'text-base font-bold' : 'text-sm font-semibold'} ${fc.text} leading-snug line-clamp-3`}
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
          {/* If the message was clamped, still allow access to the full text in the same expansion */}
          <p className={`text-xs ${fc.text} opacity-70 mt-1.5 leading-snug`}>
            <span className="font-semibold">Full alert: </span>
            {flag.message}
          </p>
        </div>
      )}
    </div>
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

  // v1.34 — the NOGG Rec 1 no-risk-factor gate is detectable by the rationale prefix
  // (the only path that emits this string). When in this state and a reveal callback
  // is provided, render the "Show calculated FRAX anyway" toggle.
  const noRfGateActive =
    typeof onRevealNoRfFrax === 'function' &&
    !patient.noRiskFactorOverride &&
    rs.rationale.startsWith('No clinical risk factors identified.');

  return (
    <div className="space-y-5 sm:space-y-6">
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

      {/* TREATMENT FIRST — clinician sees what to prescribe at the top */}
      {result.treatmentRecommendations.length > 0 && (
        <section>
          <SectionTitle>Treatment</SectionTitle>
          <div className="space-y-3">
            {result.treatmentRecommendations.map((tr, i) => {
              const isAlt = tr.priority === 'alternative';
              return (
                <div
                  key={i}
                  className={`bg-white border rounded-lg p-4 shadow-sm ${
                    isAlt ? 'border-slate-200 opacity-95' : 'border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg sm:text-xl font-bold text-slate-900 capitalize leading-tight">
                        {tr.agent}
                      </p>
                      {isAlt ? (
                        <Badge className="bg-slate-200 text-slate-700">Second-line alternative</Badge>
                      ) : (
                        <Badge className="bg-indigo-600 text-white">First-line</Badge>
                      )}
                    </div>
                    <Badge
                      className={
                        tr.strength === 'strong'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-slate-100 text-slate-600'
                      }
                    >
                      {tr.strength === 'strong' ? 'Strong' : 'Conditional'}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">
                    {tr.dose} · {tr.frequency}
                  </p>
                  <p className="text-xs text-slate-600 mb-2 leading-snug">{tr.rationale}</p>

                  {tr.irishPrescribingNote && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded px-3 py-2 mb-2">
                      <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide mb-0.5">
                        Ireland prescribing
                      </p>
                      <p className="text-xs text-indigo-900 leading-snug">{tr.irishPrescribingNote}</p>
                    </div>
                  )}

                  {tr.contraindications.length > 0 && (
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

                  {tr.monitoring.length > 0 && (
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

                  {tr.patientEducation && <PatientEducationPanel edu={tr.patientEducation} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Clinical alerts — single unified format for urgent / warning / info */}
      {sortedFlags.length > 0 && (
        <section>
          <SectionTitle>Clinical alerts</SectionTitle>
          <div className="space-y-2">
            {sortedFlags.map((flag) => (
              <AlertCard key={flag.id} flag={flag} />
            ))}
          </div>
        </section>
      )}

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

          function InvCard({ inv }: { inv: typeof sortedInvestigations[0] }) {
            const uc = URGENCY_CONFIG[inv.urgency];
            const bullets = INVESTIGATION_BULLETS[inv.investigation];

            // Tier 1 / Tier 2 blood tests with curated bullet content render as collapsibles
            if (bullets) {
              return (
                <CollapsibleCard
                  summary={
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">
                        {formatInvestigationName(inv.investigation)}
                      </span>
                      {inv.urgency !== 'routine' && <Badge className={uc.color}>{uc.label}</Badge>}
                    </span>
                  }
                  defaultOpen={false}
                >
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

            // Other investigations (DEXA, VFA, FRAX, PTH, testosterone, etc.) keep the flat card
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
