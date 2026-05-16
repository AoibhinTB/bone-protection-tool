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

// Representative numeric mg/day values for each band. Engine logic
// (isOnHighDoseGC, isOnLowDoseGC, FRAX Table 8 correction) reads
// `glucocorticoidDoseMgDay` via threshold comparisons (<2.5, ≥7.5, etc.) so
// any value within a band gives identical routing. Values mirror the
// LEGACY_GC_DOSE_MG fallback in thresholds.ts.
const REPRESENTATIVE_MG_FOR_BAND: Record<GlucocorticoidDose, number> = {
  very_low: 1,
  low: 5,
  medium: 10,
  high: 25,
};

// v1.19 — single 4-option GC status field. The dose fields below stay
// orthogonal because they describe the *current* course (only meaningful
// when status === 'current').
const GC_STATUS_OPTIONS: { value: GlucocorticoidStatus; label: string }[] = [
  { value: 'current',              label: 'Currently on' },
  { value: 'stopped_within_12m',   label: 'Stopped <12m' },
  { value: 'stopped_over_12m_ago', label: 'Stopped >12m' },
  { value: 'never',                label: 'Never' },
];

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
                ? (data.glucocorticoidDoseMgDay ?? REPRESENTATIVE_MG_FOR_BAND.low)
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
            hint="Select the dose band. Exact mg value not required — the tool uses the band for risk calculation (Table 8 FRAX correction: <2.5 mg/day ↓; 2.5–7.5 mg/day none; ≥7.5 mg/day ↑)."
            indent
          >
            <Segmented<GlucocorticoidDose>
              value={data.glucocorticoidUse.dose}
              onChange={v =>
                onChange({
                  glucocorticoidUse: { ...data.glucocorticoidUse!, dose: v },
                  glucocorticoidDoseMgDay: REPRESENTATIVE_MG_FOR_BAND[v],
                })
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
      {/* Thiazolidinedione (pioglitazone) moved from Step 3 — lives with current
          medications. Engine fires the TZD flag unconditionally; no dependency
          on the T2DM checkbox in Step 3 medical history. */}
      <Field
        label="Thiazolidinedione (pioglitazone)"
        hint="TZDs increase fracture risk — surfaces a clinical flag. Consider alternative diabetes therapy where appropriate."
      >
        <YesNo
          value={data.onThiazolidinedione}
          onChange={v => onChange({ onThiazolidinedione: v })}
        />
      </Field>
      {/* Anti-epileptics moved from Step 3 — NOGG 2024 Table 4 lists enzyme-
          inducing AEDs (phenytoin, carbamazepine) as a medication-class
          case-finder. Valproate is NOT enzyme-inducing (it's a hepatic enzyme
          inhibitor) and was removed from the list — see commit dropping
          valproate from the displayed enumeration. Engine behaviour unchanged:
          still flagged via secondaryOsteoporosis array membership of
          'antiepileptic_use'. */}
      <Field
        label="Enzyme-inducing anti-epileptics"
        hint="Phenytoin, carbamazepine — NOGG 2024 Table 4 medication-class case-finder for osteoporosis."
      >
        <YesNo
          value={data.secondaryOsteoporosis.includes('antiepileptic_use')}
          onChange={v => {
            const next = v
              ? [...data.secondaryOsteoporosis, 'antiepileptic_use' as const]
              : data.secondaryOsteoporosis.filter(k => k !== 'antiepileptic_use');
            onChange({ secondaryOsteoporosis: next });
          }}
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
