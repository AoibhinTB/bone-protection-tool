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

// v1.13 — derive the legacy categorical bucket from the numeric mg/day so both
// fields stay in sync. Engine prefers numeric, but categorical is kept for
// backwards compatibility with persisted/loaded patient data.
function bucketFromMgDay(mg: number): GlucocorticoidDose {
  if (mg < 2.5) return 'very_low';
  if (mg < 7.5) return 'low';
  if (mg <= 20) return 'medium';
  return 'high';
}

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
              glucocorticoidDoseMgDay: v ? 5 : null,
              // If turning GC on, clear "previously used" since current overrides.
              glucocorticoidPreviouslyUsed: v ? false : data.glucocorticoidPreviouslyUsed,
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
          <Field
            label="Daily dose (prednisolone equivalent)"
            hint="Enter the exact dose in mg/day — drives Table 8 FRAX correction (low <2.5 ↓; medium 2.5–7.5 none; high ≥7.5 ↑)"
            indent
          >
            <NumInput
              value={data.glucocorticoidDoseMgDay}
              onChange={v =>
                onChange({
                  glucocorticoidDoseMgDay: v,
                  // Keep legacy categorical in sync for backwards compatibility.
                  glucocorticoidUse: data.glucocorticoidUse
                    ? { ...data.glucocorticoidUse, dose: v != null && v > 0 ? bucketFromMgDay(v) : data.glucocorticoidUse.dose }
                    : data.glucocorticoidUse,
                })
              }
              min={0}
              max={120}
              step={0.5}
              unit="mg/day"
              width="w-24"
            />
          </Field>
          <Field label="Or pick a dose band" hint="Optional shortcut — only used if mg/day is left blank" indent>
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
      {!gcOn && (
        <Field
          label="Previously on long-term oral glucocorticoid (now stopped)"
          hint="Drives the GC-withdrawal bone-protection review (Section 9.4) — fires when patient is currently off GC and on a bisphosphonate"
        >
          <YesNo
            value={data.glucocorticoidPreviouslyUsed}
            onChange={v => onChange({ glucocorticoidPreviouslyUsed: v })}
          />
        </Field>
      )}

      <SectionHeading>Other medications</SectionHeading>
      <Field
        label="On levothyroxine"
        hint="Affects TSH interpretation — under/over-replacement contributes to bone loss"
      >
        <YesNo
          value={data.onThyroidReplacement}
          onChange={v => onChange({ onThyroidReplacement: v })}
        />
      </Field>
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
              onChange={v =>
                onChange({
                  aromataseInhibitorUse: v,
                  hadAdjuvantHighDoseBisphosphonate: v ? data.hadAdjuvantHighDoseBisphosphonate : false,
                })
              }
            />
          </Field>
          {data.aromataseInhibitorUse && (
            <Field
              label="Received adjuvant high-dose bisphosphonate"
              hint="Higher / more frequent dosing as part of breast cancer management — surfaces end-of-course fracture risk reassessment (NOGG 2024 Rec 4 Conditional)"
              indent
            >
              <YesNo
                value={data.hadAdjuvantHighDoseBisphosphonate}
                onChange={v => onChange({ hadAdjuvantHighDoseBisphosphonate: v })}
              />
            </Field>
          )}
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
