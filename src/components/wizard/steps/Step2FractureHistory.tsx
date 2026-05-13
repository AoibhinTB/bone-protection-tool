'use client';

import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

// v1.31 follow-up — page 2 broadened from "Fracture history" to
// "Patient History". Now contains: lifestyle, falls and fractures (combining
// fragility fx + parental hip fx + falls in last 12 months), reproductive
// history (female), and HRT safety (female). Page 3 becomes Medical History
// only.
export function Step2FractureHistory({ data, onChange }: Props) {
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

      {/* ── Falls and fractures ────────────────────────────────────────── */}
      <SectionHeading>Falls and fractures</SectionHeading>
      <Field
        label="Prior fragility fracture"
        hint="Any prior fracture in adulthood. NOGG 2024: high-trauma fractures predict future fracture risk to the same extent as low-trauma — include both."
      >
        <YesNo
          value={data.priorFragilityFracture}
          onChange={v =>
            onChange({
              priorFragilityFracture: v,
              priorHipFracture: v ? data.priorHipFracture : false,
              priorVertebralFracture: v ? data.priorVertebralFracture : false,
              recentVertebralFractureYears: v ? data.recentVertebralFractureYears : null,
              numberOfPriorFractures: v ? data.numberOfPriorFractures : 0,
            })
          }
        />
      </Field>

      {data.priorFragilityFracture && (
        <>
          <p className="text-xs text-slate-600 bg-amber-50 border-l-4 border-amber-300 rounded-r px-3 py-2 leading-snug -mt-1 mb-2">
            For FRAX purposes, enter any low-trauma fracture at any site age &gt;50.
            Note: hip and clinical vertebral fractures alone are sufficient for clinical
            diagnosis of osteoporosis without DEXA — treatment can be started without
            waiting for a scan.
          </p>
          <Field label="Hip fracture" indent>
            <YesNo
              value={data.priorHipFracture}
              onChange={v => onChange({ priorHipFracture: v })}
            />
          </Field>
          <Field label="Vertebral fracture" indent>
            <YesNo
              value={data.priorVertebralFracture}
              onChange={v =>
                onChange({
                  priorVertebralFracture: v,
                  recentVertebralFractureYears: v ? data.recentVertebralFractureYears : null,
                })
              }
            />
          </Field>
          {data.priorVertebralFracture && (
            <Field
              label="Years since most recent vertebral fracture"
              hint="≤2 years = very high risk criterion"
              indent
            >
              <NumInput
                value={data.recentVertebralFractureYears}
                onChange={v => onChange({ recentVertebralFractureYears: v })}
                min={0}
                max={50}
                unit="yrs"
                width="w-20"
              />
            </Field>
          )}
          <Field label="Total number of prior fragility fractures" indent>
            <NumInput
              value={data.numberOfPriorFractures}
              onChange={v => onChange({ numberOfPriorFractures: v ?? 0 })}
              min={0}
              max={20}
              width="w-20"
            />
          </Field>
          <Field
            label="Fracture within the last 2 years"
            hint="Imminent risk — start treatment immediately without waiting for DEXA"
            indent
          >
            <YesNo
              value={data.recentFractureWithin2Years}
              onChange={v => onChange({ recentFractureWithin2Years: v })}
            />
          </Field>
        </>
      )}

      <Field label="Parental hip fracture">
        <YesNo
          value={data.parentalHipFracture}
          onChange={v => onChange({ parentalHipFracture: v })}
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

      {/* ── Reproductive history (female only) ────────────────────────── */}
      {data.sex === 'female' && (
        <>
          <SectionHeading>Reproductive history</SectionHeading>
          {/* v1.31 follow-up — Pregnant / breastfeeding moved here from Step 1
              Demographics. Age-gated at <55 because pregnancy is biologically
              implausible above that and the tool's clinical scope is
              postmenopausal women anyway. */}
          {data.age < 55 && (
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

      {/* ── HRT safety (female only) ──────────────────────────────────── */}
      {data.sex === 'female' && (
        <>
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
        </>
      )}
    </div>
  );
}
