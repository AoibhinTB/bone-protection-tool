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
          onChange={v => onChange({ age: v ?? 65 })}
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
      <Field label="Paget's disease of bone" hint="Requires specialist management — out of scope">
        <YesNo
          value={data.pagetsDiseaseOfBone}
          onChange={v => onChange({ pagetsDiseaseOfBone: v })}
        />
      </Field>
    </div>
  );
}
