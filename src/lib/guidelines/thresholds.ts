// Versioned threshold data — all values sourced from published guidelines
// Update version strings when guidelines are revised

import type { GuidelineSource, FraxAdjustment, PatientInput } from './types';

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
  upperMOF: number;  // % — UAT: at or above this = treat without DEXA
  lowerHip: number;  // % — hip LAT
  upperHip: number;  // % — hip UAT
}

export const NOGG_2024_THRESHOLDS: NOGGThreshold[] = [
  { ageMin: 50, ageMax: 54, lowerMOF:  3.4, upperMOF:  8.8, lowerHip: 0.23, upperHip: 1.1 },
  { ageMin: 55, ageMax: 59, lowerMOF:  4.5, upperMOF: 11.4, lowerHip: 0.43, upperHip: 1.7 },
  { ageMin: 60, ageMax: 64, lowerMOF:  6.0, upperMOF: 14.6, lowerHip: 0.80, upperHip: 2.8 },
  { ageMin: 65, ageMax: 69, lowerMOF:  8.6, upperMOF: 19.8, lowerHip: 1.4,  upperHip: 4.2 },
  { ageMin: 70, ageMax: 120, lowerMOF: 11.1, upperMOF: 24.4, lowerHip: 5.4, upperHip: 6.5 },
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

  // High-dose glucocorticoids (≥7.5 mg/day prednisolone equivalent for ≥3 months)
  // FRAX with GC box ticked uses a conservative average; adjust for high dose.
  if (
    patient.glucocorticoidUse?.current &&
    (patient.glucocorticoidUse.dose === 'medium' || patient.glucocorticoidUse.dose === 'high') &&
    patient.glucocorticoidUse.durationMonths >= 3
  ) {
    mof = mof * 1.15;
    hip = hip * 1.20;
    adjustments.push({ factor: 'High-dose glucocorticoid (≥7.5 mg/day)', multiplier: 1.15, appliedTo: 'MOF' });
    adjustments.push({ factor: 'High-dose glucocorticoid (≥7.5 mg/day)', multiplier: 1.20, appliedTo: 'hip' });
  }

  // Type 2 diabetes — FRAX underestimates fracture risk
  if (patient.type2Diabetes) {
    mof = mof * 1.20;
    adjustments.push({ factor: 'Type 2 diabetes', multiplier: 1.20, appliedTo: 'MOF' });
  }

  // Falls ≥2 in past year
  if (patient.fallsInLastYear >= 2) {
    hip = hip * 1.30;
    adjustments.push({ factor: 'Falls ≥2/year', multiplier: 1.30, appliedTo: 'hip' });
  }

  // Parkinson's disease
  if (patient.parkinsonsDisease) {
    hip = hip * 1.50;
    adjustments.push({ factor: "Parkinson's disease", multiplier: 1.50, appliedTo: 'hip' });
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

export const RENAL_LIMITS = {
  alendronate:  { ci: 35 },   // eGFR <35: contraindicated
  risedronate:  { ci: 30 },   // eGFR <30: contraindicated
  zoledronate:  { ci: 35 },   // eGFR <35: avoid
  ibandronate:  { ci: 30 },   // eGFR <30: contraindicated
  denosumab:    { ci: null, hypocalcaemiaWatch: 35 }, // no formal CI; mandatory Ca check if eGFR <35 (NOGG 2024)
} as const;

// ─── Bisphosphonate treatment duration thresholds ─────────────────────────
// Source: NOGG 2024 Rec 17

export const BP_HOLIDAY = {
  oral:         { reviewAt: 5 },  // years of oral bisphosphonate before holiday review
  ivZoledronate: { reviewAt: 3 }, // years of IV zoledronate before holiday review
  holidayDurationMonthsMin: 18,   // NOGG 2024 Rec 17: 18–36 months (NOT "2–3 years")
  holidayDurationMonthsMax: 36,
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
