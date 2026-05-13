'use client';

import type { PatientInput } from '@/lib/guidelines/types';
import { Field, NumInput, YesNo, SectionHeading } from '../FormPrimitives';

interface Props {
  data: PatientInput;
  onChange: (patch: Partial<PatientInput>) => void;
}

export function Step5Physical({ data, onChange }: Props) {
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
      {/* v1.31 follow-up: Cardiovascular history (MI / stroke <12 mo) moved to
          Step 3 Past medical history. Renal function (eGFR) is now exposed
          only via Step 6 bloodResults.egfr; the renalFunction schema slot
          has been removed. */}
    </div>
  );
}
