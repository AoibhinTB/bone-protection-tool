// Determines what investigations are indicated before or alongside treatment
// Source: NOGG 2024 Recs 2–7, IOS 2024, NICE NG187

import type { PatientInput, InvestigationRecommendation } from './types';
import { BLOOD_RANGES, GIOP } from './thresholds';

export function assessInvestigationsNeeded(
  patient: PatientInput,
): InvestigationRecommendation[] {
  const needed: InvestigationRecommendation[] = [];

  // FRAX — external calculation required if not provided
  if (patient.fraxMOFPercent === null && patient.age >= 50) {
    needed.push({
      investigation: 'frax',
      reason:
        'FRAX 10-year fracture probability not provided. ' +
        'Calculate at frax.shef.ac.uk using country code 49 (Ireland). ' +
        'Enter clinical risk factors; add BMD T-score if DEXA is available. ' +
        'Apply NOGG 2024 arithmetic adjustments if high-dose GC, T2DM, falls ≥2/yr, or Parkinson\'s present.',
      urgency: 'routine',
    });
  }

  // DEXA indications
  if (!patient.dexaResults) {
    const dexaItems = dexaIndications(patient);
    needed.push(...dexaItems);
  }

  // VFA (Vertebral Fracture Assessment) — NOGG 2024 Rec 4 (Strong)
  const vfaReason = vfaIndicationReason(patient);
  if (vfaReason) {
    needed.push({
      investigation: 'vfa',
      reason: vfaReason,
      urgency: 'routine',
    });
  }

  // ── Bloods ──────────────────────────────────────────────────────────────

  // Adjusted calcium
  if (!patient.bloodResults?.adjustedCalciumMmol) {
    needed.push({
      investigation: 'calcium',
      reason:
        'Adjusted serum calcium required: hypocalcaemia must be corrected before bisphosphonate or denosumab initiation; ' +
        'hypercalcaemia may indicate primary hyperparathyroidism (refer endocrinology).',
      urgency: 'routine',
    });
  }

  // Vitamin D
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  if (vitD === null || vitD < BLOOD_RANGES.vitaminD.target) {
    needed.push({
      investigation: 'vitamin_d',
      reason:
        vitD === null
          ? `Serum 25-OHD not checked. Required before initiating antiresorptive therapy (target ≥${BLOOD_RANGES.vitaminD.target} nmol/L). ` +
            `If severely deficient (<${BLOOD_RANGES.vitaminD.deficient} nmol/L): load first — do NOT start bisphosphonate or denosumab until replete.`
          : vitD < BLOOD_RANGES.vitaminD.deficient
          ? `Severe vitamin D deficiency (${vitD} nmol/L). Load first (e.g. 50,000 IU weekly × 8–12 weeks). ` +
            `Do NOT start bisphosphonate or denosumab until replete (target ≥${BLOOD_RANGES.vitaminD.target} nmol/L).`
          : `Vitamin D insufficient (${vitD} nmol/L, target ≥${BLOOD_RANGES.vitaminD.target} nmol/L). ` +
            'Supplement alongside bone protection therapy.',
      urgency: vitD !== null && vitD < BLOOD_RANGES.vitaminD.deficient ? 'soon' : 'routine',
    });
  }

  // eGFR
  const hasEGFR = patient.renalFunction !== null || (patient.bloodResults?.egfr ?? null) !== null;
  if (!hasEGFR) {
    needed.push({
      investigation: 'egfr',
      reason:
        'Renal function (eGFR) required to select safe bone protection agent. ' +
        'Alendronate and zoledronate are contraindicated if eGFR <35 ml/min; risedronate if eGFR <30.',
      urgency: 'routine',
    });
  }

  // ALP — bone turnover, Paget's, osteomalacia screen (NOGG 2024 Rec 7)
  if (!patient.bloodResults?.alp) {
    needed.push({
      investigation: 'alp',
      reason:
        'Alkaline phosphatase (ALP): bone turnover marker; elevated ALP with low calcium/vitamin D suggests osteomalacia; ' +
        'markedly elevated ALP may indicate Paget\'s disease — investigate before starting treatment.',
      urgency: 'routine',
    });
  }

  // FBC — exclude haematological malignancy (myeloma)
  if (!patient.bloodResults?.fbc) {
    needed.push({
      investigation: 'fbc',
      reason:
        'Full blood count: exclude haematological malignancy (myeloma) — particularly in unexplained anaemia, ' +
        'very high fracture risk, or markedly elevated ESR. Consider SPEP if FBC abnormal.',
      urgency: 'routine',
    });
  }

  // Secondary osteoporosis workup
  if (secondaryWorkupIndicated(patient)) {
    if (patient.sex === 'male') {
      needed.push({
        investigation: 'testosterone',
        reason:
          'Hypogonadism is the most common secondary cause of osteoporosis in men. ' +
          'Morning serum testosterone required.',
        urgency: 'routine',
      });
    }

    if (patient.sex === 'female' && patient.earlyMenopause) {
      needed.push({
        investigation: 'lh_fsh',
        reason:
          'LH and FSH to confirm premature ovarian insufficiency (POI): elevated FSH with low oestrogen ' +
          'confirms diagnosis; HRT is first-line bone protection in this group.',
        urgency: 'routine',
      });
    }

    needed.push({
      investigation: 'thyroid',
      reason:
        'Thyroid function (TSH): untreated hyperthyroidism and T4 over-replacement both cause bone loss. ' +
        'TSH outside normal range requires review.',
      urgency: 'routine',
    });

    needed.push({
      investigation: 'pth',
      reason:
        'PTH and calcium: exclude primary hyperparathyroidism as secondary cause. ' +
        'Elevated PTH with normal or high calcium → refer endocrinology.',
      urgency: 'routine',
    });
  }

  return needed;
}

// ─── DEXA indications ─────────────────────────────────────────────────────

function dexaIndications(patient: PatientInput): InvestigationRecommendation[] {
  const items: InvestigationRecommendation[] = [];

  // Routine case-finding by age/sex (IOS 2024; NOGG 2024)
  if (patient.sex === 'female' && patient.age >= 65) {
    items.push({
      investigation: 'dexa',
      reason: 'DEXA indicated: routine case-finding strategy for women aged ≥65 years (IOS 2024; NOGG 2024).',
      urgency: 'routine',
    });
    return items; // one reason is enough
  }
  if (patient.sex === 'male' && patient.age >= 70) {
    items.push({
      investigation: 'dexa',
      reason: 'DEXA indicated: routine case-finding strategy for men aged ≥70 years (NOGG 2024).',
      urgency: 'routine',
    });
    return items;
  }

  // Clinical indications (any age ≥50)
  const specificReason = specificDexaReason(patient);
  if (specificReason) {
    const urgentDEXA =
      patient.priorHipFracture ||
      patient.priorVertebralFracture ||
      (patient.glucocorticoidUse?.current === true);
    items.push({
      investigation: 'dexa',
      reason: specificReason,
      urgency: urgentDEXA ? 'soon' : 'routine',
    });
    return items;
  }

  // Age ≥50 with ≥2 clinical risk factors and no prior DEXA (clinical pragmatism, IOS/NOGG)
  if (patient.age >= 50) {
    const rfCount = countClinicalRiskFactors(patient);
    if (rfCount >= 2) {
      items.push({
        investigation: 'dexa',
        reason: `DEXA indicated: age ≥50 with ${rfCount} clinical risk factors and no prior BMD measurement (IOS 2024; NOGG 2024).`,
        urgency: 'routine',
      });
    }
  }

  return items;
}

function specificDexaReason(patient: PatientInput): string | null {
  if (
    patient.glucocorticoidUse?.current &&
    patient.glucocorticoidUse.durationMonths >= GIOP.highDoseMinMonths
  ) {
    return 'DEXA indicated: glucocorticoid use ≥3 months — baseline BMD required for GIOP risk stratification. ' +
      'Note: treatment should NOT be delayed while awaiting DEXA if starting prednisolone ≥7.5mg/day (NOGG 2024 Rec 22).';
  }
  if (patient.earlyMenopause) {
    return 'DEXA indicated: premature ovarian insufficiency / early menopause (<45 years) — increased lifetime fracture risk.';
  }
  if (patient.adtUse) {
    return 'DEXA indicated: androgen deprivation therapy causes significant bone loss — baseline BMD required before or at ADT initiation. Monitor annually.';
  }
  if (patient.aromataseInhibitorUse) {
    return 'DEXA indicated: aromatase inhibitor therapy causes accelerated bone loss — baseline BMD before or at initiation. Monitor every 1–2 years.';
  }
  if (patient.priorFragilityFracture) {
    return 'DEXA indicated: prior fragility fracture — BMD provides baseline for monitoring response and informs treatment intensity.';
  }
  if (patient.secondaryOsteoporosis.length > 0) {
    return 'DEXA indicated: secondary cause of osteoporosis identified — BMD required for risk quantification.';
  }
  return null;
}

// ─── VFA indications ──────────────────────────────────────────────────────
// NOGG 2024 Rec 4 (Strong)

function vfaIndicationReason(patient: PatientInput): string | null {
  const reasons: string[] = [];

  if (patient.heightLossCm !== null && patient.heightLossCm >= 4) {
    reasons.push(`height loss ≥4 cm (${patient.heightLossCm} cm reported)`);
  }
  if (patient.kyphosis) {
    reasons.push('kyphosis');
  }
  if (patient.glucocorticoidUse?.current) {
    reasons.push('current glucocorticoid use');
  }
  if (patient.dexaResults) {
    const lowest = lowestTScore(patient.dexaResults);
    if (lowest <= -2.5) reasons.push(`T-score ${lowest} ≤ -2.5`);
  }
  if (patient.acuteBackPain && patient.priorFragilityFracture) {
    reasons.push('acute back pain with osteoporosis risk');
  }

  if (reasons.length === 0) return null;

  return (
    `VFA (vertebral fracture assessment) indicated: ${reasons.join('; ')}. ` +
    'VFA identifies prevalent vertebral fractures that alter risk category and treatment decisions ' +
    '(NOGG 2024 Rec 4 — Strong Recommendation).'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function secondaryWorkupIndicated(patient: PatientInput): boolean {
  return (
    patient.sex === 'male' ||
    patient.earlyMenopause ||
    patient.secondaryOsteoporosis.length > 0 ||
    patient.priorFragilityFracture ||
    (patient.dexaResults !== null && lowestTScore(patient.dexaResults) <= -2.0)
  );
}

function lowestTScore(dexa: NonNullable<PatientInput['dexaResults']>): number {
  const scores = [dexa.lumbarSpineTScore, dexa.totalHipTScore, dexa.femoralNeckTScore]
    .filter((t): t is number => t != null);
  return scores.length > 0 ? Math.min(...scores) : 0;
}

function countClinicalRiskFactors(patient: PatientInput): number {
  return [
    patient.priorFragilityFracture,
    patient.parentalHipFracture,
    patient.glucocorticoidUse?.current,
    patient.rheumatoidArthritis,
    patient.currentSmoker,
    patient.alcoholUnitsPerWeek >= 21,
    patient.secondaryOsteoporosis.length > 0,
    patient.type2Diabetes,
    patient.fallsInLastYear >= 2,
    patient.parkinsonsDisease,
    patient.adtUse,
    patient.aromataseInhibitorUse,
  ].filter(Boolean).length;
}
