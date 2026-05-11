'use client';

import type { PatientInput, GlucocorticoidDose, GlucocorticoidStatus } from '@/lib/guidelines/types';
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

// v1.19 — single 4-option GC status field. The dose fields below stay
// orthogonal because they describe the *current* course (only meaningful
// when status === 'current').
const GC_STATUS_OPTIONS: { value: GlucocorticoidStatus; label: string }[] = [
  { value: 'current',              label: 'Currently on' },
  { value: 'stopped_within_12m',   label: 'Stopped <12m' },
  { value: 'stopped_over_12m_ago', label: 'Stopped >12m' },
  { value: 'never',                label: 'Never' },
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
  const status = data.glucocorticoidStatus ?? 'never';
  const isCurrent = status === 'current';

  return (
    <div>
      <SectionHeading>Glucocorticoids</SectionHeading>
      <Field
        label="Glucocorticoid status"
        hint="Prednisolone or equivalent. v1.19 — replaces the previous pair of toggles. Choose 'Stopped <12m' if the GC course ended within the last year (drives VFA recommendation), or 'Stopped >12m' if it ended more than a year ago (drives GC-withdrawal bone-protection review)."
      >
        <Segmented<GlucocorticoidStatus>
          value={status}
          onChange={v => {
            // Toggling away from 'current' clears the current-course dose state;
            // toggling INTO 'current' seeds a default low dose so downstream logic
            // has a numeric value to work with until the clinician overwrites it.
            const becomingCurrent = v === 'current';
            const wasCurrent = isCurrent;
            onChange({
              glucocorticoidStatus: v,
              glucocorticoidUse: becomingCurrent
                ? (data.glucocorticoidUse ?? { current: true, durationMonths: 3, dose: 'low' })
                : null,
              glucocorticoidDoseMgDay: becomingCurrent
                ? (data.glucocorticoidDoseMgDay ?? 5)
                : (wasCurrent ? null : data.glucocorticoidDoseMgDay),
            });
          }}
          options={GC_STATUS_OPTIONS}
        />
      </Field>
      {isCurrent && data.glucocorticoidUse && (
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

      <SectionHeading>Other medications</SectionHeading>
      <Field
        label="Levothyroxine"
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
        </>
      )}
      {/* v1.19 — Early menopause moved out of medications. It is a clinical
          condition, not a medication, and now lives on Step 3 (Risk Factors). */}
    </div>
  );
}
