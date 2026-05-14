// v1.36 A2-impl — shared derivation of anabolic referral signals.
//
// Several engine sites (Seq.1, Seq.2, Seq.5 in treatment.ts; Pre.1, Pre.2 in assessment.ts)
// need to know "is the engine generating a referral letter that mentions anabolic
// consideration?". This file is the single source of truth for that question — the signals
// are computed from structured patient + risk state, NOT by string-matching flag names.
//
// Definitions:
//   anabolicReferralFired      — any VHR referral path is active (the metabolic-bone /
//                                rheumatology referral whose rationale mentions parenteral /
//                                anabolic consideration). Includes the GIOP-VHR sub-case
//                                (priorVertebralFracture + ≥2 fx OR any DEXA site T ≤ −3.5
//                                while on GC) — that path uses lowestDexaTScore (all sites,
//                                including total hip) which is slightly broader than the
//                                risk.ts VHR predicate (LS/FN only at T ≤ −3.5).
//   teriparatideReferralFired  — anabolicReferralFired AND patient has not already completed
//                                a teriparatide course (lifetime maximum is one 24-month course).
//   romosozumabReferralFired   — anabolicReferralFired AND female (not licensed in men) AND
//                                no recent MI/stroke within 12 months (CV CI gate).

import type { PatientInput, RiskCategory } from './types';
import { isOnGC } from './thresholds';

export interface ReferralSignals {
  anabolicReferralFired: boolean;
  teriparatideReferralFired: boolean;
  romosozumabReferralFired: boolean;
}

function lowestDexaTScoreAllSites(p: PatientInput): number | null {
  if (!p.dexaResults) return null;
  const scores = [
    p.dexaResults.lumbarSpineTScore,
    p.dexaResults.totalHipTScore,
    p.dexaResults.femoralNeckTScore,
  ].filter((t): t is number => t != null);
  return scores.length > 0 ? Math.min(...scores) : null;
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
  const isVHR = riskCategory === 'very_high';

  // GIOP-VHR anabolic referral sub-case (matches the `giopVHR` predicate inside giop()):
  // any patient on GC whose lowest DEXA T-score (all sites) is ≤ −3.5, OR who has multiple
  // vertebral fractures. This is broader than the standard VHR predicate (LS/FN only) and
  // independently triggers a rheumatology anabolic-consideration referral in treatment.ts.
  const lowestT = lowestDexaTScoreAllSites(patient);
  const isGIOPVHRAnabolicPath =
    isOnGC(patient) && (
      (patient.priorVertebralFracture && patient.numberOfPriorFractures >= 2) ||
      (lowestT !== null && lowestT <= -3.5)
    );

  const anabolicReferralFired = isVHR || isGIOPVHRAnabolicPath;

  const teriparatideReferralFired =
    anabolicReferralFired && !hasCompletedTeriparatide(patient);

  const romosozumabReferralFired =
    anabolicReferralFired &&
    patient.sex === 'female' &&
    !patient.priorMIOrStrokeWithin12Months;

  return {
    anabolicReferralFired,
    teriparatideReferralFired,
    romosozumabReferralFired,
  };
}
