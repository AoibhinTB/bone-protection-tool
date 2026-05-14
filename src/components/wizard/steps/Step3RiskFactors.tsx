'use client';

import type { PatientInput, SecondaryOsteoporosisCause } from '@/lib/guidelines/types';
import { SECONDARY_CAUSE_LABELS } from '@/lib/labels';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

// v1.31 follow-up — page 3 is now Medical History only. Lifestyle, falls /
// fractures, parental hip fracture, reproductive history and HRT safety moved
// to page 2 (Patient History). This step renders a single 23-item checkbox
// grid; each tick maps to its existing schema slot (top-level boolean for
// RA / T2DM / Parkinson's / Paget's / oesophageal disease / MI-stroke /
// lower-limb amputation / learning disabilities, or array membership in
// secondaryOsteoporosis for the rest).
//
// Grid order flows by organ system (endocrine → GI/hepatic → renal/pulm →
// musculoskeletal/neuro → cardiovascular → bone → medications) so the list
// has visual rhythm without per-cluster sub-headings.
function buildMedicalHistoryRows(
  data: PatientInput,
  onChange: (patch: Partial<PatientInput>) => void,
): { key: string; label: string; hint?: string; checked: boolean; onToggle: () => void }[] {
  const hasSec = (k: SecondaryOsteoporosisCause) => data.secondaryOsteoporosis.includes(k);
  const toggleSec = (k: SecondaryOsteoporosisCause) => {
    const next = hasSec(k)
      ? data.secondaryOsteoporosis.filter(v => v !== k)
      : [...data.secondaryOsteoporosis, k];
    onChange({ secondaryOsteoporosis: next });
  };

  return [
    // Endocrine
    { key: 'type2Diabetes', label: 'Type 2 diabetes',
      checked: data.type2Diabetes,
      onToggle: () => onChange({ type2Diabetes: !data.type2Diabetes }) },
    { key: 'type1_diabetes', label: SECONDARY_CAUSE_LABELS.type1_diabetes,
      checked: hasSec('type1_diabetes'),
      onToggle: () => toggleSec('type1_diabetes') },
    { key: 'untreated_hyperthyroidism', label: SECONDARY_CAUSE_LABELS.untreated_hyperthyroidism,
      checked: hasSec('untreated_hyperthyroidism'),
      onToggle: () => toggleSec('untreated_hyperthyroidism') },
    { key: 'hypogonadism', label: SECONDARY_CAUSE_LABELS.hypogonadism,
      checked: hasSec('hypogonadism'),
      onToggle: () => toggleSec('hypogonadism') },
    { key: 'cushing_syndrome', label: SECONDARY_CAUSE_LABELS.cushing_syndrome,
      checked: hasSec('cushing_syndrome'),
      onToggle: () => toggleSec('cushing_syndrome') },
    { key: 'hyperparathyroidism', label: SECONDARY_CAUSE_LABELS.hyperparathyroidism,
      checked: hasSec('hyperparathyroidism'),
      onToggle: () => toggleSec('hyperparathyroidism') },

    // GI / hepatic
    { key: 'oesophagealDiseaseHistory', label: 'History of oesophageal disease',
      hint: 'Stricture / achalasia / dysmotility.',
      checked: data.oesophagealDiseaseHistory,
      onToggle: () => onChange({ oesophagealDiseaseHistory: !data.oesophagealDiseaseHistory }) },
    { key: 'celiac_disease', label: SECONDARY_CAUSE_LABELS.celiac_disease,
      checked: hasSec('celiac_disease'),
      onToggle: () => toggleSec('celiac_disease') },
    { key: 'inflammatory_bowel_disease', label: SECONDARY_CAUSE_LABELS.inflammatory_bowel_disease,
      checked: hasSec('inflammatory_bowel_disease'),
      onToggle: () => toggleSec('inflammatory_bowel_disease') },
    { key: 'malabsorption', label: SECONDARY_CAUSE_LABELS.malabsorption,
      checked: hasSec('malabsorption'),
      onToggle: () => toggleSec('malabsorption') },
    { key: 'chronic_liver_disease', label: SECONDARY_CAUSE_LABELS.chronic_liver_disease,
      checked: hasSec('chronic_liver_disease'),
      onToggle: () => toggleSec('chronic_liver_disease') },

    // Renal / pulmonary
    { key: 'chronic_kidney_disease', label: SECONDARY_CAUSE_LABELS.chronic_kidney_disease,
      checked: hasSec('chronic_kidney_disease'),
      onToggle: () => toggleSec('chronic_kidney_disease') },
    { key: 'copd', label: SECONDARY_CAUSE_LABELS.copd,
      checked: hasSec('copd'),
      onToggle: () => toggleSec('copd') },

    // Musculoskeletal / neurological
    { key: 'rheumatoidArthritis', label: 'Rheumatoid arthritis',
      checked: data.rheumatoidArthritis,
      onToggle: () => onChange({ rheumatoidArthritis: !data.rheumatoidArthritis }) },
    { key: 'parkinsonsDisease', label: 'Parkinson’s disease',
      checked: data.parkinsonsDisease,
      onToggle: () => onChange({ parkinsonsDisease: !data.parkinsonsDisease }) },
    { key: 'lowerLimbAmputation', label: 'Lower limb amputation',
      checked: data.lowerLimbAmputation,
      onToggle: () => onChange({ lowerLimbAmputation: !data.lowerLimbAmputation }) },
    { key: 'learningDisabilities', label: 'Learning disabilities (e.g. Down syndrome)',
      checked: data.learningDisabilities,
      onToggle: () => onChange({ learningDisabilities: !data.learningDisabilities }) },

    // Cardiovascular
    { key: 'priorMIOrStroke', label: 'Prior MI or stroke (any time)',
      hint: 'Romosozumab contraindicated with any MI or stroke history (NOGG 2024 / spec §5.5) — no time window.',
      checked: data.priorMIOrStroke,
      onToggle: () => onChange({ priorMIOrStroke: !data.priorMIOrStroke }) },

    // Bone
    { key: 'pagetsDiseaseOfBone', label: 'Paget’s disease of bone',
      checked: data.pagetsDiseaseOfBone,
      onToggle: () => onChange({ pagetsDiseaseOfBone: !data.pagetsDiseaseOfBone }) },
    { key: 'osteogenesis_imperfecta', label: SECONDARY_CAUSE_LABELS.osteogenesis_imperfecta,
      checked: hasSec('osteogenesis_imperfecta'),
      onToggle: () => toggleSec('osteogenesis_imperfecta') },
    { key: 'chronic_malnutrition', label: SECONDARY_CAUSE_LABELS.chronic_malnutrition,
      checked: hasSec('chronic_malnutrition'),
      onToggle: () => toggleSec('chronic_malnutrition') },

    // (Anti-epileptic drugs moved to Step 4 Medications page per NOGG 2024
    // Table 4 — they are a medication-class case-finder, not a condition.
    // Engine behaviour unchanged: still flagged via secondaryOsteoporosis
    // array membership of 'antiepileptic_use'.)
  ];
}

export function Step3RiskFactors({ data, onChange }: Props) {
  const rows = buildMedicalHistoryRows(data, onChange);

  return (
    <div>
      <p className="text-sm text-slate-600 mb-4">
        Tick all conditions that apply. Listed in approximate order of organ
        system; hover any row for clinical context where present.
      </p>
      <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
        {rows.map(row => (
          <label
            key={row.key}
            className="flex items-start gap-3 cursor-pointer group py-2 px-2 -mx-2 rounded-md active:bg-slate-100 sm:py-0 sm:px-0 sm:mx-0"
            title={row.hint}
          >
            <input
              type="checkbox"
              checked={row.checked}
              onChange={row.onToggle}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-800 leading-snug">
              {row.label}
              {row.hint && (
                <span className="block text-xs text-slate-500 mt-0.5">{row.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
