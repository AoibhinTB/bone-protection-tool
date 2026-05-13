'use client';

import type { PatientInput, SecondaryOsteoporosisCause } from '@/lib/guidelines/types';
import { SECONDARY_CAUSE_LABELS } from '@/lib/labels';
import { Field, NumInput, YesNo, SectionHeading, CheckboxGroup } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

// Secondary causes reordered by organ system for display only. The schema
// labels (SECONDARY_CAUSE_LABELS) stay alphabetical so other consumers and
// engine output text are unchanged. This array is purely a UI display order:
// endocrine → GI/hepatic → renal/pulmonary → constitutional/bone →
// medications. No sub-headings are rendered between clusters; the ordering
// alone gives the grid visual rhythm without the heading clutter.
const SECONDARY_OPTIONS_BY_SYSTEM: { value: SecondaryOsteoporosisCause; label: string }[] = [
  // Endocrine
  { value: 'type1_diabetes',            label: SECONDARY_CAUSE_LABELS.type1_diabetes },
  { value: 'untreated_hyperthyroidism', label: SECONDARY_CAUSE_LABELS.untreated_hyperthyroidism },
  { value: 'hypogonadism',              label: SECONDARY_CAUSE_LABELS.hypogonadism },
  { value: 'cushing_syndrome',          label: SECONDARY_CAUSE_LABELS.cushing_syndrome },
  { value: 'hyperparathyroidism',       label: SECONDARY_CAUSE_LABELS.hyperparathyroidism },
  // GI / hepatic
  { value: 'celiac_disease',            label: SECONDARY_CAUSE_LABELS.celiac_disease },
  { value: 'inflammatory_bowel_disease',label: SECONDARY_CAUSE_LABELS.inflammatory_bowel_disease },
  { value: 'malabsorption',             label: SECONDARY_CAUSE_LABELS.malabsorption },
  { value: 'chronic_liver_disease',     label: SECONDARY_CAUSE_LABELS.chronic_liver_disease },
  // Renal / pulmonary
  { value: 'chronic_kidney_disease',    label: SECONDARY_CAUSE_LABELS.chronic_kidney_disease },
  { value: 'copd',                      label: SECONDARY_CAUSE_LABELS.copd },
  // Constitutional / bone
  { value: 'osteogenesis_imperfecta',   label: SECONDARY_CAUSE_LABELS.osteogenesis_imperfecta },
  { value: 'chronic_malnutrition',      label: SECONDARY_CAUSE_LABELS.chronic_malnutrition },
  // Medications
  { value: 'antiepileptic_use',         label: SECONDARY_CAUSE_LABELS.antiepileptic_use },
];

// Sub-heading inside Medical history. Smaller and lighter than SectionHeading
// so the hierarchy reads: Section (h2) → Sub-section (this) → Field.
function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-slate-700 mt-3 mb-1 first:mt-0">
      {children}
    </h3>
  );
}

export function Step3RiskFactors({ data, onChange }: Props) {
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

      <SubHeading>Endocrine</SubHeading>
      <Field label="Type 2 diabetes" hint="FRAX underestimates — MOF ×1.2 applied">
        <YesNo
          value={data.type2Diabetes}
          onChange={v =>
            onChange({
              type2Diabetes: v,
              onThiazolidinedione: v ? data.onThiazolidinedione : false,
            })
          }
        />
      </Field>
      {data.type2Diabetes && (
        <Field
          label="On a thiazolidinedione (pioglitazone)"
          hint="TZDs add to T2DM-related fracture risk; surfaces a clinical flag"
          indent
        >
          <YesNo
            value={data.onThiazolidinedione}
            onChange={v => onChange({ onThiazolidinedione: v })}
          />
        </Field>
      )}

      <SubHeading>Gastrointestinal</SubHeading>
      <Field
        label="History of oesophageal disease"
        hint="Stricture / achalasia / dysmotility — permanent contraindication to ALL oral bisphosphonates"
      >
        <YesNo
          value={data.oesophagealDiseaseHistory}
          onChange={v => onChange({ oesophagealDiseaseHistory: v })}
        />
      </Field>

      <SubHeading>Musculoskeletal / neurological</SubHeading>
      <Field
        label="Rheumatoid arthritis"
        hint="FRAX risk factor — do NOT also tick 'rheumatoid arthritis' under secondary causes below (double counts risk)"
      >
        <YesNo
          value={data.rheumatoidArthritis}
          onChange={v => onChange({ rheumatoidArthritis: v })}
        />
      </Field>
      <Field label="Parkinson's disease" hint="Hip fracture risk ×1.5">
        <YesNo
          value={data.parkinsonsDisease}
          onChange={v => onChange({ parkinsonsDisease: v })}
        />
      </Field>
      <Field label="Lower limb amputation" hint="NOGG 2024 — use clinical judgement">
        <YesNo
          value={data.lowerLimbAmputation}
          onChange={v => onChange({ lowerLimbAmputation: v })}
        />
      </Field>
      <Field label="Learning disabilities" hint="e.g. Down syndrome — NOGG 2024">
        <YesNo
          value={data.learningDisabilities}
          onChange={v => onChange({ learningDisabilities: v })}
        />
      </Field>

      <SubHeading>Cardiovascular</SubHeading>
      <Field
        label="MI or stroke within the last 12 months"
        hint="Cardiovascular contraindication to romosozumab (specialist-initiated anabolic)"
      >
        <YesNo
          value={data.priorMIOrStrokeWithin12Months}
          onChange={v => onChange({ priorMIOrStrokeWithin12Months: v })}
        />
      </Field>

      <SubHeading>Bone</SubHeading>
      <Field
        label="Paget's disease of bone"
        hint="Requires specialist management — out of scope for the standard algorithm"
      >
        <YesNo
          value={data.pagetsDiseaseOfBone}
          onChange={v => onChange({ pagetsDiseaseOfBone: v })}
        />
      </Field>

      <SubHeading>Other secondary causes of osteoporosis</SubHeading>
      <p className="text-sm text-slate-500 mb-3">
        Select all that apply. Listed in approximate order of organ system
        (endocrine, gastrointestinal, renal/pulmonary, constitutional,
        medications).
      </p>
      <CheckboxGroup<SecondaryOsteoporosisCause>
        options={SECONDARY_OPTIONS_BY_SYSTEM}
        selected={data.secondaryOsteoporosis}
        onChange={v => onChange({ secondaryOsteoporosis: v })}
        columns={2}
      />

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
