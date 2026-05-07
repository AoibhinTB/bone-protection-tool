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

  // ── Tier 1: Mandatory pre-treatment bloods ────────────────────────────────

  if (!patient.bloodResults?.adjustedCalciumMmol) {
    needed.push({
      investigation: 'calcium',
      tier: 1,
      reason:
        'Adjusted serum calcium: hypocalcaemia must be corrected before ' +
        'bisphosphonate or denosumab; hypercalcaemia may indicate primary hyperparathyroidism (refer endocrinology).',
      urgency: 'routine',
    });
  }

  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  if (vitD === null || vitD < BLOOD_RANGES.vitaminD.target) {
    const urgentVitD = vitD !== null && vitD < BLOOD_RANGES.vitaminD.deficient; // <25 nmol/L
    needed.push({
      investigation: 'vitamin_d',
      tier: 1,
      reason:
        vitD === null
          ? `Serum 25-OHD not yet measured. Check BEFORE starting antiresorptive therapy. ` +
            `Target ≥${BLOOD_RANGES.vitaminD.target} nmol/L. ` +
            'Supplement with 800–1000 IU/day pending result. ' +
            'Do NOT start bisphosphonate or denosumab until level is known and adequate. ' +
            'Do NOT administer denosumab until Vit D ≥50 nmol/L.'
          : vitD < BLOOD_RANGES.vitaminD.deficient  // <25 nmol/L
          ? `Severe vitamin D deficiency (${vitD} nmol/L). ` +
            'Loading protocol required: 50,000 IU cholecalciferol weekly × 6 weeks (300,000 IU total, Irish standard). ' +
            `Recheck 25-OHD after loading; do NOT start antiresorptive until level ≥${BLOOD_RANGES.vitaminD.target} nmol/L. ` +
            'Do NOT administer denosumab until Vit D ≥50 nmol/L.'
          : vitD < BLOOD_RANGES.vitaminD.insufficient  // 25–49 nmol/L
          ? `Insufficient (${vitD} nmol/L). ` +
            'Start 800–1000 IU/day cholecalciferol immediately. ' +
            'Oral bisphosphonate can start alongside supplementation. ' +
            `Do NOT administer denosumab until Vit D ≥50 nmol/L. Recheck at 3 months; target ≥${BLOOD_RANGES.vitaminD.target} nmol/L.`
          : `Adequate but below target (${vitD} nmol/L — target ≥${BLOOD_RANGES.vitaminD.target} nmol/L). ` +
            '800–1000 IU/day maintenance alongside bone protection therapy. Recheck in 6–12 months.',
      urgency: urgentVitD ? 'soon' : 'routine',
    });
  }

  const hasEGFR = patient.renalFunction !== null || (patient.bloodResults?.egfr ?? null) !== null;
  if (!hasEGFR) {
    needed.push({
      investigation: 'egfr',
      tier: 1,
      reason:
        'eGFR required to select safe agent: ' +
        'alendronate/zoledronate CI if eGFR <35; risedronate CI if eGFR <30. ' +
        'eGFR <35 with denosumab: mandatory corrected calcium check 2 weeks after every injection.',
      urgency: 'routine',
    });
  }

  // ── Tier 2: Routine baseline ──────────────────────────────────────────────

  if (!patient.bloodResults?.alp) {
    needed.push({
      investigation: 'alp',
      tier: 2,
      reason:
        'ALP: bone turnover marker; elevated ALP + low calcium/vit D suggests osteomalacia; ' +
        'markedly elevated ALP may indicate Paget\'s — investigate before starting treatment. ' +
        'Unexplained raised ALP is a contraindication to teriparatide.',
      urgency: 'routine',
    });
  }

  if (!patient.bloodResults?.fbc) {
    needed.push({
      investigation: 'fbc',
      tier: 2,
      reason:
        'FBC: exclude haematological malignancy (myeloma) — especially with anaemia, ' +
        'vertebral fracture without clear cause, or elevated ESR. If abnormal, add SPEP/UPEP.',
      urgency: 'routine',
    });
  }

  // ── Tier 3: Suspected secondary cause ────────────────────────────────────

  const alpAbnormal = patient.bloodResults?.alp !== null && patient.bloodResults?.alp !== undefined &&
    (patient.bloodResults.alp > 130 || patient.bloodResults.alp < 30);
  const calciumAbnormal = patient.bloodResults?.adjustedCalciumMmol !== null &&
    patient.bloodResults?.adjustedCalciumMmol !== undefined &&
    (patient.bloodResults.adjustedCalciumMmol > 2.6 || patient.bloodResults.adjustedCalciumMmol < 2.1);

  // Tier 3 investigations — each fires only on its own specific clinical criteria,
  // not as a blanket suggestion for every secondary-workup-eligible patient.

  // Testosterone — only when hypogonadism is suspected or already listed.
  if (
    patient.sex === 'male' &&
    (patient.secondaryOsteoporosis.includes('hypogonadism') ||
      // Severe unexplained osteoporosis in a man — testosterone is the main reversible cause to exclude
      (patient.dexaResults !== null &&
        lowestTScore(patient.dexaResults) <= -3.0 &&
        patient.secondaryOsteoporosis.length === 0 &&
        !patient.glucocorticoidUse?.current))
  ) {
    needed.push({
      investigation: 'testosterone',
      tier: 3,
      reason:
        patient.secondaryOsteoporosis.includes('hypogonadism')
          ? 'Hypogonadism flagged — confirm with morning serum testosterone. Replacement reduces fracture risk.'
          : 'Severe osteoporosis in a man with no identified cause — exclude hypogonadism with morning serum testosterone.',
      urgency: 'routine',
    });
  }

  // LH/FSH — only in women with early menopause flagged
  if (patient.sex === 'female' && patient.earlyMenopause) {
    needed.push({
      investigation: 'lh_fsh',
      tier: 3,
      reason:
        'Confirm premature ovarian insufficiency (POI) with LH and FSH. HRT is first-line bone protection.',
      urgency: 'routine',
    });
  }

  // PTH — only on abnormal calcium / ALP / explicit hyperparathyroidism flag (forearm-only handled below)
  if (alpAbnormal || calciumAbnormal || patient.secondaryOsteoporosis.includes('hyperparathyroidism')) {
    needed.push({
      investigation: 'pth',
      tier: 3,
      reason:
        'Abnormal calcium or ALP — measure PTH to exclude primary hyperparathyroidism. ' +
        'Elevated PTH with normal/high calcium → refer endocrinology.',
      urgency: 'routine',
    });
  }

  // Thyroid (TFTs) — only when (a) TSH already entered abnormal,
  // (b) clinician has flagged thyroid disease via secondary causes, or
  // (c) patient is on levothyroxine (over/under-replacement is a known driver of bone loss).
  const tsh = patient.bloodResults?.tshMUL ?? null;
  const tshAbnormal = tsh !== null && (tsh < 0.4 || tsh > 4.0);
  const thyroidDiseaseFlagged =
    patient.secondaryOsteoporosis.includes('untreated_hyperthyroidism');
  if (tshAbnormal || thyroidDiseaseFlagged || patient.onThyroidReplacement) {
    needed.push({
      investigation: 'thyroid',
      tier: 3,
      reason: tshAbnormal
        ? 'TSH outside reference range — optimise thyroid status before or alongside bone treatment.'
        : patient.onThyroidReplacement
        ? 'On levothyroxine — confirm TSH in range; over-replacement causes bone loss.'
        : 'Thyroid disease flagged — confirm TSH and treat hyperthyroidism before bone therapy.',
      urgency: 'routine',
    });
  }

  // SPEP/UPEP — Tier 3: if FBC abnormal, anaemia suspected, or vertebral fracture without clear cause
  const fhcAbnormal = patient.bloodResults?.fbc === false;
  const vertebralNoOtherCause =
    patient.priorVertebralFracture &&
    patient.secondaryOsteoporosis.length === 0 &&
    !patient.glucocorticoidUse;
  if (fhcAbnormal || vertebralNoOtherCause) {
    needed.push({
      investigation: 'spep_upep',
      tier: 3,
      reason:
        'SPEP/UPEP: exclude myeloma — particularly with abnormal FBC, anaemia, ' +
        'or vertebral fracture with no clear secondary cause.',
      urgency: fhcAbnormal ? 'soon' : 'routine',
    });
  }

  // Forearm-only osteoporosis — flag PTH workup
  const forearmOnly =
    patient.dexaResults !== null &&
    patient.dexaResults.forearmTScore !== null &&
    patient.dexaResults.forearmTScore <= -2.5 &&
    (patient.dexaResults.lumbarSpineTScore === null || patient.dexaResults.lumbarSpineTScore > -2.5) &&
    (patient.dexaResults.totalHipTScore === null || patient.dexaResults.totalHipTScore > -2.5) &&
    (patient.dexaResults.femoralNeckTScore === null || patient.dexaResults.femoralNeckTScore > -2.5);

  if (forearmOnly && !needed.some(i => i.investigation === 'pth')) {
    needed.push({
      investigation: 'pth',
      tier: 3,
      reason:
        'T-score ≤-2.5 at 33% radius with no low-T-score at standard sites. ' +
        'Rule out primary hyperparathyroidism before starting treatment: check calcium, ALP, PTH. ' +
        'Note: FRAX cannot accept forearm BMD — femoral neck BMD must be used for FRAX calculation.',
      urgency: 'soon',
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
    reasons.push(`historical height loss ≥4 cm (${patient.heightLossCm} cm)`);
  }
  if (patient.heightLossProspectiveCm !== null && patient.heightLossProspectiveCm >= 2) {
    reasons.push(`prospective height loss ≥2 cm measured in clinic (${patient.heightLossProspectiveCm} cm)`);
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
