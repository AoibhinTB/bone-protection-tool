'use client';

import { useEffect, useState } from 'react';
import type { PatientInput, ClinicalDecision } from '@/lib/guidelines/types';
import { runClinicalDecision } from '@/lib/guidelines';
import { defaultPatient } from '@/lib/defaults';
import { WizardShell } from '@/components/wizard/WizardShell';
import { Step1Demographics } from '@/components/wizard/steps/Step1Demographics';
import { Step2FractureHistory } from '@/components/wizard/steps/Step2FractureHistory';
import { Step3RiskFactors } from '@/components/wizard/steps/Step3RiskFactors';
import { Step4Medications } from '@/components/wizard/steps/Step4Medications';
import { Step5Physical } from '@/components/wizard/steps/Step5Physical';
import { Step6Investigations } from '@/components/wizard/steps/Step6Investigations';
import { Step7TreatmentHistory } from '@/components/wizard/steps/Step7TreatmentHistory';
import { ResultsView } from '@/components/results/ResultsView';
import { DisclaimerScreen } from '@/components/DisclaimerScreen';

const FEEDBACK_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScyshX1LF68y7UYCJm9DSp2f_9s-DJ2FEi3xM3WX4wXSNFzAg/viewform';
const DISCLAIMER_KEY = 'bp-disclaimer-acknowledged';

const STEP_TITLES = [
  'Demographics',
  'Patient History',
  'Medical History',
  'Medications',
  'Physical Findings',
  'Investigations',
  'Treatment History',
];

export default function Home() {
  const [patient, setPatient] = useState<PatientInput>(defaultPatient);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ClinicalDecision | null>(null);
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);

  // Check session storage for prior acknowledgement (per-session gate)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setAcknowledged(window.sessionStorage.getItem(DISCLAIMER_KEY) === '1');
    } catch {
      setAcknowledged(false);
    }
  }, []);

  function handleAcceptDisclaimer() {
    try {
      window.sessionStorage.setItem(DISCLAIMER_KEY, '1');
    } catch {
      /* sessionStorage may be unavailable in private mode — proceed anyway */
    }
    setAcknowledged(true);
  }

  // Avoid hydration mismatch by waiting for client-side check before rendering
  if (acknowledged === null) return null;
  if (!acknowledged) return <DisclaimerScreen onAccept={handleAcceptDisclaimer} />;

  function patch(updates: Partial<PatientInput>) {
    setPatient(prev => ({ ...prev, ...updates }));
  }

  function handleNext() {
    if (step < STEP_TITLES.length - 1) {
      setStep(s => s + 1);
    } else {
      setResult(runClinicalDecision(patient));
    }
  }

  function handleBack() {
    setStep(s => s - 1);
  }

  function handleReset() {
    setPatient(defaultPatient);
    setStep(0);
    setResult(null);
  }

  if (result) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 safe-pt">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold text-slate-900">Bone Protection Tool</h1>
              <span className="hidden sm:inline text-sm text-slate-500">Clinical Decision Support · Ireland</span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              Healthcare professional use only. Does not replace clinical judgement.
              {' · '}
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
              >
                Submit feedback
              </a>
            </p>
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-6 py-5 sm:py-8 safe-pb">
          <div className="max-w-3xl mx-auto">
            <ResultsView
              result={result}
              patient={patient}
              onReset={handleReset}
              onBack={() => { setResult(null); setStep(STEP_TITLES.length - 1); }}
              onRevealNoRfFrax={() => {
                const next = { ...patient, noRiskFactorOverride: true };
                setPatient(next);
                setResult(runClinicalDecision(next));
              }}
            />
          </div>
        </main>
      </div>
    );
  }

  const stepProps = { data: patient, onChange: patch };

  function renderStep() {
    switch (step) {
      case 0: return <Step1Demographics {...stepProps} />;
      case 1: return <Step2FractureHistory {...stepProps} />;
      case 2: return <Step3RiskFactors {...stepProps} />;
      case 3: return <Step4Medications {...stepProps} />;
      case 4: return <Step5Physical {...stepProps} />;
      case 5: return <Step6Investigations {...stepProps} />;
      case 6: return <Step7TreatmentHistory {...stepProps} />;
      default: return null;
    }
  }

  return (
    <WizardShell
      currentStep={step}
      totalSteps={STEP_TITLES.length}
      stepTitles={STEP_TITLES}
      onBack={handleBack}
      onNext={handleNext}
      canGoBack={step > 0}
      nextLabel={step === STEP_TITLES.length - 1 ? 'Generate Recommendation →' : 'Next →'}
    >
      {renderStep()}
    </WizardShell>
  );
}
