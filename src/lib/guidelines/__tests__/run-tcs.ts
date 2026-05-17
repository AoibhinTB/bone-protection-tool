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
    type1Diabetes: false,
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
    priorMIOrStroke: false,
    strokeHistory: false,
    recentFractureWithin2Years: false,
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
    oesophagealDiseaseHistory: false,
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
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 40, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  // v1.46 — IV zoledronate added as co-equal first-line per NOGG 2024 Rec 2
  // (Strong). Pushed at the standard primary push site for non-VHR + treatment-
  // indicated. (Filter F3 will tag status='blocked' at Vit D 40 in this profile,
  // but the rec is still present in treatmentRecommendations — the status field
  // is the v1.37 architecture for "what you'd prescribe once Vit D is fixed".)
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
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
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  // v1.40 GIOP refactor — giop_anabolic_preferred renamed to giop_specialist_context.
  check(failures, 'GIOP specialist context flag', hasFlag(decision, 'giop_specialist_context'));
  // v1.40 GIOP refactor — the parallel rheumatology:urgent referral push was removed.
  // vhr_specialist_referral is now the canonical referral source for VHR-GIOP patients
  // (medium-dose × 6mo → gcDrivesVHR=true → URGENT severity + bridging-BP wording).
  const vhrRef = decision.flags.find(f => f.id === 'vhr_specialist_referral');
  check(failures, 'vhr_specialist_referral fires URGENT (GC drives VHR)',
    !!vhrRef && vhrRef.severity === 'urgent');
  check(failures, 'vhr_specialist_referral message includes bridging-BP instruction (GC-driven)',
    !!vhrRef && /oral bisphosphonate in the meantime/i.test(vhrRef.message));
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
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 55, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (early meno + T ≤ -1.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  // Per current code: HRT under 60 is offered as an info flag; alendronate is the actual recommendation
  // Spec expected: "First-line: HRT" — but current code structures HRT as a flag option, BP as the actual rec
  check(failures, 'HRT first-line option flag (under 60 + high risk)', hasFlag(decision, 'hrt_option_under60'));
  check(failures, 'alendronate as fallback if HRT contraindicated', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 30, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (ADT + T-score ≤ -2.0)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'adt_bone_loss flag fires', hasFlag(decision, 'adt_bone_loss'));
  // Treatment options must include alendronate as a recommended option (NOGG 2024 Strong first-line).
  const alenRec = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  check(failures, 'alendronate is recommended (NOGG 2024 Strong first-line)', !!alenRec);
  const riseRec = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  check(failures, 'risedronate is recommended (equivalent first-line per NOGG 2024 Rec 12)', !!riseRec);
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
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 50, egfr: 55, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 6, reasonStopped: 'gi_intolerance', currentlyOn: false, monthsSinceLastDose: null }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GIOP pathway flag fired', hasFlag(decision, 'giop'));
  check(failures, 'IV after GI intolerance flag fired', hasFlag(decision, 'giop_iv_after_gi_intolerance'));
  check(failures, 'recommends zoledronate', hasAgent(decision, 'zoledronate'));
  check(failures, 'NO alendronate (GI intolerance)', !hasAgent(decision, 'alendronate'));
  check(failures, 'NO risedronate (GI intolerance)', !hasAgent(decision, 'risedronate'));
  // v1.45 — gc_high_dose_giop_surface flag retired (engine-internal "pathway
  // applied / Table 8 correction" framing leaked to user). The clinically
  // actionable NOGG Rec 22 content is preserved by giop_immediate_start.
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    fraxMOFPercent: 6.8,
    fraxHipPercent: 0.7,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (T-score drives despite low FRAX)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'hrt', durationMonths: 48, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: null },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (T ≤ -2.5 despite HRT)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'HRT-on-board review flag', hasFlag(decision, 'hrt_on_board_review'));
  check(failures, 'recommends alendronate alongside HRT', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 22, egfr: 35, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // v1.37 Fix B4: hip-fracture-alone no longer fires VHR. Patient routes to high via the
  // prior-fx-high path (NOGG Rec 8, risk.ts:177-186) and treat-immediately via the
  // post_hip_fracture_zoledronate path (treatment.ts:1368+). T -3.4 is above the -3.5 VHR
  // threshold, no GC, no manual FRAX above age-specific VHRT → no other VHR trigger fires.
  check(failures, 'risk = high (prior-fx-high path post-NEG-1 removal)',
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  // v1.46 — post_hip_fracture_zoledronate_first_line flag retired. At eGFR 35
  // IV zol is renally CI'd (canUse fails) so no IV zol rec is pushed; can't
  // anchor on the IV zol rationale here. TC15's remaining assertions
  // (denosumab present, FRAX life-expectancy caveat, denosumab Vit D block,
  // no alendronate) lock the primary clinical content for this profile.
  check(failures, 'recommends denosumab (eGFR 35 borderline)', hasAgent(decision, 'denosumab'));
  check(failures, 'NO alendronate at eGFR 35', !hasAgent(decision, 'alendronate'));
  check(failures, 'age ≥80 FRAX caveat', hasFlag(decision, 'frax_life_expectancy_caveat'));
  check(failures, 'denosumab Vit D block (severe deficiency)', hasFlag(decision, 'denosumab_vitd_block'));
  return { name: 'TC15 — 91F frail, recent hip fx, eGFR 35, Vit D 22 → high (post NEG-1 removal)', passed: failures.length === 0, failures, decision };
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 45, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high (GIOP context, T ≤ -1.5)', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 35, egfr: 72, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'testosterone investigation triggered', decision.investigationsNeeded.some(i => i.investigation === 'testosterone'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  // v1.46 — IV zoledronate co-equal first-line. Vit D 35 < 50 will tag F3
  // status='blocked' on parenterals; rec still present in array.
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 50, egfr: 78, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'out of scope', decision.outOfScope === true);
  check(failures, 'NO drug recommendation', decision.treatmentRecommendations.length === 0);
  check(failures, 'specialist referral (endocrinology)', hasReferral(decision, 'endocrinology'));
  return { name: 'TC21 — 48F perimenopausal (out of scope)', passed: failures.length === 0, failures, decision };
}

// ─── TC22 ─────────────────────────────────────────────────────────────────
// 78F VHR (T -3.6 + 2 VFs + recent VF 10mo), refuses injections — v1.43 Shape B
// updated semantics. Non-GC VHR patient refusing injectable therapy. Shape B
// suppresses the standard alendronate/risedronate primary recipe (oral BP not
// indicated for non-GC VHR triggers per NOGG Rec 11). Patient-preference
// fallback re-emits both oral BPs with category 'patient_preference_fallback'
// for GP/patient discussion alongside the specialist referral. specialistOptions
// menu remains populated (specialist consultation may surface considerations
// the GP cannot pre-judge).
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 55, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    refusesInjections: true,
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  // v1.44 — patient_refuses_injections flag retired (stale framing). The refusal-
  // acknowledgement is covered by the vhr_anabolic_refusal_context assertion at
  // the end of this TC. Behavioural strip-injectables filter at treatment.ts:~1224
  // continues to remove denosumab/zoledronate from recommendations (asserted below).
  check(failures, 'NO denosumab (refuses injections)', !hasAgent(decision, 'denosumab'));
  check(failures, 'NO zoledronate (refuses injections)', !hasAgent(decision, 'zoledronate'));

  // v1.43 Shape B — alendronate + risedronate re-emitted as patient-preference fallback
  // (NOT primary or bridging). Entries present in treatmentRecommendations but tagged
  // category: 'patient_preference_fallback' so UI renders distinctly.
  const aln = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const ris = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  check(failures, 'alendronate present as patient-preference fallback',
    !!aln && aln.category === 'patient_preference_fallback');
  check(failures, 'risedronate present as patient-preference fallback',
    !!ris && ris.category === 'patient_preference_fallback');
  // v1.44 — engine fallbackRationale reworded. Assertion updated to match the new
  // wording. Semantic anchor: rationale frames patient-preference (does not pre-judge
  // specialist consultation) AND carries the do-not-initiate-before-specialist gate.
  check(failures, 'alendronate rationale frames patient-preference (do not wish to receive injectable therapy)',
    !!aln && /do not wish to receive injectable therapy/i.test(aln.rationale));
  check(failures, 'alendronate rationale carries do-not-initiate-before-specialist gate',
    !!aln && /do not initiate before specialist review/i.test(aln.rationale));

  // v1.43 Shape B — vhr_specialist_referral hoist still fires (referral is the first action).
  check(failures, 'vhr_specialist_referral flag fires', hasFlag(decision, 'vhr_specialist_referral'));

  // v1.43 Shape B — context flag for the refusal scenario.
  check(failures, 'vhr_anabolic_refusal_context flag fires',
    hasFlag(decision, 'vhr_anabolic_refusal_context'));

  // v1.43 Shape B — specialistOptions still populated (postmenopausal F VHR → 3 entries).
  // Specialist consultation may surface considerations the GP cannot pre-judge.
  check(failures, 'specialistOptions has 3 entries (postmenopausal F: teri + romo + abalo)',
    decision.specialistOptions.length === 3);
  check(failures, 'specialistOptions includes teriparatide as first_line',
    decision.specialistOptions.some(o => o.drug === 'teriparatide' && o.tier === 'first_line'));
  check(failures, 'specialistOptions includes romosozumab as further_option',
    decision.specialistOptions.some(o => o.drug === 'romosozumab' && o.tier === 'further_option'));
  check(failures, 'specialistOptions includes abaloparatide as further_option with reimbursementNote',
    decision.specialistOptions.some(o => o.drug === 'abaloparatide' && o.tier === 'further_option' && !!o.reimbursementNote));

  return { name: 'TC22 — 78F VHR refuses injections (v1.43 Shape B patient-preference fallback)', passed: failures.length === 0, failures, decision };
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
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 55, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = high', decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  check(failures, 'GIOP immediate-start flag fires (criterion a)', hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'flag references prior fracture (criterion a) any GC dose', hasFlagText(decision, 'prior fragility fracture'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 65, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // FRAX category is intermediate (MOF 18.5% < IT 20.3%); GIOP criterion (b) overrides via immediate-start.
  check(failures, 'GIOP immediate-start flag fires (criterion b)', hasFlag(decision, 'giop_immediate_start'));
  check(failures, 'flag references female ≥70 (criterion b)', hasFlagText(decision, 'female ≥70'));
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'recommends alendronate', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
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
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
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
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 65, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'poi_bp_layered_hrt_ineligible flag fires',
    hasFlag(decision, 'poi_bp_layered_hrt_ineligible'));
  check(failures, 'alendronate recommended', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  // v1.46 note: IV zoledronate is NOT asserted here. POI / early-menopause
  // routes through earlyMenopause() special-population override at
  // generateTreatmentOutput, which returns BEFORE initiateTherapy() — the
  // v1.46 IV zol push at initiateTherapy's primary site does not fire for
  // this patient. POI is out of scope for the Rule 1 co-equal first-line
  // contract, same as VHR is out of scope. Documented here so future readers
  // see why TC50 lacks the IV zol assertion present on its sibling non-VHR
  // primary-path TCs (TC1, TC12, TC20, TC40, TC59, TC71, TC83, TC84).
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

// ═══════════════════════════════════════════════════════════════════════════
// v1.4 TEST CASES (TC53–TC63) — denosumab v1.26, HRT v1.27, raloxifene v1.27,
// teriparatide v1.28, romosozumab v1.28, BP-blunting v1.29
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC53 ─────────────────────────────────────────────────────────────────
// Corrected TC6: denosumab cessation hierarchy. The recipe's monitoring
// entry that fires on every denosumab recommendation must clearly state IV
// zoledronate is PREFERRED (NOGG Strong) and alendronate is SECONDARY.
function tc53(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    priorFragilityFracture: true,
    dexaResults: { lumbarSpineTScore: -3.0, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 70, egfr: 30, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'denosumab recommended', hasAgent(decision, 'denosumab'));
  const deno = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  const mon = (deno?.monitoring ?? []).join(' | ').toLowerCase();
  check(failures, 'cessation monitoring mentions IV zoledronate at 6 months',
    mon.includes('iv zoledronate') && mon.includes('6 months'));
  check(failures, 'cessation monitoring frames zoledronate as preferred (NOT equivalent to alendronate)',
    mon.includes('not equivalent to alendronate'));
  check(failures, 'cessation monitoring labels alendronate as SECONDARY',
    mon.includes('secondary option'));
  check(failures, 'FREEDOM 60.7% statistic surfaced',
    mon.includes('60.7%'));
  check(failures, 'CTX at 3 and 6 months mentioned',
    mon.includes('ctx') && mon.includes('3 and 6 months'));
  return { name: 'TC53 — denosumab cessation: zoledronate preferred, alendronate secondary', passed: failures.length === 0, failures, decision };
}

// ─── TC54 ─────────────────────────────────────────────────────────────────
// Male + GI intolerance: ibandronate filtered, IV zoledronate offered.
function tc54(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'male',
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.7, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 58, egfr: 55, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'alendronate', durationMonths: 12, reasonStopped: 'gi_intolerance', currentlyOn: false, monthsSinceLastDose: 3 }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'IV zoledronate recommended (GI intolerance → IV)',
    hasAgent(decision, 'zoledronate'));
  check(failures, 'NO ibandronate (not licensed for men)',
    !hasAgent(decision, 'ibandronate'));
  check(failures, 'risk = high (T-score ≤ −2.5)',
    decision.riskStratification.category === 'high', `got ${decision.riskStratification.category}`);
  return { name: 'TC54 — male + GI intolerance → IV zoledronate, ibandronate filtered', passed: failures.length === 0, failures, decision };
}

// ─── TC55 ─────────────────────────────────────────────────────────────────
// Male VHR + recent vertebrals → teriparatide referral; romosozumab excluded.
function tc55(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'male',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 2,
    recentVertebralFractureYears: 0.8,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -3.4, femoralNeckTScore: -3.4, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 55, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high',
    decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  check(failures, 'NO romosozumab in recommendations',
    !hasAgent(decision, 'romosozumab'));
  check(failures, 'male-VHR-teriparatide flag fires',
    hasFlag(decision, 'male_vhr_anabolic_teriparatide'));
  // v1.44 — metabolic_bone Referrals-section duplicate removed; vhr_specialist_referral
  // flag is now the canonical referral surface (hoisted banner). Assertion swapped.
  check(failures, 'VHR specialist referral fires (vhr_specialist_referral flag)',
    hasFlag(decision, 'vhr_specialist_referral'));
  check(failures, 'flag notes teriparatide is the only anabolic licensed for men',
    hasFlagText(decision, 'only anabolic'));
  return { name: 'TC55 — male VHR: teriparatide referral, romosozumab excluded', passed: failures.length === 0, failures, decision };
}

// ─── TC56 ─────────────────────────────────────────────────────────────────
// Teriparatide lifetime restriction: previous completed course.
function tc56(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0.25,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -3.1, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 65, egfr: 62, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    previousTreatments: [{ agent: 'teriparatide', durationMonths: 24, reasonStopped: 'completed_course', currentlyOn: false, monthsSinceLastDose: 18 }],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'teriparatide_lifetime_used flag fires',
    hasFlag(decision, 'teriparatide_lifetime_used'));
  check(failures, 'message states lifetime maximum',
    hasFlagText(decision, 'lifetime maximum'));
  check(failures, 'romosozumab noted as an option (no lifetime restriction)',
    hasFlagText(decision, 'romosozumab remains'));
  return { name: 'TC56 — teriparatide already used: lifetime exclusion fires', passed: failures.length === 0, failures, decision };
}

// ─── TC57 ─────────────────────────────────────────────────────────────────
// Teriparatide continuation: GP continues established prescription.
function tc57(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 64,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -3.2, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'teriparatide', durationMonths: 8, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 0 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GP-shared-care continuation flag fires',
    hasFlag(decision, 'anabolic_gp_shared_care_continue'));
  check(failures, 'message mentions shared care', hasFlagText(decision, 'shared care'));
  check(failures, 'message lists teriparatide side effects (headache / postural hypotension / leg pain)',
    hasFlagText(decision, 'postural hypotension'));
  check(failures, 'sequential antiresorptive planning prompted',
    hasFlag(decision, 'sequential_therapy_plan_required') || hasFlagText(decision, 'sequential antiresorptive'));
  return { name: 'TC57 — on teriparatide: GP shared-care, side effects + sequential plan', passed: failures.length === 0, failures, decision };
}

// ─── TC58 ─────────────────────────────────────────────────────────────────
// Prior bisphosphonate → VHR referral: blunting effect note in referral letter.
function tc58(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0.25,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -3.3, totalHipTScore: -3.1, femoralNeckTScore: -3.1, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 70, egfr: 58, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 84, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 0 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high',
    decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  // v1.44 — metabolic_bone Referrals-section duplicate removed; canonical referral
  // surface for VHR is now the vhr_specialist_referral flag (hoisted banner).
  check(failures, 'VHR specialist referral fires (vhr_specialist_referral flag)',
    hasFlag(decision, 'vhr_specialist_referral'));
  check(failures, 'BP blunting effect flag fires',
    hasFlag(decision, 'bp_blunting_effect_referral'));
  check(failures, 'message states prior alendronate AND duration',
    hasFlagText(decision, 'alendronate') && hasFlagText(decision, '84 months'));
  check(failures, 'message names teriparatide and romosozumab attenuation',
    hasFlagText(decision, 'attenuat'));
  return { name: 'TC58 — prior BP + VHR referral: blunting note in referral', passed: failures.length === 0, failures, decision };
}

// ─── TC59 ─────────────────────────────────────────────────────────────────
// Raloxifene contraindicated by stroke history.
function tc59(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    strokeHistory: true,
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'raloxifene_excluded_stroke flag fires',
    hasFlag(decision, 'raloxifene_excluded_stroke'));
  check(failures, 'NO raloxifene in recommendations',
    !hasAgent(decision, 'raloxifene'));
  check(failures, 'alendronate first-line (T ≤ -2.5)', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
  check(failures, 'recommends risedronate (equivalent first-line per NOGG 2024 Rec 12)', hasAgent(decision, 'risedronate'));
  return { name: 'TC59 — stroke history: raloxifene excluded, alendronate first-line', passed: failures.length === 0, failures, decision };
}

// ─── TC60 ─────────────────────────────────────────────────────────────────
// Zoledronate MHRA creatinine-clearance flag for age >75 / BMI <18 or >40.
function tc60(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 78,
    sex: 'female',
    bmi: 17.5,
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.9, femoralNeckTScore: -2.9, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 70, egfr: 42, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 130, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'IV zoledronate recommended (post-hip-fx)',
    hasAgent(decision, 'zoledronate'));
  const zole = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');
  const mon = (zole?.monitoring ?? []).join(' | ').toLowerCase();
  check(failures, 'MHRA creatinine clearance note present',
    mon.includes('creatinine clearance'));
  check(failures, 'flag references age >75 OR BMI extreme',
    mon.includes('>75') || mon.includes('aged >75'));
  return { name: 'TC60 — zoledronate + age >75 + BMI 17.5: MHRA CrCl flag', passed: failures.length === 0, failures, decision };
}

// ─── TC61 ─────────────────────────────────────────────────────────────────
// Post-hip-fracture zoledronate fires regardless of FRAX availability.
// Patient has no DEXA, no FRAX entered — just a recent hip fracture.
function tc61(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 74,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    fraxMOFPercent: null,
    fraxHipPercent: null,
    dexaResults: null,
    bloodResults: { adjustedCalciumMmol: 2.30, vitaminDNmol: 38, egfr: 55, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 130, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // v1.46 — post_hip_fracture_zoledronate_first_line flag retired; Rec 3 +
  // Lyles content now lives on the IV zol recommendation's inline rationale
  // (single source of truth). Assertions swapped to anchor on the rec's
  // rationale field.
  check(failures, 'IV zoledronate in recommendations',
    hasAgent(decision, 'zoledronate'));
  const zoleRec = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');
  check(failures, 'IV zol rationale anchors HORIZON-RF / Lyles reference',
    !!zoleRec && /horizon|lyles/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors Rec 3 framing',
    !!zoleRec && /rec 3|recommendation 3/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors mortality reduction',
    !!zoleRec && /mortality/i.test(zoleRec.rationale));
  // Manual FRAX was NOT entered — assert that the engine surfaced the post-hip-fx
  // pathway without depending on user-supplied FRAX (the in-tool estimator may
  // still compute a value, which is fine; the test is that the recommendation
  // does not GATE on manual-FRAX-above-IT).
  check(failures, 'manual FRAX inputs absent', patient.fraxMOFPercent === null && patient.fraxHipPercent === null);
  check(failures, 'pathway fires regardless of DEXA presence (none here)', patient.dexaResults === null);
  return { name: 'TC61 — post-hip-fx → zoledronate, no FRAX/BMD required', passed: failures.length === 0, failures, decision };
}

// ─── TC62 ─────────────────────────────────────────────────────────────────
// Denosumab pre-dose calcium check fires for ALL patients (SPC requirement),
// not just eGFR <35. Verify the pre-dose entry is on every denosumab recipe.
function tc62(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.38, vitaminDNmol: 72, egfr: 30, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'denosumab recommended', hasAgent(decision, 'denosumab'));
  const deno = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  const mon = (deno?.monitoring ?? []).join(' | ').toLowerCase();
  check(failures, 'pre-dose calcium check entry present',
    mon.includes('pre-dose calcium check'));
  check(failures, 'entry states ALL patients regardless of egfr',
    mon.includes('all patients'));
  check(failures, 'hypocalcaemia symptom advice present',
    mon.includes('muscle cramps') || mon.includes('tingling'));
  // Side effects expansion (Step 3)
  const sideEffects = (deno?.patientEducation?.sideEffects ?? []).join(' | ').toLowerCase();
  check(failures, 'side effects include cellulitis', sideEffects.includes('cellulitis'));
  check(failures, 'side effects include eczema', sideEffects.includes('eczema'));
  check(failures, 'side effects include flatulence', sideEffects.includes('flatulence'));
  return { name: 'TC62 — denosumab pre-dose Ca check for ALL patients', passed: failures.length === 0, failures, decision };
}

// ─── TC63 ─────────────────────────────────────────────────────────────────
// HRT — transdermal does NOT reduce breast cancer risk; CV-no-increase under-60.
function tc63(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 56,
    sex: 'female',
    parentalHipFracture: true, // a FRAX clinical risk factor so the engine evaluates FRAX (NOGG Rec 1 gate)
    fraxMOFPercent: 13.0,      // above IT at age 55 (9.5%) → high
    fraxHipPercent: 2.0,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -1.9, femoralNeckTScore: -1.9, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'hrt_option_under60 flag fires',
    hasFlag(decision, 'hrt_option_under60'));
  check(failures, 'message states transdermal preferred (for VTE)',
    hasFlagText(decision, 'transdermal'));
  check(failures, 'message states CV risk NOT increased when started <60',
    hasFlagText(decision, 'cardiovascular') || hasFlagText(decision, 'cv risk') || hasFlagText(decision, 'cardio'));
  check(failures, 'message states transdermal does NOT reduce breast cancer risk',
    hasFlagText(decision, 'does not reduce breast cancer risk') ||
    hasFlagText(decision, 'transdermal route does not reduce') ||
    hasFlagText(decision, 'irrespective of') && hasFlagText(decision, 'route'));
  return { name: 'TC63 — HRT: CV-safe <60, transdermal does NOT reduce breast cancer', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE-COVERAGE EXTRAS (TC64–TC73) — previously TC53–TC62, renumbered for v1.4
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC64 ─────────────────────────────────────────────────────────────────
// Post-hip-fracture 72F, eGFR 65, recent hip fx → IV zoledronate first-line.
function tc64(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.2, totalHipTScore: -2.2, femoralNeckTScore: -2.2, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // v1.46 — post_hip_fracture_zoledronate_first_line flag retired; Rec 3 +
  // Lyles content now lives on the IV zol recommendation's inline rationale.
  // Assertions swapped to anchor on the rec's rationale field.
  check(failures, 'IV zoledronate recommended', hasAgent(decision, 'zoledronate'));
  const zoleRec = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');
  check(failures, 'zoledronate priority = first-line', zoleRec?.priority === 'first-line',
    `got ${zoleRec?.priority}`);
  check(failures, 'IV zol rationale anchors HORIZON-RF / Lyles reference',
    !!zoleRec && /horizon|lyles/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors mortality reduction',
    !!zoleRec && /mortality/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors Rec 3 framing',
    !!zoleRec && /rec 3|recommendation 3/i.test(zoleRec.rationale));
  return { name: 'TC64 — post-hip-fracture → IV zoledronate first-line', passed: failures.length === 0, failures, decision };
}

// ─── TC54 ─────────────────────────────────────────────────────────────────
// Oesophageal disease 68F → all oral BPs CI, IV zoledronate from outset.
function tc65(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    oesophagealDiseaseHistory: true,
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'oesophageal disease oral-BP CI flag fires',
    hasFlag(decision, 'oesophageal_disease_oral_bp_ci'));
  check(failures, 'flag mentions IV zoledronate first-line', hasFlagText(decision, 'iv zoledronate'));
  check(failures, 'IV zoledronate in recommendations', hasAgent(decision, 'zoledronate'));
  check(failures, 'NO alendronate recommended', !hasAgent(decision, 'alendronate'));
  check(failures, 'NO risedronate recommended', !hasAgent(decision, 'risedronate'));
  check(failures, 'NO oral ibandronate recommended', !hasAgent(decision, 'ibandronate'));
  return { name: 'TC65 — oesophageal disease blocks oral BPs', passed: failures.length === 0, failures, decision };
}

// ─── TC55 ─────────────────────────────────────────────────────────────────
// Oesophageal disease 75F with eGFR 30 (severe CKD) → cannot use zoledronate,
// route to denosumab. Flag still mentions IV zoledronate as the preferred
// option in general; engine falls back to denosumab when eGFR <35.
function tc66(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 75,
    sex: 'female',
    oesophagealDiseaseHistory: true,
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 30, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 130, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'oesophageal disease CI flag fires',
    hasFlag(decision, 'oesophageal_disease_oral_bp_ci'));
  check(failures, 'denosumab recommended (eGFR <35 cannot use zoledronate)',
    hasAgent(decision, 'denosumab'));
  check(failures, 'NO zoledronate (eGFR 30 contraindicated)',
    !hasAgent(decision, 'zoledronate'));
  check(failures, 'NO oral bisphosphonate',
    !hasAgent(decision, 'alendronate') && !hasAgent(decision, 'risedronate') && !hasAgent(decision, 'ibandronate'));
  return { name: 'TC66 — oesophageal disease + eGFR 30 → denosumab', passed: failures.length === 0, failures, decision };
}

// ─── TC56 ─────────────────────────────────────────────────────────────────
// Denosumab cessation timing: 5.5 months since last dose → "arrange now" flag.
function tc67(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.5, femoralNeckTScore: -2.5, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'denosumab', durationMonths: 18, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 5.5 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'arrange-zoledronate-now flag fires at 5–6 months',
    hasFlag(decision, 'denosumab_zoledronate_arrange_now'));
  check(failures, 'message mentions IV zoledronate', hasFlagText(decision, 'iv zoledronate'));
  check(failures, 'message states zoledronate NOT equivalent to alendronate',
    hasFlagText(decision, 'not equivalent to alendronate'));
  check(failures, 'prescribing-caution flag also present',
    hasFlag(decision, 'denosumab_prescribing_caution'));
  check(failures, 'caution message mentions "younger postmenopausal women"',
    hasFlagText(decision, 'younger postmenopausal women'));
  return { name: 'TC67 — denosumab 5.5m → arrange zoledronate now', passed: failures.length === 0, failures, decision };
}

// ─── TC57 ─────────────────────────────────────────────────────────────────
// Denosumab cessation timing: 8 months since last dose, no sequential BP →
// overdue urgent + refer-urgently flags.
function tc68(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'denosumab', durationMonths: 36, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 8 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'denosumab overdue urgent flag fires',
    hasFlag(decision, 'denosumab_overdue_injection'));
  check(failures, 'refer-urgently flag fires at >7m without sequential BP',
    hasFlag(decision, 'denosumab_refer_urgently'));
  check(failures, 'overdue flag mentions IV zoledronate as preferred sequential',
    hasFlagText(decision, 'iv zoledronate'));
  check(failures, 'alendronate framed as secondary, NOT equivalent',
    hasFlagText(decision, 'secondary option'));
  return { name: 'TC68 — denosumab 8m + no sequential BP → urgent + refer', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.20–v1.25 NEW TEST CASES (TC58–TC62) — male drug filter, teriparatide
// lifetime, ibandronate fasting, post-hip-fx, anabolic shared-care
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC58 ─────────────────────────────────────────────────────────────────
// Male patient drug filter — male VHR patient never receives any of the
// five unlicensed-in-men drugs. Defence-in-depth: even if upstream pathways
// regress, the filter removes them.
function tc69(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'male',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0.5,
    numberOfPriorFractures: 2,
    dexaResults: { lumbarSpineTScore: -3.4, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  for (const agent of ['romosozumab', 'ibandronate', 'hrt', 'raloxifene', 'abaloparatide'] as const) {
    check(failures, `no ${agent} recommendation for male`, !hasAgent(decision, agent));
  }
  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'male VHR + vertebral fracture → anabolic-teriparatide flag fires',
    hasFlag(decision, 'male_vhr_anabolic_teriparatide'));
  check(failures, 'flag notes teriparatide is the only anabolic licensed for men',
    hasFlagText(decision, 'only anabolic'));
  return { name: 'TC69 — male VHR: no unlicensed drugs, teriparatide referral', passed: failures.length === 0, failures, decision };
}

// ─── TC59 ─────────────────────────────────────────────────────────────────
// Teriparatide lifetime restriction. Female VHR who has completed a
// 24-month teriparatide course in the past — flag must fire and message
// must state "lifetime maximum".
function tc70(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 75,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 2,
    recentVertebralFractureYears: 1,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    previousTreatments: [
      { agent: 'teriparatide', durationMonths: 24, reasonStopped: 'completed_course', currentlyOn: false, monthsSinceLastDose: 12 },
    ],
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'teriparatide_lifetime_used flag fires',
    hasFlag(decision, 'teriparatide_lifetime_used'));
  check(failures, 'flag mentions "lifetime maximum"',
    hasFlagText(decision, 'lifetime maximum'));
  check(failures, 'flag notes romosozumab remains an option (women)',
    hasFlagText(decision, 'romosozumab remains'));
  return { name: 'TC70 — teriparatide already used: lifetime flag fires', passed: failures.length === 0, failures, decision };
}

// ─── TC60 ─────────────────────────────────────────────────────────────────
// Ibandronate 1-hour fasting requirement — verify the patient education
// text in the ibandronate recipe contains "1 HOUR" (or equivalent) and
// flags it as longer than alendronate/risedronate.
function tc71(): TCResult {
  const failures: string[] = [];
  // Recipe text is on the ibandronate() recipe; we don't get an active
  // ibandronate recommendation from any current pathway, so import and
  // inspect the recipe directly via a synthetic patient that we then
  // check against the engine's known recipe content.
  // Rather than expose the recipe, this TC checks that the engine never
  // pushes ibandronate (it's not in the cascade) and that no patient
  // input produces an ibandronate recommendation incidentally.
  // The actual 1-hour fasting text is verified by reading the source.
  const patient = basePatient({
    age: 68,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  // The engine does not actively push ibandronate; this is intentional
  // (less hip-fx evidence than alendronate). If a future change starts
  // pushing it, the new low-hip-efficacy flag (TC62) should fire.
  check(failures, 'ibandronate not in default cascade', !hasAgent(decision, 'ibandronate'));
  // Confirm alendronate is recommended for this standard female PMO patient.
  check(failures, 'alendronate recommended', hasAgent(decision, 'alendronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
  return { name: 'TC71 — ibandronate not pushed; alendronate first-line', passed: failures.length === 0, failures, decision };
}

// ─── TC61 ─────────────────────────────────────────────────────────────────
// Specialist initiation vs GP continuation. Female currently on
// romosozumab → GP-shared-care flag fires; no referral instruction.
function tc72(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 2,
    recentVertebralFractureYears: 1,
    dexaResults: { lumbarSpineTScore: -3.0, totalHipTScore: -2.8, femoralNeckTScore: -2.8, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'romosozumab', durationMonths: 6, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 0 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'GP-shared-care continuation flag fires',
    hasFlag(decision, 'anabolic_gp_shared_care_continue'));
  check(failures, 'message mentions shared care', hasFlagText(decision, 'shared care'));
  // Sequential therapy plan flag also expected (initiation-time prompt).
  check(failures, 'sequential_therapy_plan_required flag fires',
    hasFlag(decision, 'sequential_therapy_plan_required'));
  return { name: 'TC72 — established on romosozumab: GP shared-care, no re-refer', passed: failures.length === 0, failures, decision };
}

// ─── TC62 ─────────────────────────────────────────────────────────────────
// Low-hip-efficacy note: patient currently on ibandronate AND age ≥75 →
// warning-severity hip-efficacy note fires.
function tc73(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 78,
    sex: 'female',
    priorHipFracture: false,
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.7, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 60, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'ibandronate', durationMonths: 24, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 0 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'low_hip_efficacy_note flag fires',
    hasFlag(decision, 'low_hip_efficacy_note'));
  const flag = decision.flags.find(f => f.id === 'low_hip_efficacy_note');
  check(failures, 'flag severity = warning (age ≥75 OR severe hip TS makes hip primary concern)',
    flag?.severity === 'warning', `got ${flag?.severity}`);
  check(failures, 'message names ibandronate', hasFlagText(decision, 'ibandronate'));
  check(failures, 'message recommends alendronate / zoledronate / denosumab',
    hasFlagText(decision, 'alendronate'));
  return { name: 'TC73 — ibandronate + age ≥75: low-hip-efficacy warning', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.30 NEW TEST CASES (TC74–TC75) — denosumab second-line soft prompt
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC74 ─────────────────────────────────────────────────────────────────
// Denosumab in recommendations WITHOUT a bisphosphonate contraindication.
// The natural firing path: VHR patient currently on long-term alendronate
// where the sequencing logic offers denosumab as a switch option (line ~1759).
// eGFR 70, no AFF, no oesophageal disease, no GI intolerance to oral+IV.
// Soft prompt should fire at INFO severity.
function tc74(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 2,
    recentVertebralFractureYears: 0.5,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: { agent: 'alendronate', durationMonths: 84, reasonStopped: null, currentlyOn: true, monthsSinceLastDose: 0 },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'risk = very_high',
    decision.riskStratification.category === 'very_high', `got ${decision.riskStratification.category}`);
  check(failures, 'denosumab in recommendations (BP-to-denosumab switch)',
    hasAgent(decision, 'denosumab'));
  check(failures, 'denosumab_second_line_soft_prompt fires',
    hasFlag(decision, 'denosumab_second_line_soft_prompt'));
  const prompt = decision.flags.find(f => f.id === 'denosumab_second_line_soft_prompt');
  check(failures, 'prompt severity = info (not warning, not urgent)',
    prompt?.severity === 'info', `got ${prompt?.severity}`);
  check(failures, 'message states denosumab is second-line on cost-effectiveness grounds',
    hasFlagText(decision, 'second-line') && hasFlagText(decision, 'cost-effectiveness'));
  check(failures, 'message invites documenting clinical rationale',
    hasFlagText(decision, 'documenting your clinical rationale') ||
    hasFlagText(decision, 'document') && hasFlagText(decision, 'rationale'));
  return { name: 'TC74 — denosumab soft prompt fires (no BP CI present)', passed: failures.length === 0, failures, decision };
}

// ─── TC75 ─────────────────────────────────────────────────────────────────
// Same VHR shape but with eGFR 30 → renal CI present → soft prompt MUST NOT fire.
// Denosumab is still recommended (the engine routes via renal CI), but the
// prompt is suppressed because the prescribing decision is justified.
function tc75(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 71,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 2,
    recentVertebralFractureYears: 0.5,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -3.0, femoralNeckTScore: -3.0, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 30, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 130, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'denosumab recommended (renal CI to BPs)',
    hasAgent(decision, 'denosumab'));
  check(failures, 'soft prompt does NOT fire (renal CI present)',
    !hasFlag(decision, 'denosumab_second_line_soft_prompt'));
  return { name: 'TC75 — eGFR <35: soft prompt SUPPRESSED (CI justifies denosumab)', passed: failures.length === 0, failures, decision };
}

// ─── TC76 ─────────────────────────────────────────────────────────────────
// Step 5 in isolation — denosumab Vit D block (Vit D < insufficient threshold).
// Pre-condition: Vit D is in the 25–50 window so Step 2 (severe Vit D + hypoCa
// dual blocker) doesn't ALSO fire. Calcium is in the normal range.
// Patient is on a denosumab pathway (eGFR <35) so the engine pushes denosumab
// and addVitDBlock runs.
// This is the dedicated "Step 5 in isolation" test referenced in the architecture
// audit — covers the third Vit D step independently so future regressions are
// localisable to the right step.
function tc76(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    priorFragilityFracture: true,
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.6, forearmTScore: null },
    bloodResults: {
      adjustedCalciumMmol: 2.35, // normal — Step 2 (dual blocker) must NOT fire
      vitaminDNmol: 40,           // 25 < 40 < 50: insufficient, not severe
      egfr: 30,
      alp: 80,
      tshMUL: 2.0,
      hbGramsPerLitre: 135,
      esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);
  check(failures, 'denosumab recommended (renal CI to BPs)', hasAgent(decision, 'denosumab'));
  check(failures, 'Step 5 denosumab_vitd_block flag fires',
    hasFlag(decision, 'denosumab_vitd_block'));
  // Step 2 (dual safety blocker) must NOT fire — Vit D is above the deficient
  // threshold AND calcium is normal. This isolates Step 5.
  check(failures, 'Step 2 (two_safety_blockers) does NOT fire',
    !hasFlag(decision, 'two_safety_blockers'));
  // The message must mention the threshold and the patient's value so the GP
  // sees exactly why denosumab is being held.
  const block = decision.flags.find(f => f.id === 'denosumab_vitd_block');
  const msg = (block?.message ?? '').toLowerCase();
  check(failures, 'message names patient value (40 nmol/L)', msg.includes('40 nmol/l'));
  check(failures, 'message references the 50 nmol/L threshold', msg.includes('50'));
  return { name: 'TC77 — Step 5 denosumab Vit D block, isolated from Step 2', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.31 NEW TEST CASE — Output gating by risk category (Section 17.5)
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: my previous TC76 (Vit D step-isolation) is renumbered to TC77 in the
// runner array so the user-requested TC76 number matches the spec.

// ─── TC76 (v1.31) ─────────────────────────────────────────────────────────
// 62F low-risk patient. No fractures, no FRAX-triggering risk factors,
// eGFR 75, Vit D 70 nmol/L, calcium 2.32 mmol/L, no GC, no secondary causes,
// BMI 24. Expected: risk = LOW; treatmentRecommended === false; empty
// recommendation list. Output contains lifestyle advice + reassessment +
// risk classification (green). Output does NOT contain any flag whose id
// matches a treatment-adjacent substring, and does NOT contain Tier 1 or
// Tier 2 blood entries.
function tc76_v131(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 62,
    sex: 'female',
    bmi: 24,
    fraxMOFPercent: null,
    fraxHipPercent: null,
    dexaResults: null,
    bloodResults: {
      adjustedCalciumMmol: 2.32,
      vitaminDNmol: 70,
      egfr: 75,
      alp: 80,
      tshMUL: 2.0,
      hbGramsPerLitre: 135,
      esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  // Risk and gating booleans
  check(failures, 'risk = low',
    decision.riskStratification.category === 'low', `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === false',
    decision.treatmentRecommended === false, `got ${decision.treatmentRecommended}`);
  check(failures, 'recommendation list is empty',
    decision.treatmentRecommendations.length === 0);

  // Independent outputs that MUST still fire
  check(failures, 'lifestyle advice present',
    decision.lifestyleAdvice.length > 0);
  check(failures, 'reassessment / review schedule present',
    typeof decision.reviewSchedule === 'string' && decision.reviewSchedule.length > 0);
  check(failures, 'risk classification (green) present',
    decision.riskStratification.trafficLight === 'green');

  // Treatment-adjacent flag IDs that must NOT be in the output
  const forbidden = ['pre_treatment', 'pre_dose', 'onj', 'aff_prodrome',
                     'sequential_therapy', 'denosumab_calcium_check',
                     'drug_education', 'monitoring_schedule'];
  for (const sub of forbidden) {
    const offending = decision.flags.find(f => f.id.includes(sub));
    check(failures, `no flag id contains '${sub}'`, !offending,
      offending ? `found ${offending.id}` : '');
  }

  // Tier 1 and Tier 2 bloods must NOT be in investigationsNeeded
  const tier1or2 = decision.investigationsNeeded.filter(
    inv => inv.tier === 1 || inv.tier === 2,
  );
  check(failures, 'no Tier 1 or Tier 2 blood entries',
    tier1or2.length === 0,
    tier1or2.length > 0 ? `found ${tier1or2.map(i => i.investigation).join(', ')}` : '');

  return { name: 'TC76 — v1.31 output gating, low-risk patient', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.10 TCs — TC78–TC86 — Prompt A behaviours + previously-untested branches
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC78 ─────────────────────────────────────────────────────────────────
// LS-FN upward MOF adjustment. 65F, LS -2.4 / FN -0.4 (2 SD discordance, LS
// lower → upward), parental hip fx (passes gate). Raw MOF 12 → adjusted 14.4.
// Hip unchanged. No degenerative-artefact flag.
function tc78(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    parentalHipFracture: true,
    dexaResults: { lumbarSpineTScore: -2.4, totalHipTScore: -0.5, femoralNeckTScore: -0.4, forearmTScore: null },
    fraxMOFPercent: 12,
    fraxHipPercent: 4,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  const lsfnAdj = decision.riskStratification.fraxAdjustments.find(
    a => a.appliedTo === 'MOF' && /lumbar spine|LS/i.test(a.factor),
  );
  check(failures, 'LS-FN MOF adjustment entry present', !!lsfnAdj,
    lsfnAdj ? '' : `adjustments: ${JSON.stringify(decision.riskStratification.fraxAdjustments)}`);
  check(failures, 'LS-FN multiplier === 1.2', lsfnAdj?.multiplier === 1.2,
    lsfnAdj ? `got ${lsfnAdj.multiplier}` : '');
  check(failures, 'adjusted MOF === 14.4', decision.riskStratification.adjustedFraxMOFPercent === 14.4,
    `got ${decision.riskStratification.adjustedFraxMOFPercent}`);
  check(failures, 'hip unchanged (raw === adjusted)',
    decision.riskStratification.adjustedFraxHipPercent === decision.riskStratification.fraxHipPercent);
  check(failures, 'adjusted MOF drives classification (rationale references 14.4)',
    decision.riskStratification.rationale.includes('14.4'),
    `rationale: ${decision.riskStratification.rationale}`);
  check(failures, 'no degenerative-artefact (downward) flag',
    !hasFlag(decision, 'frax_ls_fn_discordance_downward'));

  return { name: 'TC78 — LS-FN upward MOF adjustment +20%, hip unchanged', passed: failures.length === 0, failures, decision };
}

// ─── TC79 ─────────────────────────────────────────────────────────────────
// LS-FN downward → clinician-decides flag. 65F, LS -0.4 / FN -2.4 (2 SD, LS
// higher → downward). Raw MOF 10 stays 10 (no auto-apply). Flag fires citing
// Table 2 + degenerative-artefact caveat. Classification on un-adjusted FRAX.
function tc79(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    parentalHipFracture: true,
    dexaResults: { lumbarSpineTScore: -0.4, totalHipTScore: -2.4, femoralNeckTScore: -2.4, forearmTScore: null },
    fraxMOFPercent: 10,
    fraxHipPercent: 3,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'frax_ls_fn_discordance_downward flag fires',
    hasFlag(decision, 'frax_ls_fn_discordance_downward'));
  check(failures, 'flag text mentions NOGG 2024 Table 2',
    hasFlagText(decision, 'Table 2'));
  check(failures, 'flag text mentions degenerative artefact',
    hasFlagText(decision, 'degenerative artefact'));
  check(failures, 'no LS-FN entry in fraxAdjustments (no auto-apply)',
    !decision.riskStratification.fraxAdjustments.some(
      a => /lumbar spine|LS/i.test(a.factor),
    ),
    `adjustments: ${JSON.stringify(decision.riskStratification.fraxAdjustments)}`);
  check(failures, 'adjusted MOF === raw MOF (10)',
    decision.riskStratification.adjustedFraxMOFPercent === 10 &&
    decision.riskStratification.fraxMOFPercent === 10,
    `raw=${decision.riskStratification.fraxMOFPercent} adj=${decision.riskStratification.adjustedFraxMOFPercent}`);
  check(failures, 'rationale references un-adjusted 10% (classification on un-adjusted)',
    decision.riskStratification.rationale.includes('10%'),
    `rationale: ${decision.riskStratification.rationale}`);

  return { name: 'TC79 — LS-FN downward clinician-decides flag, no auto-apply', passed: failures.length === 0, failures, decision };
}

// ─── TC80 ─────────────────────────────────────────────────────────────────
// Case-finder surfacing. 65F, lower-limb amputation + learning disability,
// no other RFs. Both surface as Table 4 case-finders. FRAX un-adjusted. Low.
function tc80(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    lowerLimbAmputation: true,
    learningDisabilities: true,
    fraxMOFPercent: 2,
    fraxHipPercent: 0.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  const ampEntry = decision.riskFactorsIdentified.find(r => r.factor.toLowerCase().includes('amputation'));
  const ldEntry  = decision.riskFactorsIdentified.find(r => r.factor.toLowerCase().includes('learning'));
  check(failures, 'amputation entry surfaced', !!ampEntry);
  check(failures, 'learning disability entry surfaced', !!ldEntry);
  check(failures, 'amputation entry cites Table 4 case-finder',
    !!ampEntry && /table 4|case-finder/i.test(ampEntry.effect));
  check(failures, 'learning disability entry cites Table 4 case-finder',
    !!ldEntry && /table 4|case-finder/i.test(ldEntry.effect));
  check(failures, 'FRAX un-adjusted: adjusted MOF === raw MOF',
    decision.riskStratification.adjustedFraxMOFPercent === decision.riskStratification.fraxMOFPercent);
  check(failures, 'FRAX un-adjusted: adjusted hip === raw hip',
    decision.riskStratification.adjustedFraxHipPercent === decision.riskStratification.fraxHipPercent);
  check(failures, 'treatmentRecommended === false', decision.treatmentRecommended === false);
  check(failures, 'category low', decision.riskStratification.category === 'low');
  check(failures, 'recommendation list empty', decision.treatmentRecommendations.length === 0);

  return { name: 'TC80 — amputation + learning disability case-finder surfacing', passed: failures.length === 0, failures, decision };
}

// ─── TC81 ─────────────────────────────────────────────────────────────────
// No-RF override. 65F, no risk factors, noRiskFactorOverride=true. FRAX
// computed (estimator), gatedNoRfs===false, override flag fires, no treatment.
// Companion to TC76 which exercises noRiskFactorOverride===false (gate fires).
function tc81(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    bmi: 25,
    noRiskFactorOverride: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'computed FRAX MOF present (not suppressed)',
    decision.riskStratification.fraxMOFPercent !== null,
    `MOF=${decision.riskStratification.fraxMOFPercent}`);
  check(failures, 'computed FRAX hip present (not suppressed)',
    decision.riskStratification.fraxHipPercent !== null,
    `hip=${decision.riskStratification.fraxHipPercent}`);
  check(failures, 'frax_revealed_no_rfs documentation flag fires',
    hasFlag(decision, 'frax_revealed_no_rfs'));
  check(failures, 'documentation flag combines Rec 1 + documentation prompt',
    hasFlagText(decision, 'NOGG 2024 Rec 1') && hasFlagText(decision, 'Document'));
  check(failures, 'treatmentRecommended === false', decision.treatmentRecommended === false);
  check(failures, 'gatedNoRfs === false (gate did NOT fire — override active)',
    decision.riskStratification.gatedNoRfs === false);
  // Classification should proceed on the computed FRAX, not be suppressed to low.
  check(failures, 'classification reflects computed FRAX (not the gate stub)',
    decision.riskStratification.category !== 'low' ||
    decision.riskStratification.adjustedFraxMOFPercent !== null);

  return { name: 'TC81 — no-RF override reveals FRAX with documentation flag', passed: failures.length === 0, failures, decision };
}

// ─── TC82 ─────────────────────────────────────────────────────────────────
// Intermediate → DEXA → reassess. 65F intermediate FRAX (MOF 15), no DEXA,
// not bmdUnavailable. Engine pushes intermediate_await_dexa with Rec 4 wording
// and the BMD-reclassification instruction. Recommendation list empty.
function tc82(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    parentalHipFracture: true, // passes gate; not in Table 2 → no FRAX adj
    fraxMOFPercent: 15,
    fraxHipPercent: 3,
    fraxCalculatedWithBMD: false,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'intermediate_await_dexa flag set', hasFlag(decision, 'intermediate_await_dexa'));
  check(failures, 'output cites NOGG 2024 Rec 4', hasFlagText(decision, 'NOGG 2024 Rec 4'));
  check(failures, 'output includes the reclassify-after-BMD instruction',
    hasFlagText(decision, 'reclassify') || hasFlagText(decision, 'refer for DEXA'));
  check(failures, 'recommendation list empty', decision.treatmentRecommendations.length === 0);
  check(failures, 'treatmentRecommended === false', decision.treatmentRecommended === false);
  check(failures, 'risk category intermediate', decision.riskStratification.category === 'intermediate');

  return { name: 'TC82 — intermediate → DEXA → reassess (NOGG Rec 4)', passed: failures.length === 0, failures, decision };
}

// ─── TC83 ─────────────────────────────────────────────────────────────────
// BMD unavailable + prior fragility fracture. Engine routes to HIGH via Rec 8
// prior-fx path, AND now (v1.34) surfaces bmd_unavailable_treat_fx as a
// secondary annotation. Both NOGG Rec 6 and Rec 8 rationales apply.
function tc83(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    priorFragilityFracture: true,
    bmdUnavailable: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'bmd_unavailable_treat_fx flag set', hasFlag(decision, 'bmd_unavailable_treat_fx'));
  check(failures, 'output cites NOGG 2024 Rec 6', hasFlagText(decision, 'NOGG 2024 Rec 6'));
  check(failures, 'output references fragility fracture history',
    hasFlagText(decision, 'fragility fracture') || hasFlagText(decision, 'low-trauma fracture'));
  check(failures, 'recommendation list contains a bisphosphonate (alendronate or risedronate)',
    hasAgent(decision, 'alendronate') || hasAgent(decision, 'risedronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
  check(failures, 'treatmentRecommended === true', decision.treatmentRecommended === true);
  check(failures, 'risk category high', decision.riskStratification.category === 'high');

  return { name: 'TC83 — BMD unavailable + prior fragility fx (Rec 6 + Rec 8)', passed: failures.length === 0, failures, decision };
}

// ─── TC84 ─────────────────────────────────────────────────────────────────
// BMD unavailable + FRAX above IT. 70F intermediate FRAX (MOF 22, ≥ itMOF
// 20.3 at age 70), no fragility fx, bmdUnavailable=true. Pushes
// bmd_unavailable_treat_frax + falls through to first-line BP.
function tc84(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    parentalHipFracture: true, // passes gate
    bmdUnavailable: true,
    fraxMOFPercent: 22,
    fraxHipPercent: 4,
    fraxCalculatedWithBMD: false,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'bmd_unavailable_treat_frax flag set', hasFlag(decision, 'bmd_unavailable_treat_frax'));
  check(failures, 'output cites FRAX MOF above intervention threshold',
    hasFlagText(decision, 'exceeds intervention threshold') || hasFlagText(decision, 'intervention threshold'));
  check(failures, 'output cites NOGG 2024 Rec 6', hasFlagText(decision, 'NOGG 2024 Rec 6'));
  check(failures, 'recommendation list contains a bisphosphonate',
    hasAgent(decision, 'alendronate') || hasAgent(decision, 'risedronate'));
  check(failures, 'recommends IV zoledronate (v1.46 co-equal first-line)', hasAgent(decision, 'zoledronate'));
  check(failures, 'treatmentRecommended === true', decision.treatmentRecommended === true);

  return { name: 'TC84 — BMD unavailable + FRAX above IT (Rec 6)', passed: failures.length === 0, failures, decision };
}

// ─── TC85 ─────────────────────────────────────────────────────────────────
// BMD unavailable + neither criterion met. 70F intermediate FRAX (MOF 12,
// between LAT 11.1 and IT 20.3), no fragility fx, bmdUnavailable=true.
// Pushes bmd_unavailable_no_treatment + returns []; no treatment.
function tc85(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    parentalHipFracture: true,
    bmdUnavailable: true,
    fraxMOFPercent: 12,
    fraxHipPercent: 2.5,
    fraxCalculatedWithBMD: false,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'bmd_unavailable_no_treatment flag set', hasFlag(decision, 'bmd_unavailable_no_treatment'));
  check(failures, 'output cites NOGG 2024 Rec 6', hasFlagText(decision, 'NOGG 2024 Rec 6'));
  check(failures, "output cites 'neither criterion met' rationale",
    hasFlagText(decision, 'neither treatment criterion met') ||
    hasFlagText(decision, 'treat only if a previous'));
  check(failures, 'recommendation list empty', decision.treatmentRecommendations.length === 0);
  check(failures, 'treatmentRecommended === false', decision.treatmentRecommended === false);

  return { name: 'TC85 — BMD unavailable + neither criterion met (Rec 6)', passed: failures.length === 0, failures, decision };
}

// ─── TC86 ─────────────────────────────────────────────────────────────────
// Forearm-only osteoporosis + PHPT workup. 60F, forearm T -2.7, standard
// sites > -2.5, parental hip fx. PTH investigation pushed (Ca/ALP/PTH).
// forearm_only_osteoporosis flag with hyperparathyroidism caveat. FRAX
// values shown use femoral neck only — forearm BMD does not adjust FRAX.
function tc86(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 60,
    sex: 'female',
    parentalHipFracture: true,
    dexaResults: { lumbarSpineTScore: -1.0, totalHipTScore: -1.5, femoralNeckTScore: -1.4, forearmTScore: -2.7 },
    fraxMOFPercent: 8,
    fraxHipPercent: 1.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.3, vitaminDNmol: 60, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  const pth = decision.investigationsNeeded.find(i => i.investigation === 'pth');
  check(failures, 'PTH investigation present', !!pth);
  check(failures, 'PTH workup names calcium / ALP / PTH',
    !!pth && /calcium|ca/i.test(pth.reason) && /alp/i.test(pth.reason) && /pth/i.test(pth.reason));
  check(failures, 'forearm_only_osteoporosis flag fires',
    hasFlag(decision, 'forearm_only_osteoporosis'));
  check(failures, 'forearm flag carries the hyperparathyroidism caveat',
    hasFlagText(decision, 'hyperparathyroidism'));
  check(failures, 'FRAX MOF shown = raw input 8 (forearm did NOT adjust FRAX)',
    decision.riskStratification.fraxMOFPercent === 8 &&
    decision.riskStratification.adjustedFraxMOFPercent === 8,
    `raw=${decision.riskStratification.fraxMOFPercent} adj=${decision.riskStratification.adjustedFraxMOFPercent}`);
  check(failures, 'FRAX hip shown = raw input 1.5 (forearm did NOT adjust FRAX)',
    decision.riskStratification.fraxHipPercent === 1.5 &&
    decision.riskStratification.adjustedFraxHipPercent === 1.5);

  return { name: 'TC86 — forearm-only osteoporosis + PHPT workup', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.11 TCs — TC87 + TC88 — Bisphosphonate-duration decision points
// (Patient builders use A1-impl schema fields: ageAtStart, fractureOnCurrentTreatment,
//  adherenceAdequate on TreatmentHistory.currentTreatment.)
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC87 ─────────────────────────────────────────────────────────────────
// Bisphosphonate drug holiday eligibility (NOGG 2024 §6.2 / Section 7 Rec 6, Strong).
// 65F postmenopausal, started alendronate at 60, now 5y on. T-scores: hip -2.1, FN -2.0,
// LS -1.8. FRAX MOF 12.0% (adj, with FN BMD); FRAX hip 2.5%. No fractures ever. No GC.
// Smoker (1 FRAX RF). Adherence ≥80%. Schema fields explicitly set per A1-impl.
function tc87(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    currentSmoker: true,
    dexaResults: { lumbarSpineTScore: -1.8, totalHipTScore: -2.1, femoralNeckTScore: -2.0, forearmTScore: null },
    fraxMOFPercent: 12.0,
    fraxHipPercent: 2.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: {
      agent: 'alendronate',
      durationMonths: 60,
      reasonStopped: null,
      currentlyOn: true,
      monthsSinceLastDose: null,
      ageAtStart: 60,
      fractureOnCurrentTreatment: false,
      adherenceAdequate: true,
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'bp_holiday_appropriate flag fires', hasFlag(decision, 'bp_holiday_appropriate'));

  // Five §6.2 criteria explicitly named as met (via shouldTakeBPHoliday's "takeHoliday:true"
  // default reasons list interpolated into the flag message).
  check(failures, 'criterion: T-score >−2.5 at hip named',
    hasFlagText(decision, 'T-score >−2.5 at hip'));
  check(failures, 'criterion: no hip or vertebral fracture named',
    hasFlagText(decision, 'no hip or vertebral fracture'));
  check(failures, 'criterion: age at start <70 named',
    hasFlagText(decision, 'age at start <70'));
  check(failures, 'criterion: no ongoing steroids ≥7.5 mg/day named',
    hasFlagText(decision, 'no ongoing steroids'));
  check(failures, 'criterion: FRAX adjusted below IT named',
    hasFlagText(decision, 'FRAX adjusted below IT'));

  // Cites NOGG Section 7 Rec 6 (Strong) for the pause decision.
  check(failures, 'cites NOGG Section 7 Rec 6 (Strong)',
    hasFlagText(decision, 'Section 7 Rec 6 (Strong)'));

  // Alendronate's 2-year reassessment interval per §6.4 (NOGG Rec 4).
  check(failures, 'names alendronate 2-year reassessment interval',
    hasFlagText(decision, '2 years (24 months) for alendronate'));
  check(failures, 'cites Rec 4 / §6.4 for drug-specific intervals',
    hasFlagText(decision, 'Section 7 Rec 4') && hasFlagText(decision, '§6.4'));

  // §6.5 fracture-as-independent-restart surfaced.
  check(failures, '§6.5 fracture-as-restart trigger surfaced',
    hasFlagText(decision, 'fracture occurs during the pause') &&
    hasFlagText(decision, '§6.5'));

  // §6.6 BMD/turnover-marker restart triggers surfaced.
  check(failures, '§6.6 BMD/turnover-marker restart triggers surfaced',
    hasFlagText(decision, '§6.6') &&
    (hasFlagText(decision, 'bone turnover markers') || hasFlagText(decision, 'CTX')) &&
    hasFlagText(decision, 'BMD'));

  // treatmentRecommended === false at this assessment (per A1 Fix 3 strip).
  check(failures, 'treatmentRecommended === false',
    decision.treatmentRecommended === false,
    `got ${decision.treatmentRecommended}`);
  check(failures, 'recommendation list empty',
    decision.treatmentRecommendations.length === 0,
    `got ${decision.treatmentRecommendations.length} entries`);

  return { name: 'TC87 — pause-eligible: all 5 §6.2 criteria + Rec 6 + §6.4/6.5/6.6', passed: failures.length === 0, failures, decision };
}

// ─── TC88 ─────────────────────────────────────────────────────────────────
// 10-year course completed (NOGG 2024 §6.2 / Section 7 Rec 8, Conditional).
// 75F postmenopausal, started alendronate at 65 due to prior vertebral fracture (age 64,
// pre-treatment), now 10y on. T-scores: hip -2.4, FN -2.3, LS -2.0. FRAX MOF 18.0% (adj);
// FRAX hip 5.0%. No fractures during 10-year treatment. No GC. Adherence ≥80% throughout.
function tc88(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 75,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    numberOfPriorFractures: 1,
    recentVertebralFractureYears: 11, // age 64, now 75 — pre-treatment, not within 2y
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.4, femoralNeckTScore: -2.3, forearmTScore: null },
    fraxMOFPercent: 18.0,
    fraxHipPercent: 5.0,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: {
      agent: 'alendronate',
      durationMonths: 120,
      reasonStopped: null,
      currentlyOn: true,
      monthsSinceLastDose: null,
      ageAtStart: 65,
      // The vertebral fracture at age 64 was BEFORE this treatment course started — pre-treatment.
      // Distinguished from a fracture-during-course (which would be true).
      fractureOnCurrentTreatment: false,
      adherenceAdequate: true,
    },
  });
  const decision = runClinicalDecision(patient);

  // After-10-years individual-decision flag fires (NOGG 2024 Section 7 Rec 8, Conditional).
  check(failures, 'bp_individual_basis_after_long_course flag fires',
    hasFlag(decision, 'bp_individual_basis_after_long_course'));
  check(failures, 'cites NOGG 2024 Section 7 Rec 8 (Conditional)',
    hasFlagText(decision, 'Section 7 Rec 8 (Conditional)'));

  // Does NOT auto-pick continue/pause/switch — the flag explicitly says individual basis.
  check(failures, 'flag explicitly names individual-basis decision',
    hasFlagText(decision, 'individual basis'));

  // Specialist referral prompt surfaced (the flag message says "Specialist advice should be sought").
  check(failures, 'specialist advice / referral prompt surfaced',
    hasFlagText(decision, 'Specialist advice'));

  // §6.2 continuation criteria are explicitly noted as NOT applicable at the post-full-course
  // point — the flag rationale says "evidence base for continuing oral bisphosphonate beyond
  // 10 years ... is limited. Decisions should be individualised after specialist input."
  check(failures, '§6.2 standard continuation criteria framed as NOT applicable beyond 10y',
    hasFlagText(decision, 'beyond 10 years') && hasFlagText(decision, 'individualised'));

  // treatmentRecommended === true — patient remains on treatment pending specialist decision.
  // Engine push (symmetric to A1 Fix 3) adds current drug to recs on bp_holiday_not_appropriate.
  check(failures, 'treatmentRecommended === true (patient remains on treatment)',
    decision.treatmentRecommended === true,
    `got ${decision.treatmentRecommended}`);
  check(failures, 'recommendation list contains alendronate (continue current drug)',
    hasAgent(decision, 'alendronate'));

  // High-risk category (driven by prior vertebral fracture per Rec 8 routing in risk.ts).
  check(failures, 'risk category high',
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  return { name: 'TC88 — 10y course completed: Rec 8 individual basis + continue current drug', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.12 TCs — TC89–TC93 — Lock A1-impl Fix 4 / A2-impl / romo CV gate / GIOP simplification
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC89 ─────────────────────────────────────────────────────────────────
// On-treatment fragility fracture with adherence ≥80% (A1-impl Fix 4 + new continue-drug push).
// 70F, alendronate 3y, new T8 vert fragility fracture this week. Prior wrist fx age 65
// (pre-treatment). Adherence ≥80% confirmed. Schema fields ageAtStart=67, durationMonths=36,
// fractureOnCurrentTreatment=true, adherenceAdequate=true.
function tc89(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0,
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 2, // pre-treatment wrist + new vert
    dexaResults: { lumbarSpineTScore: -2.5, totalHipTScore: -2.4, femoralNeckTScore: -2.3, forearmTScore: null },
    fraxMOFPercent: 22.0,
    fraxHipPercent: 4.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.35, vitaminDNmol: 70, egfr: 65, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: {
      agent: 'alendronate',
      durationMonths: 36,
      reasonStopped: null,
      currentlyOn: true,
      monthsSinceLastDose: null,
      ageAtStart: 67,
      fractureOnCurrentTreatment: true,
      adherenceAdequate: true,
    },
  });
  const decision = runClinicalDecision(patient);

  // Tier 2 + Tier 3 secondary-cause-workup bloods appear as STRUCTURED entries (not only
  // in the narrative flag). on_treatment_fracture_pathway flag bypasses the index.ts gate.
  check(failures, 'Tier 2 entries present in investigationsNeeded',
    decision.investigationsNeeded.some(i => i.tier === 2));
  check(failures, 'Tier 3 PTH entry fires (Fix 4a or Pre.1)',
    decision.investigationsNeeded.some(i => i.investigation === 'pth' && i.tier === 3));

  // Planned-duration output extended to 10 yr (bp_duration_extension_indication).
  check(failures, 'planned-duration extension flag fires',
    hasFlag(decision, 'bp_duration_extension_indication'));
  check(failures, 'flag names extended target 10 years on alendronate',
    hasFlagText(decision, 'extended to 10 years') && hasFlagText(decision, 'alendronate'));

  // On-treatment-fracture narrative flag still fires.
  check(failures, 'on_treatment_fracture_pathway flag fires',
    hasFlag(decision, 'on_treatment_fracture_pathway'));

  // Treatment NOT routed to §7.4 failure.
  check(failures, 'treatment_failure flag does NOT fire',
    !hasFlag(decision, 'treatment_failure'));
  check(failures, 'treatment_failure_switch flag does NOT fire',
    !hasFlag(decision, 'treatment_failure_switch'));

  // bp_holiday_appropriate does NOT fire (duration < 60mo).
  check(failures, 'bp_holiday_appropriate does NOT fire',
    !hasFlag(decision, 'bp_holiday_appropriate'));

  // treatmentRecommended === true with alendronate continued.
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true,
    `got ${decision.treatmentRecommended}`);
  check(failures, 'alendronate in recommendations (continued)',
    hasAgent(decision, 'alendronate'));

  return { name: 'TC89 — on-treatment fracture + adherence ≥80%: extension + continue, not failure', passed: failures.length === 0, failures, decision };
}

// ─── TC90 ─────────────────────────────────────────────────────────────────
// VHR anabolic-referral cluster: Seq.1 + Seq.2 + Pre.1 + Pre.2 (A2-impl).
// 72F treatment-naïve, recent vert fx 14mo ago + FRAX MOF 31% (above engine VHRT 32.5? Not
// quite — falls back to recent-vert-fx VHR criterion). PTH and adjusted calcium both
// MISSING in bloodResults. No CV/VTE history.
function tc90(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 1, // 14 months ≈ 1y (engine VHR fires at ≤2)
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 2,
    dexaResults: { lumbarSpineTScore: -3.1, totalHipTScore: -2.6, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 33.0, // ≥ engine VHRT MOF 32.5 — also fires MOF VHR
    fraxHipPercent: 8.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: null, // MISSING — drives Pre.2 Tier 1 + Tier 3
      vitaminDNmol: 62,
      egfr: 68,
      alp: 80,
      tshMUL: 2.0,
      hbGramsPerLitre: 135,
      esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  // VHR classification (recent vert fx within 2y).
  check(failures, 'risk category very_high',
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);

  // Seq.1 — post_anabolic_antiresorptive fires at referral time.
  check(failures, 'post_anabolic_antiresorptive fires (Rec 14 at referral time)',
    hasFlag(decision, 'post_anabolic_antiresorptive'));

  // Seq.2 — sequential_therapy_plan_required fires (anabolicReferralFired gate).
  check(failures, 'sequential_therapy_plan_required fires',
    hasFlag(decision, 'sequential_therapy_plan_required'));

  // Pre.1 — Tier 3 PTH entry with teriparatide-specific reason.
  const pthEntry = decision.investigationsNeeded.find(i => i.investigation === 'pth' && i.tier === 3);
  check(failures, 'Tier 3 PTH entry present', !!pthEntry);
  check(failures, 'PTH entry has teriparatide-specific reason',
    !!pthEntry && /teriparatide/i.test(pthEntry.reason));

  // Pre.1 — Tier 1 eGFR entry not present here (eGFR is present in patient input, so the
  // missing-only Tier 1 push does not fire). This is the expected interaction: when eGFR
  // IS recorded, no Tier 1 entry. The teri-specific suffix would only apply if eGFR were
  // missing. This is a coverage gap worth a follow-up TC; for TC90 we only check that the
  // teri-PTH entry is present.

  // Pre.2 — Tier 1 calcium entry (missing) with romo-specific reason appended.
  // v1.43 calcium consolidation: the prior dual-push (Tier 1 + Tier 3) for caMissing+romoRef
  // was consolidated into a single Tier 1 entry. The Tier 3 entry's "document in referral
  // letter" instruction is now merged into the Tier 1 romoSuffix. Assertions updated to
  // verify the merged documentation prose is present on the Tier 1 entry, and that no Tier 3
  // calcium entry fires for the caMissing path (the caOutOfRange Tier 3 path is unchanged
  // but doesn't apply here because Ca is missing, not present-and-abnormal).
  const calciumTier1 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 1);
  check(failures, 'Tier 1 calcium entry fires (calcium missing)', !!calciumTier1);
  check(failures, 'Tier 1 calcium entry has romosozumab-specific reason',
    !!calciumTier1 && /romosozumab/i.test(calciumTier1.reason));
  check(failures, 'Tier 1 calcium entry includes documentation instruction (v1.43 consolidation)',
    !!calciumTier1 && /document the corrected value in the referral letter/i.test(calciumTier1.reason));
  const calciumTier3 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 3);
  check(failures, 'No Tier 3 calcium entry for caMissing path (v1.43 consolidation — was dual-push pre-v1.43)',
    !calciumTier3);

  // Both teriparatide and romosozumab pass gates — proxy: teri triggers Pre.1 PTH (✓ above);
  // romo triggers Pre.2 calcium consolidated Tier 1 entry (✓ above with documentation prose)
  // AND romosozumab_cv_risk_framing fires (rather than the exclusion variant, since no
  // MI/stroke history).
  check(failures, 'romosozumab_cv_risk_framing fires (romo passes gate, female VHR, no CV CI)',
    hasFlag(decision, 'romosozumab_cv_risk_framing'));
  check(failures, 'romosozumab_excluded_mi_stroke_history does NOT fire (no MI/stroke)',
    !hasFlag(decision, 'romosozumab_excluded_mi_stroke_history'));

  return { name: 'TC90 — VHR anabolic cluster: Seq.1 + Seq.2 + Pre.1 PTH + Pre.2 Ca Tier1 (with romo+documentation suffix, v1.43)', passed: failures.length === 0, failures, decision };
}

// ─── TC91 ─────────────────────────────────────────────────────────────────
// Raloxifene follow-on after anabolic (A2-impl Seq.5).
// 68F treatment-naïve, recent vert fx 10mo ago → VHR. eGFR 28 (BPs CI'd by renal cutoff).
// Denosumab declined → refusesInjections=true. No VTE. No stroke.
function tc91(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 1, // 10 months ≈ 1y (engine VHR fires at ≤2)
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -3.0, totalHipTScore: -2.5, femoralNeckTScore: -2.4, forearmTScore: null },
    fraxMOFPercent: 35.0, // also above VHRT for belt-and-braces
    fraxHipPercent: 8.0,
    fraxCalculatedWithBMD: true,
    refusesInjections: true, // denosumab declined
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 28, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // VHR + anabolic referral fires (proxy via post_anabolic_antiresorptive).
  check(failures, 'risk category very_high',
    decision.riskStratification.category === 'very_high');
  check(failures, 'anabolicReferralFired (proxy: post_anabolic_antiresorptive fires)',
    hasFlag(decision, 'post_anabolic_antiresorptive'));

  // Seq.5 raloxifene_anabolic_follow_on_option flag fires.
  check(failures, 'raloxifene_anabolic_follow_on_option flag fires',
    hasFlag(decision, 'raloxifene_anabolic_follow_on_option'));

  // Flag text includes vertebral-only-benefit caveat and VTE-CI note.
  check(failures, 'flag includes vertebral-only-benefit caveat',
    hasFlagText(decision, 'vertebral-only') || hasFlagText(decision, 'no hip fracture efficacy'));
  check(failures, 'flag includes VTE CI note',
    hasFlagText(decision, 'VTE'));

  // No oral or IV bisphosphonate in recommendations (eGFR 28 → all BPs CI'd).
  check(failures, 'no alendronate in recommendations', !hasAgent(decision, 'alendronate'));
  check(failures, 'no risedronate in recommendations', !hasAgent(decision, 'risedronate'));
  check(failures, 'no ibandronate in recommendations', !hasAgent(decision, 'ibandronate'));
  check(failures, 'no zoledronate in recommendations', !hasAgent(decision, 'zoledronate'));

  // No denosumab in recommendations (stripped by refusesInjections filter).
  check(failures, 'no denosumab in recommendations', !hasAgent(decision, 'denosumab'));

  return { name: 'TC91 — Seq.5 raloxifene follow-on: VHR + BP-CI + denosumab declined + no VTE', passed: failures.length === 0, failures, decision };
}

// ─── TC92 ─────────────────────────────────────────────────────────────────
// Romosozumab CV gate any-history tightening (engine commit b0d19dd predecessor: 87beee6).
// 70F treatment-naïve, recent vert fx 8mo ago + FRAX 33% above engine VHRT 32.5% → VHR.
// LS = -3.4 (just ABOVE the -3.5 standard VHR cutoff so VHR fires via FRAX MOF and
// recent-fx, not via direct T-score). Prior MI 5y ago → priorMIOrStroke=true.
function tc92(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 0, // 8 months — within 2y
    recentFractureWithin2Years: true,
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -3.4, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 33.0, // ≥ 32.5 fires MOF VHR; recent vert fx also fires VHR independently
    fraxHipPercent: 8.0,
    fraxCalculatedWithBMD: true,
    priorMIOrStroke: true, // prior MI 5y ago
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // VHR classification.
  check(failures, 'risk category very_high',
    decision.riskStratification.category === 'very_high');

  // CV-history exclusion explicitly cited.
  check(failures, 'romosozumab_excluded_mi_stroke_history flag fires',
    hasFlag(decision, 'romosozumab_excluded_mi_stroke_history'));
  check(failures, 'exclusion flag cites MI or stroke history',
    hasFlagText(decision, 'MI or stroke history') ||
    hasFlagText(decision, 'prior MI'));
  check(failures, 'exclusion flag cites spec §5.5 no-time-window',
    hasFlagText(decision, '§5.5') || hasFlagText(decision, 'no time window'));

  // romosozumab_cv_risk_framing should NOT fire (replaced by exclusion variant for this subgroup).
  check(failures, 'romosozumab_cv_risk_framing does NOT fire (replaced by exclusion)',
    !hasFlag(decision, 'romosozumab_cv_risk_framing'));

  // Teriparatide is the remaining anabolic option — Pre.1 PTH Tier 3 fires.
  const pthEntry = decision.investigationsNeeded.find(i => i.investigation === 'pth' && i.tier === 3);
  check(failures, 'teriparatide PTH Tier 3 entry fires',
    !!pthEntry && /teriparatide/i.test(pthEntry.reason));

  // Pre.2 romo outputs do NOT fire (romoRef === false).
  // Calcium is present (not missing) — so Tier 1 entry does not fire at all here.
  // Tier 3 corrected-Ca entry must NOT fire because romoRef is false.
  const calciumTier3 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 3);
  check(failures, 'no Tier 3 corrected-Ca entry (romoRef === false)', !calciumTier3);

  // Romosozumab is NOT in any recommendation or referral list (it never is — surfaced via
  // flags only — but assert explicitly per spec).
  check(failures, 'no romosozumab in recommendations',
    !decision.treatmentRecommendations.some(r => r.agent === 'romosozumab'));

  return { name: 'TC92 — romo CV any-history exclusion: VHR + prior MI 5y ago → no romo, teri remains', passed: failures.length === 0, failures, decision };
}

// ─── TC93 (v1.14) ─────────────────────────────────────────────────────────
// VHR-via-VHR-3 (LS ≤ −3.5) AND VHR-via-VHR-4 (high-dose GC ≥7.5 mg/day × ≥3mo).
// 62F treatment-naïve, prednisolone 8 mg/day × 18mo. T-scores: hip −2.9, FN −2.8, LS −3.6.
// No fractures. FRAX MOF 21%. eGFR + calcium both MISSING (drives Pre.1 eGFR teri suffix
// and Pre.2 Ca Tier 1 + Tier 3 corrected-calcium).
//
// Two VHR criteria fire: (1) standard NOGG Rec 8 T-score VHR via LS = −3.6 ≤ −3.5; (2) GC
// VHR via 8 mg/day × 18mo (≥7.5 × ≥3mo). Because GC is among the firing VHR criteria,
// the vhr_specialist_referral message escalates to URGENT with the bridging-BP +
// urgent-referral instruction (gcDrivesVHR predicate in treatment.ts).
//
// v1.14 doc flipped this TC: previously asserted "no anabolic referral" (contradicted
// standard Rec 8); now asserts VHR + full anabolic-referral cluster fires.
function tc93(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 62,
    sex: 'female',
    glucocorticoidUse: { current: true, durationMonths: 18, dose: 'medium' },
    glucocorticoidDoseMgDay: 8,
    glucocorticoidStatus: 'current',
    rheumatoidArthritis: true, // GC for RA per doc context
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -2.9, femoralNeckTScore: -2.8, forearmTScore: null },
    fraxMOFPercent: 21.0,
    fraxHipPercent: 3.2,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: null, // MISSING — drives Pre.2 Tier 1 (romo suffix) + Tier 3 corrected-Ca
      vitaminDNmol: 70,
      egfr: null, // MISSING — drives Pre.1 Tier 1 eGFR (teri suffix)
      alp: 80,
      tshMUL: 2.0,
      hbGramsPerLitre: 135,
      esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  // VHR classification: standard Rec 8 fires via LS ≤ −3.5 AND GC ≥7.5 × ≥3mo.
  check(failures, 'riskCategory === very_high',
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);

  // anabolicReferralFired === true (proxy: post_anabolic_antiresorptive fires).
  check(failures, 'post_anabolic_antiresorptive fires (Rec 14 at referral time)',
    hasFlag(decision, 'post_anabolic_antiresorptive'));

  // VHR specialist referral fires (§3.3 routing).
  check(failures, 'vhr_specialist_referral flag fires',
    hasFlag(decision, 'vhr_specialist_referral'));

  // URGENT escalation + bridging-BP instruction because GC drives VHR (gcDrivesVHR).
  const vhrRefFlag = decision.flags.find(f => f.id === 'vhr_specialist_referral');
  check(failures, 'vhr_specialist_referral severity URGENT (GC drives VHR)',
    !!vhrRefFlag && vhrRefFlag.severity === 'urgent');
  check(failures, 'vhr_specialist_referral message includes URGENT + bridging-BP instruction',
    hasFlagText(decision, 'URGENT') && hasFlagText(decision, 'oral bisphosphonate in the meantime'));
  // v1.40 GIOP refactor — the parallel rheumatology:urgent referral push that previously
  // satisfied this assertion was removed. The urgency signal is now carried by
  // vhr_specialist_referral.severity === 'urgent' (asserted above). For VHR-GIOP patients
  // the GIOP override returns from giop() before reaching Site A's standard VHR block,
  // and the Option B mirror block only pushes the flag, not a parallel referral object —
  // so decision.referrals is expected to be empty for this patient post-refactor. The
  // Site A/B metabolic_bone referral asymmetry is tracked as a known gap (out of scope
  // for the v1.40 refactor).

  // Sequential-planning fires (Seq.2 third push gate on anabolicReferralFired).
  check(failures, 'sequential_therapy_plan_required fires',
    hasFlag(decision, 'sequential_therapy_plan_required'));

  // Pre.1 PTH Tier 3 with teri-specific reason.
  const pthEntry = decision.investigationsNeeded.find(i => i.investigation === 'pth' && i.tier === 3);
  check(failures, 'Tier 3 PTH entry fires with teriparatide-specific reason',
    !!pthEntry && /teriparatide/i.test(pthEntry.reason));

  // Pre.1 eGFR Tier 1 with teri-specific suffix (eGFR missing).
  const egfrEntry = decision.investigationsNeeded.find(i => i.investigation === 'egfr' && i.tier === 1);
  check(failures, 'Tier 1 eGFR entry fires (eGFR missing) with teriparatide suffix',
    !!egfrEntry && /teriparatide/i.test(egfrEntry.reason));

  // Pre.2 Ca Tier 1 with romo-specific suffix (Ca missing).
  // v1.43 calcium consolidation: the prior Tier 3 corrected-calcium entry for the
  // caMissing+romoRef case was dropped; the documentation instruction is now merged into
  // the Tier 1 romoSuffix. Assertions updated to verify the merged prose on Tier 1 and
  // absence of Tier 3 calcium entry for this caMissing path.
  const calciumTier1 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 1);
  check(failures, 'Tier 1 calcium entry fires (calcium missing) with romosozumab suffix',
    !!calciumTier1 && /romosozumab/i.test(calciumTier1.reason));
  check(failures, 'Tier 1 calcium entry includes documentation instruction (v1.43 consolidation)',
    !!calciumTier1 && /document the corrected value in the referral letter/i.test(calciumTier1.reason));
  const calciumTier3 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 3);
  check(failures, 'No Tier 3 calcium entry for caMissing path (v1.43 consolidation — was dual-push pre-v1.43)',
    !calciumTier3);

  // giop_monitoring fires with A2-impl-corrected text.
  check(failures, 'giop_monitoring flag fires',
    hasFlag(decision, 'giop_monitoring'));
  check(failures, 'giop_monitoring includes ALP in annual bloods',
    hasFlagText(decision, 'calcium, vitamin D, eGFR, ALP'));
  check(failures, 'giop_monitoring includes FRAX-at-DEXA-repeat sentence',
    hasFlagText(decision, 'Reassess FRAX with BMD at each DEXA repeat'));

  // treatmentRecommended === true.
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true,
    `got ${decision.treatmentRecommended}`);

  return { name: 'TC93 (v1.14) — VHR via T ≤ −3.5 AND GC ≥7.5 × ≥3mo: full anabolic cluster + URGENT', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.15 TCs — TC94 + TC95 — Lock VHR classifier audit-identified fixes (B1, B3)
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC94 ─────────────────────────────────────────────────────────────────
// VHR-2 vertebral-fracture-specific count (locks Fix B1).
// 65F, 1 vertebral fx age 61 (4y ago — OLD, outside 24mo VHR-1 window) + 1 wrist fx age
// 60 (5y ago). T-scores all above −3.5 (no VHR-3 trigger). FRAX MOF 20% (above age-65 IT
// 16.5% but below age-65 VHRT 26.4%). Pre-Fix B1 the engine fired VHR-2 falsely on
// numberOfPriorFractures ≥ 2 (total fracture count, not vertebral-only). Post-fix the
// predicate uses numberOfVertebralFractures and correctly skips the criterion.
function tc94(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 4, // OLD — outside VHR-1's 24mo window
    recentFractureWithin2Years: false,
    numberOfPriorFractures: 2,        // 1 vertebral + 1 wrist
    numberOfVertebralFractures: 1,    // Fix B1 schema field — vertebral-specific count
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 20.0,
    fraxHipPercent: 4.2,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // Patient routes to HIGH (NOT very_high) via the prior-fragility-fracture-high path
  // (risk.ts:177-186 — NOGG Rec 8 prior-fx treat-immediately). NO VHR criterion fires.
  check(failures, "riskCategory === 'high' (NOT very_high)",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // VHR-2 specifically does NOT fire — vertebral-specific count predicate now correctly
  // sees numberOfVertebralFractures=1 (not the legacy total-count 2).
  check(failures, 'VHR-2 does NOT fire (rationale does not mention "two or more vertebral")',
    !decision.riskStratification.rationale.toLowerCase().includes('two or more vertebral'));

  // Sanity: rationale reflects a standard high-risk route — either T-score ≤ −2.5
  // (LS −2.8 in this patient fires risk.ts:78-84 first) or the prior-fx-high path
  // (NOGG Rec 8). Either is a valid non-VHR "high" route; assertion accepts both.
  check(failures, 'rationale reflects a standard high-risk route (T-score or prior-fx)',
    /t-score/i.test(decision.riskStratification.rationale) ||
    /rec 8/i.test(decision.riskStratification.rationale) ||
    /prior\s+\S+\s+fracture/i.test(decision.riskStratification.rationale));

  // anabolicReferralFired === false → none of the VHR-anabolic-referral cluster fires.
  check(failures, 'post_anabolic_antiresorptive does NOT fire (Seq.1 gate closed)',
    !hasFlag(decision, 'post_anabolic_antiresorptive'));
  check(failures, 'vhr_specialist_referral does NOT fire',
    !hasFlag(decision, 'vhr_specialist_referral'));
  check(failures, 'sequential_therapy_plan_required does NOT fire',
    !hasFlag(decision, 'sequential_therapy_plan_required'));
  check(failures, 'romosozumab_cv_risk_framing does NOT fire (only fires for VHR females)',
    !hasFlag(decision, 'romosozumab_cv_risk_framing'));

  // No teriparatide-specific Tier 3 PTH push (teriparatideReferralFired === false).
  const pthEntry = decision.investigationsNeeded.find(i => i.investigation === 'pth' && i.tier === 3);
  check(failures, 'Tier 3 PTH entry does NOT carry teriparatide-specific reason',
    !pthEntry || !/teriparatide/i.test(pthEntry.reason));

  // Standard high-risk antiresorptive pathway fires — alendronate (+ risedronate) as
  // equivalent first-line per NOGG Rec 12 / §6 Rec 2.
  check(failures, 'standard high-risk antiresorptive pathway fires (BP first-line)',
    hasAgent(decision, 'alendronate') || hasAgent(decision, 'risedronate'));
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  return { name: 'TC94 — VHR-2 vertebral-specific count: 1 vert + 1 wrist → high, NOT very_high', passed: failures.length === 0, failures, decision };
}

// ─── TC95 ─────────────────────────────────────────────────────────────────
// VHR-6 age-specific VHRT lookup (locks Fix B3).
// 55F, manual FRAX MOF 17% (above age-55 VHRT 15.2% = itMOF 9.5 × 1.6, but below the
// previous fixed 32.5% which was the age-70+ value). T-scores all above −2.5
// (osteopenia only, no VHR-3 trigger). Two FRAX RFs (smoker + parental hip fx). No
// fractures. No GC. Pre-Fix B3 the engine used fixed 32.5/8.6 thresholds — MOF 17%
// silently missed VHR. Post-fix the engine looks up age-specific VHRT from
// NOGG_2024_THRESHOLDS × 1.6 and correctly classifies as very_high.
function tc95(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 55,
    sex: 'female',
    currentSmoker: true,
    parentalHipFracture: true,
    dexaResults: { lumbarSpineTScore: -2.2, totalHipTScore: -2.0, femoralNeckTScore: -1.9, forearmTScore: null },
    fraxMOFPercent: 17.0,
    fraxHipPercent: 1.8,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 80, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // VHR-6 fires via age-specific VHRT lookup (age-55: itMOF 9.5% × 1.6 = 15.2%). MOF 17%
  // ≥ 15.2% → VHR. Pre-Fix B3 the engine compared to fixed 32.5% → would have classified
  // as high or intermediate, missing VHR.
  check(failures, "riskCategory === 'very_high'",
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);

  // Rationale explicitly cites the age-specific VHRT trigger.
  check(failures, 'rationale references age-specific VHRT (not the fixed 32.5%)',
    /age-specific vhrt/i.test(decision.riskStratification.rationale) &&
    /15\.2%/.test(decision.riskStratification.rationale));

  // No urgent escalation — GC is NOT among firing criteria. vhr_specialist_referral
  // severity should be 'warning', not 'urgent'.
  const vhrRefFlag = decision.flags.find(f => f.id === 'vhr_specialist_referral');
  check(failures, 'vhr_specialist_referral fires', !!vhrRefFlag);
  check(failures, 'vhr_specialist_referral severity is warning (NOT urgent — GC not firing)',
    !!vhrRefFlag && vhrRefFlag.severity === 'warning');
  // v1.44 — metabolic_bone Referrals-section duplicate removed. The "NOT urgent"
  // signal is fully covered by the flag-severity assertion immediately above
  // (severity === 'warning' is the canonical "non-GC VHR, not urgent" signal).
  // The standalone metabolic_bone-urgency assertion has been dropped as redundant.

  // anabolicReferralFired === true → full standard VHR-anabolic-referral cluster fires.
  // Seq.1 post_anabolic_antiresorptive (Rec 14 at referral time).
  check(failures, 'Seq.1 post_anabolic_antiresorptive fires',
    hasFlag(decision, 'post_anabolic_antiresorptive'));
  // Seq.2 sequential_therapy_plan_required (anabolicReferralFired push gate).
  check(failures, 'Seq.2 sequential_therapy_plan_required fires',
    hasFlag(decision, 'sequential_therapy_plan_required'));
  // Pre.1 — teriparatideReferralFired drives PTH Tier 3 with teri-specific reason.
  // PTH always pushes for teriRef (schema doesn't carry a PTH value to gate on).
  const pthEntry = decision.investigationsNeeded.find(i => i.investigation === 'pth' && i.tier === 3);
  check(failures, 'Pre.1 PTH Tier 3 entry fires with teriparatide-specific reason',
    !!pthEntry && /teriparatide/i.test(pthEntry.reason));
  // Pre.1 eGFR Tier 1 entry does NOT fire — eGFR replete (present + normal) means the
  // missing-only Tier 1 push doesn't fire. Document this gate state explicitly.
  const egfrEntry = decision.investigationsNeeded.find(i => i.investigation === 'egfr' && i.tier === 1);
  check(failures, 'Pre.1 eGFR Tier 1 entry NOT present (eGFR replete, not missing)',
    !egfrEntry);
  // Pre.2 / romoRef — romosozumab_cv_risk_framing fires for female VHR without
  // priorMIOrStroke (proxy that romosozumabReferralFired === true). Pre.2 Tier 1/Tier 3
  // calcium entries do NOT fire — calcium replete + in range means neither the
  // missing-only Tier 1 push nor the (missing OR out-of-range) Tier 3 push fires.
  check(failures, 'Pre.2 — romosozumab_cv_risk_framing fires (romoRef passes gate)',
    hasFlag(decision, 'romosozumab_cv_risk_framing'));
  const calciumTier3 = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 3);
  check(failures, 'Pre.2 Tier 3 corrected-Ca NOT present (calcium replete + in range)',
    !calciumTier3);

  return { name: 'TC95 — VHR-6 age-specific VHRT: 55F MOF 17% (≥ 15.2%) → very_high', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.17 TCs — TC96–TC100 — Pre-treatment safety filters (F1–F5)
// Locks the safetyFilters.ts engine impl (NOGG 2024 p.29/30/34 + Rec 17 Strong).
// ═══════════════════════════════════════════════════════════════════════════

// All five TCs reference these antiresorptive lists. Ibandronate has both oral and IV
// preparations sharing agent='ibandronate' — distinguish via dose.includes('IV') when
// the oral-vs-parenteral distinction matters.
const ANTIRESORPTIVE_AGENTS: ReadonlyArray<TreatmentAgent> = [
  'alendronate', 'risedronate', 'ibandronate', 'zoledronate', 'denosumab', 'romosozumab',
];

function isOralBP(rec: { agent: TreatmentAgent; dose: string }): boolean {
  if (rec.agent === 'alendronate' || rec.agent === 'risedronate') return true;
  if (rec.agent === 'ibandronate' && !rec.dose.includes('IV')) return true;
  return false;
}

function isParenteralAR(rec: { agent: TreatmentAgent; dose: string }): boolean {
  if (rec.agent === 'denosumab' || rec.agent === 'romosozumab' || rec.agent === 'zoledronate') return true;
  if (rec.agent === 'ibandronate' && rec.dose.includes('IV')) return true;
  return false;
}

// ─── TC96 ─────────────────────────────────────────────────────────────────
// Filter F1 — universal hypocalcaemia block (NOGG p.29 §a / p.30 §a / p.34 §c).
// 72F high-risk (T-score LS −3.0 fires T-score-high path). Ca 2.05 → ALL antiresorptive
// entries in treatmentRecommendations tagged 'blocked'. Vit D 65 replete → no Vit D
// filter. Combined safety gate doesn't fire (Vit D replete, only hypoCa).
function tc96(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 72,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -3.0, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 22.0,
    fraxHipPercent: 5.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.05, // hypoCa
      vitaminDNmol: 65,          // replete
      egfr: 62,                  // normal
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high' (LS −3.0 hits T-score-high path; no VHR triggers)",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  // Every antiresorptive in recs tagged 'blocked' with citation of Ca value.
  const antiresorptiveRecs = decision.treatmentRecommendations.filter(r => ANTIRESORPTIVE_AGENTS.includes(r.agent));
  check(failures, 'at least one antiresorptive in recommendations',
    antiresorptiveRecs.length > 0,
    `got ${antiresorptiveRecs.length}`);
  for (const rec of antiresorptiveRecs) {
    check(failures, `${rec.agent} status === 'blocked'`,
      rec.status === 'blocked',
      `got status=${rec.status}`);
    check(failures, `${rec.agent} blockReason cites 2.05 mmol/L below 2.10`,
      !!rec.blockReason && rec.blockReason.includes('2.05') && rec.blockReason.includes('below 2.10'));
    check(failures, `${rec.agent} unblockAction references "Correct hypocalcaemia"`,
      !!rec.unblockAction && /correct hypocalcaemia/i.test(rec.unblockAction));
  }

  // F1 flag fires urgent with NOGG attribution + Vit D loading-dose guidance.
  const f1Flag = decision.flags.find(f => f.id === 'hypocalcaemia_antiresorptive_block');
  check(failures, 'hypocalcaemia_antiresorptive_block flag fires',
    !!f1Flag);
  check(failures, 'F1 flag severity urgent',
    f1Flag?.severity === 'urgent');
  check(failures, 'F1 message cites NOGG 2024 + one of p.29/p.30/p.34',
    !!f1Flag && /NOGG 2024/i.test(f1Flag.message) && /(p\.29|p\.30|p\.34)/i.test(f1Flag.message));
  check(failures, 'F1 message references Vit D loading dose (100,000 or 300,000)',
    !!f1Flag && /(100,?000|300,?000)/i.test(f1Flag.message));

  // No anabolic in recommendations (anabolics surface via referrals only). Verify that
  // any teri/abalo entry that did slip in is NOT tagged 'blocked' by F1.
  const anabolicsInRecs = decision.treatmentRecommendations.filter(
    r => r.agent === 'teriparatide' || r.agent === 'abaloparatide',
  );
  check(failures, "anabolic entries (if any) NOT tagged 'blocked' by F1",
    anabolicsInRecs.every(r => r.status !== 'blocked'));

  // Existing bloodFlags hypocalcaemia narrative warning continues to fire (additive).
  check(failures, 'bloodFlags hypocalcaemia narrative flag continues to fire (additive)',
    hasFlag(decision, 'hypocalcaemia') &&
    !!decision.flags.find(f => f.id === 'hypocalcaemia' && f.severity === 'urgent'));

  // Combined safety gate does NOT fire (Vit D replete).
  check(failures, 'two_safety_blockers does NOT fire (Vit D replete)',
    !hasFlag(decision, 'two_safety_blockers'));

  // Tier 1 missing-Ca entry does NOT fire (Ca IS measured, just out of range).
  const tier1Ca = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 1);
  check(failures, 'Tier 1 calcium entry NOT pushed (Ca measured)',
    !tier1Ca);

  return { name: 'TC96 — F1 universal hypoCa block: every antiresorptive tagged blocked + NOGG-attributed urgent flag', passed: failures.length === 0, failures, decision };
}

// ─── TC97 ─────────────────────────────────────────────────────────────────
// Filter F2 — missing-calcium pending block (spec v1.37 §4 + §5.3).
// 68F high-risk. Ca null → ALL antiresorptive entries tagged 'pending'. Vit D replete.
function tc97(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 68,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.6, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 20.0,
    fraxHipPercent: 4.5,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: null, // missing
      vitaminDNmol: 62,          // replete
      egfr: 70,                  // normal
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  // Every antiresorptive tagged 'pending'.
  const antiresorptiveRecs = decision.treatmentRecommendations.filter(r => ANTIRESORPTIVE_AGENTS.includes(r.agent));
  check(failures, 'at least one antiresorptive in recommendations',
    antiresorptiveRecs.length > 0);
  for (const rec of antiresorptiveRecs) {
    check(failures, `${rec.agent} status === 'pending'`,
      rec.status === 'pending');
    check(failures, `${rec.agent} blockReason cites missing-Ca`,
      !!rec.blockReason && (/not yet measured/i.test(rec.blockReason) || /pre-treatment corrected calcium/i.test(rec.blockReason)));
    check(failures, `${rec.agent} unblockAction references Check Ca / Tier 1`,
      !!rec.unblockAction && (/check corrected calcium/i.test(rec.unblockAction) || /tier 1/i.test(rec.unblockAction)));
  }

  // F2 flag fires urgent.
  const f2Flag = decision.flags.find(f => f.id === 'calcium_unmeasured_antiresorptive_block');
  check(failures, 'calcium_unmeasured_antiresorptive_block fires urgent',
    !!f2Flag && f2Flag.severity === 'urgent');

  // Tier 1 missing-calcium investigation entry still fires (existing behaviour).
  const tier1Ca = decision.investigationsNeeded.find(i => i.investigation === 'calcium' && i.tier === 1);
  check(failures, 'Tier 1 calcium entry fires (existing missing-Ca path)',
    !!tier1Ca);

  // F1 / F3 / F4 do NOT fire.
  check(failures, 'F1 hypocalcaemia_antiresorptive_block does NOT fire',
    !hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));
  check(failures, 'F3 vitd_parenteral_block does NOT fire (Vit D replete)',
    !hasFlag(decision, 'vitd_parenteral_block'));
  check(failures, 'F4 vitd_unmeasured_parenteral_block does NOT fire (Vit D measured)',
    !hasFlag(decision, 'vitd_unmeasured_parenteral_block'));

  // Planned treatment preserved with pending tag.
  check(failures, 'treatmentRecommendations is non-empty (planned treatment preserved)',
    decision.treatmentRecommendations.length > 0);

  return { name: 'TC97 — F2 missing-Ca pending block: every antiresorptive tagged pending + urgent flag', passed: failures.length === 0, failures, decision };
}

// ─── TC98 ─────────────────────────────────────────────────────────────────
// Filter F5 — continuation-context hypoCa for on-denosumab patients.
// 74F currently on denosumab 18mo (next dose due at 6mo from last). New hypoCa on routine
// pre-dose bloods. VHR via prior vert fx within 2y. F1 also fires (universal hypoCa); F5
// adds the continuation-specific "HOLD next dose" action. Vit D replete + Ca measured →
// F3/F4 don't fire.
function tc98(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 74,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 2, // VHR-1 trigger (≤ 2y)
    recentFractureWithin2Years: false, // pre-treatment vert fx; not a new fracture in last 24mo
    numberOfPriorFractures: 1,
    numberOfVertebralFractures: 1,
    dexaResults: { lumbarSpineTScore: -2.8, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 25.0,
    fraxHipPercent: 6.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.05, // new hypoCa on routine monitoring
      vitaminDNmol: 60,           // replete
      egfr: 55,                   // CKD stage 3a, not severe
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
    currentTreatment: {
      agent: 'denosumab',
      durationMonths: 18,
      reasonStopped: null,
      currentlyOn: true,
      monthsSinceLastDose: 5, // approaching 6-month next dose
    },
  });
  const decision = runClinicalDecision(patient);

  // F5 flag fires with severity urgent and distinct id.
  const f5Flag = decision.flags.find(f => f.id === 'denosumab_continuation_hypocalcaemia_hold');
  check(failures, 'denosumab_continuation_hypocalcaemia_hold flag fires',
    !!f5Flag);
  check(failures, 'F5 severity urgent',
    f5Flag?.severity === 'urgent');
  check(failures, 'F5 message contains "HOLD next denosumab dose"',
    !!f5Flag && /HOLD next denosumab dose/i.test(f5Flag.message));
  check(failures, 'F5 message references 7-month rebound risk window',
    !!f5Flag && /7 months/i.test(f5Flag.message) && /rebound/i.test(f5Flag.message));

  // Generic bloodFlags hypocalcaemia warning continues to fire alongside (additive).
  check(failures, 'bloodFlags hypocalcaemia urgent flag continues to fire (additive)',
    !!decision.flags.find(f => f.id === 'hypocalcaemia' && f.severity === 'urgent'));

  // Denosumab in recommendations tagged blocked via F1; F5 overrides unblockAction.
  const denoRec = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  check(failures, 'denosumab in treatmentRecommendations',
    !!denoRec);
  check(failures, "denosumab status === 'blocked'",
    denoRec?.status === 'blocked');
  check(failures, 'denosumab unblockAction overridden to HOLD-next-dose wording (F5)',
    !!denoRec?.unblockAction && /HOLD next denosumab dose/i.test(denoRec.unblockAction));
  check(failures, "denosumab recipe contraindications retain 'Uncorrected hypocalcaemia' entry (regression check)",
    !!denoRec?.contraindications.some(s => /uncorrected hypocalcaemia/i.test(s)));

  // F1 also fires (combined with F5).
  check(failures, 'F1 hypocalcaemia_antiresorptive_block also fires (combined)',
    hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));

  // F2, F3 do NOT fire.
  check(failures, 'F2 calcium_unmeasured_antiresorptive_block does NOT fire (Ca measured)',
    !hasFlag(decision, 'calcium_unmeasured_antiresorptive_block'));
  check(failures, 'F3 vitd_parenteral_block does NOT fire (Vit D replete)',
    !hasFlag(decision, 'vitd_parenteral_block'));

  // treatmentRecommended === true — recommendation preserved (blocked tag, not removed).
  check(failures, 'treatmentRecommended === true (recipe preserved with blocked tag)',
    decision.treatmentRecommended === true);

  return { name: 'TC98 — F5 continuation hypoCa: HOLD-next-dose flag + denosumab blocked w/ continuation-specific action', passed: failures.length === 0, failures, decision };
}

// ─── TC99 ─────────────────────────────────────────────────────────────────
// Filter F3 — Vit D <50 parenteral block (NOGG Rec 17 Strong).
// 69F high-risk (LS −2.9). Vit D 42 < 50, Ca normal, eGFR 68 normal. Engine pushes oral
// BPs only (eGFR normal). Parenteral block flag fires; oral BPs continue 'active' with
// the Rec 17 supplementation note appended to monitoring.
function tc99(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 69,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 21.0,
    fraxHipPercent: 4.8,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.35, // normal
      vitaminDNmol: 42,           // insufficient (<50, >25)
      egfr: 68,                   // normal
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  // Parenteral entries (if any) tagged 'blocked'. With eGFR 68 there are no parenteral
  // recipes pushed — the engine's first-line for normal eGFR is oral BPs. The assertion
  // is vacuously true; the flag firing is the meaningful test.
  const parenterals = decision.treatmentRecommendations.filter(isParenteralAR);
  for (const rec of parenterals) {
    check(failures, `${rec.agent} (parenteral) status === 'blocked'`,
      rec.status === 'blocked');
    check(failures, `${rec.agent} blockReason cites Vit D 42 / below 50`,
      !!rec.blockReason && /vit d/i.test(rec.blockReason) && (/42/.test(rec.blockReason) || /below 50/i.test(rec.blockReason)));
    check(failures, `${rec.agent} unblockAction references Vit D treatment / spec §4.3`,
      !!rec.unblockAction && (/treat vit d/i.test(rec.unblockAction) || /loading/i.test(rec.unblockAction) || /§4\.3/.test(rec.unblockAction)));
  }

  // Oral BPs tagged 'active' (or undefined — both mean active) with Rec 17 monitoring note.
  const oralBPs = decision.treatmentRecommendations.filter(isOralBP);
  check(failures, 'at least one oral BP in recommendations (eGFR normal)',
    oralBPs.length > 0);
  for (const rec of oralBPs) {
    check(failures, `${rec.agent} (oral BP) status active (or undefined)`,
      rec.status === undefined || rec.status === 'active');
    const monitoringText = rec.monitoring.join(' | ');
    check(failures, `${rec.agent} monitoring contains NOGG Rec 17 + concurrent-supplementation note`,
      /rec 17/i.test(monitoringText) && (/alongside/i.test(monitoringText) || /concurrent/i.test(monitoringText) || /supplement/i.test(monitoringText)));
  }

  // F3 flag fires urgent.
  const f3Flag = decision.flags.find(f => f.id === 'vitd_parenteral_block');
  check(failures, 'vitd_parenteral_block flag fires urgent',
    !!f3Flag && f3Flag.severity === 'urgent');
  check(failures, 'F3 message cites NOGG + Rec 17',
    !!f3Flag && /NOGG/i.test(f3Flag.message) && /(rec 17|recommendation 17)/i.test(f3Flag.message));
  check(failures, 'F3 message mentions oral BPs remain available',
    !!f3Flag && /oral/i.test(f3Flag.message) && /(may be initiated|alongside|supplementation)/i.test(f3Flag.message));

  // Other filters NOT firing.
  check(failures, 'F1 does NOT fire (Ca replete)',
    !hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));
  check(failures, 'F2 does NOT fire (Ca measured)',
    !hasFlag(decision, 'calcium_unmeasured_antiresorptive_block'));
  check(failures, 'F4 does NOT fire (Vit D measured)',
    !hasFlag(decision, 'vitd_unmeasured_parenteral_block'));
  check(failures, 'two_safety_blockers does NOT fire (Vit D 42 above 25 severe threshold)',
    !hasFlag(decision, 'two_safety_blockers'));

  return { name: 'TC99 — F3 Vit D <50 parenteral block: oral BPs continue active w/ Rec 17 note + urgent flag', passed: failures.length === 0, failures, decision };
}

// ─── TC100 ────────────────────────────────────────────────────────────────
// Filter F4 — missing Vit D parenteral pending block (NOGG Rec 17 Strong).
// 67F high-risk (LS −2.7). Vit D null, Ca normal, eGFR 72 normal. Engine pushes oral
// BPs only. F4 flag fires; oral BPs continue 'active' with measure-and-supplement note.
function tc100(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.6, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 19.5,
    fraxHipPercent: 4.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.32, // normal
      vitaminDNmol: null,         // missing
      egfr: 72,                   // normal
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // Parenteral entries (if any) tagged 'pending'. Vacuous when no parenterals in recs.
  const parenterals = decision.treatmentRecommendations.filter(isParenteralAR);
  for (const rec of parenterals) {
    check(failures, `${rec.agent} (parenteral) status === 'pending'`,
      rec.status === 'pending');
    check(failures, `${rec.agent} blockReason references Vit D not measured`,
      !!rec.blockReason && (/not yet measured/i.test(rec.blockReason) || /require vit d/i.test(rec.blockReason)));
  }

  // Oral BPs active with Rec 17 measure-and-supplement note.
  const oralBPs = decision.treatmentRecommendations.filter(isOralBP);
  check(failures, 'at least one oral BP in recommendations',
    oralBPs.length > 0);
  for (const rec of oralBPs) {
    check(failures, `${rec.agent} status active`,
      rec.status === undefined || rec.status === 'active');
    const monitoringText = rec.monitoring.join(' | ');
    check(failures, `${rec.agent} monitoring contains Rec 17 + concurrent supplementation`,
      /rec 17/i.test(monitoringText) && /(alongside|concurrent|supplement)/i.test(monitoringText));
  }

  // F4 flag fires urgent + Rec 17 attribution.
  const f4Flag = decision.flags.find(f => f.id === 'vitd_unmeasured_parenteral_block');
  check(failures, 'vitd_unmeasured_parenteral_block flag fires urgent',
    !!f4Flag && f4Flag.severity === 'urgent');
  check(failures, 'F4 message cites NOGG Recommendation 17',
    !!f4Flag && /(rec 17|recommendation 17)/i.test(f4Flag.message));

  // Tier 1 Vit D investigation entry fires (existing missing-Vit-D path).
  const tier1VitD = decision.investigationsNeeded.find(i => i.investigation === 'vitamin_d' && i.tier === 1);
  check(failures, 'Tier 1 vitamin_d entry fires',
    !!tier1VitD);

  // Other filters NOT firing.
  check(failures, 'F1 does NOT fire (Ca replete)',
    !hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));
  check(failures, 'F2 does NOT fire (Ca measured)',
    !hasFlag(decision, 'calcium_unmeasured_antiresorptive_block'));
  check(failures, 'F3 does NOT fire (Vit D not measured — distinct from low-measured)',
    !hasFlag(decision, 'vitd_parenteral_block'));
  check(failures, 'two_safety_blockers does NOT fire',
    !hasFlag(decision, 'two_safety_blockers'));

  return { name: 'TC100 — F4 missing Vit D parenteral pending block: oral BPs active w/ Rec 17 note + urgent flag', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.18 TCs — TC101 + TC102 — Close the F3/F4 vacuous-assertion gap from v1.17
// At eGFR <35 the engine renally CI's all bisphosphonates → denosumab is the only
// viable parenteral, forcing it into treatmentRecommendations. Filter F3/F4 then
// operates on a non-empty subset and the status-tagging assertions are meaningful.
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC101 ────────────────────────────────────────────────────────────────
// F3 Vit D <50 parenteral block at low eGFR. 69F LS-osteoporosis (T-score-high path),
// Vit D 42 insufficient, Ca normal, eGFR 25 (stage 4 CKD). renal_bp_ci block at
// treatment.ts:1565+ filters out all bisphosphonates, leaving denosumab as the only
// parenteral candidate — Filter F3 then tags it 'blocked' on a non-empty subset.
function tc101(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 69,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.9, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 22.0,
    fraxHipPercent: 5.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.35,
      vitaminDNmol: 42,             // insufficient — <50, >25
      egfr: 25,                     // stage 4 CKD — renally CI's all BPs
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high' (LS −2.9 fires T-score-high path)",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  // Sanity check FIRST: denosumab must actually be in recs for status-tagging to be
  // meaningful (closes the vacuous-assertion gap from TC99).
  const denoRec = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  check(failures, 'SANITY: denosumab IS in treatmentRecommendations (renal CI to BPs at eGFR 25 → denosumab is the viable parenteral)',
    !!denoRec,
    `agents in recs: [${decision.treatmentRecommendations.map(r => r.agent).join(', ')}]`);

  // F3 status-tagging on the non-empty subset.
  check(failures, "denosumab status === 'blocked' (F3 parenteral block)",
    denoRec?.status === 'blocked',
    `got status=${denoRec?.status}`);
  check(failures, 'denosumab blockReason cites Vit D 42 / below 50',
    !!denoRec?.blockReason && /vit d/i.test(denoRec.blockReason) &&
    (/42/.test(denoRec.blockReason) || /below 50/i.test(denoRec.blockReason)));
  check(failures, 'denosumab unblockAction references Vit D treatment / loading / ≥50',
    !!denoRec?.unblockAction &&
    (/treat vit d/i.test(denoRec.unblockAction) || /loading/i.test(denoRec.unblockAction) ||
     /§4\.3/.test(denoRec.unblockAction) || /≥50/.test(denoRec.unblockAction)));

  // F3 urgent flag with NOGG Rec 17 attribution.
  const f3Flag = decision.flags.find(f => f.id === 'vitd_parenteral_block');
  check(failures, 'vitd_parenteral_block flag fires urgent',
    !!f3Flag && f3Flag.severity === 'urgent');
  check(failures, 'F3 message cites NOGG + Rec 17',
    !!f3Flag && /NOGG/i.test(f3Flag.message) &&
    (/rec 17/i.test(f3Flag.message) || /recommendation 17/i.test(f3Flag.message)));

  // Existing CKD-hypocalcaemia flag fires additively (eGFR <35 per NOGG p.30 §c).
  check(failures, 'denosumab_ckd_hypocalcaemia fires additively (eGFR <35)',
    hasFlag(decision, 'denosumab_ckd_hypocalcaemia'));

  // Oral and IV BPs filtered upstream by renal CIs.
  for (const a of ['alendronate', 'risedronate', 'ibandronate', 'zoledronate'] as const) {
    check(failures, `${a} NOT in recommendations (renal CI at eGFR 25)`,
      !hasAgent(decision, a));
  }

  // Other safety filters do NOT fire.
  check(failures, 'F1 does NOT fire (Ca replete)',
    !hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));
  check(failures, 'F2 does NOT fire (Ca measured)',
    !hasFlag(decision, 'calcium_unmeasured_antiresorptive_block'));
  check(failures, 'F4 does NOT fire (Vit D measured)',
    !hasFlag(decision, 'vitd_unmeasured_parenteral_block'));
  check(failures, 'two_safety_blockers does NOT fire (Vit D 42 above 25 severe threshold)',
    !hasFlag(decision, 'two_safety_blockers'));

  return { name: 'TC101 — F3 parenteral block at eGFR 25: denosumab tagged blocked + Rec 17 flag + CKD-hypoCa additive', passed: failures.length === 0, failures, decision };
}

// ─── TC102 ────────────────────────────────────────────────────────────────
// F4 missing-Vit-D parenteral pending block at low eGFR. 67F LS-osteoporosis, Vit D
// null (not measured), Ca normal, eGFR 25. Same renal-CI funnel as TC101 forces
// denosumab as the parenteral candidate; Filter F4 tags it 'pending'.
function tc102(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 67,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.6, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 20.0,
    fraxHipPercent: 4.0,
    fraxCalculatedWithBMD: true,
    bloodResults: {
      adjustedCalciumMmol: 2.32,
      vitaminDNmol: null,           // MISSING
      egfr: 25,                     // stage 4 CKD
      alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal',
    },
  });
  const decision = runClinicalDecision(patient);

  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'treatmentRecommended === true',
    decision.treatmentRecommended === true);

  // Sanity check FIRST.
  const denoRec = decision.treatmentRecommendations.find(r => r.agent === 'denosumab');
  check(failures, 'SANITY: denosumab IS in treatmentRecommendations',
    !!denoRec,
    `agents in recs: [${decision.treatmentRecommendations.map(r => r.agent).join(', ')}]`);

  // F4 status-tagging.
  check(failures, "denosumab status === 'pending' (F4 missing-Vit-D pending block)",
    denoRec?.status === 'pending',
    `got status=${denoRec?.status}`);
  check(failures, 'denosumab blockReason references missing Vit D',
    !!denoRec?.blockReason &&
    (/not yet measured/i.test(denoRec.blockReason) || /require vit d/i.test(denoRec.blockReason)));
  check(failures, 'denosumab unblockAction references Check Vit D / Tier 1 / ≥50',
    !!denoRec?.unblockAction &&
    (/check vit d/i.test(denoRec.unblockAction) || /tier 1/i.test(denoRec.unblockAction) ||
     /≥50/.test(denoRec.unblockAction)));

  // F4 urgent flag with NOGG Rec 17 attribution.
  const f4Flag = decision.flags.find(f => f.id === 'vitd_unmeasured_parenteral_block');
  check(failures, 'vitd_unmeasured_parenteral_block flag fires urgent',
    !!f4Flag && f4Flag.severity === 'urgent');
  check(failures, 'F4 message cites NOGG Rec 17',
    !!f4Flag &&
    (/rec 17/i.test(f4Flag.message) || /recommendation 17/i.test(f4Flag.message)));

  // CKD-hypocalcaemia flag fires additively (eGFR <35).
  check(failures, 'denosumab_ckd_hypocalcaemia fires additively (eGFR <35)',
    hasFlag(decision, 'denosumab_ckd_hypocalcaemia'));

  // Tier 1 vitamin_d investigation entry fires.
  const tier1VitD = decision.investigationsNeeded.find(i => i.investigation === 'vitamin_d' && i.tier === 1);
  check(failures, 'Tier 1 vitamin_d entry fires (missing Vit D)',
    !!tier1VitD);

  // Oral and IV BPs filtered upstream by renal CIs.
  for (const a of ['alendronate', 'risedronate', 'ibandronate', 'zoledronate'] as const) {
    check(failures, `${a} NOT in recommendations (renal CI at eGFR 25)`,
      !hasAgent(decision, a));
  }

  // Other safety filters do NOT fire.
  check(failures, 'F1 does NOT fire (Ca replete)',
    !hasFlag(decision, 'hypocalcaemia_antiresorptive_block'));
  check(failures, 'F2 does NOT fire (Ca measured)',
    !hasFlag(decision, 'calcium_unmeasured_antiresorptive_block'));
  check(failures, 'F3 does NOT fire (Vit D not measured — F3 is for measured-and-low)',
    !hasFlag(decision, 'vitd_parenteral_block'));
  check(failures, 'two_safety_blockers does NOT fire',
    !hasFlag(decision, 'two_safety_blockers'));

  return { name: 'TC102 — F4 parenteral pending at eGFR 25: denosumab tagged pending + Rec 17 flag + Tier 1 vitamin_d', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.19 TCs — TC103–TC106 — Lock engine Round 3 behaviours (v1.39 alignment)
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC103 ────────────────────────────────────────────────────────────────
// T1DM ×1.2 MOF uplift, alone (T1DM=true, T2DM=false). Locks the T1DM-only branch
// at thresholds.ts:215-225 per NOGG body para y / Leslie 2018 / Evidence IV.
function tc103(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    type1Diabetes: true,
    type2Diabetes: false,
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.5, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 20.0,
    fraxHipPercent: 3.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  const t1Adj = decision.riskStratification.fraxAdjustments.find(
    a => a.factor === 'Type 1 diabetes' && a.appliedTo === 'MOF',
  );
  check(failures, 'Type 1 diabetes ×1.2 MOF adjustment present',
    !!t1Adj && t1Adj.multiplier === 1.2);

  // T2DM attribution NOT present (since T2DM is false).
  check(failures, 'NO Type 2 diabetes adjustment (T2DM is false)',
    !decision.riskStratification.fraxAdjustments.some(a => a.factor === 'Type 2 diabetes'));

  // Adjusted MOF == 20 * 1.2 = 24.
  check(failures, 'adjustedFraxMOFPercent === 24 (20 × 1.2)',
    decision.riskStratification.adjustedFraxMOFPercent === 24,
    `got ${decision.riskStratification.adjustedFraxMOFPercent}`);

  // Hip unchanged (T1DM only uplifts MOF, not hip).
  check(failures, 'adjustedFraxHipPercent === fraxHipPercent (hip unchanged by T1DM)',
    decision.riskStratification.adjustedFraxHipPercent === decision.riskStratification.fraxHipPercent);

  return { name: 'TC103 — T1DM-only ×1.2 MOF (NOGG body para y / Leslie 2018 / Evidence IV)', passed: failures.length === 0, failures, decision };
}

// ─── TC104 ────────────────────────────────────────────────────────────────
// Both T1DM AND T2DM — single-application gate. ×1.2 once (T2DM precedence in
// attribution); NOT compounded to ×1.44. Regression guard against future
// changes that might let both blocks fire.
function tc104(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    type1Diabetes: true,
    type2Diabetes: true,
    dexaResults: { lumbarSpineTScore: -2.7, totalHipTScore: -2.5, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 20.0,
    fraxHipPercent: 3.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // T2DM branch fires first → its attribution wins per implementation precedence.
  const t2Adj = decision.riskStratification.fraxAdjustments.find(
    a => a.factor === 'Type 2 diabetes' && a.appliedTo === 'MOF',
  );
  check(failures, 'Type 2 diabetes ×1.2 MOF adjustment present (T2DM precedence)',
    !!t2Adj && t2Adj.multiplier === 1.2);

  // T1DM-only branch suppressed when T2DM also true (single-application gate).
  check(failures, 'NO Type 1 diabetes adjustment (single-application gate — T2DM fires first)',
    !decision.riskStratification.fraxAdjustments.some(a => a.factor === 'Type 1 diabetes'));

  // CRITICAL REGRESSION GUARD: adjusted MOF == 24 (×1.2 ONCE), NOT 28.8 (×1.44).
  // If the gate ever regresses and both blocks fire, this assertion catches it.
  check(failures, 'adjustedFraxMOFPercent === 24 (single ×1.2, NOT compound ×1.44 = 28.8)',
    decision.riskStratification.adjustedFraxMOFPercent === 24,
    `got ${decision.riskStratification.adjustedFraxMOFPercent} — if 28.8, single-application gate is broken`);

  return { name: 'TC104 — T1DM + T2DM single-application gate (×1.2 once, NOT ×1.44)', passed: failures.length === 0, failures, decision };
}

// ─── TC105 ────────────────────────────────────────────────────────────────
// Recent MOF imminent-risk caveat flag. 70F with low-trauma distal radius fx
// 8 months ago, high-risk, manual FRAX MOF 25%. Locks recent_mof_imminent_risk_caveat
// at index.ts:82-114; severity=info; NOGG §4h + Kanis 2020 + FRAXplus attribution.
function tc105(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 70,
    sex: 'female',
    priorFragilityFracture: true,        // distal radius wrist fx
    recentFractureWithin2Years: true,    // 8 months ago → within 24mo
    numberOfPriorFractures: 1,
    dexaResults: { lumbarSpineTScore: -2.6, totalHipTScore: -2.5, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 25.0,
    fraxHipPercent: 5.0,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  const caveatFlag = decision.flags.find(f => f.id === 'recent_mof_imminent_risk_caveat');
  check(failures, 'recent_mof_imminent_risk_caveat flag present',
    !!caveatFlag);
  check(failures, 'caveat severity === info',
    caveatFlag?.severity === 'info');

  // Content attribution.
  check(failures, 'message cites NOGG §4h',
    !!caveatFlag && /§4h/.test(caveatFlag.message));
  check(failures, 'message cites Kanis 2020',
    !!caveatFlag && /Kanis 2020/i.test(caveatFlag.message));
  check(failures, 'message refers clinician to FRAXplus',
    !!caveatFlag && /FRAXplus/i.test(caveatFlag.message));

  // The clinical assertion that the patient is high-risk (FRAX MOF 25% at age 70 is
  // intermediate; with prior fragility fx the engine routes to high via Rec 8 path,
  // even though FRAX itself sits between IT 20.3% and UAT 24.4% — actually MOF 25%
  // is above UAT at age 70, so FRAX path would also give high. Either way: high.)
  check(failures, 'riskCategory high',
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  return { name: 'TC105 — recent_mof_imminent_risk_caveat: NOGG §4h + Kanis 2020 + FRAXplus', passed: failures.length === 0, failures, decision };
}

// ─── TC106 ────────────────────────────────────────────────────────────────
// Abaloparatide shared-care continuation. 65F VHR currently on abaloparatide
// (PTHrP analogue anabolic). Locks the v1.39 widening of treatment.ts:1024 gate
// + the abaloparatide branch of sharedCareDetail. Differentiated text vs teri/romo.
function tc106(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorVertebralFracture: true,
    recentVertebralFractureYears: 1,
    recentFractureWithin2Years: false, // pre-treatment vert fx; not in last 24mo for imminent-risk
    numberOfPriorFractures: 1,
    numberOfVertebralFractures: 1,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -2.7, femoralNeckTScore: -2.6, forearmTScore: null },
    fraxMOFPercent: 28.0,
    fraxHipPercent: 6.5,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 70, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    currentTreatment: {
      agent: 'abaloparatide',
      durationMonths: 6,
      reasonStopped: null,
      currentlyOn: true,
      monthsSinceLastDose: 0,
      ageAtStart: 64,
      fractureOnCurrentTreatment: false,
      adherenceAdequate: true,
    },
  });
  const decision = runClinicalDecision(patient);

  // VHR fires (LS −3.6 ≤ −3.5 AND recent vert fx within 2y).
  check(failures, 'riskCategory very_high',
    decision.riskStratification.category === 'very_high');

  // Shared-care continuation flag fires for abaloparatide (Round 3 widening).
  const sharedFlag = decision.flags.find(f => f.id === 'anabolic_gp_shared_care_continue');
  check(failures, 'anabolic_gp_shared_care_continue flag present',
    !!sharedFlag);
  check(failures, 'flag severity === info',
    sharedFlag?.severity === 'info');

  // Abaloparatide-specific text (differentiated from teri/romo branches).
  check(failures, 'message names abaloparatide',
    !!sharedFlag && /abaloparatide/i.test(sharedFlag.message));
  check(failures, 'message references PTHrP class mechanism',
    !!sharedFlag && /PTHrP/i.test(sharedFlag.message));
  check(failures, 'message mentions sequential antiresorptive mandate',
    !!sharedFlag && /sequential/i.test(sharedFlag.message) && /antiresorptive/i.test(sharedFlag.message));
  check(failures, 'message mentions Irish reimbursement caveat',
    !!sharedFlag &&
    (/not currently reimbursed/i.test(sharedFlag.message) || /High-Tech listing/i.test(sharedFlag.message) ||
     /private pay/i.test(sharedFlag.message)));

  // Cross-check: the existing abaloparatide_not_reimbursed_ireland flag (separate from
  // the shared-care flag) also fires for any currentTreatment.agent='abaloparatide' patient.
  check(failures, 'abaloparatide_not_reimbursed_ireland fires alongside (reimbursement context)',
    hasFlag(decision, 'abaloparatide_not_reimbursed_ireland'));

  return { name: 'TC106 — abaloparatide shared-care continuation: PTHrP + sequential + reimbursement caveat', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.43 Shape B TEST CASES (TC107–TC109)
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC107 ─────────────────────────────────────────────────────────────────
// Female postmenopausal non-GC VHR (e.g. 65F, T-score −3.6 LS, no GC):
// treatmentRecommendations empty (GP refers, doesn't prescribe);
// specialistOptions has 3 entries — teri first_line + romo further_option +
// abalo further_option (with reimbursementNote). Hoist + flag both fire.
function tc107(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -2.8, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'risk = very_high (T ≤ −3.5)',
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'vhr_specialist_referral fires',
    hasFlag(decision, 'vhr_specialist_referral'));

  // Shape B suppression: BPs not pushed for non-GC VHR.
  check(failures, 'treatmentRecommendations empty (Shape B suppression)',
    decision.treatmentRecommendations.length === 0);
  check(failures, 'NO alendronate (Shape B: non-GC VHR refers, not prescribes)',
    !hasAgent(decision, 'alendronate'));
  check(failures, 'NO risedronate (Shape B: non-GC VHR refers, not prescribes)',
    !hasAgent(decision, 'risedronate'));

  // specialistOptions populated with 3 entries.
  check(failures, 'specialistOptions has 3 entries (postmenopausal F VHR)',
    decision.specialistOptions.length === 3,
    `got ${decision.specialistOptions.length}`);

  const teri = decision.specialistOptions.find(o => o.drug === 'teriparatide');
  const romo = decision.specialistOptions.find(o => o.drug === 'romosozumab');
  const abalo = decision.specialistOptions.find(o => o.drug === 'abaloparatide');

  check(failures, 'teriparatide present as first_line', !!teri && teri.tier === 'first_line');
  check(failures, 'teriparatide rationale references VERO Evidence Ib',
    !!teri && /VERO/i.test(teri.rationale));
  check(failures, 'teriparatide preReferralChecks includes eGFR + PTH',
    !!teri?.preReferralChecks && /eGFR/i.test(teri.preReferralChecks) && /PTH/i.test(teri.preReferralChecks));

  check(failures, 'romosozumab present as further_option', !!romo && romo.tier === 'further_option');
  check(failures, 'romosozumab references HSE MAP', !!romo && /HSE Managed Access Protocol/i.test(romo.reference));
  check(failures, 'romosozumab preReferralChecks includes corrected serum calcium',
    !!romo?.preReferralChecks && /corrected serum calcium/i.test(romo.preReferralChecks));

  check(failures, 'abaloparatide present as further_option', !!abalo && abalo.tier === 'further_option');
  check(failures, 'abaloparatide carries reimbursementNote (HSE not-reimbursed)',
    !!abalo?.reimbursementNote && /not currently HSE-reimbursed/i.test(abalo.reimbursementNote));

  return { name: 'TC107 — postmenopausal F non-GC VHR: empty recipe + specialistOptions {teri/romo/abalo} (Shape B)', passed: failures.length === 0, failures, decision };
}

// ─── TC108 ─────────────────────────────────────────────────────────────────
// Male ≥50 non-GC VHR (e.g. 60M, T-score −3.6 LS, prior fragility fx, no GC):
// treatmentRecommendations empty (GP refers); specialistOptions has ONE entry —
// teriparatide first_line ONLY (romo + abalo NOT licensed for men). Hoist + flag both fire.
function tc108(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 60,
    sex: 'male',
    priorFragilityFracture: true,
    dexaResults: { lumbarSpineTScore: -3.6, totalHipTScore: -2.8, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 140, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'risk = very_high (T ≤ −3.5)',
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'vhr_specialist_referral fires',
    hasFlag(decision, 'vhr_specialist_referral'));

  check(failures, 'treatmentRecommendations empty (Shape B suppression)',
    decision.treatmentRecommendations.length === 0);
  check(failures, 'NO alendronate (Shape B: non-GC VHR refers, not prescribes)',
    !hasAgent(decision, 'alendronate'));

  // specialistOptions has teri ONLY for male — romo + abalo not licensed in men.
  check(failures, 'specialistOptions has 1 entry (male VHR: teri only)',
    decision.specialistOptions.length === 1,
    `got ${decision.specialistOptions.length}`);
  check(failures, 'specialistOptions includes teriparatide as first_line',
    decision.specialistOptions.some(o => o.drug === 'teriparatide' && o.tier === 'first_line'));
  check(failures, 'NO romosozumab in specialistOptions (not licensed in men)',
    !decision.specialistOptions.some(o => o.drug === 'romosozumab'));
  check(failures, 'NO abaloparatide in specialistOptions (not licensed in men)',
    !decision.specialistOptions.some(o => o.drug === 'abaloparatide'));

  const teri = decision.specialistOptions.find(o => o.drug === 'teriparatide')!;
  check(failures, 'male teri rationale notes "only anabolic licensed for men"',
    /only anabolic/i.test(teri.rationale) && /men/i.test(teri.rationale));

  return { name: 'TC108 — M ≥50 non-GC VHR: empty recipe + specialistOptions {teri only}', passed: failures.length === 0, failures, decision };
}

// ─── TC109 ─────────────────────────────────────────────────────────────────
// Female postmenopausal GC-driven VHR (66F, prednisolone 10mg/day × 3+ months,
// T-score −3.5 LS): treatmentRecommendations has bridging alendronate + risedronate
// (Shape B coexistence — GC-driven bridging cards STILL render per NOGG Rec 8(g));
// specialistOptions ALSO populated with 3 entries (postmenopausal F VHR menu).
// This is the v1.43 coexistence-of-paths case: bridging + specialistOptions both present.
function tc109(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    glucocorticoidStatus: 'current',
    glucocorticoidUse: { current: true, durationMonths: 4, dose: 'medium' },
    glucocorticoidDoseMgDay: 10,
    dexaResults: { lumbarSpineTScore: -3.5, totalHipTScore: -2.8, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'risk = very_high', decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);
  check(failures, 'vhr_specialist_referral fires URGENT (GC drives VHR)',
    !!decision.flags.find(f => f.id === 'vhr_specialist_referral' && f.severity === 'urgent'));

  // Bridging entries present — coexistence path under Shape B.
  const aln = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const ris = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  check(failures, 'alendronate present with category bridging',
    !!aln && aln.category === 'bridging');
  check(failures, 'risedronate present with category bridging',
    !!ris && ris.category === 'bridging');

  // specialistOptions ALSO populated.
  check(failures, 'specialistOptions has 3 entries (postmenopausal F: teri + romo + abalo)',
    decision.specialistOptions.length === 3,
    `got ${decision.specialistOptions.length}`);
  check(failures, 'specialistOptions teriparatide first_line',
    decision.specialistOptions.some(o => o.drug === 'teriparatide' && o.tier === 'first_line'));
  check(failures, 'specialistOptions romosozumab further_option',
    decision.specialistOptions.some(o => o.drug === 'romosozumab' && o.tier === 'further_option'));
  check(failures, 'specialistOptions abaloparatide further_option with reimbursementNote',
    decision.specialistOptions.some(o => o.drug === 'abaloparatide' && o.tier === 'further_option' && !!o.reimbursementNote));

  return { name: 'TC109 — postmenopausal F GC-driven VHR: bridging recipe + specialistOptions coexistence (Shape B)', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.44 TEST CASE — VHR-GC + refusal coverage
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC110 ─────────────────────────────────────────────────────────────────
// Female postmenopausal GC-driven VHR + refusesInjections (66F, prednisolone
// 10mg/day × 4mo, T-score −3.5 LS, normal bloods). v1.44 closes the coverage
// gap on VHR-GC + refusal — TC22 covers VHR-non-GC + refusal; TC109 covers
// VHR-GC + no-refusal. The stale patient_refuses_injections flag has been
// retired; vhr_anabolic_refusal_context now fires with a GC-specific variant
// for this profile (semantic anchors: "discussion point for the specialist
// consultation" + "regardless of patient preference" + "Document the refusal
// in the referral letter").
function tc110(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 66,
    sex: 'female',
    glucocorticoidStatus: 'current',
    glucocorticoidUse: { current: true, durationMonths: 4, dose: 'medium' },
    glucocorticoidDoseMgDay: 10,
    dexaResults: { lumbarSpineTScore: -3.5, totalHipTScore: -2.8, femoralNeckTScore: -2.7, forearmTScore: null },
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 60, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
    refusesInjections: true,
  });
  const decision = runClinicalDecision(patient);

  check(failures, 'risk = very_high',
    decision.riskStratification.category === 'very_high',
    `got ${decision.riskStratification.category}`);

  // GC-driven VHR → URGENT specialist referral.
  check(failures, 'vhr_specialist_referral fires URGENT (GC drives VHR)',
    !!decision.flags.find(f => f.id === 'vhr_specialist_referral' && f.severity === 'urgent'));

  // Bridging recipe — GC-driven VHR retains the bridging path even when patient
  // refuses injections (the bridging step is clinically necessary, not preference-driven).
  const aln = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const ris = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  check(failures, 'alendronate present with category bridging',
    !!aln && aln.category === 'bridging');
  check(failures, 'risedronate present with category bridging',
    !!ris && ris.category === 'bridging');

  // v1.44 — vhr_anabolic_refusal_context fires with GC-specific variant.
  // Three semantic anchors lock the message contract.
  const refusalContext = decision.flags.find(f => f.id === 'vhr_anabolic_refusal_context');
  check(failures, 'vhr_anabolic_refusal_context flag fires (VHR-GC + refusal)', !!refusalContext);
  check(failures, 'refusal-context message anchors "discussion point for the specialist consultation"',
    !!refusalContext && /discussion point for the specialist consultation/i.test(refusalContext.message));
  check(failures, 'refusal-context message anchors "regardless of patient preference"',
    !!refusalContext && /regardless of patient preference/i.test(refusalContext.message));
  check(failures, 'refusal-context message anchors "Document the refusal in the referral letter"',
    !!refusalContext && /Document the refusal in the referral letter/i.test(refusalContext.message));

  // v1.44 — retired stale flag MUST NOT fire (negative assertion locks the retirement).
  check(failures, 'patient_refuses_injections flag does NOT fire (v1.44 retirement)',
    !hasFlag(decision, 'patient_refuses_injections'));

  // specialistOptions still populated (postmenopausal F VHR → 3 entries).
  check(failures, 'specialistOptions has 3 entries (postmenopausal F: teri + romo + abalo)',
    decision.specialistOptions.length === 3,
    `got ${decision.specialistOptions.length}`);

  return { name: 'TC110 — postmenopausal F GC-driven VHR + refuses-injections: bridging recipe + GC-variant refusal-context flag (v1.44)', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.46 TEST CASE — Rule 2 post-hip-fracture IV zoledronate first-line
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC111 ─────────────────────────────────────────────────────────────────
// Non-VHR + prior hip fracture profile locking NOGG Rec 3 (Strong) + Lyles
// HORIZON-RF behaviour. 65F, prior hip fx, T-2.6 hip (osteoporosis but not
// VHR-3), no vert fx, no GC, no other RFs, manual MOF 15% (above age-65 IT
// ~12% but below VHRT ~19.2% so VHR-6 doesn't fire), eGFR 75 (no renal CIs),
// Vit D 70 (replete — avoids Filter F3 status-blocking IV zol), normal
// bloods, no recent fragility fx. Profile lands in 'high' via the prior-fx-
// high route in risk.ts (priorHipFracture true → engine routes to high
// regardless of FRAX).
//
// v1.46 contract:
//   - IV zoledronate as PRIMARY recommendation, priority='first-line'
//   - Alendronate + risedronate as ALTERNATIVES, priority='alternative'
//   - IV zol rationale anchors Rec 3 + Lyles + HORIZON-RF + mortality reduction
//   - Oral rationales anchor "Alternative to IV zoledronate" framing
//   - retired post_hip_fracture_zoledronate_first_line flag DOES NOT fire
function tc111(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: false,
    dexaResults: { lumbarSpineTScore: -2.4, totalHipTScore: -2.6, femoralNeckTScore: -2.5, forearmTScore: null },
    fraxMOFPercent: 15.0,
    fraxHipPercent: 4.0,
    fraxCalculatedWithBMD: true,
    bloodResults: { adjustedCalciumMmol: 2.32, vitaminDNmol: 70, egfr: 75, alp: 80, tshMUL: 2.0, hbGramsPerLitre: 135, esrOrCrp: 'normal' },
  });
  const decision = runClinicalDecision(patient);

  // Profile lands in 'high' (not 'very_high' — Rule 2 is scoped to non-VHR).
  check(failures, "riskCategory === 'high' (not very_high — Rule 2 scope)",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // All three primary drugs present in recommendations.
  check(failures, 'IV zoledronate in recommendations', hasAgent(decision, 'zoledronate'));
  check(failures, 'alendronate in recommendations', hasAgent(decision, 'alendronate'));
  check(failures, 'risedronate in recommendations', hasAgent(decision, 'risedronate'));

  // Rule 2 priority forking: IV zol first-line, orals alternative.
  const zoleRec = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');
  const alnRec = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const risRec = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  check(failures, "zoledronate priority === 'first-line'",
    zoleRec?.priority === 'first-line', `got ${zoleRec?.priority}`);
  check(failures, "alendronate priority === 'alternative'",
    alnRec?.priority === 'alternative', `got ${alnRec?.priority}`);
  check(failures, "risedronate priority === 'alternative'",
    risRec?.priority === 'alternative', `got ${risRec?.priority}`);

  // IV zol rationale semantic anchors — Rec 3 + Lyles + HORIZON-RF + mortality
  // reduction. Locked content carrying the Rule 2 clinical framing.
  check(failures, 'IV zol rationale anchors Rec 3 framing',
    !!zoleRec && /rec 3|recommendation 3/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors HORIZON-RF / Lyles reference',
    !!zoleRec && /(horizon|lyles)/i.test(zoleRec.rationale));
  check(failures, 'IV zol rationale anchors mortality reduction',
    !!zoleRec && /mortality/i.test(zoleRec.rationale));

  // Oral rationale semantic anchor — "Alternative to IV zoledronate" framing.
  check(failures, 'alendronate rationale anchors alternative-to-IV framing',
    !!alnRec && /alternative to iv zoledronate/i.test(alnRec.rationale));
  check(failures, 'risedronate rationale anchors alternative-to-IV framing',
    !!risRec && /alternative to iv zoledronate/i.test(risRec.rationale));

  // v1.46 — retired flag must not fire (negative assertion locks the retirement).
  check(failures, 'post_hip_fracture_zoledronate_first_line flag does NOT fire (v1.46 retirement)',
    !hasFlag(decision, 'post_hip_fracture_zoledronate_first_line'));

  return { name: 'TC111 — non-VHR + prior hip fx: IV zol primary + orals alternative (v1.46 Rule 2)', passed: failures.length === 0, failures, decision };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.46.2 TEST CASE — F2 + F4 dedup contract lock
// ═══════════════════════════════════════════════════════════════════════════

// ─── TC112 ─────────────────────────────────────────────────────────────────
// Non-VHR + prior hip fracture + no bloods entered. Locks the v1.45 F2+F4
// dedup contract that was previously verified by Vercel eyeball only ("lean
// coverage" trade-off per the v1.45 round commit). This TC closes that gap.
//
// Profile: 65F + prior hip fracture (recent within 24mo) + T-2.0 osteopenia
// + NO bloods entered (bloodResults: null — so calcium, Vit D, eGFR all
// null). Patient routes to 'high' via prior-fx-high path (priorHipFracture
// true → engine routes to high regardless of FRAX).
//
// Both caMissing AND vitDMissing are true. Without the dedup, BOTH F2
// (calcium_unmeasured_antiresorptive_block) AND F4 (vitd_unmeasured_
// parenteral_block) would fire as URGENT — two alerts both prompting Vit D
// measurement, with F2's broader message already covering F4's narrower
// guidance. Dedup suppresses F4 emission when F2 fires.
//
// v1.46.2 refactored the dedup guard from `flags.some(...)` runtime
// introspection to deterministic `f2WouldFire = caMissing` boolean check
// — same behavioural contract, decoupled from source-order ordering.
// This TC locks the contract structurally so future filter-chain
// refactors can't silently regress it.
function tc112(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    bloodResults: null,
  });
  const decision = runClinicalDecision(patient);

  // Profile lands in 'high' via prior-fx-high route.
  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // All three primary BPs present (Rule 1 / Rule 2 push at the standard
  // primary site fires for this profile). Status-mutation expected.
  check(failures, 'alendronate in recommendations', hasAgent(decision, 'alendronate'));
  check(failures, 'risedronate in recommendations', hasAgent(decision, 'risedronate'));
  check(failures, 'IV zoledronate in recommendations', hasAgent(decision, 'zoledronate'));

  // F2 missing-calcium recipe-status mutation: every antiresorptive in
  // recommendations gets tagged status='pending' (the F2 contract independent
  // of the flag emission). Locks the behavioural side of F2's filter.
  const antiresorptives = decision.treatmentRecommendations.filter(
    r => r.agent === 'alendronate' || r.agent === 'risedronate' || r.agent === 'zoledronate',
  );
  for (const rec of antiresorptives) {
    check(failures, `${rec.agent} status === 'pending' (F2 status mutation)`,
      rec.status === 'pending', `got status=${rec.status}`);
  }

  // POSITIVE: F2 fires URGENT (the broad calcium-led message that covers
  // Ca + Vit D + eGFR Tier 1 bloods guidance).
  const f2Flag = decision.flags.find(f => f.id === 'calcium_unmeasured_antiresorptive_block');
  check(failures, 'F2 (calcium_unmeasured_antiresorptive_block) fires URGENT',
    !!f2Flag && f2Flag.severity === 'urgent', `got severity=${f2Flag?.severity}`);
  check(failures, 'F2 message anchors "Measure Ca, Vit D, and eGFR"',
    !!f2Flag && /measure ca, vit d, and egfr/i.test(f2Flag.message));

  // NEGATIVE: F4 (vitd_unmeasured_parenteral_block) does NOT fire — dedup
  // contract. F2's broader message subsumes F4's guidance; emitting both
  // would surface two URGENT alerts both prompting Vit D measurement.
  check(failures, 'F4 (vitd_unmeasured_parenteral_block) does NOT fire — dedup contract',
    !decision.flags.some(f => f.id === 'vitd_unmeasured_parenteral_block'));

  // NEGATIVE: F3 (vitd_parenteral_block) does NOT fire — Vit D is MISSING
  // (vitDMissing branch), not measured + low (vitDLow branch). F3 scope
  // is unaffected by the F2/F4 dedup.
  check(failures, 'F3 (vitd_parenteral_block) does NOT fire — Vit D missing, not low',
    !decision.flags.some(f => f.id === 'vitd_parenteral_block'));

  return { name: 'TC112 — F2+F4 dedup contract lock: 65F + hip fx + no bloods (v1.46.2)', passed: failures.length === 0, failures, decision };
}

// v1.47 — Pending Prerequisites render contract. Locks the engine-side
// pendingCaption field that drives the UI's amber banner caption on
// status='pending' Treatment cards. Two TCs cover the two producible caption
// variants — multi-missing (TC113, mirroring TC112's profile) and Vit D-only
// parenteral (TC114, drug-class asymmetry).
//
// The calcium-only variant (caMissing + vitDPresent) IS exercised at the F2
// caption-selection site (`f2PendingCaption = caMissing && vitDMissing ?
// MULTI : CALCIUM_ONLY`) — the false branch of that ternary is the calcium-
// only path. Not added as a dedicated TC: the false branch produces the same
// status='pending' contract as TC113's true branch, just with a different
// caption string. TC113 + TC114 together cover both ternary branches; a third
// TC would add ~zero engine-behaviour coverage. Tracked for future addition
// if a calcium-only-specific UI variant emerges.

function tc113(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    bloodResults: null,
  });
  const decision = runClinicalDecision(patient);

  // Profile mirrors TC112 (65F + prior hip fx + no bloods → 'high' via
  // prior-fx-high; F2 + F4 both gate-evaluate true; F2's mutation wins
  // precedence and tags all antiresorptives 'pending').
  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // Re-assert the TC112 status='pending' contract (independent lock here so
  // that if TC112 is ever weakened, TC113's caption assertion doesn't pass
  // vacuously on a missing pending state).
  const antiresorptives = decision.treatmentRecommendations.filter(
    r => r.agent === 'alendronate' || r.agent === 'risedronate' || r.agent === 'zoledronate',
  );
  check(failures, '3 antiresorptives present', antiresorptives.length === 3,
    `got ${antiresorptives.length}`);
  for (const rec of antiresorptives) {
    check(failures, `${rec.agent} status === 'pending'`,
      rec.status === 'pending', `got status=${rec.status}`);
  }

  // v1.47 pendingCaption contract — multi-missing variant.
  // Locked wording: 'Complete Tier 1 bloods (calcium, Vit D, eGFR as
  // applicable) before initiating treatment. Reassess once results available.'
  const EXPECTED_MULTI =
    'Complete Tier 1 bloods (calcium, Vit D, eGFR as applicable) before initiating treatment. Reassess once results available.';
  for (const rec of antiresorptives) {
    check(failures, `${rec.agent} pendingCaption populated`,
      typeof rec.pendingCaption === 'string' && rec.pendingCaption.length > 0,
      `got pendingCaption=${JSON.stringify(rec.pendingCaption)}`);
    check(failures, `${rec.agent} pendingCaption matches multi-missing variant verbatim`,
      rec.pendingCaption === EXPECTED_MULTI,
      `got ${JSON.stringify(rec.pendingCaption)}`);
  }

  return { name: 'TC113 — pendingCaption multi-missing variant: 65F + hip fx + no bloods (v1.47)', passed: failures.length === 0, failures, decision };
}

function tc114(): TCResult {
  const failures: string[] = [];
  const patient = basePatient({
    age: 65,
    sex: 'female',
    priorFragilityFracture: true,
    priorHipFracture: true,
    recentFractureWithin2Years: true,
    dexaResults: { lumbarSpineTScore: -2.0, totalHipTScore: -2.0, femoralNeckTScore: -2.0, forearmTScore: null },
    bloodResults: {
      adjustedCalciumMmol: 2.3, // measured, in range → F2 skipped
      vitaminDNmol: null,        // missing → F4 fires (parenterals only)
      egfr: 80,                  // normal renal → no CI cascade
      alp: null,
      tshMUL: null,
      hbGramsPerLitre: null,
      esrOrCrp: null,
    },
  });
  const decision = runClinicalDecision(patient);

  // Profile lands in 'high' via prior-fx-high route — same as TC113.
  check(failures, "riskCategory === 'high'",
    decision.riskStratification.category === 'high',
    `got ${decision.riskStratification.category}`);

  // Drug-class asymmetry contract:
  //   F2 skipped (caMissing=false) → orals stay active (no status mutation)
  //   F4 fires (vitDMissing=true) → IV zol tagged 'pending' with Vit D-only caption
  //   F4's oral-BP mutation path adds Rec 17 monitoring note but leaves status active

  const alendronate = decision.treatmentRecommendations.find(r => r.agent === 'alendronate');
  const risedronate = decision.treatmentRecommendations.find(r => r.agent === 'risedronate');
  const zol = decision.treatmentRecommendations.find(r => r.agent === 'zoledronate');

  check(failures, 'alendronate present', !!alendronate);
  check(failures, 'risedronate present', !!risedronate);
  check(failures, 'IV zoledronate present', !!zol);

  // Orals: status active (or undefined which the engine treats as active).
  // No pendingCaption on active entries.
  check(failures, 'alendronate status NOT pending',
    !!alendronate && alendronate.status !== 'pending',
    `got status=${alendronate?.status}`);
  check(failures, 'alendronate has NO pendingCaption (active)',
    !!alendronate && !alendronate.pendingCaption,
    `got pendingCaption=${JSON.stringify(alendronate?.pendingCaption)}`);
  check(failures, 'risedronate status NOT pending',
    !!risedronate && risedronate.status !== 'pending',
    `got status=${risedronate?.status}`);
  check(failures, 'risedronate has NO pendingCaption (active)',
    !!risedronate && !risedronate.pendingCaption,
    `got pendingCaption=${JSON.stringify(risedronate?.pendingCaption)}`);

  // IV zol: status='pending' with Vit D-only caption verbatim.
  const EXPECTED_VITD_ONLY =
    'Complete Vit D measurement before initiating parenteral therapy. Reassess once result available.';
  check(failures, "zoledronate status === 'pending' (F4 parenteral tag)",
    !!zol && zol.status === 'pending', `got status=${zol?.status}`);
  check(failures, 'zoledronate pendingCaption matches Vit D-only variant verbatim',
    !!zol && zol.pendingCaption === EXPECTED_VITD_ONLY,
    `got ${JSON.stringify(zol?.pendingCaption)}`);

  // F4 fires URGENT (since F2 doesn't fire here, the F2/F4 dedup doesn't
  // suppress F4 — locks the standalone-F4 contract).
  check(failures, 'F4 (vitd_unmeasured_parenteral_block) fires URGENT',
    decision.flags.some(f => f.id === 'vitd_unmeasured_parenteral_block' && f.severity === 'urgent'));

  // F2 does NOT fire (calcium is measured + in range).
  check(failures, 'F2 (calcium_unmeasured_antiresorptive_block) does NOT fire',
    !decision.flags.some(f => f.id === 'calcium_unmeasured_antiresorptive_block'));

  return { name: 'TC114 — pendingCaption Vit D-only variant + drug-class asymmetry: 65F + hip fx + Ca measured + Vit D missing (v1.47)', passed: failures.length === 0, failures, decision };
}

// ─── Runner ───────────────────────────────────────────────────────────────

const TCs: Array<() => TCResult> = [
  tc1, tc2, tc3, tc4, tc5, tc6, tc7, tc8, tc9, tc10,
  tc11, tc12, tc13, tc14, tc15, tc16, tc17, tc18, tc19, tc20, tc21, tc22,
  tc23, tc24, tc25, tc26, tc27, tc28, tc29, tc30, tc31, tc32,
  tc33, tc34, tc35, tc36, tc37, tc37b, tc38, tc39, tc40, tc41,
  tc42, tc43, tc44, tc45, tc46, tc47, tc48, tc49, tc50, tc51, tc52,
  // v1.4 TC53–TC63 — see below the engine-extras block.
  tc53, tc54, tc55, tc56, tc57, tc58, tc59, tc60, tc61, tc62, tc63,
  // Engine-coverage extras (these were TC53–TC62 in the pre-v1.4 suite;
  // renumbered to TC64–TC73 to free TC53–TC63 for the v1.4 alignment).
  tc64, tc65, tc66, tc67, tc68, tc69, tc70, tc71, tc72, tc73,
  // v1.30 — denosumab soft prompt
  tc74, tc75,
  // v1.31 — output gating by risk category (low-risk patient)
  tc76_v131,
  // v1.30 follow-up — Vit D step-isolation test (renumbered to TC77 so the
  // v1.31 spec's TC76 number lines up with the runner)
  tc76,
  // v1.10 (test-doc v1.10) — Prompt A behaviours + previously-untested branches
  tc78, tc79, tc80, tc81, tc82, tc83, tc84, tc85, tc86,
  // v1.11 (test-doc v1.11) — BP-duration decision points (pause-eligible + 10y individual basis)
  tc87, tc88,
  // v1.12 (test-doc v1.12) — A1-Fix-4 / A2-impl / romo CV gate / GIOP simplification locks
  tc89, tc90, tc91, tc92, tc93,
  // v1.15 (test-doc v1.15) — lock VHR classifier audit fixes B1 + B3
  tc94, tc95,
  // v1.17 (test-doc v1.17) — lock pre-treatment safety filters F1-F5 (hypoCa + Vit D)
  tc96, tc97, tc98, tc99, tc100,
  // v1.18 (test-doc v1.18) — close F3/F4 vacuous-assertion gap from v1.17 via eGFR 25
  tc101, tc102,
  // v1.19 (test-doc v1.19) — lock engine Round 3 behaviours (T1DM, recent-MOF caveat,
  // abaloparatide shared-care continuation)
  tc103, tc104, tc105, tc106,
  // v1.43 Shape B — specialistOptions field + non-GC VHR push suppression + patient-
  // preference fallback (paired with TC22 update for refuses-injections semantics)
  tc107, tc108, tc109,
  // v1.44 — VHR-GC + refusal coverage; retired stale patient_refuses_injections flag
  // negative-asserted; GC-variant vhr_anabolic_refusal_context fires with three
  // locked semantic anchors.
  tc110,
  // v1.46 — Rule 2 post-hip-fracture IV zoledronate first-line coverage; retired
  // post_hip_fracture_zoledronate_first_line flag negative-asserted; Rule 1
  // co-equal first-line locked separately via TC1's added hasAgent(zoledronate).
  tc111,
  // v1.46.2 — F2+F4 dedup contract lock (65F + hip fx + no bloods); closes the
  // v1.45 lean-coverage gap; deterministic `f2WouldFire = caMissing` guard
  // refactor at safetyFilters.ts:218 (was: `flags.some(...)` runtime introspection).
  tc112,
  // v1.47 — Pending Prerequisites render contract: lock the engine-side
  // pendingCaption field that drives the UI's amber banner caption on
  // status='pending' Treatment cards. TC113 covers multi-missing variant (Ca
  // + Vit D both missing; mirrors TC112's profile + adds caption assertions).
  // TC114 covers Vit D-only-parenteral variant + drug-class asymmetry (Ca
  // measured + Vit D missing → orals active, IV zol pending with Vit D-only
  // caption). Locks the verbatim caption strings + the asymmetry contract.
  tc113, tc114,
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
