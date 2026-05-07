'use client';

import { useState } from 'react';
import type {
  ClinicalDecision,
  ClinicalFlag,
  TrafficLight,
  FlagSeverity,
  Urgency,
  PatientEducation,
} from '@/lib/guidelines/types';
import { Term } from '@/components/Tooltip';

interface Props {
  result: ClinicalDecision;
  onReset: () => void;
  onBack: () => void;
}

const TL_CONFIG: Record<TrafficLight, { bg: string; border: string; text: string; label: string }> = {
  green:    { bg: 'bg-emerald-50',  border: 'border-emerald-500', text: 'text-emerald-900', label: 'Low Risk' },
  amber:    { bg: 'bg-amber-50',    border: 'border-amber-500',   text: 'text-amber-900',   label: 'Intermediate Risk' },
  red:      { bg: 'bg-red-50',      border: 'border-red-600',     text: 'text-red-900',     label: 'High Risk' },
  dark_red: { bg: 'bg-red-100',     border: 'border-red-800',     text: 'text-red-950',     label: 'Very High Risk' },
  grey:     { bg: 'bg-slate-100',   border: 'border-slate-400',   text: 'text-slate-800',   label: 'Out of Scope' },
};

const FLAG_CONFIG: Record<FlagSeverity, { bg: string; border: string; badge: string; text: string; ring: string; label: string }> = {
  urgent:  { bg: 'bg-red-50',   border: 'border-red-600',   badge: 'bg-red-600 text-white',         text: 'text-red-950',   ring: 'ring-2 ring-red-300', label: 'Urgent' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-500', badge: 'bg-amber-500 text-white',       text: 'text-amber-950', ring: '',                    label: 'Warning' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-400',  badge: 'bg-blue-100 text-blue-800',     text: 'text-blue-950',  ring: '',                    label: 'Info' },
};

const URGENCY_CONFIG: Record<Urgency, { label: string; color: string }> = {
  urgent:  { label: 'Urgent',  color: 'bg-red-600 text-white font-semibold' },
  soon:    { label: 'Soon',    color: 'bg-amber-500 text-white font-semibold' },
  routine: { label: 'Routine', color: 'bg-slate-100 text-slate-700' },
};

const SEVERITY_ORDER: Record<FlagSeverity, number> = { urgent: 0, warning: 1, info: 2 };
const URGENCY_ORDER: Record<Urgency, number> = { urgent: 0, soon: 1, routine: 2 };

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-3 mt-2">{children}</h2>;
}

function sourceText(flag: ClinicalFlag): string {
  return `${flag.source.guideline} ${flag.source.year}${flag.source.section ? ` §${flag.source.section}` : ''}`;
}

// ─── Unified AlertCard ────────────────────────────────────────────────────
// One layout for urgent / warning / info. Visible: badge + 2-line action + source.
// Collapsible rationale via "show rationale" toggle.

function AlertCard({ flag }: { flag: ClinicalFlag }) {
  const [showRationale, setShowRationale] = useState(false);
  const fc = FLAG_CONFIG[flag.severity];
  const isUrgent = flag.severity === 'urgent';

  return (
    <div className={`${fc.bg} border-l-[6px] ${fc.border} rounded-r-lg p-3 sm:p-4 ${fc.ring}`}>
      <div className="flex items-start gap-2 mb-1.5">
        <Badge className={fc.badge}>{fc.label}</Badge>
      </div>
      <p
        className={`${isUrgent ? 'text-base font-bold' : 'text-sm font-semibold'} ${fc.text} leading-snug line-clamp-3`}
      >
        {flag.message}
      </p>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500">{sourceText(flag)}</p>
        <button
          type="button"
          onClick={() => setShowRationale((s) => !s)}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2"
        >
          {showRationale ? '▴ hide rationale' : '▾ show rationale'}
        </button>
      </div>
      {showRationale && (
        <div className="mt-2 pt-2 border-t border-slate-200/60">
          <p className={`text-xs ${fc.text} opacity-90 leading-snug`}>{flag.rationale}</p>
          {/* If the message was clamped, still allow access to the full text in the same expansion */}
          <p className={`text-xs ${fc.text} opacity-70 mt-1.5 leading-snug`}>
            <span className="font-semibold">Full alert: </span>
            {flag.message}
          </p>
        </div>
      )}
    </div>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {open ? '▴ Hide' : '▾ Show'} {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function PatientEducationPanel({ edu }: { edu: PatientEducation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-teal-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-teal-50 active:bg-teal-100 hover:bg-teal-100 transition-colors text-left min-h-[44px]"
      >
        <span className="text-xs font-semibold text-teal-700">Patient education information</span>
        <span className="text-teal-500 text-xs">{open ? '▴ hide' : '▾ show'}</span>
      </button>
      {open && (
        <div className="px-3 py-3 bg-white space-y-3">
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">What this medicine does</p>
            <p className="text-xs text-slate-700">{edu.whatItDoes}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-teal-700 mb-0.5">How to take it</p>
            <p className="text-xs text-slate-700">{edu.howToTake}</p>
          </div>
          {edu.sideEffects.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-teal-700 mb-0.5">Common side effects</p>
              <ul className="text-xs text-slate-700 space-y-0.5 list-disc list-inside">
                {edu.sideEffects.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {edu.warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-800 mb-0.5">Important warnings</p>
              <ul className="text-xs text-amber-900 space-y-0.5 list-disc list-inside font-medium">
                {edu.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
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
    <div className="space-y-5 sm:space-y-6">
      {/* Traffic light banner */}
      <div className={`${tl.bg} border-l-4 ${tl.border} rounded-r-lg p-4 sm:p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-2xl sm:text-3xl font-extrabold ${tl.text} leading-tight`}>{tl.label}</p>
            <p className={`text-sm mt-2 ${tl.text} opacity-90 leading-snug`}>{rs.rationale}</p>
          </div>
          {result.outOfScope && (
            <Badge className="bg-slate-200 text-slate-700 mt-1">Out of scope</Badge>
          )}
        </div>

        {(rs.fraxMOFPercent !== null || rs.fraxHipPercent !== null) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {rs.fraxMOFPercent !== null && (
              <div>
                <Term term="MOF">
                  <span className={`${tl.text} opacity-70`}>MOF</span>
                </Term>
                <span className={`${tl.text} opacity-70`}> </span>
                <span className={`font-bold ${tl.text}`}>{rs.fraxMOFPercent.toFixed(1)}%</span>
                {mofChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxMOFPercent!.toFixed(1)}% adj
                  </span>
                )}
              </div>
            )}
            {rs.fraxHipPercent !== null && (
              <div>
                <span className={`${tl.text} opacity-70`}>Hip </span>
                <span className={`font-bold ${tl.text}`}>{rs.fraxHipPercent.toFixed(1)}%</span>
                {hipChanged && (
                  <span className={`${tl.text} opacity-70`}>
                    {' '}→ {rs.adjustedFraxHipPercent!.toFixed(1)}% adj
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {rs.fraxAdjustments.length > 0 && (
          <p className={`text-xs mt-2 ${tl.text} opacity-70`}>
            Adjustments:{' '}
            {rs.fraxAdjustments.map((a) => `${a.factor} ×${a.multiplier} (${a.appliedTo})`).join(' · ')}
          </p>
        )}
      </div>

      {/* Patient summary */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Patient</p>
        <p className="text-sm text-slate-800">{result.patientSummary}</p>
      </div>

      {/* TREATMENT FIRST — clinician sees what to prescribe at the top */}
      {result.treatmentRecommendations.length > 0 && (
        <section>
          <SectionTitle>Treatment</SectionTitle>
          <div className="space-y-3">
            {result.treatmentRecommendations.map((tr, i) => {
              const isAlt = tr.priority === 'alternative';
              return (
                <div
                  key={i}
                  className={`bg-white border rounded-lg p-4 shadow-sm ${
                    isAlt ? 'border-slate-200 opacity-95' : 'border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg sm:text-xl font-bold text-slate-900 capitalize leading-tight">
                        {tr.agent}
                      </p>
                      {isAlt ? (
                        <Badge className="bg-slate-200 text-slate-700">Second-line alternative</Badge>
                      ) : (
                        <Badge className="bg-indigo-600 text-white">First-line</Badge>
                      )}
                    </div>
                    <Badge
                      className={
                        tr.strength === 'strong'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-slate-100 text-slate-600'
                      }
                    >
                      {tr.strength === 'strong' ? 'Strong' : 'Conditional'}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">
                    {tr.dose} · {tr.frequency}
                  </p>
                  <p className="text-xs text-slate-600 mb-2 leading-snug">{tr.rationale}</p>

                  {tr.irishPrescribingNote && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded px-3 py-2 mb-2">
                      <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide mb-0.5">
                        Ireland prescribing
                      </p>
                      <p className="text-xs text-indigo-900 leading-snug">{tr.irishPrescribingNote}</p>
                    </div>
                  )}

                  {tr.contraindications.length > 0 && (
                    <div className="bg-red-50 border-l-4 border-red-500 rounded-r px-3 py-2 mb-2">
                      <p className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-1">
                        Contraindications
                      </p>
                      <ul className="text-xs text-red-900 font-medium space-y-1 list-disc list-inside leading-snug">
                        {tr.contraindications.map((c, j) => (
                          <li key={j}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {tr.monitoring.length > 0 && (
                    <Disclosure label="monitoring details">
                      <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside leading-snug">
                        {tr.monitoring.map((m, j) => (
                          <li key={j}>{m}</li>
                        ))}
                      </ul>
                    </Disclosure>
                  )}

                  <p className="text-[11px] text-slate-400 mt-2">
                    {tr.source.guideline} {tr.source.year}
                  </p>

                  {tr.patientEducation && <PatientEducationPanel edu={tr.patientEducation} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Clinical alerts — single unified format for urgent / warning / info */}
      {sortedFlags.length > 0 && (
        <section>
          <SectionTitle>Clinical alerts</SectionTitle>
          <div className="space-y-2">
            {sortedFlags.map((flag) => (
              <AlertCard key={flag.id} flag={flag} />
            ))}
          </div>
        </section>
      )}

      {/* Investigations */}
      {sortedInvestigations.length > 0 &&
        (() => {
          const noTier = sortedInvestigations.filter((i) => !i.tier);
          const tier1 = sortedInvestigations.filter((i) => i.tier === 1);
          const tier2 = sortedInvestigations.filter((i) => i.tier === 2);
          const tier3 = sortedInvestigations.filter((i) => i.tier === 3);

          function InvCard({ inv }: { inv: typeof sortedInvestigations[0] }) {
            const uc = URGENCY_CONFIG[inv.urgency];
            return (
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-sm font-bold text-slate-900">
                    {inv.investigation.toUpperCase().replace(/_/g, ' ')}
                  </p>
                  {inv.urgency !== 'routine' && <Badge className={uc.color}>{uc.label}</Badge>}
                </div>
                <p className="text-xs text-slate-600 leading-snug">{inv.reason}</p>
              </div>
            );
          }

          function SubHeading({ label, color }: { label: string; color: string }) {
            return (
              <p
                className={`text-[11px] font-bold uppercase tracking-wide mb-2 mt-4 first:mt-0 ${color}`}
              >
                {label}
              </p>
            );
          }

          return (
            <section>
              <SectionTitle>Investigations</SectionTitle>

              {noTier.length > 0 && (
                <div className="space-y-2">
                  {noTier.map((inv, i) => (
                    <InvCard key={i} inv={inv} />
                  ))}
                </div>
              )}

              {tier1.length > 0 && (
                <>
                  <SubHeading label="Mandatory pre-treatment bloods" color="text-red-700" />
                  <div className="space-y-2">
                    {tier1.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}

              {tier2.length > 0 && (
                <>
                  <SubHeading label="Recommended baseline bloods" color="text-amber-700" />
                  <div className="space-y-2">
                    {tier2.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}

              {tier3.length > 0 && (
                <>
                  <SubHeading
                    label="Further investigations — if clinically indicated"
                    color="text-slate-500"
                  />
                  <div className="space-y-2">
                    {tier3.map((inv, i) => (
                      <InvCard key={i} inv={inv} />
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })()}

      {/* Referrals */}
      {sortedReferrals.length > 0 && (
        <section>
          <SectionTitle>Referrals</SectionTitle>
          <div className="space-y-2">
            {sortedReferrals.map((ref, i) => {
              const uc = URGENCY_CONFIG[ref.urgency];
              const specialty = ref.specialty
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-bold text-slate-900">{specialty}</p>
                    <Badge className={uc.color}>{uc.label}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 leading-snug">{ref.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Supplements — bullet format */}
      {result.supplements.length > 0 && (
        <section>
          <SectionTitle>Supplements</SectionTitle>
          <div className="space-y-2">
            {result.supplements.map((s, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                <p className="text-sm font-bold text-slate-900 mb-1">
                  {s.supplement === 'calcium' ? 'Calcium' : 'Vitamin D'}
                </p>
                <p className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{s.headline}</p>
                {s.bullets.length > 0 && (
                  <ul className="space-y-1">
                    {s.bullets.map((b, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-slate-700 leading-snug">
                        <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Disclosure label="rationale">
                  <p className="text-xs text-slate-500 leading-snug">{s.rationale}</p>
                </Disclosure>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lifestyle advice */}
      {result.lifestyleAdvice.length > 0 && (
        <section>
          <SectionTitle>Lifestyle advice</SectionTitle>
          <ul className="space-y-2 bg-white border border-slate-200 rounded-lg px-4 py-3">
            {result.lifestyleAdvice.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-snug">
                <span className="text-indigo-500 mt-0.5 shrink-0 font-bold">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Review schedule */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Review schedule</p>
        <p className="text-sm text-slate-800">{result.reviewSchedule}</p>
      </div>

      {/* Guidelines used */}
      <p className="text-[11px] text-slate-400 leading-snug">
        <span className="font-semibold">Guidelines: </span>
        {result.guidelinesUsed.join(' · ')}
      </p>

      {/* Navigation */}
      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-3 sm:py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 bg-white active:bg-slate-100 hover:bg-slate-50 transition-colors min-h-[44px]"
        >
          ← Edit inputs
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-5 py-3 sm:py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 bg-white active:bg-slate-100 hover:bg-slate-50 transition-colors min-h-[44px]"
        >
          New patient
        </button>
      </div>
    </div>
  );
}
