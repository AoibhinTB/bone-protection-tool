'use client';

import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading, Segmented } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

export function Step1Demographics({ data, onChange }: Props) {
  return (
    <div>
      <SectionHeading>Patient demographics</SectionHeading>
      <Field label="Age" hint="Years">
        <NumInput
          value={data.age}
          // Coerce null → 0 only as a last resort (e.g. user blurs a blank
          // input). NumInput's local text buffer absorbs in-progress empties
          // so the user can clear and retype the first digit without the
          // value snapping back. PatientInput.age requires number (not null).
          onChange={v => onChange({ age: v ?? 0 })}
          min={18}
          max={120}
          unit="yrs"
          width="w-20"
        />
      </Field>
      <Field label="Biological sex">
        <Segmented
          value={data.sex}
          onChange={v => onChange({ sex: v, pregnantOrBreastfeeding: false, earlyMenopause: false, ageAtMenopause: null, aromataseInhibitorUse: false, adtUse: false })}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
      </Field>
      {data.sex === 'female' && (
        <Field
          label="Pregnant or breastfeeding"
          hint="Will be referred — out of scope for standard algorithm"
        >
          <YesNo
            value={data.pregnantOrBreastfeeding}
            onChange={v => onChange({ pregnantOrBreastfeeding: v })}
          />
        </Field>
      )}
      {/* v1.19 — Paget's disease moved out of demographics into Step 3
          (Risk Factors / past medical history) under "Clinical history". */}
      <Field
        label="Born outside Ireland"
        hint="FRAX should use the country-of-origin model — risk persists after migration (NOGG Table 2). The in-tool estimator uses Irish baselines (country 49); for non-Irish-born patients enter FRAX manually from frax.shef.ac.uk with the correct country selected."
      >
        <YesNo
          value={data.bornOutsideIreland}
          onChange={v => onChange({ bornOutsideIreland: v })}
        />
      </Field>
    </div>
  );
}
