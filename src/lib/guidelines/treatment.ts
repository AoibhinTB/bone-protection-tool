// Treatment recommendations and bisphosphonate sequencing
// Prescribing preference: HSE MMP Ireland (alendronate first-line)
// Clinical thresholds: NOGG 2024, NICE NG187

import type {
  PatientInput,
  TreatmentRecommendation,
  TreatmentAgent,
  RiskCategory,
  ClinicalFlag,
  ReferralRecommendation,
  SupplementRecommendation,
  GuidelineSource,
} from './types';
import {
  RENAL_LIMITS,
  BP_HOLIDAY,
  GIOP,
  BLOOD_RANGES,
  DENOSUMAB,
  GUIDELINE_VERSIONS,
} from './thresholds';

const SRC_HSE    = GUIDELINE_VERSIONS.hse_mmp;
const SRC_NOGG   = GUIDELINE_VERSIONS.nogg;
const SRC_NICE   = GUIDELINE_VERSIONS.nice;
const SRC_BSR    = GUIDELINE_VERSIONS.bsr;
const SRC_IOS    = GUIDELINE_VERSIONS.ios;
const SRC_CTIBL: GuidelineSource = { guideline: 'ASCO/ASBMR CTIBL Guidelines', version: '2023', year: 2023 };
const SRC_BMS:   GuidelineSource = { guideline: 'BMS / NOGG', version: '2024', year: 2024 };

// ─── Public entry point ───────────────────────────────────────────────────

export interface TreatmentOutput {
  recommendations: TreatmentRecommendation[];
  flags: ClinicalFlag[];
  referrals: ReferralRecommendation[];
  supplements: SupplementRecommendation[];
}

export function generateTreatmentOutput(
  patient: PatientInput,
  riskCategory: RiskCategory,
): TreatmentOutput {
  const flags: ClinicalFlag[]               = [];
  const referrals: ReferralRecommendation[] = [];
  const supplements                         = getSupplements(patient);

  // Out-of-scope patients should not receive treatment logic
  if (riskCategory === 'out_of_scope') {
    return { recommendations: [], flags, referrals, supplements };
  }

  // ── Imminent fracture risk (fracture within last 24 months) ──
  if (patient.recentFractureWithin2Years) {
    flags.push({
      id: 'imminent_fracture_risk',
      severity: 'urgent',
      message:
        'IMMINENT FRACTURE RISK: fracture within the last 24 months. ' +
        'Start bone protection treatment IMMEDIATELY — do not wait for DEXA. ' +
        'The fracture itself is sufficient for clinical diagnosis and treatment initiation. ' +
        'Risk of a further fracture is highest in the weeks to months after a fracture.',
      rationale:
        'NOGG 2024: fracture within 24 months = high imminent fracture risk. ' +
        'Immediate treatment is indicated — DEXA can be arranged concurrently but must not delay prescribing.',
      source: SRC_NOGG,
    });
  }

  // ── RA + secondary osteoporosis double-counting warning ──
  if (patient.rheumatoidArthritis && patient.secondaryOsteoporosis.length > 0 && patient.fraxMOFPercent !== null) {
    flags.push({
      id: 'ra_double_count',
      severity: 'warning',
      message:
        'FRAX double-counting risk: Rheumatoid Arthritis is already a specific FRAX risk factor. ' +
        'If you also ticked "Secondary Osteoporosis" in the FRAX tool because of RA, this double-counts the risk and overestimates fracture probability. ' +
        'Ensure secondary osteoporosis was ticked in FRAX for a reason OTHER than RA.',
      rationale:
        'FRAX includes RA as a named risk factor separate from secondary osteoporosis. ' +
        'Ticking both inflates the FRAX score and may lead to inappropriate treatment escalation.',
      source: SRC_NOGG,
    });
  }

  // ── Dental check before IV zoledronate or denosumab ──
  const isNewStarter = !patient.currentTreatment && patient.previousTreatments.length === 0;
  if (isNewStarter) {
    flags.push({
      id: 'dental_check_pre_treatment',
      severity: 'info',
      message:
        'Before starting IV zoledronate or denosumab: check whether the patient has any outstanding invasive dental work (extractions, implants, major restorations). ' +
        'If yes, complete dental treatment BEFORE the first dose where clinically feasible, to minimise the very small risk of osteonecrosis of the jaw (ONJ).',
      rationale:
        'NOGG 2024 Section 7.3: ONJ risk is low at osteoporosis doses but is further minimised with pre-treatment dental review. ' +
        'Particularly relevant for IV zoledronate and denosumab.',
      source: SRC_NOGG,
    });
  }

  // ── Forearm-only osteoporosis ──
  const forearmOnlyOsteoporosis =
    patient.dexaResults !== null &&
    patient.dexaResults.forearmTScore !== null &&
    patient.dexaResults.forearmTScore <= -2.5 &&
    (patient.dexaResults.lumbarSpineTScore === null || patient.dexaResults.lumbarSpineTScore > -2.5) &&
    (patient.dexaResults.totalHipTScore === null || patient.dexaResults.totalHipTScore > -2.5) &&
    (patient.dexaResults.femoralNeckTScore === null || patient.dexaResults.femoralNeckTScore > -2.5);

  if (forearmOnlyOsteoporosis) {
    flags.push({
      id: 'forearm_only_osteoporosis',
      severity: 'warning',
      message:
        'Forearm-only osteoporosis (T-score ≤-2.5 at 33% radius with normal hip and spine BMD): ' +
        'rule out primary hyperparathyroidism BEFORE starting treatment — check calcium, ALP, and PTH. ' +
        'Note: FRAX cannot accept forearm BMD as input — femoral neck BMD must be used for FRAX calculation. ' +
        'Treatment approach after ruling out secondary cause is the same as standard osteoporosis.',
      rationale:
        'Forearm-only osteoporosis has a specific differential diagnosis including primary hyperparathyroidism, ' +
        'which is characterised by preferential cortical bone loss (forearm/radius). ' +
        'Treating without ruling this out may miss a treatable systemic cause.',
      source: SRC_NOGG,
    });
  }

  // Low risk — lifestyle only
  if (riskCategory === 'low') {
    return { recommendations: [], flags, referrals, supplements };
  }

  // Intermediate risk without DEXA — withhold pharmacological treatment pending BMD
  // NOGG 2024 Section 3.1: BMD required to reclassify amber before treatment decision
  if (riskCategory === 'intermediate' && !patient.dexaResults && !patient.currentTreatment) {
    flags.push({
      id: 'intermediate_await_dexa',
      severity: 'info',
      message:
        'Intermediate fracture risk: do not start pharmacological treatment until DEXA is available. ' +
        'BMD result will reclassify to low (green — no treatment) or high (red — treat).',
      rationale:
        'NOGG 2024 Section 3.1: intermediate risk requires BMD measurement to reclassify before treatment decision. ' +
        'Starting treatment without BMD in the amber zone is not appropriate.',
      source: SRC_NOGG,
    });
    return { recommendations: [], flags, referrals, supplements };
  }

  // ── Post-anabolic sequencing (highest priority safety flag) ──
  if (patient.completedAnabolicCourse) {
    postAnabolicFlags(flags);
  }

  // ── Denosumab rebound / missed injection ──
  denosumabReboundFlags(patient, flags, referrals);

  // ── Special population overrides ──

  if (isEarlyMenopausePre50(patient)) {
    return { ...earlyMenopause(patient, flags, referrals), supplements };
  }

  if (isGIOP(patient)) {
    return { ...giop(patient, riskCategory, flags, referrals), supplements };
  }

  // ── Contextual flags ──
  adtFlags(patient, flags);
  aiFlags(patient, flags);
  affFlags(patient, flags);
  onjFlags(patient, flags);

  // ── Very high risk — anabolic consideration ──
  if (riskCategory === 'very_high') {
    flags.push({
      id: 'vhr_anabolic_consideration',
      severity: 'warning',
      message:
        'Very high fracture risk: specialist referral recommended. ' +
        'Anabolic-first therapy (teriparatide or romosozumab) may be more appropriate than antiresorptive monotherapy. ' +
        'Romosozumab (Evenity®) HSE MAP criteria — reimbursed from 1 Nov 2024: ' +
        'postmenopausal women only; T-score ≤-2.5 at total hip, femoral neck, or lumbar spine; ' +
        'major osteoporotic fracture within previous 24 months (hip, vertebral, distal radius, proximal humerus); ' +
        'individual patient application required; approved consultant only (endocrinology, gerontology, or rheumatology); ' +
        'High Tech Hub-generated prescription only — non-hub prescriptions are not reimbursed; ' +
        '12 monthly doses (210 mg/month SC = 2×105 mg injections). ' +
        'Contraindications: uncorrected hypocalcaemia, MI or stroke within preceding 12 months, hypersensitivity.',
      rationale:
        'NOGG 2024 Rec 11 (Conditional): consider referral to osteoporosis specialist for very high risk patients. ' +
        'Anabolic-first approach warranted particularly when multiple vertebral fractures are present. ' +
        'HSE MAP (effective 1 Nov 2024): romosozumab reimbursed for postmenopausal women meeting the criteria above — ' +
        'individual patient application required through approved consultant; non-hub prescriptions not reimbursed.',
      source: SRC_NOGG,
    });
    referrals.push({
      specialty: 'metabolic_bone',
      reason:
        'Very high fracture risk — anabolic therapy decision (teriparatide/romosozumab) requires consultant initiation. ' +
        'Romosozumab: HSE MAP individual patient application required; High Tech Hub prescription only.',
      urgency: 'soon',
    });
  }

  // ── Active adverse event pathways (override sequencing) ──
  if (patient.thighOrGroinPain && isCurrentlyOnBisphosphonate(patient)) {
    return { ...affProdrome(patient, flags, referrals), supplements };
  }

  if (patient.currentTreatment?.reasonStopped === 'onj') {
    return { ...onjHistory(flags, referrals), supplements };
  }

  // ── Existing treatment — sequencing logic ──
  if (patient.currentTreatment) {
    const seq = sequencing(patient, riskCategory, flags, referrals);
    return { ...seq, supplements };
  }

  // ── New treatment initiation ──
  const recommendations = initiateTherapy(patient, riskCategory, flags, referrals);
  return { recommendations, flags, referrals, supplements };
}

// ─── New treatment initiation ─────────────────────────────────────────────

function initiateTherapy(
  patient: PatientInput,
  riskCategory: RiskCategory,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): TreatmentRecommendation[] {
  const egfr = resolveEGFR(patient);
  const recs: TreatmentRecommendation[] = [];

  // HRT: first-line in postmenopausal women ≤60 with high risk (NOGG 2024 update)
  // Separate from the POI/early-menopause path (handled by isEarlyMenopausePre50)
  if (
    patient.sex === 'female' &&
    patient.age <= 60 &&
    (riskCategory === 'high' || riskCategory === 'very_high') &&
    !patient.earlyMenopause // POI handled separately
  ) {
    if (patient.vteHistory || patient.breastCancerHistory) {
      flags.push({
        id: 'hrt_safety_concern',
        severity: 'warning',
        message:
          'HRT safety concern identified: ' +
          (patient.vteHistory ? 'personal or family history of VTE (DVT/PE). ' : '') +
          (patient.breastCancerHistory ? 'personal history of breast cancer or high familial risk. ' : '') +
          'HRT is NOT recommended as first-line bone protection in this patient. ' +
          'Use bisphosphonate (alendronate) as first-line. Refer to specialist if HRT is being considered despite risk.',
        rationale:
          'NOGG 2024: HRT is first-line for women ≤60 only where VTE and breast cancer risk are low. ' +
          'VTE history or breast cancer history are standard contraindications to HRT.',
        source: SRC_BMS,
      });
    } else {
      flags.push({
        id: 'hrt_option_under60',
        severity: 'info',
        message:
          'For postmenopausal women ≤60 with high fracture risk and no VTE or breast cancer history, ' +
          'HRT is now explicitly first-line for bone protection (NOGG 2024 update). ' +
          'Transdermal oestrogen preferred (lower VTE risk than oral). Discuss with patient.',
        rationale:
          'NOGG 2024 Section 5.2 update: HRT elevated to first-line in women ≤60 alongside bisphosphonates. ' +
          'HRT also addresses menopausal symptoms. Review at 5 years.',
        source: SRC_NOGG,
      });
    }
  }

  // Alendronate first-line per HSE MMP Ireland
  if (canUse('alendronate', egfr)) {
    recs.push(alendronate());
    return recs;
  }

  // Alendronate contraindicated — renal impairment
  if (egfr !== null && egfr < RENAL_LIMITS.alendronate.ci) {
    flags.push({
      id: 'renal_bp_ci',
      severity: 'warning',
      message:
        `Oral bisphosphonates and zoledronate contraindicated: eGFR ${egfr} ml/min (<${RENAL_LIMITS.alendronate.ci}).`,
      rationale:
        'Bisphosphonates accumulate in severe renal impairment. ' +
        'Alendronate/zoledronate contraindicated if eGFR <35; risedronate if eGFR <30.',
      source: SRC_HSE,
    });

    if (egfr < RENAL_LIMITS.denosumab.hypocalcaemiaWatch) {
      flags.push({
        id: 'denosumab_ckd_hypocalcaemia',
        severity: 'warning',
        message:
          `eGFR ${egfr} ml/min: high hypocalcaemia risk with denosumab. ` +
          'Ensure vitamin D ≥50 nmol/L and calcium fully replete before injection. ' +
          'Mandatory: check corrected calcium 2 weeks after EVERY injection.',
        rationale:
          'CKD impairs 1α-hydroxylase activity (active vitamin D production). ' +
          'Denosumab increases calcium uptake into bone, worsening hypocalcaemia in CKD.',
        source: SRC_NICE,
      });
      referrals.push({
        specialty: 'nephrology',
        reason: `Severe renal impairment (eGFR ${egfr} ml/min) with osteoporosis — specialist guidance on safe bone protection.`,
        urgency: 'routine',
      });
    }

    addVitDBlock(patient, flags);
    recs.push(denosumab(egfr));
    return recs;
  }

  // eGFR unknown — add flag, still recommend with monitoring requirement
  flags.push({
    id: 'egfr_unknown',
    severity: 'warning',
    message: 'Renal function not recorded. Confirm eGFR before prescribing bisphosphonate.',
    rationale: 'eGFR <35 contraindicates alendronate and zoledronate; eGFR <30 contraindicates risedronate.',
    source: SRC_HSE,
  });
  recs.push(alendronate());
  return recs;
}

// ─── Bisphosphonate sequencing (patient on existing treatment) ────────────

function sequencing(
  patient: PatientInput,
  riskCategory: RiskCategory,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements'> {
  const current = patient.currentTreatment!;
  const egfr = resolveEGFR(patient);
  const recs: TreatmentRecommendation[] = [];

  // ── GI intolerance ──
  if (current.reasonStopped === 'gi_intolerance') {
    return { ...giSwitch(current.agent, egfr, flags), referrals };
  }

  // ── Treatment failure ──
  const isTreatmentFailure =
    current.reasonStopped === 'treatment_failure' ||
    (current.currentlyOn && current.durationMonths >= 12 && patient.numberOfPriorFractures >= 2);

  if (isTreatmentFailure) {
    flags.push({
      id: 'treatment_failure',
      severity: 'warning',
      message:
        'Possible treatment failure: new fragility fracture after ≥12 months adequate antiresorptive therapy. ' +
        'First: review adherence, oral BP technique, vitamin D repletion, calcium intake, and ongoing risk factors. ' +
        'If confirmed failure: switch treatment class.',
      rationale:
        'Treatment failure = new fracture or significant BMD loss (>4–5% spine or >3% hip) despite good adherence and replete vitamin D. ' +
        'NOGG 2024 Rec 20: reassess fracture risk after any new fracture.',
      source: SRC_NOGG,
    });
    // Offer IV/denosumab before escalating to specialist (per spec Section 7.4)
    if (isBisphosphonate(current.agent) && current.agent !== 'zoledronate') {
      flags.push({
        id: 'treatment_failure_switch',
        severity: 'info',
        message:
          'Oral bisphosphonate failure: switch to IV zoledronate or denosumab before considering anabolic escalation.',
        rationale: 'Spec Section 7.4: oral BP failure → IV zoledronate OR denosumab OR specialist for anabolic.',
        source: SRC_NOGG,
      });
      if (canUse('zoledronate', egfr)) recs.push(zoledronate());
      else recs.push(denosumab(egfr));
    } else {
      // Denosumab failure or zoledronate failure → specialist
      referrals.push({
        specialty: 'metabolic_bone',
        reason: 'Antiresorptive treatment failure — anabolic therapy (teriparatide/romosozumab) requires specialist initiation.',
        urgency: 'soon',
      });
    }
  }

  // ── Bisphosphonate reassessment (NOGG 2024 Rec 17) ──
  // Routine drug holidays are NOT supported by evidence (Evidence IIa) — individualised reassessment only.
  if (current.currentlyOn && isBisphosphonate(current.agent)) {
    const isIV = current.agent === 'zoledronate';
    const holidayYear = isIV ? BP_HOLIDAY.ivZoledronate.reviewAt : BP_HOLIDAY.oral.reviewAt;

    if (current.durationMonths >= holidayYear * 12) {
      const pauseDecision = shouldTakeBPHoliday(patient, riskCategory);
      const maleCaveat =
        patient.sex === 'male'
          ? ' No specific evidence base exists for treatment pauses in men — each case must be judged individually.'
          : '';

      if (pauseDecision.takeHoliday) {
        flags.push({
          id: 'bp_holiday_appropriate',
          severity: 'info',
          message:
            `${holidayYear}-year bisphosphonate reassessment: fracture risk appears low/intermediate ` +
            `(${pauseDecision.reasons.join('; ')}). ` +
            `An individualised treatment pause of ${BP_HOLIDAY.holidayDurationMonthsMin}–${BP_HOLIDAY.holidayDurationMonthsMax} months may be considered. ` +
            'Reassess with FRAX + femoral neck BMD at 18 months. ' +
            'This is NOT a routine recommendation — there is no standard policy for all patients.' +
            maleCaveat,
          rationale:
            'NOGG 2024 Rec 17 (Evidence IIa): routine bisphosphonate drug holidays are NOT supported by evidence. ' +
            'After 5yr oral / 3yr IV, reassess current fracture risk using FRAX with femoral neck BMD. ' +
            'A pause of 18–36 months may be considered only if risk has fallen to low/intermediate. ' +
            'Evidence is based on limited extension studies in postmenopausal women. ' +
            'FRAX assesses current fracture risk — it cannot be used to measure treatment response.',
          source: SRC_NOGG,
        });
      } else {
        flags.push({
          id: 'bp_holiday_not_appropriate',
          severity: 'info',
          message:
            `${holidayYear}-year bisphosphonate reassessment: continue ${current.agent} — ` +
            `fracture risk remains elevated (${pauseDecision.reasons.join('; ')}). ` +
            'Reassess annually using FRAX + femoral neck BMD. ' +
            'Routine drug holidays are NOT supported by evidence (NOGG 2024, Evidence IIa).' +
            maleCaveat,
          rationale:
            'NOGG 2024 Rec 17: continue bisphosphonate in high/very high risk patients. ' +
            'Fracture prevention benefit outweighs atypical femoral fracture risk. ' +
            'Evidence IIa: based on limited extension studies in postmenopausal women — each patient assessed individually.',
          source: SRC_NOGG,
        });
        // At very high risk after long-term bisphosphonate, offer denosumab switch
        if (riskCategory === 'very_high' && canUse('denosumab', egfr)) {
          recs.push(denosumab(egfr));
          flags.push({
            id: 'bp_to_denosumab',
            severity: 'info',
            message:
              'Very high risk after long-term bisphosphonate: consider switching to denosumab for superior BMD gains. ' +
              'CRITICAL: ensure explicit transition plan before starting — ' +
              'denosumab must not be stopped without sequential bisphosphonate.',
            rationale:
              'FREEDOM Extension data show greater BMD gains with denosumab vs continued bisphosphonate. ' +
              'Abrupt denosumab discontinuation causes rapid BMD loss and rebound vertebral fractures.',
            source: SRC_NOGG,
          });
        }
      }
    }
  }

  return { recommendations: recs, flags, referrals };
}

// ─── Holiday decision logic (NOGG 2024 Rec 17) ───────────────────────────

function shouldTakeBPHoliday(
  patient: PatientInput,
  riskCategory: RiskCategory,
): { takeHoliday: boolean; reasons: string[] } {
  const continueReasons: string[] = [];

  // Continue if age ≥70
  if (patient.age >= 70) {
    continueReasons.push('age ≥70 — longer duration needed');
  }

  // Continue if hip or vertebral fracture history
  if (patient.priorHipFracture || patient.priorVertebralFracture) {
    continueReasons.push('prior hip or vertebral fracture');
  }

  // Continue if new fracture on treatment
  if (patient.numberOfPriorFractures >= 2 && patient.currentTreatment?.durationMonths && patient.currentTreatment.durationMonths >= 12) {
    continueReasons.push('fracture during treatment');
  }

  // Continue if ongoing high-dose glucocorticoids
  if (
    patient.glucocorticoidUse?.current &&
    (patient.glucocorticoidUse.dose === 'medium' || patient.glucocorticoidUse.dose === 'high')
  ) {
    continueReasons.push('ongoing high-dose glucocorticoids');
  }

  // Continue if hip T-score ≤ -2.5
  const hipTScores = [
    patient.dexaResults?.totalHipTScore,
    patient.dexaResults?.femoralNeckTScore,
  ].filter((t): t is number => t != null);
  if (hipTScores.length > 0 && Math.min(...hipTScores) <= -2.5) {
    continueReasons.push('hip T-score ≤ −2.5');
  }

  // Continue if FRAX still high (red zone)
  if (riskCategory === 'high' || riskCategory === 'very_high') {
    continueReasons.push('FRAX risk still in red zone');
  }

  if (continueReasons.length > 0) {
    return { takeHoliday: false, reasons: continueReasons };
  }

  return {
    takeHoliday: true,
    reasons: ['T-score >−2.5 at hip', 'no hip or vertebral fracture', 'age <70', 'no ongoing steroids'],
  };
}

// ─── GI intolerance switch pathway ───────────────────────────────────────

function giSwitch(
  stoppedAgent: TreatmentAgent,
  egfr: number | null,
  flags: ClinicalFlag[],
): Omit<TreatmentOutput, 'supplements' | 'referrals'> {
  const recs: TreatmentRecommendation[] = [];

  if (stoppedAgent === 'alendronate') {
    flags.push({
      id: 'gi_alendronate_switch',
      severity: 'info',
      message:
        'GI intolerance to alendronate. Switch options (in order): ' +
        '(1) Risedronate 35mg weekly — better upper GI tolerability; ' +
        '(2) Ibandronate 150mg monthly — fewer dosing events; ' +
        '(3) Zoledronate 5mg IV annually — bypasses GI entirely.',
      rationale: 'HSE MMP / NOGG 2024 Rec 13: switch oral bisphosphonate or move to IV if GI not tolerated.',
      source: SRC_HSE,
    });
    if (canUse('risedronate', egfr)) recs.push(risedronate());
    if (canUse('ibandronate', egfr)) recs.push(ibandronate());
    if (canUse('zoledronate', egfr)) recs.push(zoledronate());
  } else if (stoppedAgent === 'risedronate') {
    flags.push({
      id: 'gi_risedronate_switch',
      severity: 'info',
      message:
        'GI intolerance to risedronate after alendronate failure. ' +
        'Switch to: Ibandronate 150mg monthly OR Zoledronate 5mg IV annually (bypasses GI).',
      rationale: 'After failure of two oral bisphosphonates due to GI effects, IV or monthly oral is appropriate.',
      source: SRC_HSE,
    });
    if (canUse('ibandronate', egfr)) recs.push(ibandronate());
    if (canUse('zoledronate', egfr)) recs.push(zoledronate());
    else if (!canUse('zoledronate', egfr)) recs.push(denosumab(egfr));
  } else {
    // Any other agent — IV or denosumab
    if (canUse('zoledronate', egfr)) recs.push(zoledronate());
    else recs.push(denosumab(egfr));
  }

  return { recommendations: recs, flags };
}

// ─── AFF prodrome ─────────────────────────────────────────────────────────

function affProdrome(
  patient: PatientInput,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements'> {
  flags.push({
    id: 'aff_prodrome_urgent',
    severity: 'urgent',
    message:
      'URGENT: Thigh/groin pain on bisphosphonate therapy — suspected atypical femoral fracture. ' +
      'WITHHOLD bisphosphonate immediately. Arrange bilateral femoral X-rays ± MRI. ' +
      'Do not dismiss — prodromal pain precedes complete AFF in ~70% of cases.',
    rationale:
      '~30% of AFFs are bilateral — both femora must be imaged (NOGG 2024 Section 7.2; ASBMR Task Force).',
    source: SRC_NOGG,
  });
  flags.push({
    id: 'aff_post_diagnosis_options',
    severity: 'urgent',
    message:
      'If AFF confirmed: STOP bisphosphonate permanently. ' +
      'For ongoing bone protection: denosumab OR teriparatide (specialist-initiated). ' +
      'Do NOT switch to another bisphosphonate. ' +
      'If switching FROM denosumab TO teriparatide: expect BMD decline at lumbar spine (3–6 months) and hip (12 months) — ' +
      'not advisable where severe hip or spine osteoporosis is present; confirm with specialist. ' +
      'Note: teriparatide has modest effect on hip BMD and has not been shown to reduce hip fractures in RCTs.',
    rationale:
      'NOGG 2024 / NICE NG187: after AFF, bisphosphonates should generally be avoided. ' +
      'Teriparatide promotes cortical healing of incomplete AFF. ' +
      'Denosumab is a valid alternative where teriparatide is not appropriate. ' +
      'Teriparatide contraindications: unexplained raised ALP, Paget\'s disease, prior radiation to skeleton, ' +
      'renal calculi, hypercalcaemia, hyperparathyroidism, haematological malignancy, active malignancy.',
    source: SRC_NOGG,
  });
  referrals.push(
    { specialty: 'orthopaedics', reason: 'Suspected AFF — imaging and orthopaedic assessment.', urgency: 'urgent' },
    { specialty: 'metabolic_bone', reason: 'AFF confirmed — bone protection agent selection (denosumab or teriparatide).', urgency: 'urgent' },
  );

  return { recommendations: [], flags, referrals };
}

// ─── ONJ history ──────────────────────────────────────────────────────────

function onjHistory(
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements'> {
  flags.push({
    id: 'onj_avoid_antiresorptive',
    severity: 'warning',
    message:
      'ONJ history on antiresorptive therapy: bisphosphonates and denosumab should generally be avoided. ' +
      'Refer to metabolic bone specialist for alternative bone protection strategy.',
    rationale:
      'ONJ recurrence risk with rechallenge. Anabolic agents (teriparatide) may be appropriate ' +
      'with specialist input (NOGG 2024 Section 7.3; AAOMS).',
    source: SRC_NOGG,
  });
  referrals.push(
    { specialty: 'metabolic_bone', reason: 'ONJ history — specialist guidance on bone protection alternatives.', urgency: 'soon' },
    { specialty: 'oral_maxfac', reason: 'Active ONJ: refer oral/maxillofacial surgery for assessment and management.', urgency: 'soon' },
  );
  return { recommendations: [], flags, referrals };
}

// ─── Post-anabolic sequencing ─────────────────────────────────────────────

function postAnabolicFlags(flags: ClinicalFlag[]): void {
  flags.push({
    id: 'post_anabolic_antiresorptive',
    severity: 'urgent',
    message:
      'CRITICAL: Patient has completed/is completing anabolic therapy (teriparatide/romosozumab/abaloparatide). ' +
      'The sequential antiresorptive (alendronate or zoledronate) should be PRESCRIBED AND READY 1 month before the final anabolic dose, ' +
      'to ensure zero gap in treatment. Start WITHOUT DELAY on completion. ' +
      'Failure to do so results in rapid and complete loss of BMD gains within 12 months.',
    rationale:
      'NOGG 2024 Rec 14 (Strong): antiresorptive therapy must follow anabolic treatment immediately. ' +
      'Prescribing 1 month in advance of the final dose ensures no gap if there are dispensing or appointment delays.',
    source: SRC_NOGG,
  });
}

// ─── Denosumab rebound / missed injection ────────────────────────────────

function denosumabReboundFlags(
  patient: PatientInput,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): void {
  const isOnDenosumab = patient.currentTreatment?.agent === 'denosumab' && patient.currentTreatment.currentlyOn;

  if (isOnDenosumab) {
    // Early warning at 6 months + 2 weeks (~6.5 months)
    if (
      patient.denosumabMonthsSinceLastDose !== null &&
      patient.denosumabMonthsSinceLastDose >= 6.5 &&
      patient.denosumabMonthsSinceLastDose <= DENOSUMAB.reboundRiskThresholdMonths
    ) {
      flags.push({
        id: 'denosumab_injection_due',
        severity: 'warning',
        message:
          `Denosumab injection is now ${patient.denosumabMonthsSinceLastDose} months overdue — arrange next dose immediately. ` +
          'Fracture risk begins to increase beyond 6 months from the last injection. ' +
          'The 7-month mark represents significant clinical risk.',
        rationale:
          'NOGG 2024 Rec 18: rebound fracture risk begins once the 6-month injection window is missed. ' +
          'Clinical urgency increases rapidly beyond 6.5 months.',
        source: SRC_NOGG,
      });
    }

    // Overdue injection ≥7 months — urgent
    if (
      patient.denosumabMonthsSinceLastDose !== null &&
      patient.denosumabMonthsSinceLastDose > DENOSUMAB.reboundRiskThresholdMonths
    ) {
      flags.push({
        id: 'denosumab_overdue_injection',
        severity: 'urgent',
        message:
          `URGENT: Denosumab injection is overdue (${patient.denosumabMonthsSinceLastDose} months since last dose; critical threshold 7 months). ` +
          'Rapid BMD loss and rebound vertebral fracture risk is HIGH. ' +
          'Give next injection immediately and counsel patient on strict 6-monthly schedule.',
        rationale:
          'NOGG 2024 Rec 18–19: gaps >7 months since last denosumab dose are associated with rebound vertebral fractures ' +
          'due to rapid resurgence of osteoclast activity.',
        source: SRC_NOGG,
      });
    }

    // Planned cessation
    flags.push({
      id: 'denosumab_cessation_plan',
      severity: 'warning',
      message:
        'Stopping denosumab is associated with rapid BMD loss and increased fragility fracture risk (NOGG 2024, Evidence IIa). ' +
        'Routine cessation is NOT supported — stopping should only occur when clinically necessary. ' +
        'If cessation is required: transition WITHOUT DELAY to: ' +
        '(1) Oral alendronate 70mg weekly started 6 months after last denosumab injection, OR ' +
        '(2) Single IV zoledronate 5mg given 6 months after last denosumab injection. ' +
        'Confirm DEXA 1–2 years after transition. ' +
        'Advise patient of this risk before initiating denosumab.',
      rationale:
        'NOGG 2024 Rec 18 (Strong): inform patients of rebound fracture risk before initiating denosumab. ' +
        'Stopping is associated with rapid loss of BMD and increased risk of multiple vertebral fractures (Evidence IIa). ' +
        'Rec 19 (Strong): sequential antiresorptive therapy is mandatory on cessation. ' +
        'Routine cessation without a clear clinical reason is not appropriate.',
      source: SRC_NOGG,
    });
  }
}

// ─── Special populations ──────────────────────────────────────────────────

function isEarlyMenopausePre50(patient: PatientInput): boolean {
  return patient.sex === 'female' && patient.earlyMenopause && patient.age < 50;
}

function earlyMenopause(
  patient: PatientInput,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements'> {
  flags.push({
    id: 'poi_hrt_first_line',
    severity: 'info',
    message:
      'Premature ovarian insufficiency / early menopause (<45 years): HRT is first-line for bone protection until at least age 51. ' +
      'Add bisphosphonate only if DEXA shows osteoporosis AND HRT alone is insufficient or contraindicated.',
    rationale:
      'NICE NG23 / NOGG 2024: HRT addresses all consequences of oestrogen deficiency. ' +
      'Bisphosphonates are not first-line in POI — they do not address symptoms, cardiovascular, or cognitive effects of early oestrogen deficiency.',
    source: SRC_BMS,
  });

  referrals.push({
    specialty: 'endocrinology',
    reason: 'Premature ovarian insufficiency — specialist management of POI, HRT choice, and long-term bone health (endocrinology or gynaecology).',
    urgency: 'routine',
  });

  const rec: TreatmentRecommendation = {
    agent: 'hrt',
    dose: 'Standard dose — oestradiol gel/patch (± progestogen if uterus intact)',
    frequency: 'Daily; transdermal preferred (lower VTE risk than oral)',
    rationale:
      'First-line for bone protection in POI/early menopause. ' +
      'Continue until at least average age of natural menopause (~51 years), then reassess fracture risk with FRAX and DEXA.',
    strength: 'strong',
    contraindications: [
      'Oestrogen-sensitive malignancy',
      'Undiagnosed vaginal bleeding',
      'Active or recent arterial thromboembolic event',
      'Severe active liver disease',
    ],
    monitoring: [
      'Annual blood pressure',
      'Breast awareness',
      'DEXA at age 51 to guide decision on continuing or switching bone protection strategy',
    ],
    source: SRC_BMS,
  };

  return { recommendations: [rec], flags, referrals };
}

function isGIOP(patient: PatientInput): boolean {
  if (!patient.glucocorticoidUse) return false;
  if (!patient.glucocorticoidUse.current) return false;

  const { dose, durationMonths } = patient.glucocorticoidUse;

  // High-dose threshold (≥7.5mg/day for ≥3 months)
  if ((dose === 'medium' || dose === 'high') && durationMonths >= GIOP.highDoseMinMonths) return true;

  // Lower-dose threshold: ≥5mg/day + age ≥65 or prior fragility fracture
  if (dose === 'low' && durationMonths >= GIOP.lowerDoseMinMonths) {
    if (patient.age >= GIOP.lowerDoseTriggerAge || patient.priorFragilityFracture) return true;
    // Any dose ≥3 months, age <65, no prior fracture: DEXA required — treat if T-score ≤-1.5
    if (durationMonths >= GIOP.highDoseMinMonths) return true;
  }

  return false;
}

function giop(
  patient: PatientInput,
  riskCategory: RiskCategory,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements'> {
  const egfr = resolveEGFR(patient);
  const recs: TreatmentRecommendation[] = [];
  const { dose, durationMonths } = patient.glucocorticoidUse!;

  const isHighDose = dose === 'medium' || dose === 'high';

  // Lower threshold scenario: low-dose, age <65, no prior fracture
  // Steroids increase fracture risk independently of BMD — DEXA required; treat if T-score ≤-1.5
  const isLowerThresholdOnly =
    dose === 'low' &&
    patient.age < GIOP.lowerDoseTriggerAge &&
    !patient.priorFragilityFracture;

  if (isLowerThresholdOnly) {
    flags.push({
      id: 'giop_lower_threshold_new',
      severity: 'warning',
      message:
        `Age <${GIOP.lowerDoseTriggerAge}, no prior fracture, on glucocorticoids (${dose}-dose, ${durationMonths} months): ` +
        'glucocorticoids increase fracture risk independently of BMD — the standard T-score threshold does not apply. ' +
        'DEXA required: start bone protection if T-score ≤-1.5 (NOGG 2024).',
      rationale:
        'NOGG 2024: glucocorticoids increase fracture risk at all doses over and above the effect on BMD. ' +
        'For patients aged <65 without prior fracture, the lower treatment threshold of T-score ≤-1.5 applies.',
      source: SRC_NOGG,
    });

    const tScores = patient.dexaResults
      ? [
          patient.dexaResults.lumbarSpineTScore,
          patient.dexaResults.totalHipTScore,
          patient.dexaResults.femoralNeckTScore,
        ].filter((t): t is number => t != null)
      : [];
    const lowestT = tScores.length > 0 ? Math.min(...tScores) : null;

    if (lowestT === null) {
      // No DEXA yet — flag raised, await result before treating
      return { recommendations: [], flags, referrals };
    }

    if (lowestT > -1.5) {
      flags.push({
        id: 'giop_lower_threshold_no_treatment',
        severity: 'info',
        message:
          `T-score ${lowestT} > −1.5: bone protection pharmacotherapy not required at this threshold. ` +
          'Lifestyle measures and supplementation recommended. Reassess with DEXA in 1–2 years.',
        rationale:
          'NOGG 2024: T-score >−1.5 does not meet the lower treatment threshold for this GIOP scenario.',
        source: SRC_NOGG,
      });
      return { recommendations: [], flags, referrals };
    }
    // T-score ≤-1.5 — continue to standard treatment recommendations below
  }

  flags.push({
    id: 'giop_lower_threshold',
    severity: 'warning',
    message:
      `GIOP: ${dose}-dose glucocorticoid for ${durationMonths} months — lower treatment thresholds apply. ` +
      'FRAX underestimates fracture risk at high dose; arithmetic adjustment applied (MOF ×1.15, hip ×1.20). ' +
      (isHighDose
        ? 'Start bone protection AT THE SAME TIME as steroids — do not wait for DEXA.'
        : 'Bone protection indicated given age/fracture history — assess need for DEXA.'),
    rationale:
      'NOGG 2024 Rec 22 (Strong): start bone protection immediately when prednisolone ≥7.5mg/day ≥3 months is initiated. ' +
      'Glucocorticoids cause greatest bone loss in first 3–6 months.',
    source: SRC_NOGG,
  });

  flags.push({
    id: 'giop_monitoring',
    severity: 'info',
    message:
      'GIOP monitoring: DEXA within 6 months of starting treatment, then every 1–2 years. ' +
      'Annual bloods: calcium, vitamin D, eGFR.',
    rationale: 'NOGG 2024 / IOS 2024 monitoring recommendations for GIOP.',
    source: SRC_IOS,
  });

  // GIOP very high risk: multiple VF or T-score ≤-3.5 → anabolic (not just any high dose)
  const giopVHR =
    (patient.priorVertebralFracture && patient.numberOfPriorFractures >= 2) ||
    (patient.dexaResults !== null && lowestDexaTScore(patient.dexaResults) <= -3.5);

  if (giopVHR) {
    flags.push({
      id: 'giop_anabolic_preferred',
      severity: 'warning',
      message:
        'Very high risk GIOP (multiple vertebral fractures or T-score ≤-3.5 on glucocorticoids): ' +
        'teriparatide preferred over bisphosphonate for superior efficacy. Requires specialist initiation. ' +
        'Note: teriparatide has modest effect on hip BMD and has not been shown to reduce hip fractures in RCTs. ' +
        'If severe osteoporosis is present at both spine AND hip, consider bisphosphonate first then teriparatide with specialist input.',
      rationale:
        'NOGG 2024 Rec 23 / BSR 2022: teriparatide shown superior to alendronate in GIOP (Saag et al. NEJM 2007). ' +
        'GIOP VHR = multiple vertebral fractures OR T-score ≤-3.5 on steroids. ' +
        'Teriparatide contraindications: unexplained raised ALP, Paget\'s disease, prior radiation to skeleton, ' +
        'renal calculi, hypercalcaemia, hyperparathyroidism, haematological malignancy, active malignancy.',
      source: SRC_BSR,
    });
    referrals.push({
      specialty: 'rheumatology',
      reason: 'Very high risk GIOP — teriparatide preferred; requires specialist (High-Tech) prescription in Ireland.',
      urgency: 'soon',
    });
  }

  // Standard GIOP: alendronate or zoledronate
  if (canUse('alendronate', egfr)) {
    recs.push({
      ...alendronate(),
      rationale:
        'First-line bisphosphonate for GIOP (NOGG 2024 Rec 23; HSE MMP). ' +
        'Initiate at same time as glucocorticoid if planned duration ≥3 months. ' +
        'Calcium 1000–1500 mg/day and vitamin D ≥800 IU/day required alongside.',
    });
  } else if (canUse('zoledronate', egfr)) {
    recs.push({ ...zoledronate(), rationale: 'IV zoledronate for GIOP when oral bisphosphonate is contraindicated or not tolerated.' });
  } else {
    recs.push(denosumab(egfr));
    flags.push({
      id: 'giop_denosumab_conditional',
      severity: 'info',
      message: 'Denosumab is an alternative treatment option for GIOP (NOGG 2024 Rec 24 — Conditional).',
      rationale: 'Consider denosumab when bisphosphonates are contraindicated or not tolerated in GIOP.',
      source: SRC_NOGG,
    });
  }

  return { recommendations: recs, flags, referrals };
}

// ─── Context flags ────────────────────────────────────────────────────────

function adtFlags(patient: PatientInput, flags: ClinicalFlag[]): void {
  if (!patient.adtUse) return;
  flags.push({
    id: 'adt_bone_loss',
    severity: 'info',
    message:
      'ADT (androgen deprivation therapy): causes rapid bone loss and elevated fracture risk. ' +
      'First-line bone protection: denosumab 60mg SC every 6 months (strongest trial evidence — HALT trial). ' +
      'Alternatives: alendronate or zoledronate. DEXA baseline and monitoring every 1–2 years during ADT.',
    rationale:
      'NOGG 2024 Section 7 / NICE NG187: denosumab 60mg is licensed and has RCT evidence for fracture ' +
      'prevention in men on ADT (Smith et al. NEJM 2009 — 62% vertebral fracture reduction).',
    source: SRC_NOGG,
  });
}

function aiFlags(patient: PatientInput, flags: ClinicalFlag[]): void {
  if (!patient.aromataseInhibitorUse) return;

  const tScores = patient.dexaResults
    ? [
        patient.dexaResults.lumbarSpineTScore,
        patient.dexaResults.totalHipTScore,
        patient.dexaResults.femoralNeckTScore,
      ].filter((t): t is number => t != null)
    : [];
  const lowestT = tScores.length > 0 ? Math.min(...tScores) : null;
  const meetsAIThreshold = lowestT !== null && lowestT <= -1.5;

  flags.push({
    id: 'ai_ctibl',
    severity: meetsAIThreshold ? 'warning' : 'info',
    message:
      meetsAIThreshold
        ? `Aromatase inhibitor therapy with T-score ${lowestT} ≤-1.5: TREAT — lower threshold applies due to rapid rate of bone loss on AI therapy. ` +
          'Treatment indication is independent of FRAX score. First-line: alendronate or zoledronate. DEXA every 1–2 years.'
        : 'Aromatase inhibitor therapy: treat bone loss if T-score ≤-1.5 (regardless of FRAX) due to rapid rate of bone loss in this population. ' +
          'Also treat if T-score ≤-2.5, or if FRAX is in the high/very high zone. DEXA every 1–2 years.',
    rationale:
      'NOGG 2024 Section 7 / CTIBL guidelines: AI therapy causes rapid oestrogen suppression and accelerated bone loss. ' +
      'Treatment threshold is T-score ≤-1.5 regardless of FRAX score, due to rapid bone loss rate.',
    source: SRC_CTIBL,
  });
}

function affFlags(patient: PatientInput, flags: ClinicalFlag[]): void {
  const current = patient.currentTreatment;
  if (!current || !isBisphosphonate(current.agent)) return;

  if (current.durationMonths >= 60) {
    flags.push({
      id: 'aff_long_duration_surveillance',
      severity: 'info',
      message:
        `Bisphosphonate duration ${Math.round(current.durationMonths / 12)} years: AFF risk increases after 5 years. ` +
        'Ask about unexplained thigh or groin pain at every consultation.',
      rationale:
        'NOGG 2024 Section 7.2: AFF incidence 3–50 per 100,000 person-years — risk increases with duration >5 years ' +
        'but remains low relative to fracture prevention benefit.',
      source: SRC_NOGG,
    });
  }
}

function onjFlags(patient: PatientInput, flags: ClinicalFlag[]): void {
  const newStart = !patient.currentTreatment && patient.previousTreatments.length === 0;
  if (!newStart) return;
  flags.push({
    id: 'onj_dental_pre_start',
    severity: 'info',
    message:
      'Before starting bisphosphonate or denosumab: complete any outstanding invasive dental treatment first if possible, ' +
      'ensure good dental hygiene, and advise patient to inform dentist of antiresorptive use before any future invasive dental procedure.',
    rationale:
      'NOGG 2024 Section 7.3: ONJ risk is low at osteoporosis doses (oral BP <1:10,000 patient-years) ' +
      'but can be minimised with pre-treatment dental review and ongoing oral hygiene.',
    source: SRC_NOGG,
  });
}

// ─── Supplements ──────────────────────────────────────────────────────────

function getSupplements(patient: PatientInput): SupplementRecommendation[] {
  const sups: SupplementRecommendation[] = [];
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  const isGIOPPatient = isGIOP(patient);

  // Vitamin D
  const severeVitDDeficiency = vitD !== null && vitD < 25;
  const vitDDose =
    vitD === null
      ? '50,000 IU cholecalciferol weekly × 8 weeks loading (e.g. Dekristol 20,000 IU × 4 weekly doses, or equivalent), ' +
        'then 800–1000 IU/day maintenance. Do NOT start antiresorptive until replete. ' +
        'Do NOT administer denosumab until Vit D ≥50 nmol/L.'
      : severeVitDDeficiency
      ? `Severe deficiency (${vitD} nmol/L): Irish standard loading protocol — ` +
        '50,000 IU cholecalciferol weekly × 6 weeks (300,000 IU total load, e.g. Dekristol). ' +
        'Recheck 25-OHD 6–8 weeks after loading. ' +
        `Then maintenance 800–1000 IU/day. Target ≥${BLOOD_RANGES.vitaminD.target} nmol/L. ` +
        'Do NOT start antiresorptive until replete. Do NOT administer denosumab until Vit D ≥50 nmol/L.'
      : vitD < BLOOD_RANGES.vitaminD.deficient
      ? `Deficient (${vitD} nmol/L): 50,000 IU weekly × 8–12 weeks loading, then 800–1000 IU/day maintenance. ` +
        `Target ≥${BLOOD_RANGES.vitaminD.target} nmol/L. Do NOT administer denosumab until Vit D ≥50 nmol/L.`
      : vitD < BLOOD_RANGES.vitaminD.target
      ? '800–1000 IU/day (cholecalciferol — Desunin 800IU or InVita D3 drops)'
      : '800 IU/day (maintenance — Desunin 800IU or combined Ca/D3 product)';

  sups.push({
    supplement: 'vitamin_d',
    dose: vitDDose,
    rationale:
      vitD !== null
        ? `Serum 25-OHD ${vitD} nmol/L — target ≥${BLOOD_RANGES.vitaminD.target} nmol/L (NOGG 2024 Rec 26). ` +
          'Practically all older adults in Ireland are vitamin D insufficient given low-sunlight latitude.'
        : `Vitamin D status unknown — supplement pending result. Target ≥${BLOOD_RANGES.vitaminD.target} nmol/L.`,
  });

  // Calcium
  sups.push({
    supplement: 'calcium',
    dose: isGIOPPatient
      ? '1000–1500 mg/day total (diet + supplement) — higher requirement in GIOP. ' +
        'Supplement with Calcichew D3 Forte or Adcal-D3 if dietary intake is insufficient. ' +
        'Dietary calcium always preferred over supplements.'
      : '1200 mg/day total dietary target (IOS 2024) for all patients ≥50 with bone loss. ' +
        'Supplements should only be used if dietary calcium is consistently insufficient — ' +
        'dietary calcium is always preferred. ' +
        'Excess supplementation (>500–600 mg/day on top of an adequate diet) carries cardiovascular risk evidence and should be avoided.',
    rationale: isGIOPPatient
      ? 'Glucocorticoids reduce GI calcium absorption and increase renal excretion — higher supplementation needed (NOGG 2024 Rec 22).'
      : 'IOS 2024: 1200 mg/day is the target total intake for adults ≥50 with bone loss. ' +
        'Dietary sources (dairy, fortified foods, green vegetables) are preferred. ' +
        'Supplements are indicated only when dietary intake consistently falls below the target (NOGG 2024 Rec 26).',
  });

  return sups;
}

// ─── Treatment recipe cards ───────────────────────────────────────────────

function alendronate(): TreatmentRecommendation {
  return {
    agent: 'alendronate',
    dose: '70 mg',
    frequency: 'Once weekly, fasting with full glass of water; remain upright ≥30 minutes before eating/other medications',
    rationale:
      'First-line bisphosphonate (HSE MMP Ireland preferred). Best cost-effectiveness; generic available. ' +
      'Reduces vertebral fractures ~47% and hip fractures ~51% (Black et al. Lancet 1996).',
    strength: 'strong',
    contraindications: [
      'eGFR <35 ml/min',
      'Oesophageal abnormality (stricture, achalasia, dysmotility)',
      'Inability to sit/stand upright for ≥30 minutes',
      'Uncorrected hypocalcaemia',
    ],
    monitoring: [
      'Adjusted calcium and eGFR at baseline',
      'Vitamin D ≥75 nmol/L before initiation',
      'DEXA at 1–2 years, then every 2 years',
      'Review for treatment holiday at 5 years per NOGG 2024 Rec 17',
      'Annual enquiry about thigh/groin pain (AFF surveillance)',
    ],
    irishPrescribingNote: 'GMS standard — GP can prescribe. HSE MMP preferred first-line bisphosphonate.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Alendronate is a weekly tablet that strengthens bones by slowing the cells that break down bone tissue. It significantly reduces the risk of hip and spine fractures.',
      howToTake:
        'Take ONE tablet once a week, on the SAME day each week. Take it first thing in the morning, on an empty stomach, with a full glass of plain water (not tea or juice). ' +
        'Stay sitting or standing upright for at least 30 minutes afterwards — do not lie down. Wait 30 minutes before eating, drinking anything other than water, or taking other medicines.',
      sideEffects: [
        'Heartburn, indigestion, or stomach discomfort (most common)',
        'Difficulty swallowing or chest pain (rare — stop and contact your GP if this happens)',
        'Muscle or joint aches',
      ],
      warnings: [
        'Never crush or chew the tablet — swallow it whole.',
        'If you miss a dose, take it the next morning — then return to your usual day the following week. Never take two doses in one day.',
        'Tell your dentist you are taking alendronate before any tooth extraction or jaw surgery.',
        'If you develop unexplained thigh or hip pain, tell your GP — this needs to be checked promptly.',
      ],
    },
  };
}

function risedronate(): TreatmentRecommendation {
  return {
    agent: 'risedronate',
    dose: '35 mg',
    frequency: 'Once weekly, on an empty stomach; remain upright ≥30 minutes',
    rationale:
      'Second-line oral bisphosphonate (HSE MMP). Lower upper GI adverse effect rate than alendronate. Generic available.',
    strength: 'strong',
    contraindications: [
      'eGFR <30 ml/min',
      'Oesophageal abnormality',
      'Inability to remain upright for ≥30 minutes',
      'Uncorrected hypocalcaemia',
    ],
    monitoring: [
      'Calcium and eGFR at baseline',
      'Vitamin D ≥75 nmol/L before initiation',
      'DEXA at 1–2 years; holiday review at 5 years',
    ],
    irishPrescribingNote: 'GMS standard — second-line oral bisphosphonate per HSE MMP.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Risedronate is a weekly tablet that strengthens bones by reducing bone breakdown. It is an alternative to alendronate with slightly less stomach upset.',
      howToTake:
        'Take ONE tablet once a week, on the SAME day each week. Take on an empty stomach first thing in the morning with a full glass of water. ' +
        'Stay upright for at least 30 minutes and do not eat, drink (other than water), or take other medicines for 30 minutes.',
      sideEffects: [
        'Mild stomach upset, heartburn (less common than with alendronate)',
        'Headache',
        'Muscle or joint pain',
      ],
      warnings: [
        'Stay upright (sitting or standing) for at least 30 minutes after taking.',
        'Tell your dentist you are on risedronate before any invasive dental work.',
        'If you develop unexplained thigh or groin pain, contact your GP.',
      ],
    },
  };
}

function ibandronate(): TreatmentRecommendation {
  return {
    agent: 'ibandronate',
    dose: '150 mg',
    frequency: 'Once monthly, fasting with full glass of water; remain upright ≥60 minutes',
    rationale:
      'Monthly dosing — adherence advantage over weekly. Evidence mainly for vertebral fracture reduction; ' +
      'less robust hip fracture data than alendronate/zoledronate. Use where weekly oral dosing is not feasible.',
    strength: 'conditional',
    contraindications: [
      'eGFR <30 ml/min',
      'Oesophageal abnormality',
      'Inability to remain upright ≥60 minutes',
      'Uncorrected hypocalcaemia',
    ],
    monitoring: [
      'Calcium and eGFR at baseline',
      'DEXA at 1–2 years',
    ],
    irishPrescribingNote: 'GMS standard (less preferred per HSE MMP). Monthly dosing only advantage.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Ibandronate is a monthly tablet that strengthens bones by slowing bone breakdown. It is taken once a month, which some patients find easier than weekly tablets.',
      howToTake:
        'Take ONE tablet on the SAME date each month, first thing in the morning on an empty stomach with a full glass of water. ' +
        'Stay upright for at least 60 minutes after taking and do not eat or drink (other than water) for 60 minutes.',
      sideEffects: [
        'Stomach upset, heartburn',
        'Difficulty swallowing (rare)',
      ],
      warnings: [
        'Must remain upright for a full 60 minutes after taking (longer than weekly bisphosphonates).',
        'Tell your dentist you are on ibandronate before invasive dental work.',
      ],
    },
  };
}

function zoledronate(): TreatmentRecommendation {
  return {
    agent: 'zoledronate',
    dose: '5 mg IV infusion over ≥15 minutes',
    frequency: 'Once yearly',
    rationale:
      'IV bisphosphonate — first choice if oral not tolerated. Single annual infusion maximises adherence. ' +
      '70% hip fracture reduction (HORIZON-PFT, Black et al. NEJM 2007). Pre-hydrate (500ml water) before infusion.',
    strength: 'strong',
    contraindications: [
      'eGFR <35 ml/min',
      'Uncorrected hypocalcaemia (must be corrected before infusion)',
      'Vitamin D deficiency (replete before infusion)',
      'Pregnancy',
    ],
    monitoring: [
      'Vitamin D ≥75 nmol/L and calcium normal before each infusion',
      'eGFR before each annual infusion',
      'Premedication: paracetamol 1g 1 hour BEFORE infusion, then again 6 hours AFTER — reduces flu-like acute-phase reaction',
      'DEXA at 1–2 years; bisphosphonate reassessment at 3 years',
      'Dental review before starting if invasive dental work anticipated — ONJ risk (very low at osteoporosis doses)',
    ],
    irishPrescribingNote: 'GMS standard (Aclasta) — administered in community infusion centre or hospital. GP prescribes, clinic administers.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Zoledronate (Aclasta) is an annual IV infusion that strengthens bone by slowing the cells that break it down. One infusion a year provides year-round protection.',
      howToTake:
        'Given as a slow drip into a vein over about 15 minutes in a clinic or hospital, once a year. ' +
        'Drink plenty of water (at least 2 glasses) before attending. Take 1g paracetamol 1 hour before your appointment.',
      sideEffects: [
        'Flu-like symptoms (fever, aches, headache) for 1–3 days after the first infusion — this is an immune reaction, not an allergy, and usually improves with subsequent doses',
        'Muscle or joint aches',
        'Low-grade fever',
      ],
      warnings: [
        'Take 1g paracetamol (2 standard tablets) 1 hour before the infusion, and again 6 hours after, to reduce flu-like side effects.',
        'Drink plenty of fluids on the day of your infusion.',
        'Tell your dentist you are on zoledronate before any tooth extraction or jaw surgery — jaw problems (ONJ) are very rare but possible.',
        'Your vitamin D and calcium should be normal before the infusion — a blood test will be checked beforehand.',
        'If you develop severe jaw pain or dental problems after the infusion, contact your doctor.',
      ],
    },
  };
}

function denosumab(egfr: number | null): TreatmentRecommendation {
  const ckdCaution =
    egfr !== null && egfr < RENAL_LIMITS.denosumab.hypocalcaemiaWatch
      ? [
          `eGFR ${egfr} ml/min: HIGH hypocalcaemia risk — mandatory corrected calcium check 2 weeks after EVERY injection.`,
        ]
      : [];

  return {
    agent: 'denosumab',
    dose: '60 mg SC injection',
    frequency: 'Every 6 months (strict) — risk of rebound vertebral fractures begins if >6 months since last dose',
    rationale:
      'Not renally cleared — preferred when bisphosphonates are contraindicated (eGFR <35). ' +
      'Also used in treatment escalation for very high risk or bisphosphonate failure.',
    strength: 'strong',
    contraindications: [
      'Uncorrected hypocalcaemia (MUST correct before each injection)',
      'Vitamin D <50 nmol/L — correct deficiency before administering',
      ...ckdCaution,
    ],
    monitoring: [
      'Adjusted calcium before each injection',
      'Vitamin D ≥50 nmol/L before each injection (do not administer if <50 nmol/L)',
      ...(egfr !== null && egfr < RENAL_LIMITS.denosumab.hypocalcaemiaWatch
        ? ['eGFR <35: corrected calcium MANDATORY at 2 weeks post-injection (every dose)']
        : []),
      'Strict 6-monthly schedule — clinical risk begins to rise after 6 months + 2 weeks; treat >7 months as urgent',
      'DEXA at 1–2 years',
      'CRITICAL: Plan sequential antiresorptive (alendronate or single-dose zoledronate) BEFORE stopping denosumab. Routine cessation is not supported.',
    ],
    irishPrescribingNote:
      'GMS High-Tech (Prolia / biosimilar e.g. Jublia) — any doctor can prescribe. ' +
      'Widely available through community pharmacies in Ireland on the High-Tech drug scheme; dispensed via PCRS direct payment. Patient pays nothing.',
    source: SRC_NOGG,
    patientEducation: {
      whatItDoes:
        'Denosumab (Prolia / Jublia) is an injection that blocks a protein called RANKL, which is responsible for breaking down bone. It reduces bone loss and lowers the risk of broken bones.',
      howToTake:
        'One injection under the skin (usually upper arm, thigh, or abdomen) every 6 months — given by your GP, nurse, or at a clinic. ' +
        'The 6-month schedule is critical — do not miss or delay your injection.',
      sideEffects: [
        'Mild pain or redness at the injection site',
        'Skin infections (cellulitis) — seek medical attention for any spreading redness',
        'Aching in joints or muscles',
        'Low blood calcium (more common with kidney problems — your calcium will be checked beforehand)',
      ],
      warnings: [
        'CRITICAL: Never stop denosumab without talking to your doctor first. Stopping can cause several broken bones at once (rebound fractures) — a different bone-protecting tablet must be started before or at the same time as stopping.',
        'You cannot donate blood after receiving denosumab.',
        'Your injection must not be delayed — fracture risk rises if more than 6 months pass since the last injection. Contact your doctor immediately if your appointment is delayed.',
        'Tell your dentist you are receiving denosumab before any tooth extraction or invasive dental work — there is a very small risk of jaw problems (osteonecrosis of the jaw).',
        'Ensure your vitamin D and calcium are adequate — you will have a blood test before each injection.',
      ],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function vitDSafe(patient: PatientInput): boolean {
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  return vitD === null || vitD >= 50; // unknown → allow with supplement flag; known <50 → block
}

function addVitDBlock(patient: PatientInput, flags: ClinicalFlag[]): void {
  const vitD = patient.bloodResults?.vitaminDNmol;
  if (vitD !== undefined && vitD !== null && vitD < 50) {
    flags.push({
      id: 'denosumab_vitd_block',
      severity: 'urgent',
      message:
        `HOLD denosumab: vitamin D is ${vitD} nmol/L (<50 nmol/L). ` +
        'Correct deficiency FIRST — do not administer until Vit D ≥50 nmol/L. ' +
        'Load with 50,000 IU cholecalciferol weekly × 6 weeks if severely deficient (<25 nmol/L), then recheck.',
      rationale:
        'Denosumab reduces bone resorption acutely; if vitamin D and calcium are not replete, ' +
        'severe hypocalcaemia can occur. Mandatory to correct Vit D to ≥50 nmol/L before each dose.',
      source: SRC_NOGG,
    });
  }
}

function resolveEGFR(patient: PatientInput): number | null {
  return patient.renalFunction?.egfr ?? patient.bloodResults?.egfr ?? null;
}

function canUse(agent: keyof typeof RENAL_LIMITS, egfr: number | null): boolean {
  const limit = RENAL_LIMITS[agent].ci;
  if (limit === null) return true;
  if (egfr === null) return true; // unknown — permit with egfr_unknown flag
  return egfr >= limit;
}

const BISPHOSPHONATE_AGENTS: TreatmentAgent[] = ['alendronate', 'risedronate', 'zoledronate', 'ibandronate'];

function isBisphosphonate(agent: TreatmentAgent): boolean {
  return BISPHOSPHONATE_AGENTS.includes(agent);
}

function isCurrentlyOnBisphosphonate(patient: PatientInput): boolean {
  return (
    patient.currentTreatment?.currentlyOn === true &&
    isBisphosphonate(patient.currentTreatment.agent)
  );
}

function lowestDexaTScore(dexa: NonNullable<PatientInput['dexaResults']>): number {
  const scores = [dexa.lumbarSpineTScore, dexa.totalHipTScore, dexa.femoralNeckTScore]
    .filter((t): t is number => t != null);
  return scores.length > 0 ? Math.min(...scores) : 0;
}
