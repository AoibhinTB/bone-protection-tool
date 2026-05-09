'use client';

interface Props {
  onAccept: () => void;
}

const FEEDBACK_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScyshX1LF68y7UYCJm9DSp2f_9s-DJ2FEi3xM3WX4wXSNFzAg/viewform';

export function DisclaimerScreen({ onAccept }: Props) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col safe-pt safe-pb">
      <div className="flex-1 flex flex-col px-4 sm:px-6 py-4 sm:py-6 max-w-md sm:max-w-lg mx-auto w-full">
        {/* Header */}
        <header className="text-center mb-3 sm:mb-4">
          <div className="inline-flex items-center justify-center h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-indigo-600 text-white font-bold text-base sm:text-lg mb-2">
            BP
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
            Ireland Bone Protection Tool
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            Clinical Decision Support for Irish Healthcare Professionals
          </p>
        </header>

        {/* Description */}
        <p className="text-xs sm:text-sm text-slate-700 leading-snug text-center mb-3 sm:mb-4">
          A clinical decision support tool to guide bone protection assessment and management
          in line with NOGG 2024, HSE Medicines Management Programme, and Irish Osteoporosis Society guidelines.
        </p>

        {/* Disclaimer box */}
        <section
          aria-label="Disclaimer"
          className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5 sm:px-4 sm:py-3 mb-2 sm:mb-3"
        >
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-slate-700 mb-1.5">
            Disclaimer
          </p>
          <ul className="space-y-1 text-[11px] sm:text-xs text-slate-800 leading-snug">
            <li className="flex items-start gap-1.5">
              <span className="text-slate-500 mt-0.5 shrink-0">•</span>
              <span>For use by registered healthcare professionals only</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-slate-500 mt-0.5 shrink-0">•</span>
              <span>This is a decision support aid and does not replace clinical judgement</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-slate-500 mt-0.5 shrink-0">•</span>
              <span>All recommendations must be verified against current SmPCs and HSE reimbursement criteria before prescribing</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-slate-500 mt-0.5 shrink-0">•</span>
              <span>This tool is pending independent clinical review — it is a prototype under active development</span>
            </li>
          </ul>
        </section>

        {/* Data privacy box */}
        <section
          aria-label="Data privacy"
          className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2.5 sm:px-4 sm:py-3 mb-3 sm:mb-4"
        >
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-sky-800 mb-1.5">
            Data privacy
          </p>
          <ul className="space-y-1 text-[11px] sm:text-xs text-sky-950 leading-snug">
            <li className="flex items-start gap-1.5">
              <span className="text-sky-600 mt-0.5 shrink-0">•</span>
              <span>No patient data is collected, stored, or transmitted</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-sky-600 mt-0.5 shrink-0">•</span>
              <span>All information entered is processed locally in your browser and discarded when you leave the page</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-sky-600 mt-0.5 shrink-0">•</span>
              <span>This tool is fully anonymous</span>
            </li>
          </ul>
        </section>

        {/* CTA — most prominent element */}
        <button
          type="button"
          onClick={onAccept}
          className="w-full rounded-lg bg-indigo-600 text-white font-semibold text-sm sm:text-base px-5 py-3 sm:py-3.5 active:bg-indigo-800 hover:bg-indigo-700 shadow-sm transition-colors min-h-[48px]"
        >
          I understand — begin assessment
        </button>

        {/* Footer: version, sources, feedback */}
        <footer className="mt-3 sm:mt-4 text-center text-[10px] sm:text-[11px] text-slate-500 leading-snug">
          <p className="mb-1">
            <span className="font-medium text-slate-600">Version 1.0</span>
            {' · '}Last reviewed May 2026
          </p>
          <p className="mb-2">
            Sources: NOGG 2024 · HSE MMP · IOS · FRAX Ireland (country 49) · NICE NG187 · ISCD 2023
          </p>
          <p className="text-slate-600">
            Found a clinical error or have a suggestion? We want to hear from you.
            {' '}
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800 font-medium"
            >
              Submit feedback
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
