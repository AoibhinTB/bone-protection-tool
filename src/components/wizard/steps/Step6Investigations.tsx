'use client';

import { estimateFrax } from '@/lib/fraxEstimate';
import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';
import { Term } from '@/components/Tooltip';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

export function Step6Investigations({ data, onChange }: Props) {
  const fraxEst = estimateFrax(data);
  const hasManualFrax = data.fraxMOFPercent !== null;
  const hasDexa = data.dexaResults !== null;
  const hasBlood = data.bloodResults !== null;

  return (
    <div>
      <SectionHeading>
        <Term term="FRAX">FRAX</Term>
      </SectionHeading>

      {/* Auto-calculated estimate */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 mb-4">
        <p className="text-xs font-medium text-indigo-700 mb-1">
          Estimated FRAX — Ireland (no BMD)
        </p>
        <div className="flex gap-6 text-sm">
          <div>
            <Term term="MOF">
              <span className="text-indigo-500">MOF</span>
            </Term>
            <span className="text-indigo-500"> </span>
            <span className="font-bold text-indigo-900">{fraxEst.mof}%</span>
          </div>
          <div>
            <Term term="Hip">
              <span className="text-indigo-500">Hip</span>
            </Term>
            <span className="text-indigo-500"> </span>
            <span className="font-bold text-indigo-900">{fraxEst.hip}%</span>
          </div>
        </div>
        <p className="text-xs text-indigo-500 mt-1">
          Calculated from risk factors above · Based on published NOGG/FRAX algorithm (Kanis et al.)
        </p>
      </div>

      <Field
        label="Override with official FRAX values"
        hint="Use frax.shef.ac.uk (country 49) — required if you have BMD available"
      >
        <YesNo
          value={hasManualFrax}
          onChange={v => {
            if (v) {
              onChange({ fraxMOFPercent: fraxEst.mof, fraxHipPercent: fraxEst.hip });
            } else {
              onChange({ fraxMOFPercent: null, fraxHipPercent: null, fraxCalculatedWithBMD: false });
            }
          }}
        />
      </Field>

      {hasManualFrax && (
        <>
          <Field label="Official MOF (10-year)" indent>
            <NumInput
              value={data.fraxMOFPercent}
              onChange={v => onChange({ fraxMOFPercent: v })}
              min={0}
              max={100}
              step={0.1}
              unit="%"
              width="w-20"
            />
          </Field>
          <Field label="Official hip fracture (10-year)" indent>
            <NumInput
              value={data.fraxHipPercent}
              onChange={v => onChange({ fraxHipPercent: v })}
              min={0}
              max={100}
              step={0.1}
              unit="%"
              width="w-20"
            />
          </Field>
          <Field label="Calculated with BMD" hint="If yes, arithmetic adjustments (T2DM, falls, Parkinson's) still applied" indent>
            <YesNo
              value={data.fraxCalculatedWithBMD}
              onChange={v => onChange({ fraxCalculatedWithBMD: v })}
            />
          </Field>
        </>
      )}

      <SectionHeading>DEXA</SectionHeading>
      <Field label="DEXA results available">
        <YesNo
          value={hasDexa}
          onChange={v =>
            onChange({
              dexaResults: v
                ? { lumbarSpineTScore: null, totalHipTScore: null, femoralNeckTScore: null, forearmTScore: null }
                : null,
              bmdUnavailable: v ? false : data.bmdUnavailable,
            })
          }
        />
      </Field>
      {!hasDexa && (
        <Field
          label="BMD measurement is unavailable, contraindicated, or impractical"
          hint="e.g. frailty, severe immobility — applies NOGG 2024 Rec 6 logic"
        >
          <YesNo
            value={data.bmdUnavailable}
            onChange={v => onChange({ bmdUnavailable: v })}
          />
        </Field>
      )}
      {hasDexa && data.dexaResults && (
        <>
          <Field label="Lumbar spine T-score" indent>
            <NumInput
              value={data.dexaResults.lumbarSpineTScore}
              onChange={v => onChange({ dexaResults: { ...data.dexaResults!, lumbarSpineTScore: v } })}
              min={-5}
              max={3}
              step={0.1}
              width="w-20"
            />
          </Field>
          <Field label="Total hip T-score" indent>
            <NumInput
              value={data.dexaResults.totalHipTScore}
              onChange={v => onChange({ dexaResults: { ...data.dexaResults!, totalHipTScore: v } })}
              min={-5}
              max={3}
              step={0.1}
              width="w-20"
            />
          </Field>
          <Field label="Femoral neck T-score" indent>
            <NumInput
              value={data.dexaResults.femoralNeckTScore}
              onChange={v => onChange({ dexaResults: { ...data.dexaResults!, femoralNeckTScore: v } })}
              min={-5}
              max={3}
              step={0.1}
              width="w-20"
            />
          </Field>
          <Field label="33% radius / forearm T-score" hint="Peripheral DEXA — enter if available; forearm-only osteoporosis has specific rules" indent>
            <NumInput
              value={data.dexaResults.forearmTScore}
              onChange={v => onChange({ dexaResults: { ...data.dexaResults!, forearmTScore: v } })}
              min={-5}
              max={3}
              step={0.1}
              width="w-20"
            />
          </Field>
          <p className="text-xs text-slate-500 pl-4 sm:pl-6 -mt-1 mb-2">
            T-score reference: ≤−2.5 osteoporosis · −1.0 to −2.5 osteopenia · ≥−1.0 normal
          </p>
        </>
      )}

      <SectionHeading>Blood results</SectionHeading>
      <Field label="Blood results available">
        <YesNo
          value={hasBlood}
          onChange={v =>
            onChange({
              bloodResults: v
                ? { adjustedCalciumMmol: null, vitaminDNmol: null, egfr: null, alp: null, tshMUL: null, fbc: null }
                : null,
            })
          }
        />
      </Field>
      {hasBlood && data.bloodResults && (
        <>
          <Field label="Adjusted calcium" hint="mmol/L — normal 2.10–2.60" indent>
            <NumInput
              value={data.bloodResults.adjustedCalciumMmol}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, adjustedCalciumMmol: v } })}
              min={1}
              max={4}
              step={0.01}
              unit="mmol/L"
              width="w-24"
            />
          </Field>
          <Field label="25-OH vitamin D" hint="nmol/L — target ≥75" indent>
            <NumInput
              value={data.bloodResults.vitaminDNmol}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, vitaminDNmol: v } })}
              min={0}
              max={300}
              unit="nmol/L"
              width="w-24"
            />
          </Field>
          <Field label="eGFR" hint="ml/min/1.73 m² — kidney function" indent>
            <NumInput
              value={data.bloodResults.egfr}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, egfr: v } })}
              min={1}
              max={130}
              unit="ml/min"
              width="w-24"
            />
          </Field>
          <Field label="ALP" hint="U/L — normal 30–130; >200 markedly elevated" indent>
            <NumInput
              value={data.bloodResults.alp}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, alp: v } })}
              min={0}
              max={1000}
              unit="U/L"
              width="w-24"
            />
          </Field>
          <Field label="TSH" hint="mU/L — normal 0.4–4.0; <0.1 suppressed; >4.0 elevated" indent>
            <NumInput
              value={data.bloodResults.tshMUL}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, tshMUL: v } })}
              min={0}
              max={50}
              step={0.1}
              unit="mU/L"
              width="w-24"
            />
          </Field>
          <Field
            label="On levothyroxine"
            hint="Affects TSH interpretation — under/over-replacement contributes to bone loss"
            indent
          >
            <YesNo
              value={data.onThyroidReplacement}
              onChange={v => onChange({ onThyroidReplacement: v })}
            />
          </Field>
          <Field label="FBC" indent>
            <YesNo
              value={data.bloodResults.fbc ?? false}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, fbc: v } })}
              yesLabel="Normal"
              noLabel="Abnormal / not done"
            />
          </Field>
        </>
      )}
    </div>
  );
}
