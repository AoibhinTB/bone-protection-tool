'use client';

interface WizardShellProps {
  currentStep: number;
  totalSteps: number;
  stepTitles: string[];
  onBack: () => void;
  onNext: () => void;
  canGoBack: boolean;
  nextLabel: string;
  children: React.ReactNode;
}

export function WizardShell({
  currentStep,
  totalSteps,
  stepTitles,
  onBack,
  onNext,
  canGoBack,
  nextLabel,
  children,
}: WizardShellProps) {
  const pct = Math.round(((currentStep + 1) / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold text-slate-900">Bone Protection Tool</h1>
            <span className="text-sm text-slate-500">Clinical Decision Support · Ireland</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            For use by registered healthcare professionals. Does not replace clinical judgement.
          </p>
        </div>
      </header>

      {/* Progress */}
      <div className="bg-white border-b border-slate-100 px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">
              Step {currentStep + 1} of {totalSteps}: {stepTitles[currentStep]}
            </span>
            <span className="text-xs text-slate-400">{pct}%</span>
          </div>
          <div className="flex gap-1">
            {stepTitles.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < currentStep
                    ? 'bg-indigo-600'
                    : i === currentStep
                    ? 'bg-indigo-400'
                    : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-3xl mx-auto">{children}</div>
      </main>

      {/* Navigation */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex justify-between">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="px-5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={onNext}
            className="px-6 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            {nextLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
