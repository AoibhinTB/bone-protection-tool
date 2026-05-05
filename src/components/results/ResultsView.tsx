'use client';

import { useState } from 'react';
import type { ClinicalDecision, TrafficLight, FlagSeverity, Urgency, PatientEducation } from '@/lib/guidelines/types';

interface Props {
  result: ClinicalDecision;
  onReset: () => void;
  onBack: () => void;
}

const TL_CONFIG: Record<TrafficLight, { bg: string; border: string; text: string; label: string }> = {
  green:    { bg: 'bg-emerald-50',  border: 'border-emerald-500', text: 'text-emerald-800', label: 'Low Risk' },
  amber:    { bg: 'bg-amber-50',    border: 'border-amber-500',   text: 'text-amber-800',   label: 'Intermediate Risk' },
  red:      { bg: 'bg-red-50',      border: 'border-red-600',     text: 'text-red-800',     label: 'High Risk' },
  dark_red: { bg: 'bg-red-100',     border: 'border-red-800',     text: 'text-red-900',     label: 'Very High Risk' },
  grey:     { bg: 'bg-slate-100',   border: 'border-slate-400',   text: 'text-slate-700',   label: 'Out of Scope' },
};

const FLAG_CONFIG: Record<FlagSeverity, { bg: string; border: string; badge: string; text: string }> = {
  urgent:  { bg: 'bg-red-50',   border: 'border-red-400',   badge: 'bg-red-100 text-red-700',   text: 'text-red-900' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-400', badge: 'bg-amber-100 text-amber-700', text: 'text-amber-900' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-300',  badge: 'bg-blue-100 text-blue-700',  text: 'text-blue-900' },
};

const URGENCY_CONFIG: Record<Urgency, { label: string; color: string }> = {
  urgent:  { label: 'Urgent',  color: 'bg-red-100 text-red-700' },
  soon:    { label: 'Soon',    color: 'bg-amber-100 text-amber-700' },
  routine: { label: 'Routine', color: 'bg-slate-100 text-slate-600' },
};

const SEVERITY_ORDER: Record<FlagSeverity, number> = { urgent: 0, warning: 1, info: 2 };
const URGENCY_ORDER: Record<Urgency, number> = { urgent: 0, soon: 1, routine: 2 };

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${className}`}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-slate-900 mb-3">{children}</h2>;
}

function PatientEducationPanel({ edu }: { edu: PatientEducation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-teal-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-teal-50 hover:bg-teal-100 transition-colors text-left"
      >
        <span className="text-xs font-medium text-teal-700">Patient education information</span>
        <span className="text-teal-500 text-xs">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="px-3 py-3 bg-white space-y-3">
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">What this medicine does</p>
            <p className="text-xs text-slate-600">{edu.whatItDoes}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">How to take it</p>
            <p className="text-xs text-slate-600">{edu.howToTake}</p>
          </div>
          {edu.sideEffects.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-teal-700 mb-0.5">Common side effects</p>
              <ul className="text-xs text-slate-600 space-y-0.5 list-disc list-inside">
                {edu.sideEffects.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {edu.warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Important warnings</p>
              <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside">
                {edu.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ResultsView({ result, onReset, onBack }: Props) {
  const rs = result.riskStratification;
  const tl = TL_CONFIG[rs.trafficLight];

  const sortedFlags = [...result.flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const sortedInvestigations = [...result.investigationsNeeded].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
  );
  const sortedReferrals = [...result.referrals].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
  );

  const mofChanged =
    rs.adjustedFraxMOFPercent !== null &&
    rs.fraxMOFPercent !== null &&
    rs.adjustedFraxMOFPercent !== rs.fraxMOFPercent;
  const hipChanged =
    rs.adjustedFraxHipPercent !== null &&
    rs.fraxHipPercent !== null &&
    rs.adjustedFraxHipPercent !== rs.fraxHipPercent;

  return (
    <div className="space-y-6">
      {/* Traffic light banner */}
      <div className={`${tl.bg} border-l-4 ${tl.border} rounded-r-lg p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={`text-xl font-bold ${tl.text}`}>{tl.label}</p>
            <p className={`text-sm mt-1 ${tl.text} opacity-80`}>{rs.rationale}</p>
          </div>
          {result.outOfScope && (
            <Badge className="bg-slate-200 text-slate-700 mt-0.5">Out of scope</Badge>
          )}
        </div>

        {(rs.fraxMOFPercent !== null || rs.fraxHipPercent !== null) && (
          <div className="mt-3 flex flex-wrap gap-5 text-sm">
            {rs.fraxMOFPercent !== null && (
              <div>
                <span className={`${tl.text} opacity-70`}>MOF </span>
                <span className={`font-semibold ${tl.text}`}>{rs.fraxMOFPercent.toFixed(1)}%</span>
                {mofChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxMOFPercent!.toFixed(1)}% adjusted
                  </span>
                )}
              </div>
            )}
            {rs.fraxHipPercent !== null && (
              <div>
                <span className={`${tl.text} opacity-70`}>Hip </span>
                <span className={`font-semibold ${tl.text}`}>{rs.fraxHipPercent.toFixed(1)}%</span>
                {hipChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxHipPercent!.toFixed(1)}% adjusted
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {rs.fraxAdjustments.length > 0 && (
          <p className={`text-xs mt-2 ${tl.text} opacity-60`}>
            Adjustments:{' '}
            {rs.fraxAdjustments
              .map(a => `${a.factor} ×${a.multiplier} (${a.appliedTo})`)
              .join(' · ')}
          </p>
        )}
      </div>

      {/* Patient summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Patient</p>
        <p className="text-sm text-slate-700">{result.patientSummary}</p>
      </div>

      {/* Clinical alerts */}
      {sortedFlags.length > 0 && (
        <section>
          <SectionTitle>Clinical alerts</SectionTitle>
          <div className="space-y-2">
            {sortedFlags.map(flag => {
              const fc = FLAG_CONFIG[flag.severity];
              return (
                <div key={flag.id} className={`${fc.bg} border-l-4 ${fc.border} rounded-r-lg p-3`}>
                  <div className="flex items-start gap-2">
                    <Badge className={`${fc.badge} mt-0.5`}>{flag.severity.toUpperCase()}</Badge>
                    <div>
                      <p className={`text-sm font-medium ${fc.text}`}>{flag.message}</p>
                      <p className={`text-xs mt-0.5 ${fc.text} opacity-80`}>{flag.rationale}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {flag.source.guideline} {flag.source.year}
                        {flag.source.section ? ` §${flag.source.section}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Treatment recommendations */}
      {result.treatmentRecommendations.length > 0 && (
        <section>
          <SectionTitle>Treatment recommendations</SectionTitle>
          <div className="space-y-3">
            {result.treatmentRecommendations.map((tr, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-slate-900 capitalize">{tr.agent}</p>
                  <Badge className={tr.strength === 'strong' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}>
                    {tr.strength === 'strong' ? 'Strong' : 'Conditional'}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 mb-1">
                  {tr.dose} · {tr.frequency}
                </p>
                <p className="text-xs text-slate-500 mb-2">{tr.rationale}</p>

                {tr.irishPrescribingNote && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded px-3 py-2 mb-2">
                    <p className="text-xs font-medium text-indigo-700 mb-0.5">Ireland prescribing</p>
                    <p className="text-xs text-indigo-600">{tr.irishPrescribingNote}</p>
                  </div>
                )}

                {tr.contraindications.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-slate-600 mb-0.5">Contraindications:</p>
                    <ul className="text-xs text-slate-500 space-y-0.5 list-disc list-inside">
                      {tr.contraindications.map((c, j) => <li key={j}>{c}</li>)}
                    </ul>
                  </div>
                )}

                {tr.monitoring.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-slate-600 mb-0.5">Monitoring:</p>
                    <ul className="text-xs text-slate-500 space-y-0.5 list-disc list-inside">
                      {tr.monitoring.map((m, j) => <li key={j}>{m}</li>)}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-slate-400">
                  {tr.source.guideline} {tr.source.year}
                </p>

                {tr.patientEducation && (
                  <PatientEducationPanel edu={tr.patientEducation} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Investigations */}
      {sortedInvestigations.length > 0 && (
        <section>
          <SectionTitle>Investigations needed</SectionTitle>
          <div className="space-y-2">
            {sortedInvestigations.map((inv, i) => {
              const uc = URGENCY_CONFIG[inv.urgency];
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3"
                >
                  <Badge className={uc.color}>{uc.label}</Badge>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-800">
                        {inv.investigation.toUpperCase().replace(/_/g, ' ')}
                      </p>
                      {inv.tier && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          inv.tier === 1 ? 'bg-red-100 text-red-700' :
                          inv.tier === 2 ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          Tier {inv.tier}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{inv.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Referrals */}
      {sortedReferrals.length > 0 && (
        <section>
          <SectionTitle>Referrals</SectionTitle>
          <div className="space-y-2">
            {sortedReferrals.map((ref, i) => {
              const uc = URGENCY_CONFIG[ref.urgency];
              const specialty = ref.specialty
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3"
                >
                  <Badge className={uc.color}>{uc.label}</Badge>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{specialty}</p>
                    <p className="text-xs text-slate-500">{ref.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Supplements */}
      {result.supplements.length > 0 && (
        <section>
          <SectionTitle>Supplements</SectionTitle>
          <div className="space-y-2">
            {result.supplements.map((s, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                <p className="text-sm font-medium text-slate-800">
                  {s.supplement === 'calcium' ? 'Calcium' : 'Vitamin D'} — {s.dose}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{s.rationale}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lifestyle advice */}
      {result.lifestyleAdvice.length > 0 && (
        <section>
          <SectionTitle>Lifestyle advice</SectionTitle>
          <ul className="space-y-1.5">
            {result.lifestyleAdvice.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="text-slate-400 mt-0.5 shrink-0">•</span>
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Review schedule */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Review schedule</p>
        <p className="text-sm text-slate-700">{result.reviewSchedule}</p>
      </div>

      {/* Guidelines used */}
      <p className="text-xs text-slate-400">
        <span className="font-medium">Guidelines: </span>
        {result.guidelinesUsed.join(' · ')}
      </p>

      {/* Navigation */}
      <div className="pt-4 border-t border-slate-200 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
        >
          ← Edit inputs
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-500 bg-white hover:bg-slate-50 transition-colors"
        >
          New patient
        </button>
      </div>
    </div>
  );
}
