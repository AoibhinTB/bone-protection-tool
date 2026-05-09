'use client';

const FEEDBACK_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScyshX1LF68y7UYCJm9DSp2f_9s-DJ2FEi3xM3WX4wXSNFzAg/viewform';

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
  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      {/* Header */}
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

      {/* Progress */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-2.5 sm:py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-sm font-medium text-slate-700 truncate pr-2">
              <span className="text-slate-400 font-normal">Step {currentStep + 1}/{totalSteps} · </span>
              {stepTitles[currentStep]}
            </span>
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
      <main className="flex-1 px-4 sm:px-6 py-5 sm:py-8 pb-28 sm:pb-8">
        <div className="max-w-3xl mx-auto">{children}</div>
      </main>

      {/* Navigation */}
      <footer className="bg-white border-t border-slate-200 px-4 sm:px-6 py-3 sm:py-4 fixed bottom-0 inset-x-0 sm:static safe-pb shadow-[0_-2px_10px_rgba(0,0,0,0.04)] sm:shadow-none">
        <div className="max-w-3xl mx-auto flex gap-3">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="flex-1 sm:flex-initial sm:px-5 px-4 py-3 sm:py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white active:bg-slate-100 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            ← Back
          </button>
          <button
            onClick={onNext}
            className="flex-[2] sm:flex-initial sm:px-6 px-4 py-3 sm:py-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white active:bg-indigo-800 hover:bg-indigo-700 transition-colors min-h-[44px]"
          >
            {nextLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
