// v1.36 A2-impl — shared derivation of anabolic referral signals.
//
// Several engine sites (Seq.1, Seq.2, Seq.5 in treatment.ts; Pre.1, Pre.2 in assessment.ts)
// need to know "is the engine generating a referral letter that mentions anabolic
// consideration?". This file is the single source of truth for that question — the signals
// are computed from structured patient + risk state, NOT by string-matching flag names.
//
// Definitions:
//   anabolicReferralFired      — riskCategory === 'very_high'. NOGG 2024 Section 5 does NOT
//                                define a separate "very high risk GIOP" category with
//                                distinct thresholds — the operational definition of
//                                VHR-GIOP is "standard NOGG Rec 11 VHR criteria + on GC",
//                                which is just riskCategory === 'very_high' since GC dose
//                                is already incorporated as FRAX context. The previous
//                                GIOP-specific OR branch (on GC + ≥2 vert fx OR any DEXA
//                                site T ≤ −3.5) used engine-invented thresholds not
//                                anchored to NOGG; dropped in this file. In practice the
//                                OR branch was largely redundant since both ≥2 vert fx and
//                                T ≤ −3.5 typically already produce VHR by standard criteria.
//   teriparatideReferralFired  — anabolicReferralFired AND patient has not already completed
//                                a teriparatide course (lifetime maximum is one 24-month course).
//   romosozumabReferralFired   — anabolicReferralFired AND female (not licensed in men) AND
//                                no prior MI or stroke (CV CI gate per spec v1.36 §5.5:
//                                "avoid if MI or stroke history" — no time window).

import type { PatientInput, RiskCategory } from './types';

export interface ReferralSignals {
  anabolicReferralFired: boolean;
  teriparatideReferralFired: boolean;
  romosozumabReferralFired: boolean;
}

function hasCompletedTeriparatide(p: PatientInput): boolean {
  for (const t of p.previousTreatments) {
    if (t.agent !== 'teriparatide') continue;
    if (t.currentlyOn) continue;
    if (t.reasonStopped === 'completed_course') return true;
    if (t.durationMonths >= 24) return true;
  }
  return false;
}

export function deriveReferralSignals(
  patient: PatientInput,
  riskCategory: RiskCategory,
): ReferralSignals {
  const anabolicReferralFired = riskCategory === 'very_high';

  const teriparatideReferralFired =
    anabolicReferralFired && !hasCompletedTeriparatide(patient);

  const romosozumabReferralFired =
    anabolicReferralFired &&
    patient.sex === 'female' &&
    !patient.priorMIOrStroke;

  return {
    anabolicReferralFired,
    teriparatideReferralFired,
    romosozumabReferralFired,
  };
}
