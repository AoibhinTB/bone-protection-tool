'use client';

import type { PatientInput, SecondaryOsteoporosisCause } from '@/lib/guidelines/types';
import { SECONDARY_CAUSE_LABELS } from '@/lib/labels';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

// One unified Medical history grid. Each row is a checkbox that maps to its
// own existing schema slot. Some rows are top-level booleans on PatientInput
// (RA, T2DM, Parkinson's, Paget's, oesophageal disease, MI/stroke, lower-limb
// amputation, learning disabilities). The rest map to membership in the
// secondaryOsteoporosis enum array.
//
// The schema is preserved — engine logic does not change and tests do not
// need rewriting. The UI just stops segregating "FRAX risk factor" vs
// "FRAX adjustment" vs "secondary cause" vs "past medical history", because
// that taxonomy is internal to the engine, not how clinicians read the form.
//
// The grid order flows by organ system (endocrine → GI/hepatic → renal/pulm
// → musculoskeletal/neuro → cardiovascular → bone → medications) so the list
// has visual rhythm without per-cluster sub-headings.
function buildMedicalHistoryRows(
  data: PatientInput,
  onChange: (patch: Partial<PatientInput>) => void,
): { key: string; label: string; hint?: string; checked: boolean; onToggle: () => void }[] {
  // Helpers for the secondaryOsteoporosis array — array-membership toggle.
  const hasSec = (k: SecondaryOsteoporosisCause) => data.secondaryOsteoporosis.includes(k);
  const toggleSec = (k: SecondaryOsteoporosisCause) => {
    const next = hasSec(k)
      ? data.secondaryOsteoporosis.filter(v => v !== k)
      : [...data.secondaryOsteoporosis, k];
    onChange({ secondaryOsteoporosis: next });
  };

  return [
    // ── Endocrine ─────────────────────────────────────────────────────
    {
      key: 'type2Diabetes',
      label: 'Type 2 diabetes',
      checked: data.type2Diabetes,
      onToggle: () => onChange({ type2Diabetes: !data.type2Diabetes }),
    },
    {
      key: 'type1_diabetes',
      label: SECONDARY_CAUSE_LABELS.type1_diabetes,
      checked: hasSec('type1_diabetes'),
      onToggle: () => toggleSec('type1_diabetes'),
    },
    {
      key: 'untreated_hyperthyroidism',
      label: SECONDARY_CAUSE_LABELS.untreated_hyperthyroidism,
      checked: hasSec('untreated_hyperthyroidism'),
      onToggle: () => toggleSec('untreated_hyperthyroidism'),
    },
    {
      key: 'hypogonadism',
      label: SECONDARY_CAUSE_LABELS.hypogonadism,
      checked: hasSec('hypogonadism'),
      onToggle: () => toggleSec('hypogonadism'),
    },
    {
      key: 'cushing_syndrome',
      label: SECONDARY_CAUSE_LABELS.cushing_syndrome,
      checked: hasSec('cushing_syndrome'),
      onToggle: () => toggleSec('cushing_syndrome'),
    },
    {
      key: 'hyperparathyroidism',
      label: SECONDARY_CAUSE_LABELS.hyperparathyroidism,
      checked: hasSec('hyperparathyroidism'),
      onToggle: () => toggleSec('hyperparathyroidism'),
    },

    // ── Gastrointestinal / hepatic ────────────────────────────────────
    {
      key: 'oesophagealDiseaseHistory',
      label: 'History of oesophageal disease',
      hint: 'Stricture / achalasia / dysmotility.',
      checked: data.oesophagealDiseaseHistory,
      onToggle: () => onChange({ oesophagealDiseaseHistory: !data.oesophagealDiseaseHistory }),
    },
    {
      key: 'celiac_disease',
      label: SECONDARY_CAUSE_LABELS.celiac_disease,
      checked: hasSec('celiac_disease'),
      onToggle: () => toggleSec('celiac_disease'),
    },
    {
      key: 'inflammatory_bowel_disease',
      label: SECONDARY_CAUSE_LABELS.inflammatory_bowel_disease,
      checked: hasSec('inflammatory_bowel_disease'),
      onToggle: () => toggleSec('inflammatory_bowel_disease'),
    },
    {
      key: 'malabsorption',
      label: SECONDARY_CAUSE_LABELS.malabsorption,
      checked: hasSec('malabsorption'),
      onToggle: () => toggleSec('malabsorption'),
    },
    {
      key: 'chronic_liver_disease',
      label: SECONDARY_CAUSE_LABELS.chronic_liver_disease,
      checked: hasSec('chronic_liver_disease'),
      onToggle: () => toggleSec('chronic_liver_disease'),
    },

    // ── Renal / pulmonary ─────────────────────────────────────────────
    {
      key: 'chronic_kidney_disease',
      label: SECONDARY_CAUSE_LABELS.chronic_kidney_disease,
      checked: hasSec('chronic_kidney_disease'),
      onToggle: () => toggleSec('chronic_kidney_disease'),
    },
    {
      key: 'copd',
      label: SECONDARY_CAUSE_LABELS.copd,
      checked: hasSec('copd'),
      onToggle: () => toggleSec('copd'),
    },

    // ── Musculoskeletal / neurological ────────────────────────────────
    {
      key: 'rheumatoidArthritis',
      label: 'Rheumatoid arthritis',
      checked: data.rheumatoidArthritis,
      onToggle: () => onChange({ rheumatoidArthritis: !data.rheumatoidArthritis }),
    },
    {
      key: 'parkinsonsDisease',
      label: 'Parkinson’s disease',
      checked: data.parkinsonsDisease,
      onToggle: () => onChange({ parkinsonsDisease: !data.parkinsonsDisease }),
    },
    {
      key: 'lowerLimbAmputation',
      label: 'Lower limb amputation',
      checked: data.lowerLimbAmputation,
      onToggle: () => onChange({ lowerLimbAmputation: !data.lowerLimbAmputation }),
    },
    {
      key: 'learningDisabilities',
      label: 'Learning disabilities (e.g. Down syndrome)',
      checked: data.learningDisabilities,
      onToggle: () => onChange({ learningDisabilities: !data.learningDisabilities }),
    },

    // ── Cardiovascular ───────────────────────────────────────────────
    {
      key: 'priorMIOrStrokeWithin12Months',
      label: 'MI or stroke within the last 12 months',
      checked: data.priorMIOrStrokeWithin12Months,
      onToggle: () => onChange({ priorMIOrStrokeWithin12Months: !data.priorMIOrStrokeWithin12Months }),
    },

    // ── Bone ──────────────────────────────────────────────────────────
    {
      key: 'pagetsDiseaseOfBone',
      label: 'Paget’s disease of bone',
      checked: data.pagetsDiseaseOfBone,
      onToggle: () => onChange({ pagetsDiseaseOfBone: !data.pagetsDiseaseOfBone }),
    },
    {
      key: 'osteogenesis_imperfecta',
      label: SECONDARY_CAUSE_LABELS.osteogenesis_imperfecta,
      checked: hasSec('osteogenesis_imperfecta'),
      onToggle: () => toggleSec('osteogenesis_imperfecta'),
    },
    {
      key: 'chronic_malnutrition',
      label: SECONDARY_CAUSE_LABELS.chronic_malnutrition,
      checked: hasSec('chronic_malnutrition'),
      onToggle: () => toggleSec('chronic_malnutrition'),
    },

    // ── Medications (kept here because antiepileptics are a clinical
    //    condition-driver, not a current-medication question on Step 4) ──
    {
      key: 'antiepileptic_use',
      label: SECONDARY_CAUSE_LABELS.antiepileptic_use,
      checked: hasSec('antiepileptic_use'),
      onToggle: () => toggleSec('antiepileptic_use'),
    },
  ];
}

export function Step3RiskFactors({ data, onChange }: Props) {
  const medicalHistoryRows = buildMedicalHistoryRows(data, onChange);

  return (
    <div>
      {/* ── Lifestyle ──────────────────────────────────────────────────── */}
      <SectionHeading>Lifestyle</SectionHeading>
      <Field label="BMI" hint="kg/m²">
        <NumInput
          value={data.bmi}
          onChange={v => onChange({ bmi: v })}
          min={10}
          max={70}
          step={0.1}
          unit="kg/m²"
          width="w-20"
        />
      </Field>
      <Field label="Current smoker">
        <YesNo
          value={data.currentSmoker}
          onChange={v => onChange({ currentSmoker: v })}
        />
      </Field>
      <Field label="Vaping" hint="NOGG 2024 addition — possible risk factor">
        <YesNo value={data.vaping} onChange={v => onChange({ vaping: v })} />
      </Field>
      <Field label="Alcohol" hint="≥21 units/week (3/day) is the FRAX threshold">
        <NumInput
          value={data.alcoholUnitsPerWeek}
          onChange={v => onChange({ alcoholUnitsPerWeek: v ?? 0 })}
          min={0}
          max={100}
          step={1}
          unit="units/wk"
          width="w-20"
        />
      </Field>
      <Field label="Falls in the last 12 months" hint="≥2 falls → hip risk ×1.3">
        <NumInput
          value={data.fallsInLastYear}
          onChange={v => onChange({ fallsInLastYear: v ?? 0 })}
          min={0}
          max={20}
          width="w-20"
        />
      </Field>

      {/* ── Family history ─────────────────────────────────────────────── */}
      <SectionHeading>Family history</SectionHeading>
      <Field label="Parental hip fracture">
        <YesNo
          value={data.parentalHipFracture}
          onChange={v => onChange({ parentalHipFracture: v })}
        />
      </Field>

      {/* ── Medical history ────────────────────────────────────────────── */}
      <SectionHeading>Medical history</SectionHeading>
      <p className="text-sm text-slate-500 mb-3">
        Tick all conditions that apply. Listed in approximate order of organ
        system; hover any row for clinical context.
      </p>
      <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
        {medicalHistoryRows.map(row => (
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

      {/* ── Reproductive history (female only) ────────────────────────── */}
      {data.sex === 'female' && (
        <>
          <SectionHeading>Reproductive history</SectionHeading>
          <Field label="Early menopause" hint="Menopause before age 45 — drives the POI / early-menopause pathway">
            <YesNo
              value={data.earlyMenopause}
              onChange={v =>
                onChange({ earlyMenopause: v, ageAtMenopause: v ? data.ageAtMenopause : null })
              }
            />
          </Field>
          {data.earlyMenopause && (
            <Field label="Age at menopause" indent>
              <NumInput
                value={data.ageAtMenopause}
                onChange={v => onChange({ ageAtMenopause: v })}
                min={20}
                max={45}
                unit="yrs"
                width="w-20"
              />
            </Field>
          )}
        </>
      )}

      {/* ── HRT safety (affects first-line recommendations) ───────────── */}
      <SectionHeading>HRT safety (affects first-line recommendations)</SectionHeading>
      <Field label="Personal or family history of VTE" hint="DVT, PE — affects HRT safety assessment">
        <YesNo
          value={data.vteHistory}
          onChange={v => onChange({ vteHistory: v })}
        />
      </Field>
      <Field label="Personal history of breast cancer or high breast cancer risk">
        <YesNo
          value={data.breastCancerHistory}
          onChange={v => onChange({ breastCancerHistory: v })}
        />
      </Field>
    </div>
  );
}
