'use client';

import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';
import { Term } from '@/components/Tooltip';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

export function Step5Physical({ data, onChange }: Props) {
  const hasRenalFunction = data.renalFunction !== null;

  return (
    <div>
      <SectionHeading>Physical findings</SectionHeading>
      <Field label="Historical height loss" hint="≥4 cm compared to historical maximum height → VFA">
        <NumInput
          value={data.heightLossCm}
          onChange={v => onChange({ heightLossCm: v })}
          min={0}
          max={30}
          step={0.5}
          unit="cm"
          width="w-20"
        />
      </Field>
      <Field label="Prospective height loss" hint="≥2 cm measured in clinic compared to last visit → VFA">
        <NumInput
          value={data.heightLossProspectiveCm}
          onChange={v => onChange({ heightLossProspectiveCm: v })}
          min={0}
          max={15}
          step={0.5}
          unit="cm"
          width="w-20"
        />
      </Field>
      <Field label="Kyphosis on examination">
        <YesNo value={data.kyphosis} onChange={v => onChange({ kyphosis: v })} />
      </Field>
      <Field label="Acute back pain" hint="With osteoporosis risk factors — may indicate vertebral fracture">
        <YesNo value={data.acuteBackPain} onChange={v => onChange({ acuteBackPain: v })} />
      </Field>

      <SectionHeading>Cardiovascular history</SectionHeading>
      <Field label="MI or stroke in the last 12 months" hint="Contraindication to romosozumab">
        <YesNo
          value={data.priorMIOrStrokeWithin12Months}
          onChange={v => onChange({ priorMIOrStrokeWithin12Months: v })}
        />
      </Field>

      <SectionHeading>
        Renal function (<Term term="eGFR">eGFR</Term>)
      </SectionHeading>
      <Field label="eGFR known">
        <YesNo
          value={hasRenalFunction}
          onChange={v => onChange({ renalFunction: v ? { egfr: 60 } : null })}
        />
      </Field>
      {hasRenalFunction && data.renalFunction && (
        <Field label="eGFR" hint="ml/min/1.73 m²" indent>
          <NumInput
            value={data.renalFunction.egfr}
            onChange={v => onChange({ renalFunction: { egfr: v ?? 60 } })}
            min={1}
            max={130}
            unit="ml/min/1.73m²"
            width="w-24"
          />
        </Field>
      )}
    </div>
  );
}
