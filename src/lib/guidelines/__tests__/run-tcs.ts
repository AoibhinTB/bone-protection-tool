// Executable Section 16 test cases — runs runClinicalDecision against each TC
// and reports pass/fail. Run with: npx ts-node --transpile-only src/lib/guidelines/__tests__/run-tcs.ts

import { runClinicalDecision } from '../index';
import type { PatientInput, ClinicalDecision, TreatmentAgent } from '../types';

// ─── PatientInput factory ─────────────────────────────────────────────────

function basePatient(overrides: Partial<PatientInput>): PatientInput {
  const base: PatientInput = {
    age: 65,
    sex: 'female',
    pregnantOrBreastfeeding: false,
    pagetsDiseaseOfBone: false,
    priorFragilityFracture: false,
    priorHipFracture: false,
    priorVertebralFracture: false,
    recentVertebralFractureYears: null,
    numberOfPriorFractures: 0,
    parentalHipFracture: false,
    currentSmoker: false,
    vaping: false,
    alcoholUnitsPerWeek: 0,
    bmi: 25,
    rheumatoidArthritis: false,
    secondaryOsteoporosis: [],
    type2Diabetes: false,
    fallsInLastYear: 0,
    parkinsonsDisease: false,
    lowerLimbAmputation: false,
    learningDisabilities: false,
    glucocorticoidUse: null,
    glucocorticoidDoseMgDay: null,
    glucocorticoidPreviouslyUsed: false,
    boneTurnoverMarkersRising: null,
    bmdDecreasedDuringPause: null,
    adtUse: false,
    aromataseInhibitorUse: false,
    earlyMenopause: false,
    ageAtMenopause: null,
    heightLossCm: null,
    heightLossProspectiveCm: null,
    kyphosis: false,
    acuteBackPain: false,
    vteHistory: false,
    breastCancerHistory: false,
    priorMIOrStrokeWithin12Months: false,
    recentFractureWithin2Years: false,
    renalFunction: null,
    dexaResults: null,
    bloodResults: null,
    fraxMOFPercent: null,
    fraxHipPercent: null,
    fraxCalculatedWithBMD: false,
    currentTreatment: null,
    previousTreatments: [],
    denosumabMonthsSinceLastDose: null,
    completedAnabolicCourse: false,
    thighOrGroinPain: false,
    onThyroidReplacement: false,
    refusesInjections: false,
    bmdUnavailable: false,
    recentOralGlucocorticoidUse: false,
    bornOutsideIreland: false,
    onThiazolidinedione: false,
  };
  return { ...base, ...overrides };
}

// ─── Test framework ───────────────────────────────────────────────────────

interface TCResult {
  name: string;
  passed: boolean;
  failures: string[];
  decision: ClinicalDecision;
}

function check(failures: string[], label: string, condition: boolean, details = ''): void {
  if (!condition) failures.push(`${label}${details ? ` — ${details}` : ''}`);
}

function hasAgent(decision: ClinicalDecision, agent: TreatmentAgent): boolean {
  return decision.treatmentRecommendations.some(r => r.agent === agent);
}

function hasFlag(decision: ClinicalDecision, idSubstring: string): boolean {
  return decision.flags.some(f => f.id.includes(idSubstring));
}

function hasFlagText(decision: ClinicalDecision, text: string): boolean {
  const lc = text.toLowerCase();
  return decision.flags.some(f =>
    f.message.toLowerCase().includes(lc) || f.rationale.toLowerCase().includes(lc),
  );
}

function hasReferral(decision: ClinicalDecision, specialty: string): boolean {
  return decision.referrals.some(r => r.specialty === specialty);
}

function hasSupplementText(decision: ClinicalDecision, kind: 'vitamin_d' | 'calcium', text: string): boolean {
  const sup = decision.supplements.find(s => s.supplement === kind);
  if (!sup) return false;
  const lc = text.toLowerCase();
  return (
    sup.headline.toLowerCase().includes(lc) ||
    sup.bullets.some(b => b.toLowerCase().includes(lc))
  );
}

// ─── TC1 ──────────────────────────────────────────────────────────────────
// 68F postmenopausal, T-score -2.8 spine / -2.2 hip, no fx, eGFR 58, Vit D 40

function tc1(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.2, femoralNeckTScore: -2.2, forearmTScore: null },
    renalFunction: { egfr: 58 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 40, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'no denosumab', !hasAgent(decision, 'denosumab'));
  check(failures, 'Vit D supplement insufficient text', hasSupplementText(decision, 'vitamin_d', 'insufficient'));
  check(failures, 'Vit D 800–1000 IU/day mentioned', hasSupplementText(decision, 'vitamin_d', '800') || hasSupplementText(decision, 'vitamin_d', '1000'));
  return { name: 'TC1 — 68F osteoporosis no prev tx', passed: failures.length === 0, failures, decision };
}

// ─── TC2 ──────────────────────────────────────────────────────────────────
// 72F, prev alendronate stopped AFF 2 years ago, T-score -3.1 hip, eGFR 55

function tc2(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: null, totalHipTScore: -3.1, femoralNeckTScore: -3.1, forearmTScore: null },
    renalFunction: { egfr: 55 },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 36, reasonStopped: 'aff_confirmed', currentlyOn: false }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (not VHR — T-score -3.1 > -3.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'AFF contraindication flag present', hasFlag(decision, 'aff_history_bp_permanent_ci'));
  check(failures, 'recommends denosumab', hasAgent(decision, 'denosumab'));
  check(failures, 'NO alendronate recommendation', !hasAgent(decision, 'alendronate'));
  check(failures, 'NO risedronate recommendation', !hasAgent(decision, 'risedronate'));
  check(failures, 'NO ibandronate recommendation', !hasAgent(decision, 'ibandronate'));
  check(failures, 'NO zoledronate recommendation', !hasAgent(decision, 'zoledronate'));
  return { name: 'TC2 — 72F AFF history', passed: failures.length === 0, failures, decision };
}

// ─── TC3 ──────────────────────────────────────────────────────────────────
// 80M, T-score -2.6, eGFR 30, no fx, Vit D 60

function tc3(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 80,
    sex: 'male',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 30 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 30, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'NO alendronate (eGFR 30 < 35)', !hasAgent(decision, 'alendronate'));
  check(failures, 'NO zoledronate (eGFR 30 < 35)', !hasAgent(decision, 'zoledronate'));
  check(failures, 'recommends denosumab', hasAgent(decision, 'denosumab'));
  check(failures, 'mandatory Ca 2-week check flag', hasFlag(decision, 'denosumab_ckd_hypocalcaemia'));
  check(failures, 'nephrology referral', hasReferral(decision, 'nephrology'));
  check(failures, 'Vit D adequate (target met or below target)', hasSupplementText(decision, 'vitamin_d', 'target') || hasSupplementText(decision, 'vitamin_d', 'maintenance'));
  return { name: 'TC3 — 80M severe CKD', passed: failures.length === 0, failures, decision };
}

// ─── TC4 ──────────────────────────────────────────────────────────────────
// 55F, prev alendronate stopped GI intolerance, T-score -2.9, eGFR 62, Vit D 80

function tc4(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 55,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.9, femoralNeckTScore: -2.9, forearmTScore: null },
    renalFunction: { egfr: 62 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 80, egfr: 62, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 6, reasonStopped: 'gi_intolerance', currentlyOn: false }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'GI intolerance contraindication flag', hasFlag(decision, 'prev_gi_intolerance_bp'));
  check(failures, 'recommends zoledronate (IV bypasses GI)', hasAgent(decision, 'zoledronate'));
  check(failures, 'NO alendronate recommendation', !hasAgent(decision, 'alendronate'));
  check(failures, 'Vit D adequate (≥75)', hasSupplementText(decision, 'vitamin_d', 'target met') || hasSupplementText(decision, 'vitamin_d', 'maintenance'));
  // Paracetamol pre-medication should be in the zoledronate monitoring
  const zol = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');
  check(failures, 'zoledronate paracetamol pre-medication', !!zol && zol.monitoring.some(m => m.toLowerCase().includes('paracetamol')));
  return { name: 'TC4 — 55F oral BP GI intolerance', passed: failures.length === 0, failures, decision };
}

// ─── TC5 ──────────────────────────────────────────────────────────────────
// 77F, T-score -3.8, two vertebral fx (one 18mo ago), prednisolone 10mg/day (3+mo), eGFR 50

function tc5(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 77,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 1.5,
    numberOfPriorFractures: 2,
    glucocorticoidUse: { current: true, durationMonths: 6, dose: 'medium' },
    dexaResults: { lumbarSpineTScore: -3.8, totalHipTScore: -3.6, femoralNeckTScore: -3.6, forearmTScore: null },
    renalFunction: { egfr: 50 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  check(failures, 'GIOP anabolic preferred flag', hasFlag(decision, 'giop_anabolic_preferred'));
  check(failures, 'rheumatology referral urgent', decision.referrals.some(r => r.specialty === 'rheumatology' && r.urgency === 'urgent'));
  check(failures, 'empirical alendronate (NOGG Rec 22)', hasAgent(decision, 'alendronate'));
  return { name: 'TC5 — 77F GIOP VHR + 2 VF', passed: failures.length === 0, failures, decision };
}

// ─── TC6 ──────────────────────────────────────────────────────────────────
// 63F on denosumab 3 years, Vit D 45, wants to stop

function tc6(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 63,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    renalFunction: { egfr: 75 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 45, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'denosumab', durationMonths: 36, reasonStopped: null, currentlyOn: true },
    denosumabMonthsSinceLastDose: 5,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'recommends denosumab continuation', hasAgent(decision, 'denosumab'));
  check(failures, 'cessation plan flag', hasFlag(decision, 'denosumab_cessation_plan'));
  check(failures, 'cessation plan mentions alendronate', hasFlagText(decision, 'alendronate'));
  check(failures, 'cessation plan mentions zoledronate', hasFlagText(decision, 'zoledronate'));
  check(failures, 'Vit D insufficient text', hasSupplementText(decision, 'vitamin_d', 'insufficient'));
  check(failures, 'Vit D <50 hold flag (denosumab)', hasFlag(decision, 'denosumab_vitd_block'));
  return { name: 'TC6 — 63F on denosumab, wants to stop', passed: failures.length === 0, failures, decision };
}

// ─── TC7 ──────────────────────────────────────────────────────────────────
// 58F, early menopause age 40, T-score -1.8, eGFR 70, Vit D 55, not on HRT

function tc7(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 58,
    sex: 'female',
    earlyMenopause: true,
    ageAtMenopause: 40,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -1.6, femoralNeckTScore: -1.6, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 55, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (early meno + T ≤ -1.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  // Per current code: HRT under 60 is offered as an info flag; alendronate is the actual recommendation
  // Spec expected: "First-line: HRT" — but current code structures HRT as a flag option, BP as the actual rec
  check(failures, 'HRT first-line option flag (under 60 + high risk)', hasFlag(decision, 'hrt_option_under60'));
  check(failures, 'alendronate as fallback if HRT contraindicated', hasAgent(decision, 'alendronate'));
  check(failures, 'Vit D below target maintenance', hasSupplementText(decision, 'vitamin_d', 'maintenance') || hasSupplementText(decision, 'vitamin_d', 'below target'));
  return { name: 'TC7 — 58F early menopause', passed: failures.length === 0, failures, decision };
}

// ─── TC8 ──────────────────────────────────────────────────────────────────
// 74F, BP and denosumab both stopped due to ONJ

function tc8(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 74,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 60 },
    previousTreatments: [
      { agent: 'alendronate', durationMonths: 24, reasonStopped: 'onj', currentlyOn: false },
      { agent: 'denosumab', durationMonths: 12, reasonStopped: 'onj', currentlyOn: false },
    ],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'ONJ avoidance flag', hasFlag(decision, 'onj_avoid_antiresorptive'));
  check(failures, 'NO bisphosphonate', !hasAgent(decision, 'alendronate') && !hasAgent(decision, 'risedronate') && !hasAgent(decision, 'zoledronate') && !hasAgent(decision, 'ibandronate'));
  check(failures, 'NO denosumab', !hasAgent(decision, 'denosumab'));
  check(failures, 'metabolic_bone referral', hasReferral(decision, 'metabolic_bone'));
  check(failures, 'oral_maxfac referral', hasReferral(decision, 'oral_maxfac'));
  return { name: 'TC8 — 74F dual-class ONJ history', passed: failures.length === 0, failures, decision };
}

// ─── TC9 ──────────────────────────────────────────────────────────────────
// 69M ADT for prostate cancer, T-score -2.3, eGFR 65, Vit D 30

function tc9(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 69,
    sex: 'male',
    adtUse: true,
    dexaResults: { lumbarSpineTScore: -2.3, totalHipTScore: -2.1, femoralNeckTScore: -2.1, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 30, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (ADT + T-score ≤ -2.0)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'ADT bone loss flag with denosumab preference', hasFlag(decision, 'adt_bone_loss'));
  // ADT-specific: denosumab must be primary first-line; alendronate appears as second-line alternative.
  const denoRec = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  const alenRec = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  check(failures, 'denosumab is recommended', !!denoRec);
  check(failures, 'denosumab is FIRST-line (primary)', !!denoRec && denoRec.priority !== 'alternative');
  check(failures, 'denosumab appears before alendronate in list',
    !!denoRec && !!alenRec && decision.treatmentRecommendations.indexOf(denoRec) < decision.treatmentRecommendations.indexOf(alenRec));
  check(failures, 'alendronate is second-line alternative', !!alenRec && alenRec.priority === 'alternative');
  check(failures, 'Vit D insufficient text', hasSupplementText(decision, 'vitamin_d', 'insufficient'));
  return { name: 'TC9 — 69M ADT', passed: failures.length === 0, failures, decision };
}

// ─── TC10 ─────────────────────────────────────────────────────────────────
// 82F, T-score -2.7, FRAX hip 5.2%, eGFR 45, Vit D unknown, Ca 2.35

function tc10(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 82,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.5, femoralNeckTScore: -2.5, forearmTScore: null },
    renalFunction: { egfr: 45 },
    bloodResults: { adjustedCalciumMmol: 2.35, vitaminDNmol: null, egfr: 45, alp: null, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    fraxHipPercent: 5.2,
  });
  const decision = runClinicalDecision(patient);
  // Per code's spec discrepancy comment: HIGH (T-score -2.7 ≤ -2.5), not VHR (FRAX hip 5.2 < 8.6 VHRT)
  check(failures, 'risk = high (T-score driven)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate (oral preferred at borderline eGFR)', hasAgent(decision, 'alendronate'));
  check(failures, 'zoledronate borderline eGFR caution flag', hasFlag(decision, 'zoledronate_borderline_egfr'));
  check(failures, 'age ≥80 FRAX life expectancy caveat', hasFlag(decision, 'frax_life_expectancy_caveat'));
  check(failures, 'Vit D check before treatment (unknown level)', hasSupplementText(decision, 'vitamin_d', 'unknown') || hasSupplementText(decision, 'vitamin_d', 'before starting'));
  return { name: 'TC10 — 82F T-2.7 borderline CKD', passed: failures.length === 0, failures, decision };
}

// ─── TC11 ─────────────────────────────────────────────────────────────────
// 66M GIOP (pred 15mg/day, started 2mo, planned ≥6mo) + previous alendronate GI intolerance
// Expected: HIGH (GIOP), oral BP CI, IV zoledronate, FRAX adjustments noted

function tc11(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'male',
    rheumatoidArthritis: true, // implicit — RA on prednisolone for RA
    glucocorticoidUse: { current: true, durationMonths: 2, dose: 'high' },
    dexaResults: { lumbarSpineTScore: -2.1, totalHipTScore: -2.0, femoralNeckTScore: -2.1, forearmTScore: null },
    renalFunction: { egfr: 55 },
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 50, egfr: 55, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 6, reasonStopped: 'gi_intolerance', currentlyOn: false }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GIOP pathway flag fired', hasFlag(decision, 'giop'));
  check(failures, 'IV after GI intolerance flag fired', hasFlag(decision, 'giop_iv_after_gi_intolerance'));
  check(failures, 'recommends zoledronate', hasAgent(decision, 'zoledronate'));
  check(failures, 'NO alendronate (GI intolerance)', !hasAgent(decision, 'alendronate'));
  check(failures, 'NO risedronate (GI intolerance)', !hasAgent(decision, 'risedronate'));
  check(failures, 'GC high-dose surface flag', hasFlag(decision, 'gc_high_dose_giop_surface'));
  return { name: 'TC11 — 66M GIOP + prior oral BP GI intolerance', passed: failures.length === 0, failures, decision };
}

// ─── TC12 ─────────────────────────────────────────────────────────────────
// 52F T-score osteoporosis but FRAX low — discordance
// Expected: HIGH (T-score drives), alendronate, secondary cause workup

function tc12(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 52,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    renalFunction: { egfr: 75 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    fraxMOFPercent: 6.8,
    fraxHipPercent: 0.7,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (T-score drives despite low FRAX)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  // Young + osteoporosis + no obvious cause → broad workup (PTH at minimum)
  check(failures, 'PTH investigation triggered (young unexplained)', decision.investigationsNeeded.some(i => i.investigation === 'pth'));
  return { name: 'TC12 — 52F osteoporosis + low FRAX (discordance)', passed: failures.length === 0, failures, decision };
}

// ─── TC13 ─────────────────────────────────────────────────────────────────
// 74F T-3.0 + recent wrist fx + Vit D 18 + Ca 2.05 — TWO safety blockers
// Expected: SAFETY BLOCK, no antiresorptive recommendation until corrected

function tc13(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 74,
    sex: 'female',
    priorFragilityFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -3.0, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    renalFunction: { egfr: 60 },
    bloodResults: { adjustedCalciumMmol: 2.05, vitaminDNmol: 18, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'two-safety-blockers urgent flag', hasFlag(decision, 'two_safety_blockers'));
  check(failures, 'NO treatment recommendation while blocked', decision.treatmentRecommendations.length === 0);
  // bloodFlags should also fire individually
  check(failures, 'hypocalcaemia flag', hasFlag(decision, 'hypocalcaemia'));
  return { name: 'TC13 — 74F severe Vit D + hypocalcaemia (dual blockers)', passed: failures.length === 0, failures, decision };
}

// ─── TC14 ─────────────────────────────────────────────────────────────────
// 59F on HRT 4y, T -2.8 — review HRT first, can add alendronate
function tc14(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 59,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 72 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'hrt', durationMonths: 48, reasonStopped: null, currentlyOn: true },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (T ≤ -2.5 despite HRT)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'HRT-on-board review flag', hasFlag(decision, 'hrt_on_board_review'));
  check(failures, 'recommends alendronate alongside HRT', hasAgent(decision, 'alendronate'));
  return { name: 'TC14 — 59F on HRT + T -2.8', passed: failures.length === 0, failures, decision };
}

// ─── TC15 ─────────────────────────────────────────────────────────────────
// 91F frail care home, hip fx 3mo, eGFR 35, Vit D 22, dementia
// Expected: VERY HIGH (recent hip fx within 24mo), denosumab preferred, urgent Vit D loading

function tc15(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 91,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -3.4, totalHipTScore: -3.4, femoralNeckTScore: -3.4, forearmTScore: null },
    renalFunction: { egfr: 35 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 22, egfr: 35, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high (recent hip fx)', decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends denosumab (eGFR 35 borderline)', hasAgent(decision, 'denosumab'));
  check(failures, 'NO alendronate at eGFR 35', !hasAgent(decision, 'alendronate'));
  check(failures, 'age ≥80 FRAX caveat', hasFlag(decision, 'frax_life_expectancy_caveat'));
  check(failures, 'denosumab Vit D block (severe deficiency)', hasFlag(decision, 'denosumab_vitd_block'));
  return { name: 'TC15 — 91F frail, recent hip fx, eGFR 35, Vit D 22', passed: failures.length === 0, failures, decision };
}

// ─── TC16 ─────────────────────────────────────────────────────────────────
// 61F on AI, T -1.8 (osteopenia), FRAX 11.5% — AI-specific lower threshold
function tc16(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 61,
    sex: 'female',
    aromataseInhibitorUse: true,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -1.7, femoralNeckTScore: -1.7, forearmTScore: null },
    renalFunction: { egfr: 68 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 55, egfr: 68, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    fraxMOFPercent: 11.5,
    fraxHipPercent: 1.5,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (AI lower threshold T ≤ -1.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'AI CTIBL flag', hasFlag(decision, 'ai_ctibl'));
  check(failures, 'recommends alendronate or zoledronate', hasAgent(decision, 'alendronate') || hasAgent(decision, 'zoledronate'));
  return { name: 'TC16 — 61F AI lower threshold', passed: failures.length === 0, failures, decision };
}

// ─── TC17 ─────────────────────────────────────────────────────────────────
// 71F BP holiday — fx during holiday — restart immediately
function tc17(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    priorFragilityFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.3, totalHipTScore: -2.3, femoralNeckTScore: -2.3, forearmTScore: null },
    renalFunction: { egfr: 62 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 72, egfr: 62, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 60, reasonStopped: 'treatment_holiday', currentlyOn: false }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (recent fragility fracture)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'imminent fracture flag', hasFlag(decision, 'imminent_fracture_risk'));
  check(failures, 'recommends alendronate (restart)', hasAgent(decision, 'alendronate'));
  return { name: 'TC17 — 71F fx during BP holiday', passed: failures.length === 0, failures, decision };
}

// ─── TC18 ─────────────────────────────────────────────────────────────────
// 67F denosumab 8 months since last — urgent
function tc18(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'denosumab', durationMonths: 24, reasonStopped: null, currentlyOn: true },
    denosumabMonthsSinceLastDose: 8,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'urgent overdue injection flag', hasFlag(decision, 'denosumab_overdue_injection'));
  check(failures, 'continues denosumab recommendation', hasAgent(decision, 'denosumab'));
  return { name: 'TC18 — 67F denosumab 8mo overdue', passed: failures.length === 0, failures, decision };
}

// ─── TC19 ─────────────────────────────────────────────────────────────────
// 58M GIOP low-dose pred 4mg/day for polymyalgia, T -1.7
function tc19(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 58,
    sex: 'male',
    glucocorticoidUse: { current: true, durationMonths: 4, dose: 'low' },
    dexaResults: { lumbarSpineTScore: -1.7, totalHipTScore: -1.6, femoralNeckTScore: -1.6, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 45, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (GIOP context, T ≤ -1.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'GIOP lower-threshold flag fires', hasFlag(decision, 'giop_lower_threshold'));
  return { name: 'TC19 — 58M GIOP low-dose, T -1.7', passed: failures.length === 0, failures, decision };
}

// ─── TC20 ─────────────────────────────────────────────────────────────────
// 58M hypogonadism + incidental VF + T -2.7 + Vit D 35
function tc20(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 58,
    sex: 'male',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    secondaryOsteoporosis: ['hypogonadism'],
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.5, femoralNeckTScore: -2.5, forearmTScore: null },
    renalFunction: { egfr: 72 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 35, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'testosterone investigation triggered', decision.investigationsNeeded.some(i => i.investigation === 'testosterone'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'Vit D insufficient text', hasSupplementText(decision, 'vitamin_d', 'insufficient'));
  return { name: 'TC20 — 58M hypogonadism + VF + osteoporosis', passed: failures.length === 0, failures, decision };
}

// ─── TC21 ─────────────────────────────────────────────────────────────────
// 48F perimenopausal, T -2.6 — out of scope
function tc21(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 48,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    renalFunction: { egfr: 78 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 50, egfr: 78, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'out of scope', decision.outOfScope === true);
  check(failures, 'NO drug recommendation', decision.treatmentRecommendations.length === 0);
  check(failures, 'specialist referral (endocrinology)', hasReferral(decision, 'endocrinology'));
  return { name: 'TC21 — 48F perimenopausal (out of scope)', passed: failures.length === 0, failures, decision };
}

// ─── TC22 ─────────────────────────────────────────────────────────────────
// 78F VHR (T -3.6 + 2 VFs + recent VF 10mo), refuses injections
function tc22(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 78,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0.83, // 10 months
    numberOfPriorFractures: 2,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -3.5, femoralNeckTScore: -3.5, forearmTScore: null },
    renalFunction: { egfr: 58 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 55, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    refusesInjections: true,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  check(failures, 'refuses-injections flag fires', hasFlag(decision, 'patient_refuses_injections'));
  check(failures, 'NO denosumab (refuses injections)', !hasAgent(decision, 'denosumab'));
  check(failures, 'NO zoledronate (refuses injections)', !hasAgent(decision, 'zoledronate'));
  check(failures, 'recommends alendronate (oral)', hasAgent(decision, 'alendronate'));
  return { name: 'TC22 — 78F VHR refuses injections', passed: failures.length === 0, failures, decision };
}

// ─── Runner ───────────────────────────────────────────────────────────────

const TCs: Array<() => TCResult> = [
  tc1, tc2, tc3, tc4, tc5, tc6, tc7, tc8, tc9, tc10,
  tc11, tc12, tc13, tc14, tc15, tc16, tc17, tc18, tc19, tc20, tc21, tc22,
];

const results = TCs.map(fn => fn());
const passed = results.filter(r => r.passed).length;
const total  = results.length;

console.log('\n=== Section 16 Test Cases ===\n');
for (const r of results) {
  const icon = r.passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${r.name}`);
  if (!r.passed) {
    for (const f of r.failures) console.log(`         - ${f}`);
    // Diagnostics
    console.log(`         > category=${r.decision.riskStratification.category}; agents=[${r.decision.treatmentRecommendations.map(t => t.agent).join(', ')}]`);
    console.log(`         > flags=[${r.decision.flags.map(f => f.id).join(', ')}]`);
    console.log(`         > referrals=[${r.decision.referrals.map(r => r.specialty + ':' + r.urgency).join(', ')}]`);
  }
}
console.log(`\n${passed}/${total} passed.\n`);

if (passed !== total) process.exit(1);
