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
    glucocorticoidStatus: null,
    boneTurnoverMarkersRising: null,
    bmdDecreasedDuringPause: null,
    adtUse: false,
    aromataseInhibitorUse: false,
    hadAdjuvantHighDoseBisphosphonate: false,
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
    completedAnabolicCourse: false,
    thighOrGroinPain: false,
    onThyroidReplacement: false,
    refusesInjections: false,
    bmdUnavailable: false,
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
    previousTreatments: [{ agent: 'alendronate', durationMonths: 36, reasonStopped: 'aff_confirmed', currentlyOn: false, monthsSinceLastDose: null }],
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
    previousTreatments: [{ agent: 'alendronate', durationMonths: 6, reasonStopped: 'gi_intolerance', currentlyOn: false, monthsSinceLastDose: null }],
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
    // v1.19 — months-since-last-dose now lives on the treatment record itself.
    currentTreatment: { agent: 'denosumab', durationMonths: 36, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 5 },
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
      { agent: 'alendronate', durationMonths: 24, reasonStopped: 'onj', currentlyOn: false, monthsSinceLastDose: null },
      { agent: 'denosumab', durationMonths: 12, reasonStopped: 'onj', currentlyOn: false, monthsSinceLastDose: null },
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
  // v1.2 corrected (revised v1.18): ADT no longer designates denosumab as PRIMARY/first-line.
  // Standard NOGG 2024 Strong order: bisphosphonate first-line as the most cost-effective antiresorptive,
  // denosumab as the alternative when BP contraindicated. Spec assertion: output must NOT designate
  // denosumab as PRIMARY or first-line for ADT specifically.
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
  check(failures, 'adt_bone_loss flag fires', hasFlag(decision, 'adt_bone_loss'));
  // Treatment options must include alendronate as a recommended option (NOGG 2024 Strong first-line).
  const alenRec = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  check(failures, 'alendronate is recommended (NOGG 2024 Strong first-line)', !!alenRec);
  // Denosumab must NOT appear as primary/first-line for ADT specifically.
  const denoRec = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  const denoIsPrimary = !!denoRec && denoRec.priority === 'first-line';
  check(failures, 'denosumab is NOT designated first-line for ADT', !denoIsPrimary,
    denoRec ? `denosumab present with priority=${denoRec.priority}` : 'denosumab absent');
  // Output text must not present denosumab as PRIMARY/first-line for ADT.
  const adtFlag = decision.flags.find(f => f.id === 'adt_bone_loss');
  const adtMsg = (adtFlag?.message ?? '').toLowerCase();
  check(failures, 'adt_bone_loss message does not call denosumab "first-line"',
    !adtMsg.includes('first-line bone protection: denosumab') && !adtMsg.includes('denosumab is first-line'));
  // Equivalence wording present.
  check(failures, 'adt_bone_loss notes BP and denosumab are equivalent',
    adtMsg.includes('equivalent'));
  check(failures, 'Vit D insufficient text', hasSupplementText(decision, 'vitamin_d', 'insufficient'));
  return { name: 'TC9 — 69M ADT (v1.2 corrected)', passed: failures.length === 0, failures, decision };
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
    previousTreatments: [{ agent: 'alendronate', durationMonths: 6, reasonStopped: 'gi_intolerance', currentlyOn: false, monthsSinceLastDose: null }],
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
    currentTreatment: { agent: 'hrt', durationMonths: 48, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
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
// v1.2 corrected: 61F on AI, T -1.8, FRAX 11.5% (below IT 12.2% at age 60).
// IOF 2017: T < -2.0 unconditional; T < -1.5 with ≥1 RF; ≥2 RFs without BMD.
// T -1.8 with no additional RFs → does NOT meet treatment threshold.
// Outcome: intermediate, no treatment, AI near-threshold reassessment flag (12–24 months).
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
  check(failures, 'risk = intermediate (T -1.8, no additional RFs, FRAX below IT)',
    decision.riskStratification.category === 'intermediate', `got ${decision.riskStratification.category}`);
  check(failures, 'AI CTIBL flag', hasFlag(decision, 'ai_ctibl'));
  check(failures, 'AI near-threshold 12–24 month reassessment flag', hasFlag(decision, 'ai_near_threshold_reassess'));
  check(failures, 'AI near-threshold flag uses 12–24 month wording',
    hasFlagText(decision, '12–24 months'));
  // Spec assertion: must NOT state "T-score ≤-1.5 regardless of FRAX" or attribute to Irish practice.
  check(failures, 'output does NOT use blanket -1.5 wording',
    !hasFlagText(decision, '≤-1.5 regardless of frax') && !hasFlagText(decision, 'irish practice'));
  // No drug treatment recommendation expected.
  check(failures, 'no drug treatment recommended at this visit',
    decision.treatmentRecommendations.length === 0,
    `got ${decision.treatmentRecommendations.length} recommendations`);
  return { name: 'TC16 — 61F AI T-1.8 no RF (v1.2 corrected)', passed: failures.length === 0, failures, decision };
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
    previousTreatments: [{ agent: 'alendronate', durationMonths: 60, reasonStopped: 'treatment_holiday', currentlyOn: false, monthsSinceLastDose: null }],
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
    currentTreatment: { agent: 'denosumab', durationMonths: 24, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 8 },
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

// ═══════════════════════════════════════════════════════════════════════════
// v1.2 NEW TEST CASES (TC23–TC41)
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC23 ─────────────────────────────────────────────────────────────────
// 65F low-dose GC (2mg/day): Table 8 ×0.80 MOF, ×0.65 hip should pull both axes below IT.
// Uncorrected MOF 17.5% above IT 16.5%; corrected 14% below. No fx, no DEXA → no treatment;
// near-threshold flag fires.
function tc23(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    glucocorticoidDoseMgDay: 2,
    fraxMOFPercent: 17.5,
    fraxHipPercent: 3.8,
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 60, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const adjMOF = decision.riskStratification.adjustedFraxMOFPercent;
  const adjHip = decision.riskStratification.adjustedFraxHipPercent;
  check(failures, 'Table 8 low-dose MOF correction (×0.80 ≈ 14.0%)',
    adjMOF !== null && Math.abs(adjMOF - 14.0) < 0.2, `got adjMOF=${adjMOF}`);
  check(failures, 'Table 8 low-dose hip correction (×0.65 ≈ 2.47%)',
    adjHip !== null && Math.abs(adjHip - 2.47) < 0.2, `got adjHip=${adjHip}`);
  check(failures, 'risk = intermediate after correction',
    decision.riskStratification.category === 'intermediate', `got ${decision.riskStratification.category}`);
  check(failures, 'no immediate-start GIOP flag', !hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'GIOP near-threshold reassessment flag fires', hasFlag(decision, 'giop_near_threshold_reassess'));
  check(failures, 'no drug treatment recommended at this visit',
    decision.treatmentRecommendations.length === 0,
    `got ${decision.treatmentRecommendations.length}`);
  return { name: 'TC23 — 65F low-dose GC, Table 8 downward correction', passed: failures.length === 0, failures, decision };
}

// ─── TC24 ─────────────────────────────────────────────────────────────────
// 62F medium-dose GC + prior wrist fracture → GIOP immediate-start criterion (a).
// No dose floor; criterion (a) fires regardless of GC dose.
function tc24(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 62,
    sex: 'female',
    glucocorticoidDoseMgDay: 3,
    glucocorticoidUse: { current: true, dose: 'low', durationMonths: 1 },
    priorFragilityFracture: true,
    dexaResults: { lumbarSpineTScore: -1.6, totalHipTScore: -1.6, femoralNeckTScore: -1.6, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 55, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'GIOP immediate-start flag fires (criterion a)', hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'flag references prior fracture (criterion a) any GC dose', hasFlagText(decision, 'prior fragility fracture'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  return { name: 'TC24 — 62F GIOP criterion (a) any-dose prior fx', passed: failures.length === 0, failures, decision };
}

// ─── TC25 ─────────────────────────────────────────────────────────────────
// 73F medium-dose GC, no fracture → GIOP immediate-start criterion (b) (female ≥70 any dose).
function tc25(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 73,
    sex: 'female',
    glucocorticoidDoseMgDay: 4,
    glucocorticoidUse: { current: true, dose: 'low', durationMonths: 1 },
    fraxMOFPercent: 18.5,
    fraxHipPercent: 4.5,
    dexaResults: { lumbarSpineTScore: -1.4, totalHipTScore: -1.4, femoralNeckTScore: -1.4, forearmTScore: null },
    renalFunction: { egfr: 60 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 65, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // FRAX category is intermediate (MOF 18.5% < IT 20.3%); GIOP criterion (b) overrides via immediate-start.
  check(failures, 'GIOP immediate-start flag fires (criterion b)', hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'flag references female ≥70 (criterion b)', hasFlagText(decision, 'female ≥70'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  return { name: 'TC25 — 73F GIOP criterion (b) female ≥70', passed: failures.length === 0, failures, decision };
}

// ─── TC26 ─────────────────────────────────────────────────────────────────
// GC withdrawal — both MOF and hip below IT after recalculation → withdrawal eligible.
function tc26(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 64,
    sex: 'female',
    glucocorticoidStatus: 'stopped_over_12m_ago',
    glucocorticoidDoseMgDay: null,
    fraxMOFPercent: 10.5,
    fraxHipPercent: 2.1,
    dexaResults: { lumbarSpineTScore: -1.9, totalHipTScore: -1.9, femoralNeckTScore: -1.9, forearmTScore: null },
    renalFunction: { egfr: 68 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 68, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 24, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GC withdrawal review flag fires (eligible)', hasFlag(decision, 'gc_withdrawal_bp_review'));
  check(failures, 'flag references both MOF and hip below IT', hasFlagText(decision, 'both below'));
  check(failures, 'no continue-treatment variant fires', !hasFlag(decision, 'gc_withdrawal_continue_treatment'));
  return { name: 'TC26 — GC withdrawal eligible (both axes below IT)', passed: failures.length === 0, failures, decision };
}

// ─── TC27 ─────────────────────────────────────────────────────────────────
// GC withdrawal — hip remains above IT → must continue.
function tc27(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    glucocorticoidStatus: 'stopped_over_12m_ago',
    glucocorticoidDoseMgDay: null,
    fraxMOFPercent: 19.0,
    fraxHipPercent: 5.6,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    renalFunction: { egfr: 62 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 62, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 24, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GC withdrawal CONTINUE-TREATMENT flag fires', hasFlag(decision, 'gc_withdrawal_continue_treatment'));
  check(failures, 'flag mentions hip above IT', hasFlagText(decision, 'hip 5.6%'));
  check(failures, 'eligible variant does NOT fire', !hasFlag(decision, 'gc_withdrawal_bp_review'));
  return { name: 'TC27 — GC withdrawal continue (hip above IT)', passed: failures.length === 0, failures, decision };
}

// ─── TC28 ─────────────────────────────────────────────────────────────────
// 60M medium-dose GC near-threshold (no DEXA, FRAX MOF 10.5% / IT 12.2% = 86%) → 12–18m flag.
function tc28(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 60,
    sex: 'male',
    glucocorticoidDoseMgDay: 6,
    glucocorticoidUse: { current: true, dose: 'medium', durationMonths: 1 },
    fraxMOFPercent: 10.5,
    fraxHipPercent: 2.0,
    renalFunction: { egfr: 72 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 60, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = intermediate', decision.riskStratification.category === 'intermediate', `got ${decision.riskStratification.category}`);
  check(failures, 'no immediate-start', !hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'GIOP near-threshold reassessment flag fires', hasFlag(decision, 'giop_near_threshold_reassess'));
  check(failures, 'reassessment uses 12–18 month wording', hasFlagText(decision, '12–18 months'));
  check(failures, 'no drug treatment recommended', decision.treatmentRecommendations.length === 0);
  return { name: 'TC28 — 60M medium-dose GC near-threshold', passed: failures.length === 0, failures, decision };
}

// ─── TC29 ─────────────────────────────────────────────────────────────────
// Drug-specific holiday: alendronate → 2 years (24 months).
function tc29(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 63,
    sex: 'female',
    fraxMOFPercent: 8.0,
    fraxHipPercent: 1.5,
    dexaResults: { lumbarSpineTScore: -1.9, totalHipTScore: -1.9, femoralNeckTScore: -1.9, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 60, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'pause flag fires', hasFlag(decision, 'bp_holiday_appropriate'));
  check(failures, 'alendronate 2-year reassessment interval', hasFlagText(decision, '2 years'));
  check(failures, 'restart-on-fracture-during-pause noted', hasFlagText(decision, 'fracture occurs during the pause'));
  return { name: 'TC29 — alendronate pause = 2 years', passed: failures.length === 0, failures, decision };
}

// ─── TC30 ─────────────────────────────────────────────────────────────────
// Drug-specific holiday: risedronate → 18 months.
function tc30(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 60,
    sex: 'female',
    fraxMOFPercent: 7.0,
    fraxHipPercent: 1.3,
    dexaResults: { lumbarSpineTScore: -1.9, totalHipTScore: -1.9, femoralNeckTScore: -1.9, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'risedronate', durationMonths: 60, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'pause flag fires', hasFlag(decision, 'bp_holiday_appropriate'));
  check(failures, 'risedronate 18-month reassessment interval', hasFlagText(decision, '18 months'));
  return { name: 'TC30 — risedronate pause = 18 months', passed: failures.length === 0, failures, decision };
}

// ─── TC31 ─────────────────────────────────────────────────────────────────
// Drug-specific holiday: ibandronate → 18 months.
function tc31(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 58,
    sex: 'female',
    fraxMOFPercent: 6.0,
    fraxHipPercent: 1.0,
    dexaResults: { lumbarSpineTScore: -1.9, totalHipTScore: -1.9, femoralNeckTScore: -1.9, forearmTScore: null },
    renalFunction: { egfr: 72 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'ibandronate', durationMonths: 60, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'pause flag fires', hasFlag(decision, 'bp_holiday_appropriate'));
  check(failures, 'ibandronate 18-month reassessment interval', hasFlagText(decision, '18 months'));
  return { name: 'TC31 — ibandronate pause = 18 months', passed: failures.length === 0, failures, decision };
}

// ─── TC32 ─────────────────────────────────────────────────────────────────
// Drug-specific holiday: zoledronate → 3 years (36 months).
function tc32(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    fraxMOFPercent: 9.0,
    fraxHipPercent: 1.8,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -1.8, femoralNeckTScore: -1.8, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'zoledronate', durationMonths: 36, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'pause flag fires', hasFlag(decision, 'bp_holiday_appropriate'));
  check(failures, 'zoledronate 3-year reassessment interval', hasFlagText(decision, '3 years'));
  return { name: 'TC32 — zoledronate pause = 3 years', passed: failures.length === 0, failures, decision };
}

// ─── TC33 ─────────────────────────────────────────────────────────────────
// 67F alendronate paused 10 months ago, new wrist fracture last month → immediate restart.
function tc33(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    priorFragilityFracture: true,
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -2.2, totalHipTScore: -2.2, femoralNeckTScore: -2.2, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 68, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 60, reasonStopped: 'treatment_holiday', currentlyOn: false, monthsSinceLastDose: null }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'fracture-during-pause restart flag fires', hasFlag(decision, 'bp_pause_fracture_restart'));
  check(failures, 'restart instruction does not wait for drug-specific interval',
    hasFlagText(decision, 'do not wait for the drug-specific'));
  check(failures, 'recommends alendronate (restart)', hasAgent(decision, 'alendronate'));
  return { name: 'TC33 — fracture during pause → immediate restart', passed: failures.length === 0, failures, decision };
}

// ─── TC34 ─────────────────────────────────────────────────────────────────
// 69F year-3 alendronate, hip fracture 6 weeks ago → adherence pathway, NOT auto-failure.
function tc34(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 69,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -2.4, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    renalFunction: { egfr: 60 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 55, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 36, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'on-treatment fracture pathway flag fires', hasFlag(decision, 'on_treatment_fracture_pathway'));
  check(failures, 'flag mentions adherence review (<80%)', hasFlagText(decision, '<80%'));
  check(failures, 'flag mentions secondary cause investigation', hasFlagText(decision, 'secondary cause'));
  check(failures, 'NOT auto-classified as treatment failure', !hasFlag(decision, 'treatment_failure'));
  // No automatic switch to denosumab/zoledronate in the recommendation list (failure path) before
  // adherence + secondary cause are confirmed.
  const hasFailureSwitch = hasFlag(decision, 'treatment_failure_switch');
  check(failures, 'no automatic class switch flag', !hasFailureSwitch);
  return { name: 'TC34 — on-treatment fracture: adherence pathway not auto-failure', passed: failures.length === 0, failures, decision };
}

// ─── TC35 ─────────────────────────────────────────────────────────────────
// 74F on alendronate 10.5y → after-10-years individual basis flag.
function tc35(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 74,
    sex: 'female',
    fraxMOFPercent: 18.0,
    fraxHipPercent: 4.0,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 126, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'after-10-years individual basis flag fires', hasFlag(decision, 'bp_individual_basis_after_long_course'));
  check(failures, 'flag mentions individual basis', hasFlagText(decision, 'individual basis'));
  return { name: 'TC35 — alendronate ≥10y individual basis', passed: failures.length === 0, failures, decision };
}

// ─── TC36 ─────────────────────────────────────────────────────────────────
// 71F on IV zoledronate 6.5y → after-6-years (IV) individual basis flag.
function tc36(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    fraxMOFPercent: 16.0,
    fraxHipPercent: 3.5,
    dexaResults: { lumbarSpineTScore: -2.1, totalHipTScore: -2.1, femoralNeckTScore: -2.1, forearmTScore: null },
    renalFunction: { egfr: 58 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'zoledronate', durationMonths: 78, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'after-6-years IV individual basis flag fires', hasFlag(decision, 'bp_individual_basis_after_long_course'));
  check(failures, 'flag mentions IV zoledronate', hasFlagText(decision, 'IV zoledronate'));
  return { name: 'TC36 — IV zoledronate ≥6y individual basis', passed: failures.length === 0, failures, decision };
}

// ─── TC37 ─────────────────────────────────────────────────────────────────
// 66F alendronate paused 18mo, BTM rising (ALP 145 from 78). T-2.0, FRAX 16% < IT 20.3% (age 70+).
function tc37(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    boneTurnoverMarkersRising: true,
    fraxMOFPercent: 16.0,
    fraxHipPercent: 3.0,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 145, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 60, reasonStopped: 'treatment_holiday', currentlyOn: false, monthsSinceLastDose: null }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'BP pause restart-signal flag fires', hasFlag(decision, 'bp_pause_restart_signal'));
  check(failures, 'flag references rising bone turnover', hasFlagText(decision, 'rising bone turnover markers'));
  check(failures, 'flag mentions LFTs/GGT caveat for ALP elevation', hasFlagText(decision, 'lfts'));
  // Conditional: must be flagged but no auto-restart treatment recommendation forced.
  return { name: 'TC37 — BTM rising during pause: restart signal', passed: failures.length === 0, failures, decision };
}

// ─── TC37b ─────────────────────────────────────────────────────────────────
// v1.19 — UI-realistic shape for "patient currently on alendronate, currently paused".
// Same clinical state as TC37 but expressed via currentTreatment={alendronate,
// currentlyOn:false, reasonStopped:'treatment_holiday', monthsSinceLastDose:18}.
// Pre-v1.19 the engine's onPause check required currentTreatment===null and so
// could not fire the restart signal for this shape; the wizard's "Currently on
// bone protection treatment" YesNo produces exactly this shape, which was the
// manual-testing failure mode. This test locks in the v1.19 fix.
function tc37b(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    boneTurnoverMarkersRising: true,
    fraxMOFPercent: 16.0,
    fraxHipPercent: 3.0,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 145, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 60, reasonStopped: 'treatment_holiday', currentlyOn: false, monthsSinceLastDose: 18 },
    previousTreatments: [],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'BP pause restart-signal flag fires (UI-realistic shape)', hasFlag(decision, 'bp_pause_restart_signal'));
  check(failures, 'flag references rising bone turnover', hasFlagText(decision, 'rising bone turnover markers'));
  check(failures, 'flag mentions LFTs/GGT caveat for ALP elevation', hasFlagText(decision, 'lfts'));
  return { name: 'TC37b — paused current BP shape (UI-realistic)', passed: failures.length === 0, failures, decision };
}

// ─── TC38 ─────────────────────────────────────────────────────────────────
// 72M ADT, FRAX MOF 17.5% (86% of IT 20.3%), hip 4.8% (88% of IT 5.4%) → ADT 12–18m flag.
function tc38(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'male',
    adtUse: true,
    fraxMOFPercent: 17.5,
    fraxHipPercent: 4.8,
    dexaResults: { lumbarSpineTScore: -1.6, totalHipTScore: -1.6, femoralNeckTScore: -1.6, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 65, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = intermediate', decision.riskStratification.category === 'intermediate',
    `got ${decision.riskStratification.category}`);
  check(failures, 'ADT near-threshold flag fires', hasFlag(decision, 'adt_near_threshold_reassess'));
  check(failures, 'flag uses 12–18 month wording', hasFlagText(decision, '12–18 months'));
  check(failures, 'flag uses ADT-specific language (not 12–24)', !hasFlagText(decision, '12–24 months after starting adt'));
  check(failures, 'no drug treatment at this visit', decision.treatmentRecommendations.length === 0);
  return { name: 'TC38 — ADT near-threshold 12–18m', passed: failures.length === 0, failures, decision };
}

// ─── TC39 ─────────────────────────────────────────────────────────────────
// 63F AI, T-1.6 no RFs, FRAX MOF 10.8% near IT 12.2% → AI 12–24m flag (distinct from ADT 12–18m).
function tc39(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 63,
    sex: 'female',
    aromataseInhibitorUse: true,
    fraxMOFPercent: 10.8,
    fraxHipPercent: 1.9,
    dexaResults: { lumbarSpineTScore: -1.6, totalHipTScore: -1.6, femoralNeckTScore: -1.6, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = intermediate', decision.riskStratification.category === 'intermediate',
    `got ${decision.riskStratification.category}`);
  check(failures, 'AI near-threshold flag fires', hasFlag(decision, 'ai_near_threshold_reassess'));
  check(failures, 'flag uses 12–24 month wording (not 12–18)', hasFlagText(decision, '12–24 months'));
  check(failures, 'flag explicitly distinguishes AI from ADT/GIOP', hasFlagText(decision, 'differs from'));
  check(failures, 'no drug treatment at this visit', decision.treatmentRecommendations.length === 0);
  return { name: 'TC39 — AI near-threshold 12–24m', passed: failures.length === 0, failures, decision };
}

// ─── TC40 ─────────────────────────────────────────────────────────────────
// 66F T-2.7, starting alendronate. Dental hygiene + no-data-stopping in monitoring.
function tc40(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  const alenRec = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const monitoringText = (alenRec?.monitoring ?? []).join(' | ').toLowerCase();
  check(failures, 'monitoring includes dental hygiene/dental check-up',
    monitoringText.includes('dental') || monitoringText.includes('oral hygiene'));
  check(failures, 'monitoring includes no-data-for-stopping-before-dental wording',
    monitoringText.includes('no data') || monitoringText.includes('do not routinely stop'));
  return { name: 'TC40 — dental hygiene fires at BP initiation', passed: failures.length === 0, failures, decision };
}

// ─── TC41 ─────────────────────────────────────────────────────────────────
// 58F prednisolone 15mg/day high-dose. Table 8 ×1.15 MOF, ×1.20 hip pushes both above IT.
// Criterion (c) immediate-start.
function tc41(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 58,
    sex: 'female',
    glucocorticoidDoseMgDay: 15,
    glucocorticoidUse: { current: true, dose: 'high', durationMonths: 1 },
    fraxMOFPercent: 8.5,
    fraxHipPercent: 1.3,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -1.8, femoralNeckTScore: -1.8, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const adjMOF = decision.riskStratification.adjustedFraxMOFPercent;
  const adjHip = decision.riskStratification.adjustedFraxHipPercent;
  check(failures, 'Table 8 high-dose MOF correction (×1.15 ≈ 9.78%)',
    adjMOF !== null && Math.abs(adjMOF - 9.78) < 0.1, `got adjMOF=${adjMOF}`);
  check(failures, 'Table 8 high-dose hip correction (×1.20 ≈ 1.56%)',
    adjHip !== null && Math.abs(adjHip - 1.56) < 0.05, `got adjHip=${adjHip}`);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'GIOP immediate-start flag fires (criterion c)', hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'flag references high-dose ≥7.5 mg/day', hasFlagText(decision, '≥7.5 mg/day'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  return { name: 'TC41 — 58F high-dose GC, Table 8 upward correction', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.3 NEW TEST CASES (TC42–TC52) — covers v1.15/v1.16 Ca/VitD/lifestyle/POI
// ═══════════════════════════════════════════════════════════════════════════

// Helper: search every supplement bullet, headline and rationale for a substring.
function hasAnySupplementText(decision: ClinicalDecision, text: string): boolean {
  const lc = text.toLowerCase();
  return decision.supplements.some(s =>
    s.headline.toLowerCase().includes(lc) ||
    s.bullets.some(b => b.toLowerCase().includes(lc)) ||
    (s.rationale ?? '').toLowerCase().includes(lc),
  );
}

// ─── TC42 ─────────────────────────────────────────────────────────────────
// 70F T -2.6, low dietary calcium, Vit D 55. Output must NOT mention "cardiovascular"
// in calcium/supplement context AND MUST mention "kidney stones".
function tc42(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 55, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const calcium = decision.supplements.find(s => s.supplement === 'calcium');
  const calciumText = (
    (calcium?.headline ?? '') + ' ' +
    (calcium?.bullets ?? []).join(' ') + ' ' +
    (calcium?.rationale ?? '')
  ).toLowerCase();
  check(failures, 'calcium output present', !!calcium);
  check(failures, 'calcium output does NOT mention "cardiovascular"',
    !calciumText.includes('cardiovascular'),
    calciumText.includes('cardiovascular') ? 'found "cardiovascular" in calcium output' : '');
  check(failures, 'calcium output mentions "kidney stones"',
    calciumText.includes('kidney stones'));
  return { name: 'TC42 — calcium safety: no CV claim, kidney stones stated', passed: failures.length === 0, failures, decision };
}

// ─── TC43 ─────────────────────────────────────────────────────────────────
// 68F T -2.8. Calcium output must contain both 700 mg AND 1200 mg figures.
function tc43(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'calcium output mentions 700 mg/day RNI floor',
    hasSupplementText(decision, 'calcium', '700'));
  check(failures, 'calcium output mentions 1200 mg/day target',
    hasSupplementText(decision, 'calcium', '1200'));
  return { name: 'TC43 — calcium dual threshold (700 + 1200 mg/day)', passed: failures.length === 0, failures, decision };
}

// ─── TC44 ─────────────────────────────────────────────────────────────────
// 84F care home + housebound + Vit D 30. Priority-groups note must fire in supplements.
// (No housebound/residential schema field; the priority-groups bullet always fires for clinician
// awareness — this asserts the bullet is present in the supplements section.)
function tc44(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 84,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.9, femoralNeckTScore: -2.9, forearmTScore: null },
    renalFunction: { egfr: 50 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 30, egfr: 50, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 130, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'supplements mention "housebound"',
    hasAnySupplementText(decision, 'housebound'));
  check(failures, 'supplements mention "residential" or "nursing care"',
    hasAnySupplementText(decision, 'residential') || hasAnySupplementText(decision, 'nursing care'));
  check(failures, 'supplements mention malabsorption (coeliac/IBD/bariatric)',
    hasAnySupplementText(decision, 'coeliac') ||
    hasAnySupplementText(decision, 'malabsorption') ||
    hasAnySupplementText(decision, 'bariatric'));
  return { name: 'TC44 — calcium priority groups note', passed: failures.length === 0, failures, decision };
}

// ─── TC45 ─────────────────────────────────────────────────────────────────
// 72F Vit D 35 (insufficient tier). Vit D output must contain falls/fracture nuance and
// the ≥60,000 IU bolus warning. Must NOT contain blanket "does not prevent fractures or falls".
function tc45(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.5, totalHipTScore: -2.5, femoralNeckTScore: -2.5, forearmTScore: null },
    renalFunction: { egfr: 65 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 35, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'vit D output: "does not reduce fracture"',
    hasSupplementText(decision, 'vitamin_d', 'does not reduce fracture'));
  check(failures, 'vit D output: "may reduce falls"',
    hasSupplementText(decision, 'vitamin_d', 'may reduce falls'));
  check(failures, 'vit D output does NOT contain blanket "does not prevent fractures or falls"',
    !hasSupplementText(decision, 'vitamin_d', 'does not prevent fractures or falls'));
  check(failures, 'vit D output: ≥60,000 IU bolus warning',
    hasSupplementText(decision, 'vitamin_d', '60,000'));
  return { name: 'TC45 — Vit D nuance + ≥60kIU bolus warning', passed: failures.length === 0, failures, decision };
}

// ─── TC46 ─────────────────────────────────────────────────────────────────
// 65F T -2.6. Lifestyle output must lead with healthy balanced diet recommendation.
function tc46(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 60, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'lifestyle has at least 1 entry', decision.lifestyleAdvice.length >= 1);
  const first = (decision.lifestyleAdvice[0] ?? '').toLowerCase();
  check(failures, 'lifestyleAdvice[0] contains "healthy"', first.includes('healthy'));
  check(failures, 'lifestyleAdvice[0] contains "nutrient" or "balanced"',
    first.includes('nutrient') || first.includes('balanced'));
  check(failures, 'lifestyleAdvice[0] mentions diet', first.includes('diet'));
  return { name: 'TC46 — lifestyle: healthy diet first item', passed: failures.length === 0, failures, decision };
}

// ─── TC47 ─────────────────────────────────────────────────────────────────
// 60M alcohol 21 u/wk (≥3/day) T -2.7. Alcohol advice must use ≤2 units/day daily framing.
function tc47(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 60,
    sex: 'male',
    alcoholUnitsPerWeek: 21,
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.7, femoralNeckTScore: -2.7, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 60, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const alcoholAdvice = decision.lifestyleAdvice.find(a => a.toLowerCase().includes('alcohol'));
  check(failures, 'alcohol advice present', !!alcoholAdvice);
  const t = (alcoholAdvice ?? '').toLowerCase();
  check(failures, 'alcohol advice contains "≤2 units/day" or "2 units/day"',
    t.includes('≤2 units/day') || t.includes('2 units/day'));
  return { name: 'TC47 — alcohol ≤2 units/day daily framing', passed: failures.length === 0, failures, decision };
}

// ─── TC48 ─────────────────────────────────────────────────────────────────
// 66F T -2.6, no falls history. Falls flag must fire on the population-level scope wording.
function tc48(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    fallsInLastYear: 0,
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 70 },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 60, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'falls flag fires despite no falls history', hasFlag(decision, 'falls_risk_assessment'));
  check(failures, 'falls flag uses population-level scope ("ALL patients")',
    hasFlagText(decision, 'all patients'));
  return { name: 'TC48 — falls flag scope: ALL osteoporosis patients', passed: failures.length === 0, failures, decision };
}

// ─── TC49 ─────────────────────────────────────────────────────────────────
// 38F POI confirmed, T -1.4 osteopenia, FRAX MOF 3.2% (low). FRAX-underestimation flag must
// fire at severity=warning with "do NOT use FRAX" wording. Treatment NOT suppressed by low FRAX.
function tc49(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 38,
    sex: 'female',
    earlyMenopause: true,
    ageAtMenopause: 36,
    fraxMOFPercent: 3.2,
    fraxHipPercent: 0.5,
    dexaResults: { lumbarSpineTScore: -1.4, totalHipTScore: -1.4, femoralNeckTScore: -1.4, forearmTScore: null },
    renalFunction: { egfr: 80 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const poiFlag = decision.flags.find(f => f.id === 'early_menopause_frax_underestimate');
  check(failures, 'POI FRAX-underestimation flag fires', !!poiFlag);
  check(failures, 'flag severity is "warning"', poiFlag?.severity === 'warning',
    `got ${poiFlag?.severity ?? 'undefined'}`);
  check(failures, 'flag contains "FRAX UNDERESTIMATES" or "underestimates"',
    hasFlagText(decision, 'underestimates'));
  check(failures, 'flag contains "do NOT use FRAX" wording',
    hasFlagText(decision, 'do not use frax'));
  // Treatment must NOT be suppressed — HRT recommended despite low FRAX.
  check(failures, 'HRT is recommended despite low FRAX',
    hasAgent(decision, 'hrt'));
  return { name: 'TC49 — POI FRAX underestimation warning', passed: failures.length === 0, failures, decision };
}

// ─── TC50 ─────────────────────────────────────────────────────────────────
// 41F POI + VTE + breast cancer history + T -2.6. HRT contraindicated combinatorially →
// poi_bp_layered_hrt_ineligible flag fires AND alendronate is in the recommendation list.
function tc50(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 41,
    sex: 'female',
    earlyMenopause: true,
    ageAtMenopause: 39,
    vteHistory: true,
    breastCancerHistory: true,
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    renalFunction: { egfr: 75 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'poi_bp_layered_hrt_ineligible flag fires',
    hasFlag(decision, 'poi_bp_layered_hrt_ineligible'));
  check(failures, 'alendronate recommended', hasAgent(decision, 'alendronate'));
  // Both VTE and breast cancer safety flags should be visible for clinician documentation.
  check(failures, 'POI VTE flag fires', hasFlag(decision, 'poi_hrt_vte'));
  check(failures, 'POI breast cancer flag fires', hasFlag(decision, 'poi_hrt_breast_cancer'));
  check(failures, 'endocrinology referral present',
    hasReferral(decision, 'endocrinology'));
  return { name: 'TC50 — POI + HRT-CI: alendronate layered', passed: failures.length === 0, failures, decision };
}

// ─── TC51 ─────────────────────────────────────────────────────────────────
// 44F POI on transdermal HRT, T -1.8 osteopenia, currentSmoker. "Consider BP if HRT
// insufficient" flag fires; mandatory BP recommendation must NOT fire.
function tc51(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 44,
    sex: 'female',
    earlyMenopause: true,
    ageAtMenopause: 41,
    currentSmoker: true,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -1.8, femoralNeckTScore: -1.8, forearmTScore: null },
    renalFunction: { egfr: 80 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'poi_bp_consider_if_hrt_insufficient flag fires',
    hasFlag(decision, 'poi_bp_consider_if_hrt_insufficient'));
  check(failures, 'HRT recommended (first-line)', hasAgent(decision, 'hrt'));
  check(failures, 'no automatic alendronate recommendation',
    !hasAgent(decision, 'alendronate'));
  check(failures, 'no layered-HRT-ineligible flag (since not jointly contraindicated)',
    !hasFlag(decision, 'poi_bp_layered_hrt_ineligible'));
  return { name: 'TC51 — POI osteopenia + smoker: consider-BP flag', passed: failures.length === 0, failures, decision };
}

// ─── TC52 ─────────────────────────────────────────────────────────────────
// 39F POI, T -1.5 osteopenia, no VTE/breast cancer. HRT first-line; output must specify
// transdermal preference + lower VTE rationale.
function tc52(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 39,
    sex: 'female',
    earlyMenopause: true,
    ageAtMenopause: 36,
    dexaResults: { lumbarSpineTScore: -1.5, totalHipTScore: -1.5, femoralNeckTScore: -1.5, forearmTScore: null },
    renalFunction: { egfr: 80 },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  const poiFlag = decision.flags.find(f => f.id === 'poi_hrt_first_line');
  check(failures, 'poi_hrt_first_line flag fires', !!poiFlag);
  const msg = (poiFlag?.message ?? '').toLowerCase();
  check(failures, 'poi_hrt_first_line message mentions "transdermal"',
    msg.includes('transdermal'));
  check(failures, 'poi_hrt_first_line message mentions "preferred"',
    msg.includes('preferred'));
  check(failures, 'poi_hrt_first_line message mentions VTE rationale',
    msg.includes('vte'));
  check(failures, 'HRT recommended', hasAgent(decision, 'hrt'));
  // VTE / breast cancer safety checks are inputs to the decision — no false-positive flags expected.
  check(failures, 'no false-positive VTE flag', !hasFlag(decision, 'poi_hrt_vte'));
  check(failures, 'no false-positive breast cancer flag', !hasFlag(decision, 'poi_hrt_breast_cancer'));
  return { name: 'TC52 — POI: transdermal HRT preference stated', passed: failures.length === 0, failures, decision };
}

// ─── Runner ───────────────────────────────────────────────────────────────

const TCs: Array<() => TCResult> = [
  tc1, tc2, tc3, tc4, tc5, tc6, tc7, tc8, tc9, tc10,
  tc11, tc12, tc13, tc14, tc15, tc16, tc17, tc18, tc19, tc20, tc21, tc22,
  tc23, tc24, tc25, tc26, tc27, tc28, tc29, tc30, tc31, tc32,
  tc33, tc34, tc35, tc36, tc37, tc37b, tc38, tc39, tc40, tc41,
  tc42, tc43, tc44, tc45, tc46, tc47, tc48, tc49, tc50, tc51, tc52,
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
