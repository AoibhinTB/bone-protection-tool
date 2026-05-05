'use client';

import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

export function Step2FractureHistory({ data, onChange }: Props) {
  return (
    <div>
      <SectionHeading>Fracture history</SectionHeading>
      <Field
        label="Prior fragility fracture"
        hint="Low-energy fracture from a fall from standing height or less"
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
        </>
      )}
    </div>
  );
}
