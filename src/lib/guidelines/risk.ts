// NOGG 2024 fracture risk stratification — traffic light system
// Source: Kanis JA et al. Age Ageing. 2024 (NOGG 2024 guidelines)

import type { PatientInput, RiskStratification, RiskCategory, TrafficLight, FraxAdjustment } from './types';
import {
  getAgeThreshold,
  applyFraxAdjustments,
  VERY_HIGH_RISK,
  GUIDELINE_VERSIONS,
  GIOP,
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
  let rawMOF: number | null = patient.fraxMOFPercent;
  let rawHip: number | null = patient.fraxHipPercent;
  const needEstimate = (rawMOF === null || rawHip === null) && patient.age >= 50;

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
  if (patient.glucocorticoidUse?.current && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -1.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `Glucocorticoid therapy with T-score ${lowest}: lower intervention threshold (≤−1.5) applies. ` +
        'Glucocorticoids increase fracture risk independently of BMD — treatment indicated at this BMD level (NOGG 2024 Rec 22).');
    }
  }

  // Aromatase inhibitor: T-score ≤ -1.5 warrants treatment (CTIBL guidelines / NOGG 2024 Section 7.1)
  if (patient.aromataseInhibitorUse && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -1.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `Aromatase inhibitor use with T-score ${lowest}: lower intervention threshold (≤-1.5) applies. ` +
        'Accelerated cancer treatment–induced bone loss (CTIBL) warrants antiresorptive treatment (NOGG 2024 Section 7.1).');
    }
  }

  // Early menopause history (now age ≥50): T-score ≤ -1.5 warrants treatment (IOS 2024 / NOGG 2024)
  // Patients are age ≥50 here (age <50 path handled above) — early menopause = lifetime cumulative bone deficit
  if (patient.sex === 'female' && patient.earlyMenopause && patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -1.5) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `History of early menopause with T-score ${lowest}: lower intervention threshold (≤-1.5) applies. ` +
        'Early oestrogen deficiency causes cumulative bone loss beyond normal age-related risk (IOS 2024 / NOGG 2024).');
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

  // FRAX-based stratification (always available here: estimate or manual)
  if (adjustedMOF !== null) {
    const mof = adjustedMOF;

    if (mof >= threshold.upperMOF) {
      return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `FRAX MOF ${mof}% exceeds upper threshold (${threshold.upperMOF}%) for age ${patient.age} — treatment indicated.` + estNote);
    }

    if (mof >= threshold.lowerMOF) {
      // Intermediate FRAX but T-score ≤ -2.5 → reclassify to high
      if (patient.dexaResults && lowestTScore(patient.dexaResults) <= -2.5) {
        return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
          `FRAX MOF ${mof}% in intermediate zone, but T-score ≤ -2.5 — reclassified to high risk per NOGG 2024 Rec 2.` + estNote);
      }
      return result('intermediate', 'amber', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
        `FRAX MOF ${mof}% between thresholds (${threshold.lowerMOF}–${threshold.upperMOF}%) for age ${patient.age}. ` +
        'DEXA recommended to refine risk.' + estNote);
    }

    return result('low', 'green', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      `FRAX MOF ${mof}% below lower threshold (${threshold.lowerMOF}%) for age ${patient.age} — treatment not indicated.` + estNote);
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
  if (
    patient.glucocorticoidUse?.current &&
    (patient.glucocorticoidUse.dose === 'medium' || patient.glucocorticoidUse.dose === 'high') &&
    patient.glucocorticoidUse.durationMonths >= GIOP.highDoseMinMonths
  ) {
    criteria.push(`high-dose glucocorticoid (${patient.glucocorticoidUse.dose} dose, ${patient.glucocorticoidUse.durationMonths} months)`);
  }

  // FRAX MOF / hip VHR triggers — only when FRAX is manually entered (not estimated).
  // The estimator is too coarse for VHR designation; require an official FRAX value to
  // avoid over-classification.
  const fraxIsManual = patient.fraxMOFPercent !== null || patient.fraxHipPercent !== null;
  if (fraxIsManual) {
    if (adjustedMOF !== null && adjustedMOF >= VERY_HIGH_RISK.fraxMOF) {
      criteria.push(`adjusted FRAX MOF ${adjustedMOF}% ≥ ${VERY_HIGH_RISK.fraxMOF}%`);
    }
    if (adjustedHip !== null && adjustedHip >= VERY_HIGH_RISK.fraxHip) {
      criteria.push(`adjusted FRAX hip ${adjustedHip}% ≥ ${VERY_HIGH_RISK.fraxHip}%`);
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
    (patient.glucocorticoidUse?.current === true) ||
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
  if (p.glucocorticoidUse?.current === true) return true;
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
