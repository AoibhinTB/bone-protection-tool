'use client';

import type { PatientInput, TreatmentAgent, TreatmentStopReason, TreatmentHistory } from '@/lib/guidelines/types';
import { AGENT_LABELS, STOP_REASON_LABELS } from '@/lib/labels';
import { Field, NumInput, YesNo, SectionHeading, Select } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

const AGENT_OPTIONS = (Object.keys(AGENT_LABELS) as TreatmentAgent[]).map(k => ({
  value: k,
  label: AGENT_LABELS[k],
}));

const STOP_REASON_OPTIONS = (Object.keys(STOP_REASON_LABELS) as TreatmentStopReason[]).map(k => ({
  value: k,
  label: STOP_REASON_LABELS[k],
}));

const BISPHOSPHONATES: TreatmentAgent[] = ['alendronate', 'risedronate', 'ibandronate', 'zoledronate'];

// v1.19 — onPause matches the engine's new rule (treatment.ts):
//   1. currentTreatment is a paused BP (currentlyOn=false with reasonStopped='treatment_holiday')
//   2. currentTreatment is null AND a previous BP has reasonStopped='treatment_holiday'
//   3. EITHER slot has a BP with monthsSinceLastDose > 0 and currentlyOn=false
function isPausedBP(t: TreatmentHistory | null | undefined): boolean {
  if (!t || !BISPHOSPHONATES.includes(t.agent)) return false;
  if (t.reasonStopped === 'treatment_holiday') return true;
  if (!t.currentlyOn && (t.monthsSinceLastDose ?? 0) > 0) return true;
  return false;
}

export function Step7TreatmentHistory({ data, onChange }: Props) {
  const onTreatment = data.currentTreatment !== null;
  const currentAgent = data.currentTreatment?.agent;
  const isOnDenosumab = currentAgent === 'denosumab';
  const isOnBP = currentAgent !== undefined && BISPHOSPHONATES.includes(currentAgent);
  const onPause =
    isPausedBP(data.currentTreatment) ||
    data.previousTreatments.some(isPausedBP);

  function updateCurrent(patch: Partial<TreatmentHistory>) {
    if (!data.currentTreatment) return;
    onChange({ currentTreatment: { ...data.currentTreatment, ...patch } });
  }

  function addPreviousTreatment() {
    onChange({
      previousTreatments: [
        ...data.previousTreatments,
        { agent: 'alendronate', durationMonths: 12, reasonStopped: null, currentlyOn: false, monthsSinceLastDose: null },
      ],
    });
  }

  function updatePrevious(index: number, patch: Partial<TreatmentHistory>) {
    onChange({
      previousTreatments: data.previousTreatments.map((t, i) =>
        i === index ? { ...t, ...patch } : t
      ),
    });
  }

  function removePrevious(index: number) {
    onChange({ previousTreatments: data.previousTreatments.filter((_, i) => i !== index) });
  }

  return (
    <div>
      <SectionHeading>Current treatment</SectionHeading>
      <Field label="Currently on bone protection treatment" hint="Includes patients currently on a planned bisphosphonate holiday/pause — toggle 'Currently dosing' off below to mark them as paused.">
        <YesNo
          value={onTreatment}
          onChange={v =>
            onChange({
              currentTreatment: v
                ? { agent: 'alendronate', durationMonths: 12, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null }
                : null,
            })
          }
        />
      </Field>

      {onTreatment && data.currentTreatment && (
        <>
          <Field label="Agent" indent>
            <Select<TreatmentAgent>
              value={data.currentTreatment.agent}
              onChange={v => updateCurrent({ agent: v })}
              options={AGENT_OPTIONS}
            />
          </Field>
          <Field label="Duration on current treatment" indent>
            <NumInput
              value={data.currentTreatment.durationMonths}
              onChange={v => updateCurrent({ durationMonths: v ?? 1 })}
              min={0}
              max={360}
              step={1}
              unit="months"
              width="w-20"
            />
          </Field>
          {/* v1.19 — currentlyOn + reasonStopped now exposed for the current
              treatment so the user can mark "on alendronate but currently paused"
              without having to bounce the agent into previousTreatments. */}
          <Field
            label="Currently dosing"
            hint="Off = on a planned holiday/pause, or otherwise temporarily off the active drug"
            indent
          >
            <YesNo
              value={data.currentTreatment.currentlyOn}
              onChange={v => updateCurrent({ currentlyOn: v })}
            />
          </Field>
          {!data.currentTreatment.currentlyOn && (
            <Field label="Reason paused / stopped" indent>
              <Select<TreatmentStopReason>
                value={data.currentTreatment.reasonStopped ?? ''}
                onChange={v => updateCurrent({ reasonStopped: v })}
                options={STOP_REASON_OPTIONS}
                placeholder="Not specified"
              />
            </Field>
          )}
          <Field
            label="Months since last dose"
            hint={
              isOnDenosumab
                ? '>7 months = missed dose → rebound risk. v1.19: drives the denosumab rebound alerts.'
                : 'Months since the last actual dose. For BPs this counts from the last administration regardless of where the patient sits in the planned course; drives drug-specific holiday reassessment intervals.'
            }
            indent
          >
            <NumInput
              value={data.currentTreatment.monthsSinceLastDose}
              onChange={v => updateCurrent({ monthsSinceLastDose: v })}
              min={0}
              max={120}
              step={0.5}
              unit="months"
              width="w-24"
            />
          </Field>
          {isOnBP && (
            <Field
              label="Unexplained mid-thigh or groin pain"
              hint="Prodrome of atypical femoral fracture (AFF) — ask at every review"
              indent
            >
              <YesNo
                value={data.thighOrGroinPain}
                onChange={v => onChange({ thighOrGroinPain: v })}
              />
            </Field>
          )}
        </>
      )}

      {/* v1.13 / v1.19 — BP pause monitoring signals (NOGG 2024 Section 6.6 Rec 7 Conditional).
          Now visible whenever ANY bisphosphonate slot looks paused — current OR previous —
          rather than only the previous-treatment shape. */}
      {onPause && (
        <>
          <SectionHeading>Bisphosphonate pause — monitoring signals</SectionHeading>
          <Field
            label="Bone turnover markers rising during pause"
            hint="CTX or P1NP trending upward — Conditional restart signal (NOGG 2024 Rec 7). Exclude liver source if ALP-driven."
          >
            <YesNo
              value={data.boneTurnoverMarkersRising === true}
              onChange={v => onChange({ boneTurnoverMarkersRising: v })}
            />
          </Field>
          <Field
            label="BMD decreased on repeat DEXA during pause"
            hint="Conditional restart signal (NOGG 2024 Rec 7). No definitive thresholds — clinical judgement."
          >
            <YesNo
              value={data.bmdDecreasedDuringPause === true}
              onChange={v => onChange({ bmdDecreasedDuringPause: v })}
            />
          </Field>
        </>
      )}

      <SectionHeading>Patient preference</SectionHeading>
      <Field
        label="Refuses all injections (subcutaneous and intravenous)"
        hint="Filters out denosumab (SC), zoledronate (IV), teriparatide (SC), romosozumab (SC) — oral options only"
      >
        <YesNo
          value={data.refusesInjections}
          onChange={v => onChange({ refusesInjections: v })}
        />
      </Field>

      <SectionHeading>Post-anabolic sequencing</SectionHeading>
      <Field
        label="Recently completed anabolic course"
        hint="Teriparatide, romosozumab, or abaloparatide — antiresorptive must start without delay (NOGG Rec 14)"
      >
        <YesNo
          value={data.completedAnabolicCourse}
          onChange={v => onChange({ completedAnabolicCourse: v })}
        />
      </Field>

      <SectionHeading>Previous treatments</SectionHeading>
      {data.previousTreatments.length === 0 && (
        <p className="text-sm text-slate-500 mb-3">No previous treatments recorded</p>
      )}
      {data.previousTreatments.map((t, i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-slate-700">Previous treatment {i + 1}</p>
            <button
              type="button"
              onClick={() => removePrevious(i)}
              className="text-xs text-red-500 hover:text-red-700 font-medium"
            >
              Remove
            </button>
          </div>
          <Field label="Agent">
            <Select<TreatmentAgent>
              value={t.agent}
              onChange={v => updatePrevious(i, { agent: v })}
              options={AGENT_OPTIONS}
            />
          </Field>
          <Field label="Total duration">
            <NumInput
              value={t.durationMonths}
              onChange={v => updatePrevious(i, { durationMonths: v ?? 1 })}
              min={0}
              max={360}
              step={1}
              unit="months"
              width="w-20"
            />
          </Field>
          <Field label="Reason stopped">
            <Select<TreatmentStopReason>
              value={t.reasonStopped ?? ''}
              onChange={v => updatePrevious(i, { reasonStopped: v })}
              options={STOP_REASON_OPTIONS}
              placeholder="Not specified"
            />
          </Field>
          <Field
            label="Months since last dose"
            hint="Counts from the last administered dose. For a holiday/pause, this is the months elapsed since stopping."
          >
            <NumInput
              value={t.monthsSinceLastDose}
              onChange={v => updatePrevious(i, { monthsSinceLastDose: v })}
              min={0}
              max={240}
              step={0.5}
              unit="months"
              width="w-24"
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={addPreviousTreatment}
        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
      >
        + Add previous treatment
      </button>
    </div>
  );
}
