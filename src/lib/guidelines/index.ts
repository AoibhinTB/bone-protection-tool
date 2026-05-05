// Main clinical decision engine — stateless, no I/O, fully unit-testable
// Input: PatientInput → Output: ClinicalDecision
// Scope: postmenopausal women and men aged ≥50 (NOGG 2024 Section 1)

import type { PatientInput, ClinicalDecision, RiskCategory, ReferralRecommendation, ClinicalFlag } from './types';
import { assessInvestigationsNeeded } from './assessment';
import { stratifyRisk } from './risk';
import { generateTreatmentOutput } from './treatment';
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

  const investigationsNeeded = assessInvestigationsNeeded(patient);

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
    generateTreatmentOutput(patient, riskCategory);

  // Age ≥85: FRAX 10-year probability may exceed remaining life expectancy
  if (patient.age >= 85) {
    const fraxLifeFlag: ClinicalFlag = {
      id: 'frax_life_expectancy_caveat',
      severity: 'info',
      message:
        'Patient aged ≥85: FRAX 10-year fracture probability may exceed remaining life expectancy. ' +
        'Apply clinical judgement — absolute fracture prevention benefit and treatment tolerability must be weighed individually.',
      rationale:
        'NOGG 2024: FRAX calculates 10-year fracture probability. In very elderly patients, remaining life expectancy ' +
        'may be shorter than 10 years — the clinical significance of the FRAX percentage should be interpreted accordingly.',
      source: GUIDELINE_VERSIONS.nogg,
    };
    flags.unshift(fraxLifeFlag);
  }

  // NOGG threshold caveat for borderline (intermediate) risk — thresholds are age-dependent
  if (riskCategory === 'intermediate') {
    const noggThresholdFlag: ClinicalFlag = {
      id: 'nogg_threshold_caveat',
      severity: 'info',
      message:
        'Intermediate fracture risk: NOGG intervention thresholds vary with age. ' +
        'For borderline cases, verify using the NOGG intervention threshold tool at nogg.org.uk.',
      rationale:
        'NOGG 2024: intervention thresholds are age-dependent (10-year MOF probability). ' +
        'The ranges used in this tool represent broad categories; precise age-specific thresholds are available at nogg.org.uk.',
      source: GUIDELINE_VERSIONS.nogg,
    };
    flags.push(noggThresholdFlag);
  }

  const deduplicatedReferrals = deduplicateReferrals(referrals);

  return {
    patientSummary:           buildSummary(patient, riskCategory),
    outOfScope:               false,
    riskStratification,
    investigationsNeeded,
    flags,
    treatmentRecommendations: recommendations,
    referrals:                deduplicatedReferrals,
    supplements,
    lifestyleAdvice:          lifestyleAdvice(patient),
    reviewSchedule:           reviewSchedule(riskCategory),
    guidelinesUsed: [
      `NOGG ${GUIDELINE_VERSIONS.nogg.year}`,
      `HSE MMP Ireland ${GUIDELINE_VERSIONS.hse_mmp.year}`,
      `NICE NG187 (${GUIDELINE_VERSIONS.nice.year})`,
      `Irish Osteoporosis Society ${GUIDELINE_VERSIONS.ios.year}`,
      'FRAX — country code 49 (Ireland), frax.shef.ac.uk',
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
    },
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

  if (patient.glucocorticoidUse?.current) {
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
  const advice: string[] = [
    'Weight-bearing and resistance exercise ≥30 min most days (walking, dancing, strength training, back extensor exercises)',
    'Fall prevention: balance training (tai chi / Otago programme for age ≥65), home hazard assessment, annual vision check, medication review for fall risk',
    'Calcium: healthy diet rich in dairy, leafy greens, fortified foods (700–1200 mg/day from food preferred over supplementation)',
    'Vitamin D: sunlight exposure, oily fish, fortified foods; supplement in most Irish adults given latitude',
  ];

  if (patient.currentSmoker || patient.vaping) {
    advice.push('Smoking/vaping cessation: smoking is a FRAX risk factor; vaping is a probable risk factor (NOGG 2024 update). Smoking directly impairs bone metabolism.');
  }
  if (patient.alcoholUnitsPerWeek >= 14) {
    advice.push('Reduce alcohol to <14 units/week — threshold for FRAX is ≥3 units/day; excess alcohol increases fall risk and suppresses osteoblast function.');
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
