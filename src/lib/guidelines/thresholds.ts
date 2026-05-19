// Versioned threshold data — all values sourced from published guidelines
// Update version strings when guidelines are revised

import type { GuidelineSource, FraxAdjustment, PatientInput, GlucocorticoidDose } from './types';

// ─── Glucocorticoid helpers (v1.13) ───────────────────────────────────────
// Canonical numeric dose input (mg/day prednisolone equivalent) is read first.
// Legacy categorical (glucocorticoidUse) is used as a fallback for UI compat.

const LEGACY_GC_DOSE_MG: Record<GlucocorticoidDose, number> = {
  very_low: 1.25,  // <2.5 mg/day band — midpoint
  low:       5,    // 2.5–7.4 mg/day band
  medium:   10,    // 7.5–20 mg/day band
  high:     25,    // >20 mg/day band — midpoint
};

/** Effective current GC dose in mg/day. null if not on GC. */
export function effectiveGCDoseMgDay(p: PatientInput): number | null {
  // Canonical numeric field wins
  if (p.glucocorticoidDoseMgDay !== null && p.glucocorticoidDoseMgDay !== undefined) {
    return p.glucocorticoidDoseMgDay > 0 ? p.glucocorticoidDoseMgDay : null;
  }
  // Fall back to legacy categorical
  if (p.glucocorticoidUse?.current === true) {
    return LEGACY_GC_DOSE_MG[p.glucocorticoidUse.dose];
  }
  return null;
}

/** Currently on glucocorticoid (any dose >0). */
export function isOnGC(p: PatientInput): boolean {
  return effectiveGCDoseMgDay(p) !== null;
}

/** Current GC dose ≥7.5 mg/day prednisolone equivalent. */
export function isOnHighDoseGC(p: PatientInput): boolean {
  const d = effectiveGCDoseMgDay(p);
  return d !== null && d >= 7.5;
}

/** Current GC dose ≥2.5 mg/day (medium or high band). */
export function isOnMediumOrHighDoseGC(p: PatientInput): boolean {
  const d = effectiveGCDoseMgDay(p);
  return d !== null && d >= 2.5;
}

/** Elapsed duration of current GC use in months (0 if not on GC). */
export function gcDurationMonths(p: PatientInput): number {
  if (p.glucocorticoidUse?.current === true) return p.glucocorticoidUse.durationMonths;
  return 0;
}

// ─── GC status helpers (v1.19) ───────────────────────────────────────────
// glucocorticoidStatus replaces the recentOralGlucocorticoidUse and
// glucocorticoidPreviouslyUsed booleans. The four meaningful values drive
// distinct downstream pathways. null is treated like 'never' but kept distinct
// in the schema so the UI can show "not assessed" rather than asserting "never".

/** Patient stopped GC within the last ~12 months. Drives VFA recommendation
 *  (silent vertebral fractures may have occurred during the GC period). */
export function gcStoppedWithin12Months(p: PatientInput): boolean {
  return p.glucocorticoidStatus === 'stopped_within_12m';
}

/** Patient stopped GC over 12 months ago. Drives Section 9.4 GC withdrawal
 *  bone-protection review when patient is now on a bisphosphonate. */
export function gcStoppedOver12MonthsAgo(p: PatientInput): boolean {
  return p.glucocorticoidStatus === 'stopped_over_12m_ago';
}

/** Patient ever had a previous course of GC (within 12 months OR over 12 months ago). */
export function gcEverPreviouslyUsed(p: PatientInput): boolean {
  return p.glucocorticoidStatus === 'stopped_within_12m' ||
         p.glucocorticoidStatus === 'stopped_over_12m_ago';
}

// ─── Renal function: CrCl via Cockcroft-Gault (v1.46) ─────────────────────
// Replaces the prior raw eGFR field. Engine + UI + tests consume CrCl via
// this helper.
//
// Cockcroft-Gault (SI):
//   CrCl = ((140 − age) × weightKg × F) / serumCreatinine_µmol/L
//   F = 1.04 (female), 1.23 (male)
// Source: GPnotebook / MDCalc SI / UKidney. BNF expresses female as
// F_male × 0.85 = 1.0455; rounded form 1.04 (vs 1.0455) differs by 0.5%
// and is clinically indistinguishable at all current TCs (verified).
//
// Returns null if any input is missing — engine callers branch accordingly.
// Null-CrCl surfacing lives at safetyFilters.ts via the crcl_pending_renal_drug
// filter (v1.48 Backlog #18); the prior crcl_unknown flag emission in
// treatment.ts was removed as unreachable dead code.
const COCKCROFT_GAULT_F_FEMALE = 1.04;
const COCKCROFT_GAULT_F_MALE   = 1.23;

export function computeCrCl(p: PatientInput): number | null {
  const creat = p.bloodResults?.creatinine ?? null;
  if (creat === null || creat <= 0) return null;
  if (p.weightKg === null || p.weightKg <= 0) return null;
  if (p.age === null || p.age <= 0) return null;
  const f = p.sex === 'female' ? COCKCROFT_GAULT_F_FEMALE : COCKCROFT_GAULT_F_MALE;
  return ((140 - p.age) * p.weightKg * f) / creat;
}

// ─── Anthropometry: BMI via weight/height² (v1.46) ────────────────────────
// Replaces the prior raw bmi field. Engine + UI + tests consume BMI via
// this helper. Weight is dual-purpose: also used for CrCl.
//
// BMI = weightKg / heightM². Returns null if either input is missing.

export function computeBMI(p: PatientInput): number | null {
  if (p.weightKg === null || p.weightKg <= 0) return null;
  if (p.heightCm === null || p.heightCm <= 0) return null;
  const heightM = p.heightCm / 100;
  return p.weightKg / (heightM * heightM);
}

// v1.14 — count of standard FRAX clinical risk factors a patient has, *excluding* the
// AI-/ADT-/early-menopause condition itself (those are the primary trigger, not "additional").
// Used by the IOF 2017 AI threshold logic.
export function aiAdditionalRiskFactorCount(p: PatientInput): number {
  let n = 0;
  if (p.priorFragilityFracture || p.priorHipFracture || p.priorVertebralFracture) n++;
  if (p.parentalHipFracture) n++;
  if (p.currentSmoker) n++;
  if (p.alcoholUnitsPerWeek >= 21) n++;
  const bmi = computeBMI(p);
  if (bmi !== null && bmi < 19) n++;
  if (p.rheumatoidArthritis) n++;
  if (isOnGC(p)) n++;
  if (p.secondaryOsteoporosis.length > 0) n++;
  return n;
}

// ─── Guideline versions ────────────────────────────────────────────────────

export const GUIDELINE_VERSIONS = {
  nogg:           { guideline: 'NOGG',                                                                    version: '2024', year: 2024 } as GuidelineSource,
  hse_mmp:        { guideline: 'HSE MMP Ireland',                                                         version: '2023', year: 2023 } as GuidelineSource,
  nice:           { guideline: 'NICE NG187',                                                              version: '2023', year: 2023 } as GuidelineSource,
  ios:            { guideline: 'Irish Osteoporosis Society',                                               version: '2024', year: 2024 } as GuidelineSource,
  bsr:            { guideline: 'BSR/BHPR GIOP Guidelines',                                                version: '2022', year: 2022 } as GuidelineSource,
  acr:            { guideline: 'ACR GIOP Guidelines',                                                     version: '2022', year: 2022 } as GuidelineSource,
  iscd:           { guideline: 'ISCD Official Positions',                                                  version: '2023', year: 2023 } as GuidelineSource,
  mccarroll_2023: { guideline: 'McCarroll K. Osteoporosis: Diagnosis and Management (CPD). Medical Independent', version: '2023', year: 2023 } as GuidelineSource,
  mccarroll_2025: { guideline: 'McCarroll K. Osteoporosis: Review and Update. Medical Independent',       version: '2025', year: 2025 } as GuidelineSource,
  hse_map_romo:   { guideline: 'HSE Managed Access Protocol — Romosozumab (Evenity)',                     version: '2024', year: 2024, section: 'assets.hse.ie/media/documents/HSE_Managed_Access_Protocol_Romosozumab.pdf' } as GuidelineSource,
};

// ─── NOGG 2024 intervention thresholds ────────────────────────────────────
// 10-year FRAX probability of major osteoporotic fracture (MOF), %
// Applied AFTER arithmetic adjustments (Section 2.2, NOGG 2024 Table 2).
// Thresholds apply equally to men and women per NOGG 2024.
// FRAX must be calculated using Ireland country code 49 (frax.shef.ac.uk).
//
// Source: Kanis JA et al. Age Ageing. 2024 (NOGG 2024 Clinical Guideline), Table 5.
//
// lowerMOF = Lower Assessment Threshold (LAT): below this = low risk; no DEXA required.
// upperMOF = Upper Assessment Threshold (UAT): at or above this = treat without DEXA.
// Between LAT and UAT = intermediate risk; DEXA required before treatment decision.
// lowerHip / upperHip follow the same LAT/UAT structure for the hip fracture axis.
//
// FIXED THRESHOLDS ≥70: NOGG 2024 explicitly states "At age 70 years and above, fixed
// thresholds are applied" — all bands from 70 to 120 use the age-70 values.
//
// VERY HIGH RISK threshold = Intervention Threshold × 1.60 per NOGG 2024 Section 3.2.
// At age 70+: MOF VHRT = 32.5%, Hip VHRT = 8.6% (see VERY_HIGH_RISK below).
//
// TC10 DISCREPANCY NOTE: The clinical spec (v1.2, TC10) labels an 82F with FRAX hip
// 5.2% as VERY HIGH citing "FRAX hip ≥4.5%". Confirmed from NOGG 2024 Table 5:
//   - Hip IT at 70+ = 5.4% — so FRAX hip 5.2% is actually BELOW the intervention threshold.
//   - Hip VHRT at 70+ = 8.6% — so 5.2% is well below VHR by hip axis.
//   - T-score -2.7 ≤ -2.5 → HIGH (correct classification).
// The "4.5%" figure does not correspond to any NOGG 2024 published threshold.
// The tool correctly classifies TC10 as HIGH. See __tests__/tc-spec.ts.

export interface NOGGThreshold {
  ageMin: number;
  ageMax: number;
  lowerMOF: number;  // % — LAT: below this = low risk
  itMOF:    number;  // % — IT: intervention threshold (used by NOGG 2024 Rec 6 for BMD-unavailable patients)
  upperMOF: number;  // % — UAT: at or above this = treat without DEXA
  lowerHip: number;  // % — hip LAT
  itHip:    number;  // % — hip IT
  upperHip: number;  // % — hip UAT
}

export const NOGG_2024_THRESHOLDS: NOGGThreshold[] = [
  { ageMin: 50, ageMax: 54, lowerMOF:  3.4, itMOF:  7.3, upperMOF:  8.8, lowerHip: 0.23, itHip: 0.91, upperHip: 1.1 },
  { ageMin: 55, ageMax: 59, lowerMOF:  4.5, itMOF:  9.5, upperMOF: 11.4, lowerHip: 0.43, itHip: 1.5,  upperHip: 1.7 },
  { ageMin: 60, ageMax: 64, lowerMOF:  6.0, itMOF: 12.2, upperMOF: 14.6, lowerHip: 0.80, itHip: 2.3,  upperHip: 2.8 },
  { ageMin: 65, ageMax: 69, lowerMOF:  8.6, itMOF: 16.5, upperMOF: 19.8, lowerHip: 1.4,  itHip: 3.5,  upperHip: 4.2 },
  { ageMin: 70, ageMax: 120, lowerMOF: 11.1, itMOF: 20.3, upperMOF: 24.4, lowerHip: 2.6, itHip: 5.4,  upperHip: 6.5 },
];

export function getAgeThreshold(age: number): NOGGThreshold | null {
  return NOGG_2024_THRESHOLDS.find(t => age >= t.ageMin && age <= t.ageMax) ?? null;
}

// ─── FRAX arithmetic adjustments (NOGG 2024, Table 2) ────────────────────
// Applied when the raw FRAX tool under- or over-estimates risk.
// Source: NOGG 2024 Section 2.2 / Table 2 (Conditional Recommendation).

export interface AdjustedFrax {
  adjustedMOF: number;
  adjustedHip: number;
  adjustments: FraxAdjustment[];
}

export function applyFraxAdjustments(
  patient: PatientInput,
  rawMOF: number,
  rawHip: number,
): AdjustedFrax {
  let mof = rawMOF;
  let hip = rawHip;
  const adjustments: FraxAdjustment[] = [];

  // Glucocorticoid dose-specific FRAX adjustment (NOGG 2024 Table 8, v1.13).
  // Three-tier correction applied AFTER FRAX is calculated with the GC box ticked.
  // - <2.5 mg/day:    hip ×0.65 (−35%), MOF ×0.80 (−20%)  — FRAX overestimates at very low dose
  // - 2.5 – 7.5 mg/day: no adjustment                       — FRAX accurate
  // - ≥7.5 mg/day:    hip ×1.20, MOF ×1.15                  — FRAX underestimates at high dose
  // Source: Kanis et al 2011 / NOGG 2024 Table 8.
  const gcDose = effectiveGCDoseMgDay(patient);
  if (gcDose !== null) {
    if (gcDose < 2.5) {
      mof = mof * 0.80;
      hip = hip * 0.65;
      adjustments.push({ factor: `Low-dose glucocorticoid (${gcDose} mg/day, <2.5)`, multiplier: 0.80, appliedTo: 'MOF' });
      adjustments.push({ factor: `Low-dose glucocorticoid (${gcDose} mg/day, <2.5)`, multiplier: 0.65, appliedTo: 'hip' });
    } else if (gcDose >= 7.5) {
      mof = mof * 1.15;
      hip = hip * 1.20;
      adjustments.push({ factor: `High-dose glucocorticoid (${gcDose} mg/day, ≥7.5)`, multiplier: 1.15, appliedTo: 'MOF' });
      adjustments.push({ factor: `High-dose glucocorticoid (${gcDose} mg/day, ≥7.5)`, multiplier: 1.20, appliedTo: 'hip' });
    }
    // Medium dose 2.5–7.5: no adjustment (FRAX is accurate at this dose)
  }

  // Type 2 diabetes — ×1.2 MOF uplift.
  // v1.39 Round 3 Change 4 — attribution updated: this ×1.2 output multiplier is an
  // engine-side operational approximation, NOT a direct NOGG Table 2 prescription.
  // NOGG 2024 Table 2 actually prescribes RA-proxy INPUT to FRAX (Leslie 2018) — this
  // output multiplier has no verifiable primary-source attribution. Multiplier stays in
  // place pending future RA-proxy alignment round (engine + UX work, tracked separately).
  if (patient.type2Diabetes) {
    mof = mof * 1.20;
    adjustments.push({ factor: 'Type 2 diabetes', multiplier: 1.20, appliedTo: 'MOF' });
  }

  // v1.39 Round 3 Change 1 — Type 1 diabetes.
  // Per NOGG 2024 body para y (Evidence level IV): "Although type 1 diabetes carries a
  // risk of fracture over and above that provided by FRAX, there are yet no empirical
  // data from which to recommend adjustment. In the meanwhile, the same adjustment can
  // be used as for type 2 diabetes." Engine applies ×1.2 MOF matching T2DM.
  // Single-application gate: T2DM block fires above first; T1DM block fires only when
  // T2DM is NOT already set. If both T1DM and T2DM are true (unusual — e.g. LADA
  // misclassified, or T1DM with steroid-induced secondary diabetes), the multiplier
  // fires ONCE via the T2DM block above. NOGG doesn't address compounding explicitly;
  // single-application is the conservative read.
  // Reads BOTH the new type1Diabetes boolean AND the legacy
  // secondaryOsteoporosis.includes('type1_diabetes') path for backwards compatibility
  // with existing UI/data — mirrors the pattern at treatment.ts:780.
  const hasT1DM =
    patient.type1Diabetes === true ||
    patient.secondaryOsteoporosis.includes('type1_diabetes');
  if (hasT1DM && !patient.type2Diabetes) {
    mof = mof * 1.20;
    adjustments.push({ factor: 'Type 1 diabetes', multiplier: 1.20, appliedTo: 'MOF' });
  }

  // Falls ≥2 in past year — NOGG Table 2: ×1.30 for BOTH MOF and hip.
  if (patient.fallsInLastYear >= 2) {
    mof = mof * 1.30;
    hip = hip * 1.30;
    adjustments.push({ factor: 'Falls ≥2/year', multiplier: 1.30, appliedTo: 'MOF' });
    adjustments.push({ factor: 'Falls ≥2/year', multiplier: 1.30, appliedTo: 'hip' });
  }

  // Parkinson's disease — ×1.30 MOF / ×1.50 hip.
  // v1.39 Round 3 Change 4 — attribution updated: these output multipliers are
  // engine-side operational approximations, NOT direct NOGG Table 2 prescriptions.
  // NOGG 2024 Table 2 actually prescribes RA-proxy INPUT to FRAX (Schini 2023) — these
  // output multipliers have no verifiable primary-source attribution. NOGG body para z
  // explicitly states RA-proxy "only partly accounts for" the residual Parkinson's-
  // associated fracture risk. The ×1.50 hip in particular has no NOGG citation.
  // Multipliers stay in place pending future RA-proxy alignment round.
  if (patient.parkinsonsDisease) {
    mof = mof * 1.30;
    hip = hip * 1.50;
    adjustments.push({ factor: "Parkinson's disease", multiplier: 1.30, appliedTo: 'MOF' });
    adjustments.push({ factor: "Parkinson's disease", multiplier: 1.50, appliedTo: 'hip' });
  }

  // Lumbar spine vs femoral neck T-score discordance — NOGG 2024 Rec 3 (Conditional) / Table 2.
  // +10% MOF per rounded T-score SD difference when LS is LOWER than FN. Auto-applied.
  // When LS is HIGHER than FN, the symmetrical downward adjustment is NOT auto-applied
  // because degenerative artefact (sclerotic lesions, vertebral compression, OA) can
  // inflate LS BMD; the downward case is surfaced as a clinical-judgement flag in
  // index.ts so the clinician decides whether the LS reading is reliable.
  const ls = patient.dexaResults?.lumbarSpineTScore ?? null;
  const fn = patient.dexaResults?.femoralNeckTScore ?? null;
  if (ls !== null && fn !== null) {
    const diff = Math.round(Math.abs(ls - fn));
    if (diff >= 1 && ls < fn) {
      const mult = 1 + 0.10 * diff;
      mof = mof * mult;
      adjustments.push({
        factor: `Lumbar spine T-score ${ls} discordant with femoral neck ${fn} (LS lower by ${diff} SD)`,
        multiplier: Math.round(mult * 100) / 100,
        appliedTo: 'MOF',
      });
    }
  }

  return {
    adjustedMOF: Math.min(Math.round(mof * 10) / 10, 100),
    adjustedHip: Math.min(Math.round(hip * 10) / 10, 100),
    adjustments,
  };
}

// ─── Very high risk criteria (NOGG 2024, Rec 11 / Section 3.2) ────────────
// ANY one criterion is sufficient.

export const VERY_HIGH_RISK = {
  fraxMOF: 32.5,        // % — FRAX MOF ≥ 32.5% (NOGG 2024 Table 5: VHRT at 70+ = IT 20.3 × 1.60)
  fraxHip: 8.6,         // % — FRAX hip ≥ 8.6% (NOGG 2024 Table 5: VHRT at 70+ = IT 5.4 × 1.60)
  tScore: -3.5,         // T-score ≤ -3.5 at femoral neck OR lumbar spine (CORRECTED from -3.0)
  recentVertebralFractureYears: 2,  // vertebral fracture within last 2 years
  minVertebralFracturesForVHR: 2,   // two or more vertebral fractures (any time)
} as const;

// ─── Renal function thresholds ────────────────────────────────────────────
// Sources: SmPCs; NOGG 2024; NICE NG187

// Spec table simplification: ALL bisphosphonates are contraindicated at eGFR <35,
// even though SmPCs license risedronate and ibandronate down to <30 (oral, more
// conservative renal clearance vs alendronate / zoledronate). The tool follows the
// clinical-spec simplification because the BMI/CKD-MBD risk profile of CKD 3b–5
// outweighs the marginal SmPC permission, and denosumab is the preferred agent in
// this band per NOGG 2024 Strong (bisphosphonate first-line as the most cost-effective antiresorptive; denosumab alternative).
//
// Stage 5 CKD: separate escalation logic in treatment.ts adds an urgent flag and
// bumps nephrology referral urgency at eGFR <15.

// CrCl (mL/min) — Cockcroft-Gault per computeCrCl helper. Engine values:
// - BP CI gate (alendronate/risedronate/zoledronate/ibandronate): CrCl <=35.
//   Engine-conservative-vs-source: SPC text reads "below 35" / "less than 35"
//   (strict <35); engine uses <=35 (one tick more conservative at the boundary).
//   Defer to backlog clinical-decision round whether to literal-align to <35.
// - Denosumab Ca-watch (denosumab_ckd_hypocalcaemia): CrCl <30.
//   SPC + FDA explicitly mandate Ca monitoring at CrCl <30. Engine prior <35
//   was historical drift; v1.46 realigns to SPC <30.
// - Stage 5 escalation (severe_ckd_specialist_only): CrCl <15. Unchanged.
export const RENAL_LIMITS = {
  alendronate:  { ci: 35 },   // CrCl <=35: contraindicated (predicate inclusive — see note above)
  risedronate:  { ci: 35 },   // CrCl <=35: contraindicated per spec table (SPC strict is <30)
  zoledronate:  { ci: 35 },   // CrCl <=35: contraindicated
  ibandronate:  { ci: 35 },   // CrCl <=35: contraindicated per spec table (SPC strict is <30)
  denosumab:    { ci: null, hypocalcaemiaWatch: 30, extremeRiskBelow: 15 }, // no formal CI; mandatory Ca check <30 per SPC + FDA; specialist-only <15
} as const;

// ─── Bisphosphonate treatment duration thresholds ─────────────────────────
// Source: NOGG 2024 Rec 17

export const BP_HOLIDAY = {
  oral:         { reviewAt: 5 },  // years of oral bisphosphonate before holiday review
  ivZoledronate: { reviewAt: 3 }, // years of IV zoledronate before holiday review
  holidayDurationMonthsMin: 18,   // NOGG 2024 Rec 17: 18–36 months (NOT "2–3 years")
  holidayDurationMonthsMax: 36,
} as const;

// v1.13 Step 8 — drug-specific reassessment intervals after a pause (NOGG 2024 Section 7 Rec 4, Strong).
// Reflects the different offset kinetics of each bisphosphonate.
export const PAUSE_REASSESSMENT_INTERVAL_MONTHS: Record<
  'alendronate' | 'risedronate' | 'ibandronate' | 'zoledronate',
  number
> = {
  risedronate: 18,
  ibandronate: 18,
  alendronate: 24,
  zoledronate: 36,
};

// v1.13 Step 13 — after-10-years (oral) / after-6-years (IV) individual basis recommendation.
export const BP_INDIVIDUAL_BASIS_AFTER_YEARS = {
  oral: 10,
  iv: 6,
} as const;

// ─── GIOP thresholds ──────────────────────────────────────────────────────
// Source: NOGG 2024 Recs 22–24; ACR 2022

export const GIOP = {
  // Standard high-dose threshold
  highDoseMgPerDay: 7.5,
  highDoseMinMonths: 3,
  // Lower-dose trigger for older/high-risk patients (ACR 2022 / NOGG 2024)
  lowerDoseMgPerDay: 5.0,
  lowerDoseMinMonths: 3,
  lowerDoseTriggerAge: 65,  // ≥5mg/day + age ≥65 OR prior fragility fracture
} as const;

// ─── Blood reference ranges ───────────────────────────────────────────────

export const BLOOD_RANGES = {
  vitaminD: {
    deficient:    25,  // nmol/L — <25: load before antiresorptive; do NOT start until replete
    insufficient: 50,  // nmol/L — 25–50: supplement alongside therapy
    target:       75,  // nmol/L — ≥75: adequate for bone protection
  },
  adjustedCalcium: {
    low:  2.10, // mmol/L
    high: 2.60, // mmol/L
  },
} as const;

// ─── Denosumab-specific thresholds ────────────────────────────────────────

export const DENOSUMAB = {
  injectionIntervalMonths: 6,
  reboundRiskThresholdMonths: 7, // >7 months since last dose = urgent rebound risk
} as const;
