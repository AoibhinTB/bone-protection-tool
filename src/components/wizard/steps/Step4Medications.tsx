'use client';

import type { PatientInput, GlucocorticoidDose } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading, Segmented } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

const GC_DOSE_OPTIONS: { value: GlucocorticoidDose; label: string }[] = [
  { value: 'very_low', label: '<2.5 mg/day' },
  { value: 'low', label: '2.5–7.4 mg' },
  { value: 'medium', label: '7.5–20 mg' },
  { value: 'high', label: '>20 mg/day' },
];

export function Step4Medications({ data, onChange }: Props) {
  const gcOn = data.glucocorticoidUse !== null;

  return (
    <div>
      <SectionHeading>Glucocorticoids</SectionHeading>
      <Field label="Current glucocorticoid use" hint="Prednisolone or equivalent">
        <YesNo
          value={gcOn}
          onChange={v =>
            onChange({
              glucocorticoidUse: v
                ? { current: true, durationMonths: 3, dose: 'low' }
                : null,
            })
          }
        />
      </Field>
      <Field
        label="Recent oral glucocorticoid use (stopped within last 12 months)"
        hint="Triggers VFA — silent vertebral fractures may have occurred during GC period"
      >
        <YesNo
          value={data.recentOralGlucocorticoidUse}
          onChange={v => onChange({ recentOralGlucocorticoidUse: v })}
        />
      </Field>
      {gcOn && data.glucocorticoidUse && (
        <>
          <Field label="Currently taking" indent>
            <YesNo
              value={data.glucocorticoidUse.current}
              onChange={v =>
                onChange({ glucocorticoidUse: { ...data.glucocorticoidUse!, current: v } })
              }
            />
          </Field>
          <Field label="Duration of use" indent>
            <NumInput
              value={data.glucocorticoidUse.durationMonths}
              onChange={v =>
                onChange({ glucocorticoidUse: { ...data.glucocorticoidUse!, durationMonths: v ?? 0 } })
              }
              min={0}
              max={360}
              unit="months"
              width="w-20"
            />
          </Field>
          <Field label="Daily dose (prednisolone equivalent)" indent>
            <Segmented<GlucocorticoidDose>
              value={data.glucocorticoidUse.dose}
              onChange={v =>
                onChange({ glucocorticoidUse: { ...data.glucocorticoidUse!, dose: v } })
              }
              options={GC_DOSE_OPTIONS}
            />
          </Field>
        </>
      )}

      <SectionHeading>Other medications</SectionHeading>
      {data.sex === 'male' && (
        <Field label="Androgen deprivation therapy (ADT)" hint="Prostate cancer treatment">
          <YesNo value={data.adtUse} onChange={v => onChange({ adtUse: v })} />
        </Field>
      )}
      {data.sex === 'female' && (
        <>
          <Field label="Aromatase inhibitor" hint="Breast cancer treatment">
            <YesNo
              value={data.aromataseInhibitorUse}
              onChange={v => onChange({ aromataseInhibitorUse: v })}
            />
          </Field>
          <Field label="Early menopause" hint="Menopause before age 45">
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
    </div>
  );
}
