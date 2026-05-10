// NOGG 2024 fracture risk stratification — traffic light system
// Source: Kanis JA et al. Age Ageing. 2024 (NOGG 2024 guidelines)

import type { PatientInput, RiskStratification, RiskCategory, TrafficLight, FraxAdjustment } from './types';
import {
  getAgeThreshold,
  applyFraxAdjustments,
  VERY_HIGH_RISK,
  GUIDELINE_VERSIONS,
  GIOP,
  isOnGC,
  isOnHighDoseGC,
  gcDurationMonths,
  aiAdditionalRiskFactorCount,
} from './thresholds';
import { estimateFrax } from '../fraxEstimate';

const SOURCE = GUIDELINE_VERSIONS.nogg;

// ─── Main entry point ─────────────────────────────────────────────────────

export function stratifyRisk(patient: PatientInput): RiskStratification {
  // No clinical risk factors at all → FRAX not indicated (NOGG 2024 Rec 1).
  // Skip FRAX calculation; surface a specific rationale; downstream paths produce no
  // pharmacological treatment, only lifestyle / Ca / Vit D advice.
  if (!hasAnyClinicalRiskFactor(patient)) {
    return result(
      'low', 'green', null, null, null, null, null, null, [],
      'No clinical risk factors identified. FRAX assessment is not indicated at this time per NOGG 2024 Rec 1. ' +
      'Reassess if risk factors develop. Advise on lifestyle measures and calcium/vitamin D intake.'
    );
  }

  // Use manually entered FRAX values where provided; estimate any missing axis for age ≥50.
  // Partial manual entry is respected — e.g. clinician provides hip only, MOF is estimated.
  // For patients born outside Ireland, the estimator is suppressed: it uses Irish baselines
  // (country code 49) which are not appropriate for non-Irish-born patients (NOGG Table 2).
  let rawMOF: number | null = patient.fraxMOFPercent;
  let rawHip: number | null = patient.fraxHipPercent;
  const needEstimate =
    !patient.bornOutsideIreland &&
    (rawMOF === null || rawHip === null) &&
    patient.age >= 50;

  if (needEstimate) {
    const est = estimateFrax(patient);
    if (rawMOF === null) rawMOF = est.mof;
    if (rawHip === null) rawHip = est.hip;
  }

  // Apply arithmetic adjustments (NOGG 2024 Table 2) whenever FRAX values are available
  const { adjustedMOF, adjustedHip, adjustments } =
    rawMOF !== null && rawHip !== null
      ? applyFraxAdjustments(patient, rawMOF, rawHip)
      : { adjustedMOF: null, adjustedHip: null, adjustments: [] as FraxAdjustment[] };

  const fullyEstimated = patient.fraxMOFPercent === null && patient.fraxHipPercent === null && patient.age >= 50;
  const estNote = fullyEstimated ? ' (FRAX estimated — verify with frax.shef.ac.uk, country 49)' : '';

  // Very high risk — overrides all other categories
  const vhrReason = veryHighRiskReason(patient, adjustedMOF, adjustedHip);
  if (vhrReason) {
    return result('very_high', 'dark_red', null, null, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments, vhrReason + estNote);
  }

  // FRAX not validated under 50; use clinical features only
  if (patient.age < 50) {
    return stratifyUnder50(patient, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments);
  }

  const threshold = getAgeThreshold(patient.age);
  if (!threshold) {
    return result('intermediate', 'amber', null, null, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      'Age outside NOGG threshold tables — clinical judgement required.' + estNote);
  }

  // T-score ≤ -2.5 alone → high risk → treat (NOGG 2024 Section 3.1 / WHO definition)
  if (patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -2.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `T-score ${lowest} ≤ -2.5 (WHO osteoporosis threshold) — high risk; treatment indicated regardless of FRAX.`);
    }
  }

  // Lower intervention thresholds: high-risk exposures that warrant treatment at T-scores above the WHO -2.5 cut-off.
  // These mirror NOGG 2024 Section 7 guidance on context-specific lower thresholds.

  // GIOP lower threshold: any current glucocorticoid use + T-score ≤ -1.5 → high risk.
  // Glucocorticoids increase fracture risk over and above their effect on BMD; NOGG applies
  // a lower BMD treatment threshold of T ≤ -1.5 in this context.
  if (isOnGC(patient) && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -1.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `Glucocorticoid therapy with T-score ${lowest}: lower intervention threshold (≤−1.5) applies. ` +
        'Glucocorticoids increase fracture risk independently of BMD — treatment indicated at this BMD level (NOGG 2024 Rec 22).');
    }
  }

  // Aromatase inhibitor: IOF 2017 international consensus (cited by NOGG 2024). v1.14.
  // Replaces the previous blanket T-score ≤ −1.5 rule.
  //   T-score < −2.0 (any site)            → high
  //   T-score < −1.5 + ≥1 additional RF    → high
  //   No T-score + ≥2 additional RFs       → high
  if (patient.aromataseInhibitorUse) {
    const lowest = patient.dexaResults ? lowestTScore(patient.dexaResults) : null;
    const rfCount = aiAdditionalRiskFactorCount(patient);
    const meets =
      (lowest !== null && lowest < -2.0) ||
      (lowest !== null && lowest < -1.5 && rfCount >= 1) ||
      (lowest === null && rfCount >= 2);
    if (meets) {
      const rationale = lowest !== null && lowest < -2.0
        ? `Aromatase inhibitor with T-score ${lowest} (< −2.0): IOF 2017 unconditional treatment threshold met (cited by NOGG 2024 Section 7.1).`
        : lowest !== null
        ? `Aromatase inhibitor with T-score ${lowest} (< −1.5) + ${rfCount} additional clinical risk factor${rfCount > 1 ? 's' : ''}: IOF 2017 threshold met (cited by NOGG 2024 Section 7.1).`
        : `Aromatase inhibitor with no DEXA available + ${rfCount} additional clinical risk factors: IOF 2017 threshold met without BMD (cited by NOGG 2024 Section 7.1).`;
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments, rationale);
    }
  }

  // Early menopause history (now age ≥50): T-score ≤ -1.5 warrants treatment (NOGG 2024; international consensus)
  // Patients are age ≥50 here (age <50 path handled above) — early menopause = lifetime cumulative bone deficit
  if (patient.sex === 'female' && patient.earlyMenopause && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -1.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `History of early menopause with T-score ${lowest}: lower intervention threshold (≤-1.5) applies. ` +
        'Early oestrogen deficiency causes cumulative bone loss beyond normal age-related risk (NOGG 2024; international consensus).');
    }
  }

  // Androgen deprivation therapy: T-score ≤ -2.0 warrants treatment (NOGG 2024 Section 7.2)
  if (patient.adtUse && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -2.0) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `ADT use with T-score ${lowest}: lower intervention threshold (≤-2.0) applies. ` +
        'ADT-induced hypogonadism causes rapid bone loss — treatment indicated at this BMD level (NOGG 2024 Section 7.2).');
    }
  }

  // Forearm-only severe osteoporosis with ≥1 FRAX clinical risk factor →
  // treatment indicated regardless of FRAX/standard-site BMD (ISCD 2023 / NOGG).
  // Only fires when standard sites (LS, total hip, FN) are NOT below −2.5 — otherwise
  // those paths handle classification. Primary hyperparathyroidism must be excluded
  // first (Ca, ALP, PTH); the forearm_only_osteoporosis flag in treatment.ts surfaces
  // that workup requirement.
  if (patient.dexaResults) {
    const fr = patient.dexaResults.forearmTScore;
    const ls = patient.dexaResults.lumbarSpineTScore;
    const th = patient.dexaResults.totalHipTScore;
    const fn = patient.dexaResults.femoralNeckTScore;
    const standardSitesOK =
      (ls === null || ls > -2.5) &&
      (th === null || th > -2.5) &&
      (fn === null || fn > -2.5);
    if (
      fr !== null &&
      fr <= -3.0 &&
      standardSitesOK &&
      countFraxClinicalRiskFactors(patient) >= 1
    ) {
      return result(
        'high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `Forearm T-score ${fr} ≤ −3.0 with ≥1 clinical risk factor and standard sites not below −2.5 — ` +
        'treatment indicated regardless of FRAX (ISCD 2023; NOGG 2024). Exclude primary hyperparathyroidism first ' +
        '(Ca, ALP, PTH — preferential cortical bone loss).'
      );
    }
  }

  // Previous fragility fracture (any site) → treat regardless of FRAX (NOGG 2024 Rec 8).
  // Hip and clinical vertebral fractures alone are sufficient for clinical diagnosis of osteoporosis
  // without DEXA. Other fragility fracture sites also drive treatment per NOGG 2024.
  if (patient.priorFragilityFracture || patient.priorHipFracture || patient.priorVertebralFracture) {
    const site = patient.priorHipFracture
      ? 'hip'
      : patient.priorVertebralFracture
      ? 'vertebral'
      : 'fragility';
    return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      `Prior ${site} fracture — treatment indicated regardless of FRAX (NOGG 2024 Rec 8). ` +
      'Hip and clinical vertebral fractures provide clinical diagnosis of osteoporosis without DEXA.');
  }

  // FRAX-based stratification (always available here: estimate or manual).
  // NOGG 2024 (Strong): when BMD is included in FRAX, classify by the HIGHER of the MOF
  // and hip-fracture risk categories. Without BMD, hip probability is unreliable for
  // classification (per SCOOP study and NOGG guidance) — use MOF only.
  if (adjustedMOF !== null) {
    const mof = adjustedMOF;

    const categorise = (val: number, low: number, up: number): 'high' | 'intermediate' | 'low' =>
      val >= up ? 'high' : val >= low ? 'intermediate' : 'low';

    const mofCat = categorise(mof, threshold.lowerMOF, threshold.upperMOF);

    // Hip axis only counted when BMD is included in the FRAX calculation
    let hipCat: 'high' | 'intermediate' | 'low' | null = null;
    if (patient.fraxCalculatedWithBMD && adjustedHip !== null) {
      hipCat = categorise(adjustedHip, threshold.lowerHip, threshold.upperHip);
    }

    const rank = (c: 'high' | 'intermediate' | 'low'): number =>
      c === 'high' ? 2 : c === 'intermediate' ? 1 : 0;

    const useHip = hipCat !== null && rank(hipCat) > rank(mofCat);
    const finalCat: 'high' | 'intermediate' | 'low' = useHip ? hipCat! : mofCat;

    const drivenBy = useHip
      ? `FRAX hip ${adjustedHip}% drives ${finalCat} classification (higher of MOF / hip per NOGG 2024 Strong recommendation; BMD included)`
      : hipCat !== null
      ? `FRAX MOF ${mof}% drives ${finalCat} classification (MOF and hip categories agree or MOF is higher; BMD included)`
      : `FRAX MOF ${mof}% drives ${finalCat} classification (BMD not included — hip axis not counted per NOGG 2024)`;

    if (finalCat === 'high') {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `${drivenBy}. Treatment indicated.` + estNote);
    }

    if (finalCat === 'intermediate') {
      // Intermediate FRAX but T-score ≤ -2.5 → reclassify to high
      if (patient.dexaResults && lowestTScore(patient.dexaResults) <= -2.5) {
        return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
          `${drivenBy}, but T-score ≤ -2.5 — reclassified to high risk per NOGG 2024 Rec 2.` + estNote);
      }
      return result('intermediate', 'amber', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `${drivenBy}. DEXA recommended to refine risk.` + estNote);
    }

    return result('low', 'green', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      `${drivenBy}. Treatment not indicated.` + estNote);
  }

  // Fallback (age <50 or no data): clinical risk factor estimate
  return result('intermediate', 'amber', null, null, rawMOF, rawHip, null, null, [],
    'FRAX not available and age <50 — stratification based on clinical features only.');
}

// ─── Very high risk override criteria (NOGG 2024, Rec 11 / Section 3.2) ──
// ANY single criterion is sufficient.

function veryHighRiskReason(
  patient: PatientInput,
  adjustedMOF: number | null,
  adjustedHip: number | null,
): string | null {
  const criteria: string[] = [];

  // Recent vertebral fracture within 2 years (highest imminent re-fracture risk)
  if (
    patient.priorVertebralFracture &&
    patient.recentVertebralFractureYears !== null &&
    patient.recentVertebralFractureYears <= VERY_HIGH_RISK.recentVertebralFractureYears
  ) {
    criteria.push(`vertebral fracture within the last ${patient.recentVertebralFractureYears} year(s)`);
  }

  // Recent hip fracture within 24 months — imminent re-fracture risk; NOGG VHR criterion
  if (patient.priorHipFracture && patient.recentFractureWithin2Years) {
    criteria.push('hip fracture within the last 24 months (imminent re-fracture risk)');
  }

  // Two or more vertebral fractures (any time)
  if (patient.priorVertebralFracture && patient.numberOfPriorFractures >= VERY_HIGH_RISK.minVertebralFracturesForVHR) {
    criteria.push('two or more vertebral fragility fractures');
  }

  // T-score ≤ -3.5 at femoral neck or lumbar spine (CORRECTED from -3.0 per spec Section 3.2)
  if (patient.dexaResults) {
    const scores = [
      patient.dexaResults.lumbarSpineTScore,
      patient.dexaResults.femoralNeckTScore,
    ].filter((t): t is number => t != null);
    const lowest = scores.length > 0 ? Math.min(...scores) : null;
    if (lowest !== null && lowest <= VERY_HIGH_RISK.tScore) {
      criteria.push(`T-score ${lowest} ≤ ${VERY_HIGH_RISK.tScore} at femoral neck or lumbar spine`);
    }
  }

  // High-dose glucocorticoids ≥7.5 mg/day for ≥3 months (NOGG 2024 Rec 11)
  if (isOnHighDoseGC(patient) && gcDurationMonths(patient) >= GIOP.highDoseMinMonths) {
    const dose = patient.glucocorticoidDoseMgDay ?? '?';
    const months = gcDurationMonths(patient);
    criteria.push(`high-dose glucocorticoid (${dose} mg/day, ${months} months)`);
  }

  // Multiple clinical risk factors with a recent fragility fracture (any site) —
  // NOGG 2024: high imminent re-fracture risk. ≥3 risk factors used as a sensible threshold.
  if (patient.recentFractureWithin2Years) {
    const rfCount = countFraxClinicalRiskFactors(patient);
    if (rfCount >= 3) {
      criteria.push(`recent fragility fracture (within 24 months) plus ${rfCount} clinical risk factors — high imminent re-fracture risk`);
    }
  }

  // FRAX MOF / hip VHR triggers
  // - MOF VHR fires only when FRAX MOF was manually entered (estimator too coarse for VHR designation).
  // - Hip VHR fires only when BMD was included in the FRAX calculation (NOGG 2024 / SCOOP — hip
  //   probability is unreliable without BMD).
  const fraxIsManual = patient.fraxMOFPercent !== null || patient.fraxHipPercent !== null;
  if (fraxIsManual) {
    if (adjustedMOF !== null && adjustedMOF >= VERY_HIGH_RISK.fraxMOF) {
      criteria.push(`adjusted FRAX MOF ${adjustedMOF}% ≥ ${VERY_HIGH_RISK.fraxMOF}%`);
    }
    if (
      adjustedHip !== null &&
      adjustedHip >= VERY_HIGH_RISK.fraxHip &&
      patient.fraxCalculatedWithBMD
    ) {
      criteria.push(`adjusted FRAX hip ${adjustedHip}% ≥ ${VERY_HIGH_RISK.fraxHip}% (BMD-included)`);
    }
  }

  // Fracture on adequate therapy — treatment failure
  if (
    patient.currentTreatment?.currentlyOn &&
    patient.currentTreatment.durationMonths >= 12 &&
    patient.priorFragilityFracture &&
    patient.numberOfPriorFractures >= 2
  ) {
    criteria.push('possible treatment failure: fracture(s) during adequate antiresorptive therapy');
  }

  if (criteria.length === 0) return null;

  return `Very high risk (NOGG 2024 Rec 11): ${criteria.join('; ')}.`;
}

// ─── Under-50 stratification ──────────────────────────────────────────────

function stratifyUnder50(
  patient: PatientInput,
  rawMOF: number | null,
  rawHip: number | null,
  adjustedMOF: number | null,
  adjustedHip: number | null,
  adjustments: FraxAdjustment[],
): RiskStratification {
  const hasHighRiskFeature =
    patient.priorFragilityFracture ||
    patient.earlyMenopause ||
    isOnGC(patient) ||
    (patient.dexaResults !== null && lowestTScore(patient.dexaResults) <= -2.5);

  const hasIntermediateFeature =
    patient.secondaryOsteoporosis.length > 0 ||
    (patient.dexaResults !== null && lowestTScore(patient.dexaResults) <= -1.5);

  if (hasHighRiskFeature) {
    return result('high', 'red', null, null, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      'Age <50: FRAX not validated. High-risk feature present (fragility fracture / osteoporosis / early menopause / glucocorticoid use). Treatment indicated and specialist referral recommended.');
  }

  if (hasIntermediateFeature) {
    return result('intermediate', 'amber', null, null, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      'Age <50: FRAX not validated. Secondary cause or low BMD identified — specialist assessment recommended.');
  }

  return result('low', 'green', null, null, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
    'Age <50: FRAX not validated. No major risk features. Lifestyle advice; DEXA if clinical concern.');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Count of FRAX-relevant clinical risk factors. Used by the NOGG VHR criterion
// "multiple clinical risk factors with recent fragility fracture".
function countFraxClinicalRiskFactors(p: PatientInput): number {
  let n = 0;
  if (p.parentalHipFracture) n++;
  if (p.currentSmoker) n++;
  if (p.alcoholUnitsPerWeek >= 21) n++;
  if (p.bmi !== null && p.bmi < 19) n++;
  if (p.rheumatoidArthritis) n++;
  if (p.secondaryOsteoporosis.length > 0) n++;
  if (p.type2Diabetes) n++;
  if (p.fallsInLastYear >= 2) n++;
  if (p.parkinsonsDisease) n++;
  if (isOnGC(p)) n++;
  if (p.adtUse) n++;
  if (p.aromataseInhibitorUse) n++;
  if (p.earlyMenopause) n++;
  return n;
}

// True if the patient has any FRAX-relevant clinical risk factor across all inputs.
// Used to gate FRAX calculation per NOGG 2024 Rec 1.
function hasAnyClinicalRiskFactor(p: PatientInput): boolean {
  if (
    p.priorFragilityFracture ||
    p.priorHipFracture ||
    p.priorVertebralFracture ||
    p.recentFractureWithin2Years
  ) return true;
  if (p.parentalHipFracture || p.currentSmoker || p.vaping) return true;
  if (p.alcoholUnitsPerWeek >= 21) return true;            // FRAX threshold
  if (p.bmi !== null && p.bmi < 19) return true;            // low BMI
  if (p.rheumatoidArthritis) return true;
  if (p.secondaryOsteoporosis.length > 0) return true;
  if (isOnGC(p)) return true;
  if (p.adtUse || p.aromataseInhibitorUse) return true;
  if (p.earlyMenopause) return true;
  if (p.type2Diabetes) return true;
  if (p.fallsInLastYear >= 2) return true;
  if (p.parkinsonsDisease || p.lowerLimbAmputation || p.learningDisabilities) return true;
  if (p.heightLossCm !== null && p.heightLossCm >= 4) return true;
  if (p.heightLossProspectiveCm !== null && p.heightLossProspectiveCm >= 2) return true;
  if (p.kyphosis || p.acuteBackPain) return true;
  if (p.dexaResults !== null && lowestTScore(p.dexaResults) <= -2.5) return true;
  if (p.thighOrGroinPain || p.completedAnabolicCourse) return true;
  if (p.currentTreatment || p.previousTreatments.length > 0) return true;
  return false;
}

function lowestTScore(dexa: NonNullable<PatientInput['dexaResults']>): number {
  const scores = [dexa.lumbarSpineTScore, dexa.totalHipTScore, dexa.femoralNeckTScore]
    .filter((t): t is number => t != null);
  return scores.length > 0 ? Math.min(...scores) : 0;
}

function result(
  category: RiskCategory,
  trafficLight: TrafficLight,
  lowerThreshold: number | null,
  upperThreshold: number | null,
  rawMOF: number | null,
  rawHip: number | null,
  adjustedMOF: number | null,
  adjustedHip: number | null,
  adjustments: FraxAdjustment[],
  rationale: string,
): RiskStratification {
  return {
    category,
    trafficLight,
    fraxMOFPercent: rawMOF,
    fraxHipPercent: rawHip,
    adjustedFraxMOFPercent: adjustedMOF,
    adjustedFraxHipPercent: adjustedHip,
    fraxAdjustments: adjustments,
    lowerThreshold,
    upperThreshold,
    rationale,
    source: SOURCE,
  };
}
