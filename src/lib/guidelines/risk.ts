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
  // Use manually entered FRAX or compute an estimate for age ≥50
  const hasManualFrax = patient.fraxMOFPercent !== null && patient.fraxHipPercent !== null;
  const useEstimate = !hasManualFrax && patient.age >= 50;

  let rawMOF: number | null = patient.fraxMOFPercent;
  let rawHip: number | null = patient.fraxHipPercent;

  if (useEstimate) {
    const est = estimateFrax(patient);
    rawMOF = est.mof;
    rawHip = est.hip;
  }

  // Apply arithmetic adjustments (NOGG 2024 Table 2) whenever FRAX values are available
  const { adjustedMOF, adjustedHip, adjustments } =
    rawMOF !== null && rawHip !== null
      ? applyFraxAdjustments(patient, rawMOF, rawHip)
      : { adjustedMOF: null, adjustedHip: null, adjustments: [] as FraxAdjustment[] };

  const estNote = useEstimate ? ' (FRAX estimated — verify with frax.shef.ac.uk, country 49)' : '';

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

  // Previous hip or vertebral fracture → treat regardless of FRAX (NOGG 2024 Rec 8)
  if (patient.priorHipFracture || patient.priorVertebralFracture) {
    return result('high', 'red', threshold.lowerMOF, threshold.upperMOF, rawMOF, rawHip, adjustedMOF, adjustedHip, adjustments,
      `Prior ${patient.priorHipFracture ? 'hip' : 'vertebral'} fragility fracture — clinical diagnosis of osteoporosis; ` +
      'treatment indicated per NOGG 2024 Rec 8 regardless of FRAX or T-score.');
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

  // FRAX MOF ≥ 32.5% (NOGG 2024 Table 5: VHRT at 70+ = IT 20.3% × 1.60)
  if (adjustedMOF !== null && adjustedMOF >= VERY_HIGH_RISK.fraxMOF) {
    criteria.push(`adjusted FRAX MOF ${adjustedMOF}% ≥ ${VERY_HIGH_RISK.fraxMOF}%`);
  }

  // FRAX hip ≥ 8.6% (NOGG 2024 Table 5: VHRT at 70+ = IT 5.4% × 1.60)
  if (adjustedHip !== null && adjustedHip >= VERY_HIGH_RISK.fraxHip) {
    criteria.push(`adjusted FRAX hip ${adjustedHip}% ≥ ${VERY_HIGH_RISK.fraxHip}%`);
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
