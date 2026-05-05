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

export function Step7TreatmentHistory({ data, onChange }: Props) {
  const onTreatment = data.currentTreatment !== null;
  const currentAgent = data.currentTreatment?.agent;
  const isOnDenosumab = currentAgent === 'denosumab';
  const isOnBP = currentAgent !== undefined && BISPHOSPHONATES.includes(currentAgent);

  function updateCurrent(patch: Partial<TreatmentHistory>) {
    if (!data.currentTreatment) return;
    onChange({ currentTreatment: { ...data.currentTreatment, ...patch } });
  }

  function addPreviousTreatment() {
    onChange({
      previousTreatments: [
        ...data.previousTreatments,
        { agent: 'alendronate', durationMonths: 12, reasonStopped: null, currentlyOn: false },
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
      <Field label="Currently on bone protection treatment">
        <YesNo
          value={onTreatment}
          onChange={v =>
            onChange({
              currentTreatment: v
                ? { agent: 'alendronate', durationMonths: 12, reasonStopped: null, currentlyOn: true }
                : null,
              denosumabMonthsSinceLastDose: null,
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
          {isOnDenosumab && (
            <Field
              label="Months since last injection"
              hint=">7 months = missed dose → rebound risk"
              indent
            >
              <NumInput
                value={data.denosumabMonthsSinceLastDose}
                onChange={v => onChange({ denosumabMonthsSinceLastDose: v })}
                min={0}
                max={36}
                unit="months"
                width="w-20"
              />
            </Field>
          )}
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
          <Field label="Duration">
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
