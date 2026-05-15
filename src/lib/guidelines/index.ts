// Main clinical decision engine — stateless, no I/O, fully unit-testable
// Input: PatientInput → Output: ClinicalDecision
// Scope: postmenopausal women and men aged ≥50 (NOGG 2024 Section 1)

import type { PatientInput, ClinicalDecision, RiskCategory, ReferralRecommendation, ClinicalFlag } from './types';
import { assessInvestigationsNeeded } from './assessment';
import { stratifyRisk, hasAnyClinicalRiskFactor } from './risk';
import { deriveReferralSignals } from './referralSignals';
import { applyPreTreatmentSafetyFilters } from './safetyFilters';
import { generateTreatmentOutput } from './treatment';
import { generateBloodFlags } from './bloodFlags';
import { generateRiskFactorsIdentified } from './riskFactorsSummary';
import { GUIDELINE_VERSIONS } from './thresholds';

export function runClinicalDecision(patient: PatientInput): ClinicalDecision {
  // ── Out-of-scope detection (Section 1.1) ──────────────────────────────
  const outOfScope = detectOutOfScope(patient);
  if (outOfScope.isOutOfScope) {
    return buildOutOfScopeDecision(patient, outOfScope.reason!, outOfScope.referrals!);
  }

  // ── Core algorithm ────────────────────────────────────────────────────
  const riskStratification = stratifyRisk(patient);
  const riskCategory       = riskStratification.category;

  const investigationsNeeded = assessInvestigationsNeeded(patient, riskCategory);

  // Intermediate risk without DEXA → DEXA is the decision gate
  if (riskCategory === 'intermediate' && !patient.dexaResults) {
    const alreadyHasDEXA = investigationsNeeded.some(i => i.investigation === 'dexa');
    if (!alreadyHasDEXA) {
      investigationsNeeded.unshift({
        investigation: 'dexa',
        reason:
          `FRAX in intermediate zone (adjusted ${riskStratification.adjustedFraxMOFPercent ?? patient.fraxMOFPercent}%) — ` +
          'BMD measurement required to reclassify risk before committing to or withholding treatment (NOGG 2024 Rec 2).',
        urgency: 'routine',
      });
    }
  }

  const { recommendations, flags, referrals, supplements } =
    generateTreatmentOutput(patient, riskCategory, riskStratification);

  // v1.37 Filters 1-5 — structural pre-treatment safety filters (hypoCa + Vit D).
  // Mutates recommendations in place (tags status/blockReason/unblockAction) and pushes
  // urgent flags. Single call site applies regardless of which path produced the recipes
  // (standard recipe / GIOP / early menopause / oesophageal disease / sequencing).
  // Sources: NOGG 2024 p.29 §a, p.30 §a, p.34 §c (universal hypoCa CI for all
  // antiresorptives); NOGG Rec 17 Strong (parenteral Vit D pre-condition).
  applyPreTreatmentSafetyFilters(patient, recommendations, flags);

  // Append biochemistry-driven flags (ALP, TSH, calcium)
  flags.push(...generateBloodFlags(patient));

  // v1.34 — LS vs FN downward MOF adjustment is NOT auto-applied. Surface as a
  // clinical-judgement prompt so the clinician decides if the LS reading is reliable
  // (degenerative artefact may inflate spine BMD).
  const ls = patient.dexaResults?.lumbarSpineTScore ?? null;
  const fn = patient.dexaResults?.femoralNeckTScore ?? null;
  if (ls !== null && fn !== null) {
    const diff = Math.round(Math.abs(ls - fn));
    if (diff >= 1 && ls > fn) {
      const mult = 1 - 0.10 * diff;
      flags.push({
        id: 'frax_ls_fn_discordance_downward',
        severity: 'info',
        message:
          `LS T-score ${ls} higher than FN ${fn} by ${diff} SD. NOGG 2024 Table 2 permits a downward MOF ` +
          `adjustment of ${(0.10 * diff * 100).toFixed(0)}% (×${mult.toFixed(2)}) — consider applying only if the LS BMD measurement is reliable. ` +
          'Degenerative artefact (sclerotic lesions, vertebral compression, OA) may inflate spine readings; in that case do NOT apply the adjustment.',
        rationale:
          'NOGG 2024 Rec 3 (Conditional) / Table 2: when LS and FN T-scores differ, MOF probability may be ' +
          'adjusted by 10% per rounded SD. Upward adjustments (LS lower than FN) are auto-applied. Downward ' +
          'adjustments (LS higher than FN) require clinical judgement because degenerative artefact can inflate ' +
          'LS BMD and produce a falsely reassuring difference.',
        source: GUIDELINE_VERSIONS.nogg,
      });
    }
  }

  // v1.34 — when the no-risk-factor gate has been overridden, surface the NOGG Rec 1 context
  // together with the documentation prompt so both are visible alongside the revealed FRAX.
  if (patient.noRiskFactorOverride && !hasAnyClinicalRiskFactor(patient)) {
    flags.unshift({
      id: 'frax_revealed_no_rfs',
      severity: 'info',
      message:
        'FRAX revealed despite no clinical risk factors recorded. By revealing FRAX you confirm that additional ' +
        "clinical context not captured by the tool's risk-factor questions supports performing this assessment. " +
        'Document the rationale in the patient record.',
      rationale:
        'NOGG 2024 Rec 1: where there are no clinical risk factors, FRAX assessment is not indicated. The override ' +
        "path is intended for cases where the clinician has identified a risk factor outside the tool's explicit input " +
        'fields. The NOGG Rec 1 framing is preserved as additive context, not replaced.',
      source: GUIDELINE_VERSIONS.nogg,
    });
  }

  // Age ≥80: FRAX 10-year probability may exceed remaining life expectancy
  if (patient.age >= 80) {
    const fraxLifeFlag: ClinicalFlag = {
      id: 'frax_life_expectancy_caveat',
      severity: 'info',
      message:
        'Patient aged ≥80: FRAX 10-year fracture probability may exceed remaining life expectancy. ' +
        'Apply clinical judgement — absolute fracture prevention benefit and treatment tolerability must be weighed individually.',
      rationale:
        'NOGG 2024: FRAX calculates 10-year fracture probability. In elderly patients aged ≥80, remaining life expectancy ' +
        'may be shorter than 10 years — the clinical significance of the FRAX percentage should be interpreted accordingly.',
      source: GUIDELINE_VERSIONS.nogg,
    };
    flags.unshift(fraxLifeFlag);
  }

  const deduplicatedReferrals = deduplicateReferrals(referrals);

  const riskFactorsIdentified = generateRiskFactorsIdentified(patient, { riskStratification, flags });

  // ── v1.31 Section 17.5 — Output gating by risk category ───────────────
  // Treatment-adjacent content suppresses when no drug is being recommended,
  // unless an independent trigger applies (e.g. patient currently on the drug,
  // Vit D entered as abnormal, secondary-cause workup indication).
  const treatmentRecommended = recommendations.length > 0;
  // (onAntiresorptive flag was reserved for the monitoring-schedule gate, but
  // monitoring lives inside each TreatmentRecommendation card — it self-gates
  // because cards only render when treatmentRecommendations is non-empty.
  // Dropped to avoid an unused-variable lint error.)
  const onDenosumab =
    patient.currentTreatment?.currentlyOn === true &&
    patient.currentTreatment.agent === 'denosumab';
  const onBP =
    patient.currentTreatment?.currentlyOn === true &&
    (patient.currentTreatment.agent === 'alendronate' ||
     patient.currentTreatment.agent === 'risedronate' ||
     patient.currentTreatment.agent === 'ibandronate' ||
     patient.currentTreatment.agent === 'zoledronate');
  const vitDAbnormal =
    patient.bloodResults?.vitaminDNmol !== null &&
    patient.bloodResults?.vitaminDNmol !== undefined &&
    patient.bloodResults.vitaminDNmol < 75;

  // 1) Investigations — gate Tier 1 and Tier 2 on treatmentRecommended. Tier 3
  //    fires on its own (secondary-cause workup). DEXA / VFA / FRAX entries
  //    have no tier and fire on independent indications.
  // v1.36 Fix 4 (§6.3): the on-treatment-fracture pathway also requires Tier 2 bloods
  //    even when no new drug is being recommended (the patient is already on therapy and
  //    needs secondary-cause workup before any classification decision). Bypass the
  //    treatmentRecommended gate when the §6.3 pathway flag is present.
  const onTxFracturePath = flags.some(f => f.id === 'on_treatment_fracture_pathway');
  const gatedInvestigations = investigationsNeeded.filter(inv => {
    if (inv.tier === 1 || inv.tier === 2) return treatmentRecommended || onTxFracturePath;
    return true;
  });

  // 2) Flags — suppress treatment-adjacent prompts when no drug is being
  //    recommended AND the corresponding independent trigger isn't met.
  const gatedFlags = flags.filter(f => {
    // ONJ pre-treatment dental advice — gated on treatmentRecommended.
    // (Patients already on antiresorptive get ONJ guidance via their
    // recipe's monitoring section, not via this pre-start flag.)
    if (f.id === 'dental_check_pre_treatment') return treatmentRecommended;
    // Sequential therapy planning prompt (Section 17.5, widened per v1.31
    // follow-up): fires when ANY anabolic is in recommendations, OR the
    // patient is currently on denosumab, teriparatide, or romosozumab.
    // The literal Section 17.5 row says "anabolic in recs OR currently on
    // denosumab" but that excludes the clinically obvious case of a patient
    // mid-course on romosozumab or teriparatide — both have lifetime / fixed-
    // duration constraints and a mandatory follow-on antiresorptive, so the
    // prompt is essential for those patients. Confirmed with the clinical
    // lead; the spec text should be amended in the next revision.
    if (f.id === 'sequential_therapy_plan_required') {
      const anabolicInRecs = recommendations.some(r =>
        r.agent === 'teriparatide' || r.agent === 'romosozumab' || r.agent === 'abaloparatide',
      );
      const onAnabolic =
        patient.currentTreatment?.currentlyOn === true &&
        (patient.currentTreatment.agent === 'teriparatide' ||
         patient.currentTreatment.agent === 'romosozumab' ||
         patient.currentTreatment.agent === 'abaloparatide');
      // v1.36 (TC90): also allow through when an anabolic referral is firing (new-referral
      // patient has no anabolic in `recommendations` because anabolics surface via referrals,
      // not recipes — without this allow-through, the third push gate's flag was being
      // suppressed by the output filter).
      const referralSignals = deriveReferralSignals(patient, riskCategory);
      return anabolicInRecs || onDenosumab || onAnabolic || referralSignals.anabolicReferralFired;
    }
    // Denosumab cessation / timing / sequential alerts — only relevant when
    // denosumab is in recommendations OR patient is currently on denosumab.
    // (Recipe pushes alerts when monthsSinceLastDose is set; without a
    // denosumab record on the patient, these never fire — but defence-
    // in-depth filter here.)
    if (f.id.startsWith('denosumab_') &&
        f.id !== 'denosumab_vitd_block' /* Vit D block fires on the abnormal-Vit-D trigger */) {
      const denoInRecs = recommendations.some(r => r.agent === 'denosumab');
      return denoInRecs || onDenosumab;
    }
    // AFF prodrome / long-duration surveillance — only when on (or being
    // recommended) a long-term bisphosphonate.
    if (f.id === 'aff_prodrome_urgent' || f.id === 'aff_long_duration_surveillance') {
      const bpInRecs = recommendations.some(r =>
        r.agent === 'alendronate' || r.agent === 'risedronate' ||
        r.agent === 'ibandronate' || r.agent === 'zoledronate',
      );
      return bpInRecs || onBP;
    }
    // All other flags fire on their own clinical triggers (risk-factor
    // double-counts, blood-result alerts, life-expectancy caveat, falls
    // assessment, etc.) — pass through.
    return true;
  });

  // 3) Supplements — when no drug is being recommended:
  //    - Calcium supplementation framework (per-mg prescription) → suppress
  //      (low-risk patients get dietary calcium guidance from lifestyleAdvice).
  //    - Vit D tiered protocol → keep ONLY when Vit D entered as abnormal.
  const gatedSupplements = supplements.filter(s => {
    if (s.supplement === 'calcium') return treatmentRecommended;
    if (s.supplement === 'vitamin_d') return treatmentRecommended || vitDAbnormal;
    return true;
  });

  return {
    patientSummary:           buildSummary(patient, riskCategory),
    outOfScope:               false,
    treatmentRecommended,
    riskStratification,
    riskFactorsIdentified,
    investigationsNeeded:     gatedInvestigations,
    flags:                    gatedFlags,
    treatmentRecommendations: recommendations,
    referrals:                deduplicatedReferrals,
    supplements:              gatedSupplements,
    lifestyleAdvice:          lifestyleAdvice(patient),
    reviewSchedule:           reviewSchedule(riskCategory),
    guidelinesUsed: [
      `NOGG ${GUIDELINE_VERSIONS.nogg.year}`,
      `HSE MMP Ireland ${GUIDELINE_VERSIONS.hse_mmp.year}`,
      `NICE NG187 (${GUIDELINE_VERSIONS.nice.year})`,
      `Irish Osteoporosis Society ${GUIDELINE_VERSIONS.ios.year}`,
      `ISCD Official Positions ${GUIDELINE_VERSIONS.iscd.year}`,
      'FRAX — country code 49 (Ireland), frax.shef.ac.uk',
      `HSE Managed Access Protocol — Romosozumab (Evenity) ${GUIDELINE_VERSIONS.hse_map_romo.year}`,
      GUIDELINE_VERSIONS.mccarroll_2023.guideline,
      GUIDELINE_VERSIONS.mccarroll_2025.guideline,
    ],
  };
}

// ─── Out-of-scope detection ────────────────────────────────────────────────
// NOGG 2024 Section 1.1: these cases require specialist referral, not standard algorithm

interface OutOfScopeResult {
  isOutOfScope: boolean;
  reason?: string;
  referrals?: ReferralRecommendation[];
}

function detectOutOfScope(patient: PatientInput): OutOfScopeResult {
  if (patient.pregnantOrBreastfeeding) {
    return {
      isOutOfScope: true,
      reason: 'Pregnant or breastfeeding: bisphosphonates, denosumab, and teriparatide are all contraindicated. Specialist referral required.',
      referrals: [{ specialty: 'endocrinology', reason: 'Bone protection during/after pregnancy — specialist management required.', urgency: 'soon' }],
    };
  }

  if (patient.pagetsDiseaseOfBone) {
    return {
      isOutOfScope: true,
      reason: "Paget's disease of bone: distinct management pathway; bisphosphonate dosing differs from osteoporosis. Specialist referral required.",
      referrals: [{ specialty: 'metabolic_bone', reason: "Paget's disease — specialist management.", urgency: 'routine' }],
    };
  }

  // Premenopausal women with fragility fracture or osteoporosis on DEXA
  if (
    patient.sex === 'female' &&
    !patient.earlyMenopause &&
    patient.age < 50 &&
    (patient.priorFragilityFracture ||
      (patient.dexaResults !== null && lowestTScore(patient.dexaResults) <= -2.5))
  ) {
    return {
      isOutOfScope: true,
      reason:
        'Premenopausal woman with fragility fracture or osteoporosis on DEXA: ' +
        'thorough secondary cause workup required (NOGG 2024 Section 1.1). Specialist referral.',
      referrals: [
        { specialty: 'endocrinology', reason: 'Premenopausal osteoporosis — secondary cause workup and specialist management.', urgency: 'soon' },
      ],
    };
  }

  // Men under 50 with fragility fracture or osteoporosis
  if (
    patient.sex === 'male' &&
    patient.age < 50 &&
    (patient.priorFragilityFracture ||
      (patient.dexaResults !== null && lowestTScore(patient.dexaResults) <= -2.5))
  ) {
    return {
      isOutOfScope: true,
      reason:
        'Man aged <50 with fragility fracture or osteoporosis: ' +
        'secondary cause workup required (NOGG 2024 Section 1.1). Specialist referral.',
      referrals: [
        { specialty: 'endocrinology', reason: 'Osteoporosis in man <50 — secondary cause workup required.', urgency: 'soon' },
      ],
    };
  }

  return { isOutOfScope: false };
}

function buildOutOfScopeDecision(
  patient: PatientInput,
  reason: string,
  referrals: ReferralRecommendation[],
): ClinicalDecision {
  return {
    patientSummary: `${patient.age}yo ${patient.sex} — out of scope for standard algorithm`,
    outOfScope: true,
    treatmentRecommended: false,
    riskStratification: {
      category: 'out_of_scope',
      trafficLight: 'grey',
      fraxMOFPercent: null,
      fraxHipPercent: null,
      adjustedFraxMOFPercent: null,
      adjustedFraxHipPercent: null,
      fraxAdjustments: [],
      lowerThreshold: null,
      upperThreshold: null,
      rationale: reason,
      source: GUIDELINE_VERSIONS.nogg,
      gatedNoRfs: false,
    },
    riskFactorsIdentified: [],
    investigationsNeeded: [],
    flags: [{
      id: 'out_of_scope',
      severity: 'warning',
      message: reason,
      rationale: 'NOGG 2024 Section 1.1',
      source: GUIDELINE_VERSIONS.nogg,
    }],
    treatmentRecommendations: [],
    referrals,
    supplements: [],
    lifestyleAdvice: [],
    reviewSchedule: 'Per specialist',
    guidelinesUsed: [`NOGG ${GUIDELINE_VERSIONS.nogg.year}`],
  };
}

// ─── Builders ─────────────────────────────────────────────────────────────

function buildSummary(patient: PatientInput, riskCategory: RiskCategory): string {
  const parts: string[] = [`${patient.age}yo ${patient.sex}`];

  if (patient.priorHipFracture)            parts.push('hip fracture');
  else if (patient.priorVertebralFracture) parts.push(`vertebral fracture (×${patient.numberOfPriorFractures})`);
  else if (patient.priorFragilityFracture) parts.push('prior fragility fracture');

  if (patient.glucocorticoidDoseMgDay !== null && patient.glucocorticoidDoseMgDay > 0) {
    parts.push(`GC ${patient.glucocorticoidDoseMgDay} mg/day`);
  } else if (patient.glucocorticoidUse?.current) {
    parts.push(`${patient.glucocorticoidUse.dose}-dose GC ×${patient.glucocorticoidUse.durationMonths}mo`);
  }
  if (patient.adtUse)                      parts.push('on ADT');
  if (patient.aromataseInhibitorUse)        parts.push('on aromatase inhibitor');
  if (patient.earlyMenopause)              parts.push('early menopause');
  if (patient.type2Diabetes)              parts.push('T2DM');
  if (patient.parkinsonsDisease)           parts.push("Parkinson's");
  if (patient.fallsInLastYear >= 2)        parts.push(`falls ×${patient.fallsInLastYear}/yr`);

  if (patient.fraxMOFPercent !== null) {
    parts.push(`FRAX MOF ${patient.fraxMOFPercent}%`);
  }

  const tScores = [
    patient.dexaResults?.lumbarSpineTScore,
    patient.dexaResults?.totalHipTScore,
  ].filter((t): t is number => t != null);
  if (tScores.length > 0) parts.push(`lowest T-score ${Math.min(...tScores)}`);

  parts.push(`→ ${riskCategory.replace('_', ' ')} risk`);
  return parts.join(', ');
}

function lifestyleAdvice(patient: PatientInput): string[] {
  // v1.16 Step 6 — healthy balanced diet recommendation as first item (NOGG 2024 Strong, Section 12).
  const advice: string[] = [
    'Advise a healthy, nutrient-rich balanced diet (NOGG 2024 Strong). Adequate dietary calcium is the preferred approach — supplement only the gap between dietary intake and the 1200 mg/day target.',
    'Progressive resistance training and weight-bearing exercise ≥30 min most days (strength training, walking, dancing, back extensor exercises) per NOGG 2024 — progressive load is key to bone stimulation',
    // v1.16 Step 7 — falls assessment scope: ALL patients with osteoporosis or any fragility
    // fracture (not only those identified as at risk). Wording aligned with NOGG 2024 Rec 7.
    'Falls prevention: a falls assessment should be undertaken in ALL patients with osteoporosis (T-score ≤ −2.5) and ALL patients with any fragility fracture (NOGG 2024 Rec 7 — Strong). Those at risk should be offered exercise programmes to improve balance and/or a combined exercise protocol (tai chi, Otago). Practical measures: home hazard assessment, medication review (sedatives, antihypertensives), vision check, footwear review.',
    'Calcium: minimum 700 mg/day (Irish/UK RNI) — target 1200 mg/day total from all sources. Dairy, leafy greens, fortified foods preferred over supplementation.',
    'Vitamin D: sunlight exposure, oily fish, fortified foods; supplement in most Irish adults given latitude. Vitamin D alone does not reduce fracture incidence but may reduce falls risk (NOGG 2024 Evidence Ib) — combine with pharmacological treatment where indicated.',
  ];

  if (patient.currentSmoker || patient.vaping) {
    advice.push('Smoking/vaping cessation: smoking is a FRAX risk factor; vaping is a probable risk factor (NOGG 2024 update). Smoking directly impairs bone metabolism.');
  }
  // v1.16 — alcohol: NOGG 2024 Strong = ≤2 units/day (≤14 units/week).
  if (patient.alcoholUnitsPerWeek >= 14) {
    advice.push('Restrict alcohol to ≤2 units/day (≤14 units/week) — NOGG 2024 Strong. The FRAX risk threshold is ≥3 units/day; excess alcohol increases fall risk and suppresses osteoblast function.');
  }
  if (patient.bmi !== null && patient.bmi < 18.5) {
    advice.push('Low BMI (<18.5) is a FRAX risk factor — optimise nutritional intake and address any underlying cause.');
  }

  return advice;
}

function reviewSchedule(riskCategory: RiskCategory): string {
  const schedules: Record<RiskCategory, string> = {
    low:          'Reassess in 5 years, or sooner if risk factors change (NOGG 2024 Rec 21)',
    intermediate: '1–2 years after DEXA result; sooner if clinical change',
    high:         'Adherence check at 3 months; DEXA at 1–2 years; full review every 2 years',
    very_high:    '6–12 months specialist-led; adherence at 3 months',
    out_of_scope: 'Per specialist',
  };
  return schedules[riskCategory];
}

// ─── Deduplication ────────────────────────────────────────────────────────

function deduplicateReferrals(
  referrals: ReferralRecommendation[],
): ReferralRecommendation[] {
  const urgencyRank: Record<string, number> = { urgent: 2, soon: 1, routine: 0 };
  const map = new Map<string, ReferralRecommendation>();
  for (const ref of referrals) {
    const existing = map.get(ref.specialty);
    if (!existing || urgencyRank[ref.urgency] > urgencyRank[existing.urgency]) {
      map.set(ref.specialty, ref);
    }
  }
  return Array.from(map.values());
}

function lowestTScore(dexa: NonNullable<PatientInput['dexaResults']>): number {
  const scores = [dexa.lumbarSpineTScore, dexa.totalHipTScore, dexa.femoralNeckTScore]
    .filter((t): t is number => t != null);
  return scores.length > 0 ? Math.min(...scores) : 0;
}

// ─── Re-exports ───────────────────────────────────────────────────────────

export type {
  PatientInput,
  ClinicalDecision,
  RiskStratification,
  TreatmentRecommendation,
  ClinicalFlag,
  InvestigationRecommendation,
  ReferralRecommendation,
  SupplementRecommendation,
  FraxAdjustment,
} from './types';

export { GUIDELINE_VERSIONS } from './thresholds';
