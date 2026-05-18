'use client';

import { estimateFrax } from '@/lib/fraxEstimate';
import type { PatientInput } from '@/lib/guidelines/types';
import { computeCrCl } from '@/lib/guidelines/thresholds';
import { Field, NumInput, YesNo, SectionHeading, Segmented } from '../FormPrimitives';
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

      {/* FRAX calculator — opens frax.shef.ac.uk in a new tab.
          (Iframe embedding was tried but frax.shef.ac.uk blocks it via
          X-Frame-Options, so we link out instead.) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <a
          href="https://frax.shef.ac.uk/FRAX/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 active:bg-indigo-800"
        >
          Open FRAX calculator
          <span aria-hidden="true">↗</span>
        </a>
        <span className="text-[11px] text-slate-500">
          Opens frax.shef.ac.uk in a new tab — use country code 49 for Ireland.
        </span>
      </div>

      {data.bornOutsideIreland ? (
        // Non-Irish: auto-estimate suppressed (Irish baselines not appropriate)
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg px-4 py-3 mb-4">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">
            FRAX must be calculated externally
          </p>
          <p className="text-xs text-amber-900 leading-snug">
            Patient born outside Ireland. The in-tool estimator uses Irish baselines (country
            code 49) and is not appropriate. Calculate FRAX at{' '}
            <a
              href="https://frax.shef.ac.uk/FRAX/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              frax.shef.ac.uk
            </a>{' '}
            with the patient&apos;s country of birth selected, then enter the values below
            (NOGG 2024 Table 2 — risk characteristics persist after migration).
          </p>
        </div>
      ) : (
        // Irish-born (or unknown): show auto-estimate
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
      )}

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
      <p className="text-xs text-slate-500 mb-2 leading-snug">
        Optional. Fill in any values you have — leave fields blank if not done. The tool
        will recommend baseline bloods regardless and use entered values to refine alerts.
      </p>
      <Field label="Blood results available">
        <YesNo
          value={hasBlood}
          onChange={v =>
            onChange({
              bloodResults: v
                ? {
                    adjustedCalciumMmol: null,
                    vitaminDNmol: null,
                    creatinine: null,
                    alp: null,
                    tshMUL: null,
                    hbGramsPerLitre: null,
                    esrOrCrp: null,
                  }
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
          <Field label="Serum creatinine" hint="µmol/L — CrCl auto-computed via Cockcroft-Gault from creatinine + weight + age + sex" indent>
            <NumInput
              value={data.bloodResults.creatinine}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, creatinine: v } })}
              min={20}
              max={1500}
              step={1}
              unit="µmol/L"
              width="w-24"
            />
          </Field>
          {(() => {
            const crcl = computeCrCl(data);
            return (
              <p className="text-xs text-slate-500 pl-4 sm:pl-6 -mt-1 mb-2 indent">
                CrCl: <span className="font-medium text-slate-700">
                  {crcl !== null ? `${Math.round(crcl)} mL/min` : '—'}
                </span> <span className="text-slate-400">
                  (Cockcroft-Gault; requires creatinine + weight + age + sex)
                </span>
              </p>
            );
          })()}
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
            label="Hb"
            hint="g/L — anaemia threshold <120 women, <130 men. Anaemia is the key FBC signal for myeloma exclusion."
            indent
          >
            <NumInput
              value={data.bloodResults.hbGramsPerLitre}
              onChange={v => onChange({ bloodResults: { ...data.bloodResults!, hbGramsPerLitre: v } })}
              min={40}
              max={220}
              unit="g/L"
              width="w-24"
            />
          </Field>
          <Field
            label="ESR or CRP"
            hint="Either ESR or CRP — categorical only. Elevated value adds to myeloma triggers (NOGG)."
            indent
          >
            <Segmented<'not_done' | 'normal' | 'elevated'>
              value={
                data.bloodResults.esrOrCrp === null
                  ? 'not_done'
                  : data.bloodResults.esrOrCrp
              }
              onChange={v => {
                const val: 'normal' | 'elevated' | null =
                  v === 'not_done' ? null : v;
                onChange({ bloodResults: { ...data.bloodResults!, esrOrCrp: val } });
              }}
              options={[
                { value: 'not_done', label: 'Not done' },
                { value: 'normal',   label: 'Normal' },
                { value: 'elevated', label: 'Elevated' },
              ]}
            />
          </Field>
        </>
      )}
    </div>
  );
}
