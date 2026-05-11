'use client';

import type { PatientInput, SecondaryOsteoporosisCause } from '@/lib/guidelines/types';
import { SECONDARY_CAUSE_LABELS } from '@/lib/labels';
import { Field, NumInput, YesNo, SectionHeading, CheckboxGroup } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

const SECONDARY_OPTIONS = (
  Object.keys(SECONDARY_CAUSE_LABELS) as SecondaryOsteoporosisCause[]
).map(k => ({ value: k, label: SECONDARY_CAUSE_LABELS[k] }));

export function Step3RiskFactors({ data, onChange }: Props) {
  return (
    <div>
      <SectionHeading>FRAX clinical risk factors</SectionHeading>
      <Field label="Parental hip fracture">
        <YesNo
          value={data.parentalHipFracture}
          onChange={v => onChange({ parentalHipFracture: v })}
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
      <Field label="Rheumatoid arthritis" hint="FRAX risk factor — do NOT also tick 'secondary osteoporosis' in FRAX (double counts risk)">
        <YesNo
          value={data.rheumatoidArthritis}
          onChange={v => onChange({ rheumatoidArthritis: v })}
        />
      </Field>

      <SectionHeading>FRAX arithmetic adjustment factors</SectionHeading>
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
      <Field label="Falls in the last 12 months" hint="≥2 falls → hip risk ×1.3">
        <NumInput
          value={data.fallsInLastYear}
          onChange={v => onChange({ fallsInLastYear: v ?? 0 })}
          min={0}
          max={20}
          width="w-20"
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

      {/* v1.19 — Early menopause moved here from Step 4 (medications). It is a clinical
          history item and drives the POI / early-menopause pathway (Section 10.3). */}
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

      {/* v1.19 — Past medical history section. Paget's lives here (moved from
          Step 1) and oesophagealDiseaseHistory drives a Step-1 contraindication
          check on oral bisphosphonates (Section 5.2). */}
      <SectionHeading>Past medical history</SectionHeading>
      <Field label="Paget's disease of bone" hint="Requires specialist management — out of scope for the standard algorithm">
        <YesNo
          value={data.pagetsDiseaseOfBone}
          onChange={v => onChange({ pagetsDiseaseOfBone: v })}
        />
      </Field>
      <Field
        label="History of oesophageal disease"
        hint="Stricture / achalasia / dysmotility — permanent contraindication to ALL oral bisphosphonates. Engine routes to IV zoledronate (or denosumab if eGFR <35)."
      >
        <YesNo
          value={data.oesophagealDiseaseHistory}
          onChange={v => onChange({ oesophagealDiseaseHistory: v })}
        />
      </Field>

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

      <SectionHeading>Secondary osteoporosis causes</SectionHeading>
      <p className="text-sm text-slate-500 mb-3">Select all that apply</p>
      <CheckboxGroup<SecondaryOsteoporosisCause>
        options={SECONDARY_OPTIONS}
        selected={data.secondaryOsteoporosis}
        onChange={v => onChange({ secondaryOsteoporosis: v })}
        columns={2}
      />
    </div>
  );
}
