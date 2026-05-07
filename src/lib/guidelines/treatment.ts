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

const SRC_HSE      = GUIDELINE_VERSIONS.hse_mmp;
const SRC_NOGG     = GUIDELINE_VERSIONS.nogg;
const SRC_NICE     = GUIDELINE_VERSIONS.nice;
const SRC_BSR      = GUIDELINE_VERSIONS.bsr;
const SRC_IOS      = GUIDELINE_VERSIONS.ios;
const SRC_ISCD     = GUIDELINE_VERSIONS.iscd;
const SRC_ROMO_MAP = GUIDELINE_VERSIONS.hse_map_romo;
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

  // ── Safety gate: severe Vit D deficiency + hypocalcaemia together blocks all antiresorptive ──
  // Both must be corrected before any bisphosphonate or denosumab — risk of severe acute hypocalcaemia.
  const vitDLevel = patient.bloodResults?.vitaminDNmol ?? null;
  const caLevel = patient.bloodResults?.adjustedCalciumMmol ?? null;
  const severeVitDDef = vitDLevel !== null && vitDLevel < BLOOD_RANGES.vitaminD.deficient;
  const hypocalcaemia = caLevel !== null && caLevel < BLOOD_RANGES.adjustedCalcium.low;
  if (severeVitDDef && hypocalcaemia) {
    flags.push({
      id: 'two_safety_blockers',
      severity: 'urgent',
      message:
        `DO NOT START ANTIRESORPTIVE — severe Vit D deficiency (${vitDLevel} nmol/L) + hypocalcaemia (${caLevel} mmol/L). Correct both first.`,
      rationale:
        'Two simultaneous blockers. Likely cause: severe Vit D deficiency driving secondary hyperparathyroidism and low calcium — ' +
        'correcting Vit D should normalise calcium. Loading: 50,000 IU cholecalciferol weekly × 6 weeks. Recheck calcium AND Vit D ' +
        'at 6–8 weeks. Consider PTH given hypocalcaemia. Once Vit D ≥50 and Ca ≥2.10, start alendronate (or other antiresorptive).',
      source: SRC_NOGG,
    });
    return { recommendations: [], flags, referrals, supplements };
  }

  // ── Imminent fracture risk (fracture within last 24 months) ──
  if (patient.recentFractureWithin2Years) {
    flags.push({
      id: 'imminent_fracture_risk',
      severity: 'urgent',
      message:
        'Start bone protection NOW — fracture within last 24 months. Do not wait for DEXA.',
      rationale:
        'NOGG 2024: fracture within 24 months = high imminent fracture risk. ' +
        'Immediate treatment is indicated — DEXA can be arranged concurrently but must not delay prescribing.',
      source: SRC_NOGG,
    });
  }

  // ── RA double-counting warning — fires whenever RA is ticked ──
  if (patient.rheumatoidArthritis) {
    flags.push({
      id: 'ra_double_count',
      severity: 'warning',
      message:
        'RA is already a FRAX input — do not also tick Secondary Osteoporosis as this double-counts the risk.',
      rationale:
        'FRAX includes Rheumatoid Arthritis as a named risk factor separate from "Secondary Osteoporosis". ' +
        'Ticking both inflates the FRAX score and may lead to inappropriate treatment escalation.',
      source: SRC_NOGG,
    });
  }

  // ── Early menopause / POI surface flag — FRAX underestimates ──
  if (patient.earlyMenopause) {
    flags.push({
      id: 'early_menopause_frax_underestimate',
      severity: 'info',
      message:
        'Early menopause / POI — FRAX may underestimate fracture risk in this population; lower treatment thresholds apply.',
      rationale:
        'Early oestrogen loss causes cumulative bone deficit beyond what FRAX clinical risk factors capture. ' +
        'NOGG 2024 / IOS 2024: lower BMD treatment threshold (T-score ≤−1.5) applies. HRT is first-line bone protection ' +
        'in women under 50 (POI); first-line for women ≤60 with high fracture risk and no VTE/breast cancer history.',
      source: SRC_IOS,
    });
  }

  // ── Glucocorticoids ≥7.5 mg/day surface flag — GIOP pathway, FRAX adjusted ──
  // Fires on current high-dose use regardless of elapsed duration (planned ≥3 mo per Rec 22).
  if (
    patient.glucocorticoidUse?.current &&
    (patient.glucocorticoidUse.dose === 'medium' || patient.glucocorticoidUse.dose === 'high')
  ) {
    flags.push({
      id: 'gc_high_dose_giop_surface',
      severity: 'warning',
      message:
        'Glucocorticoids ≥7.5 mg/day for ≥3 months — GIOP pathway applied; FRAX MOF ×1.15 / hip ×1.20.',
      rationale:
        'NOGG 2024 Rec 22 (Strong): start bone protection at the same time as glucocorticoids; do not wait for DEXA. ' +
        'NOGG arithmetic adjustment compensates for FRAX underestimation at high doses.',
      source: SRC_NOGG,
    });
  }

  // ── Malabsorption surface flag — Ca and Vit D absorption may be impaired ──
  const hasMalabsorption =
    patient.secondaryOsteoporosis.includes('malabsorption') ||
    patient.secondaryOsteoporosis.includes('celiac_disease') ||
    patient.secondaryOsteoporosis.includes('inflammatory_bowel_disease');
  if (hasMalabsorption) {
    flags.push({
      id: 'malabsorption_supplement_warning',
      severity: 'warning',
      message:
        'Malabsorption (coeliac/IBD/bariatric) — dietary calcium and vitamin D absorption may be impaired; check levels and supplement.',
      rationale:
        'Malabsorptive states reduce intestinal absorption of calcium, vitamin D, and oral bisphosphonates. ' +
        'Check 25-OHD and adjusted calcium; supplement aggressively. Consider IV zoledronate or denosumab if oral bisphosphonate response is poor.',
      source: SRC_NOGG,
    });
  }

  // ── Patient refuses injections — surface flag ──
  if (patient.refusesInjections) {
    flags.push({
      id: 'patient_refuses_injections',
      severity: 'warning',
      message:
        'Patient refuses injections — denosumab, zoledronate, teriparatide, romosozumab cannot be offered. Oral bisphosphonate only.',
      rationale:
        'Document discussion of clinical risk, particularly in very high risk patients where anabolic-first or denosumab is preferred. ' +
        'Re-engage at follow-up — preferences may change. Specialist referral remains appropriate where injection-only options are clinically indicated.',
      source: SRC_NOGG,
    });
  }

  // ── Dental check before IV zoledronate or denosumab ──
  // Single merged alert (replaces previous dental_check_pre_treatment + onj_dental_pre_start overlap).
  const isNewStarter = !patient.currentTreatment && patient.previousTreatments.length === 0;
  if (isNewStarter) {
    flags.push({
      id: 'dental_check_pre_treatment',
      severity: 'info',
      message:
        'Before starting IV zoledronate or denosumab: ask about outstanding invasive dental work. ' +
        'Complete before first dose if clinically feasible. Advise patient to inform dentist of antiresorptive use before any future invasive procedure.',
      rationale:
        'NOGG 2024 Section 7.3: ONJ risk is low at osteoporosis doses (oral BP <1:10,000 patient-years) ' +
        'but is minimised by pre-treatment dental review and ongoing oral hygiene. Particularly relevant for IV zoledronate and denosumab.',
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
        'Forearm-only osteoporosis — rule out primary hyperparathyroidism (Ca, ALP, PTH) BEFORE starting treatment.',
      rationale:
        'Forearm-only osteoporosis has a specific differential diagnosis including primary hyperparathyroidism, ' +
        'which is characterised by preferential cortical bone loss (forearm/radius). ' +
        'Treating without ruling this out may miss a treatable systemic cause. ' +
        'ISCD 2023: 33% radius (1/3 distal radius) is the standard forearm site for DXA reporting.',
      source: SRC_ISCD,
    });
  }

  // Compute AI lower-threshold override: T-score ≤-1.5 on aromatase inhibitor mandates treatment
  // regardless of FRAX category (CTIBL guidelines / NOGG 2024 Section 7)
  const aiLowerThresholdMet = (() => {
    if (!patient.aromataseInhibitorUse || !patient.dexaResults) return false;
    const scores = [
      patient.dexaResults.lumbarSpineTScore,
      patient.dexaResults.totalHipTScore,
      patient.dexaResults.femoralNeckTScore,
    ].filter((t): t is number => t != null);
    return scores.length > 0 && Math.min(...scores) <= -1.5;
  })();

  // Low risk — lifestyle only
  // Bypass: recent fracture within 24 months (imminent risk → treat immediately without waiting for FRAX)
  // Bypass: AI therapy with T-score ≤-1.5 (CTIBL threshold is independent of FRAX)
  if (riskCategory === 'low' && !patient.recentFractureWithin2Years && !aiLowerThresholdMet) {
    return { recommendations: [], flags, referrals, supplements };
  }

  // Intermediate risk without DEXA — withhold pharmacological treatment pending BMD
  // NOGG 2024 Section 3.1: BMD required to reclassify amber before treatment decision
  // Bypass: recent fracture (treat immediately) or AI threshold met (DEXA not required to decide)
  if (riskCategory === 'intermediate' && !patient.dexaResults && !patient.currentTreatment &&
      !patient.recentFractureWithin2Years && !aiLowerThresholdMet) {
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
  denosumabReboundFlags(patient, flags);

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

  // ── Very high risk — anabolic consideration ──
  if (riskCategory === 'very_high') {
    flags.push({
      id: 'vhr_anabolic_consideration',
      severity: 'warning',
      message:
        'Very high risk — refer specialist. Anabolic-first (teriparatide or romosozumab) may be appropriate; GP cannot initiate High-Tech.',
      rationale:
        'NOGG 2024 Rec 11 (Conditional): consider referral to osteoporosis specialist for very high risk patients. ' +
        'Anabolic-first approach warranted particularly when multiple vertebral fractures are present. ' +
        'HSE MAP (effective 1 Nov 2024): romosozumab reimbursed for postmenopausal women meeting the criteria above — ' +
        'individual patient application required through approved consultant; non-hub prescriptions not reimbursed. ' +
        'Source: HSE Managed Access Protocol — Romosozumab (Evenity), available at assets.hse.ie/media/documents/HSE_Managed_Access_Protocol_Romosozumab.pdf',
      source: SRC_ROMO_MAP,
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

  // ONJ history — covers both current AND previous treatments
  if (hasONJHistory(patient)) {
    return { ...onjHistory(flags, referrals), supplements };
  }

  // AFF history — permanent bisphosphonate CI; push flag here so it appears in all subsequent paths
  if (hasAFFHistory(patient)) {
    flags.push({
      id: 'aff_history_bp_permanent_ci',
      severity: 'urgent',
      message:
        'DO NOT prescribe any bisphosphonate — confirmed AFF history. Use denosumab or teriparatide; refer specialist.',
      rationale:
        'AFF is a class effect of bisphosphonates due to suppression of bone remodelling at cortical stress sites. ' +
        'Rechallenge with any bisphosphonate carries recurrence risk and is contraindicated. ' +
        'NOGG 2024 Section 7.2 / ASBMR Task Force: after confirmed AFF, bisphosphonates should generally be avoided permanently.',
      source: SRC_NOGG,
    });
  }

  // ── Existing treatment — sequencing logic ──
  if (patient.currentTreatment) {
    const seq = sequencing(patient, riskCategory, flags, referrals);
    return { ...seq, supplements };
  }

  // ── New treatment initiation ──
  let recommendations = initiateTherapy(patient, riskCategory, flags, referrals);

  // ── Patient refuses injections — strip injection-based agents from output ──
  if (patient.refusesInjections) {
    const oralAgents = new Set(['alendronate', 'risedronate', 'ibandronate']);
    recommendations = recommendations.filter(r => oralAgents.has(r.agent));
    if (recommendations.length === 0) {
      // No oral options remaining — escalate to specialist
      referrals.push({
        specialty: 'metabolic_bone',
        reason: 'Patient refuses injections and no oral antiresorptive available — specialist input required to negotiate options.',
        urgency: 'soon',
      });
    }
  }

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
    !isEarlyMenopausePre50(patient) // POI (<50) handled separately; ≥50 with early menopause history still eligible
  ) {
    if (patient.vteHistory || patient.breastCancerHistory) {
      flags.push({
        id: 'hrt_safety_concern',
        severity: 'warning',
        message:
          `HRT not first-line — ${patient.vteHistory ? 'VTE history' : ''}${patient.vteHistory && patient.breastCancerHistory ? ' + ' : ''}${patient.breastCancerHistory ? 'breast cancer history' : ''}. Use alendronate; refer specialist if HRT still considered.`,
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
          'HRT first-line option (postmenopausal ≤60, high risk, no VTE/breast Ca). Transdermal preferred.',
        rationale:
          'NOGG 2024 Section 5.2 update: HRT elevated to first-line in women ≤60 alongside bisphosphonates. ' +
          'HRT also addresses menopausal symptoms. Review at 5 years.',
        source: SRC_NOGG,
      });
    }
  }

  // ── Previous treatment contraindication checks ──

  // AFF history: permanent ban on ALL bisphosphonates — go directly to denosumab
  if (hasAFFHistory(patient)) {
    addVitDBlock(patient, flags);
    recs.push(denosumab(egfr));
    referrals.push({
      specialty: 'metabolic_bone',
      reason: 'AFF history — teriparatide is the preferred specialist-initiated alternative to denosumab if antiresorptive is not tolerated.',
      urgency: 'soon',
    });
    return recs;
  }

  // ADT (men on androgen deprivation therapy): denosumab is first-line by RCT evidence
  // (HALT trial, Smith et al. NEJM 2009 — 62% vertebral fracture reduction). Alendronate is
  // an acceptable alternative but second-line in this specific population.
  if (patient.adtUse && !hasAFFHistory(patient) && !hasPreviousGIIntoleranceToBP(patient)) {
    addVitDBlock(patient, flags);
    recs.push({ ...denosumab(egfr), priority: 'first-line' });
    if (canUse('alendronate', egfr)) {
      recs.push({
        ...alendronate(),
        priority: 'alternative',
        rationale:
          'Second-line alternative on ADT. Consider if denosumab not feasible (cost, adherence, patient preference). ' +
          'Note: denosumab has the strongest fracture-reduction RCT evidence in this population (HALT trial, Smith et al. NEJM 2009).',
      });
    }
    return recs;
  }

  // Previous GI intolerance to oral bisphosphonate: skip oral BPs, offer IV or denosumab
  if (hasPreviousGIIntoleranceToBP(patient)) {
    flags.push({
      id: 'prev_gi_intolerance_bp',
      severity: 'info',
      message:
        'Previous oral bisphosphonate stopped due to GI intolerance — oral bisphosphonates are contraindicated for this patient. ' +
        'IV zoledronate (bypasses GI tract entirely) is the preferred option. Denosumab is an alternative if IV is not feasible.',
      rationale:
        'GI intolerance to oral bisphosphonate is a contraindication to that route, not to the drug class overall. ' +
        'IV zoledronate has no GI exposure and is appropriate after oral bisphosphonate GI intolerance (NOGG 2024 Rec 13; HSE MMP).',
      source: SRC_HSE,
    });
    if (canUse('zoledronate', egfr)) {
      recs.push(zoledronate());
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
    return recs;
  }

  // Currently on HRT with high risk: review HRT adequacy + add bisphosphonate option
  if (
    patient.currentTreatment?.agent === 'hrt' &&
    patient.currentTreatment.currentlyOn &&
    (riskCategory === 'high' || riskCategory === 'very_high')
  ) {
    flags.push({
      id: 'hrt_on_board_review',
      severity: 'info',
      message:
        'On HRT with high fracture risk — review HRT dose/compliance first; if BMD inadequate, add alendronate alongside HRT.',
      rationale:
        'NOGG 2024: HRT is first-line bone protection for women ≤60 with high risk. ' +
        'When T-score remains ≤−2.5 despite HRT, additional antiresorptive may be warranted. ' +
        'Plan for HRT review at 5 years total and reassess fracture risk.',
      source: SRC_BMS,
    });
    if (canUse('alendronate', egfr)) {
      recs.push({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection.',
        priority: 'first-line',
      });
    }
    return recs;
  }

  // Alendronate first-line per HSE MMP Ireland (skip when eGFR is at/below the CI threshold)
  if (canUse('alendronate', egfr) && (egfr === null || egfr > RENAL_LIMITS.alendronate.ci)) {
    // Borderline renal function: zoledronate should be avoided at eGFR <45
    if (egfr !== null && egfr < 50) {
      flags.push({
        id: 'zoledronate_borderline_egfr',
        severity: 'info',
        message:
          `eGFR ${egfr} ml/min: IV zoledronate should be used with caution or avoided when eGFR is borderline (<45 ml/min). ` +
          'Oral bisphosphonate (alendronate or risedronate) is preferred at this level of renal function. Monitor eGFR at least annually.',
        rationale:
          'SmPC (Aclasta/zoledronate): caution required in renal impairment; consider avoiding if eGFR <45 ml/min. ' +
          'Oral bisphosphonates do not accumulate in renal impairment at the same rate and are preferred when eGFR is borderline.',
        source: SRC_NICE,
      });
    }
    recs.push(alendronate());
    return recs;
  }

  // Alendronate contraindicated — renal impairment (eGFR ≤35 ml/min triggers BP ban; below
  // strict NOGG CI of <35 we still prefer denosumab at the boundary because BPs accumulate
  // and denosumab is not renally cleared — the safer choice in borderline CKD).
  if (egfr !== null && egfr <= RENAL_LIMITS.alendronate.ci) {
    flags.push({
      id: 'renal_bp_ci',
      severity: 'warning',
      message:
        `eGFR ${egfr} — bisphosphonates contraindicated (<${RENAL_LIMITS.alendronate.ci}). Use denosumab.`,
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
          `eGFR ${egfr} — mandatory adjusted Ca check 2 weeks after EVERY denosumab injection. Vit D ≥50 + Ca replete first.`,
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
    message: 'Check eGFR before prescribing bisphosphonate — not recorded.',
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

  // ── On HRT with high fracture risk: review HRT adequacy + add bisphosphonate ──
  if (current.agent === 'hrt' && current.currentlyOn) {
    flags.push({
      id: 'hrt_on_board_review',
      severity: 'info',
      message:
        'On HRT with high fracture risk — review HRT dose/compliance first; if BMD inadequate, add alendronate alongside HRT.',
      rationale:
        'NOGG 2024: HRT is first-line bone protection for women ≤60 with high risk. ' +
        'When T-score remains ≤−2.5 despite HRT, additional antiresorptive may be warranted. ' +
        'Plan for HRT review at 5 years total and reassess fracture risk.',
      source: SRC_BMS,
    });
    if (canUse('alendronate', egfr)) {
      recs.push({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection.',
        priority: 'first-line',
      });
    }
    return { recommendations: recs, flags, referrals };
  }

  // ── GI intolerance ──
  if (current.reasonStopped === 'gi_intolerance') {
    return { ...giSwitch(patient, current.agent, egfr, flags), referrals };
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
        'Possible treatment failure — fracture on adequate therapy. Review adherence/Vit D first; if confirmed, switch class.',
      rationale:
        'Treatment failure = new fracture or significant BMD loss (>4–5% spine or >3% hip) despite good adherence and replete vitamin D. ' +
        'NOGG 2024 Rec 20: reassess fracture risk after any new fracture.',
      source: SRC_NOGG,
    });
    // Offer IV/denosumab before escalating to specialist (per spec Section 7.4)
    // AFF history: cannot offer zoledronate — go directly to denosumab
    if (isBisphosphonate(current.agent) && current.agent !== 'zoledronate') {
      flags.push({
        id: 'treatment_failure_switch',
        severity: 'info',
        message:
          hasAFFHistory(patient)
            ? 'Oral bisphosphonate failure with AFF history: IV zoledronate is contraindicated (AFF — permanent BP ban). Switch to denosumab.'
            : 'Oral bisphosphonate failure: switch to IV zoledronate or denosumab before considering anabolic escalation.',
        rationale: 'Spec Section 7.4: oral BP failure → IV zoledronate OR denosumab OR specialist for anabolic.',
        source: SRC_NOGG,
      });
      if (canUse('zoledronate', egfr) && !hasAFFHistory(patient)) {
        recs.push(zoledronate());
      } else {
        addVitDBlock(patient, flags);
        recs.push(denosumab(egfr));
      }
    } else {
      // Denosumab failure or zoledronate failure → specialist
      referrals.push({
        specialty: 'metabolic_bone',
        reason: 'Antiresorptive treatment failure — anabolic therapy (teriparatide/romosozumab) requires specialist initiation.',
        urgency: 'soon',
      });
    }
  }

  // ── Currently on denosumab (stable — no treatment failure): show continuation + transition plan ──
  // denosumabReboundFlags() has already added the cessation plan flag explaining transition options.
  if (current.agent === 'denosumab' && current.currentlyOn && !isTreatmentFailure) {
    addVitDBlock(patient, flags);
    recs.push(denosumab(egfr));
    return { recommendations: recs, flags, referrals };
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
          addVitDBlock(patient, flags);
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
  patient: PatientInput,
  stoppedAgent: TreatmentAgent,
  egfr: number | null,
  flags: ClinicalFlag[],
): Omit<TreatmentOutput, 'supplements' | 'referrals'> {
  const recs: TreatmentRecommendation[] = [];

  const affCI = hasAFFHistory(patient);

  if (stoppedAgent === 'alendronate') {
    flags.push({
      id: 'gi_alendronate_switch',
      severity: 'info',
      message: affCI
        ? 'GI intolerance to alendronate with AFF history: all bisphosphonates are permanently contraindicated. Switch to denosumab.'
        : 'GI intolerance to alendronate. Switch options (in order): ' +
          '(1) Risedronate 35mg weekly — better upper GI tolerability; ' +
          '(2) Ibandronate 150mg monthly — fewer dosing events; ' +
          '(3) Zoledronate 5mg IV annually — bypasses GI entirely.',
      rationale: 'HSE MMP / NOGG 2024 Rec 13: switch oral bisphosphonate or move to IV if GI not tolerated.',
      source: SRC_HSE,
    });
    if (!affCI && canUse('risedronate', egfr)) recs.push(risedronate());
    if (!affCI && canUse('ibandronate', egfr)) recs.push(ibandronate());
    if (!affCI && canUse('zoledronate', egfr)) recs.push(zoledronate());
    if (affCI || (!canUse('risedronate', egfr) && !canUse('ibandronate', egfr) && !canUse('zoledronate', egfr))) {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
  } else if (stoppedAgent === 'risedronate') {
    flags.push({
      id: 'gi_risedronate_switch',
      severity: 'info',
      message: affCI
        ? 'GI intolerance to risedronate with AFF history: all bisphosphonates are permanently contraindicated. Switch to denosumab.'
        : 'GI intolerance to risedronate after alendronate failure. ' +
          'Switch to: Ibandronate 150mg monthly OR Zoledronate 5mg IV annually (bypasses GI).',
      rationale: 'After failure of two oral bisphosphonates due to GI effects, IV or monthly oral is appropriate.',
      source: SRC_HSE,
    });
    if (!affCI && canUse('ibandronate', egfr)) recs.push(ibandronate());
    if (!affCI && canUse('zoledronate', egfr)) {
      recs.push(zoledronate());
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
  } else {
    // Any other agent — IV or denosumab
    if (!affCI && canUse('zoledronate', egfr)) {
      recs.push(zoledronate());
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
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
      'STOP bisphosphonate. Image both femora (X-ray ± MRI) — suspected atypical femoral fracture.',
    rationale:
      '~30% of AFFs are bilateral — both femora must be imaged (NOGG 2024 Section 7.2; ASBMR Task Force).',
    source: SRC_NOGG,
  });
  flags.push({
    id: 'aff_post_diagnosis_options',
    severity: 'urgent',
    message:
      'If AFF confirmed: bisphosphonates permanently contraindicated. Switch to denosumab or specialist-initiated teriparatide.',
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
      'After anabolic therapy: start alendronate or zoledronate immediately — gap = rapid loss of BMD gains.',
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
          `Denosumab ${patient.denosumabMonthsSinceLastDose} months overdue — arrange next dose now. Risk rises after 6.5 months.`,
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
          `Give denosumab NOW — ${patient.denosumabMonthsSinceLastDose} months overdue (>7 mo = high rebound vertebral fracture risk).`,
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
        'Do NOT stop denosumab without sequential alendronate or single zoledronate (6 months after last dose) — rebound vertebral fractures.',
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

  // VTE / breast cancer safety checks — relevant for POI even though HRT is first-line
  if (patient.vteHistory) {
    flags.push({
      id: 'poi_hrt_vte',
      severity: 'warning',
      message:
        'VTE history in POI patient: TRANSDERMAL oestrogen (patch/gel) is mandatory — it does not increase VTE risk, unlike oral oestrogen. ' +
        'Oral HRT is contraindicated. Specialist endocrinology/haematology input required before initiating.',
      rationale:
        'Transdermal oestrogen avoids first-pass hepatic metabolism and does not activate coagulation factors, ' +
        'unlike oral oestrogen which is associated with increased VTE risk. ' +
        'NICE NG23 / BMS 2024: transdermal route is the preferred option in women with VTE history.',
      source: SRC_BMS,
    });
  }

  if (patient.breastCancerHistory) {
    flags.push({
      id: 'poi_hrt_breast_cancer',
      severity: 'warning',
      message:
        'Breast cancer history in POI patient: HRT use requires joint oncology and endocrinology input. ' +
        'In women with BRCA1/2 mutations who have undergone risk-reducing surgery, HRT may be appropriate — individual risk-benefit assessment required. ' +
        'Bisphosphonate (alendronate or zoledronate) should be used as bone protection if HRT is declined or contraindicated.',
      rationale:
        'NICE NG23 / BMS 2024: breast cancer history is not an absolute contraindication to HRT in POI, ' +
        'but requires specialist risk-benefit assessment. The bone protection benefit of treating early oestrogen deficiency must be weighed against oncological risk.',
      source: SRC_BMS,
    });
  }

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
      'Oestrogen-sensitive malignancy (specialist input required if uncertain)',
      'Undiagnosed vaginal bleeding',
      'Active or recent arterial thromboembolic event',
      'Severe active liver disease',
      'Oral HRT in VTE history (transdermal route required)',
    ],
    monitoring: [
      'Annual blood pressure',
      'Breast awareness — advise patient to report any changes promptly',
      'DEXA at age 51 to guide decision on continuing or switching bone protection strategy',
    ],
    source: SRC_BMS,
    patientEducation: {
      whatItDoes:
        'HRT (hormone replacement therapy) replaces the oestrogen your body is no longer making. In premature menopause, this protects your bones, heart, and brain — as well as managing menopausal symptoms.',
      howToTake:
        'Usually applied daily as a gel or patch to the skin (transdermal). If you have a womb, you will also need a progestogen to protect the womb lining. ' +
        'Your specialist will advise on the exact preparation and dose. Continue until at least age 51, then reassess.',
      sideEffects: [
        'Breast tenderness (usually settles within a few months)',
        'Irregular bleeding (common in the first few months)',
        'Mild skin irritation at patch site',
        'Bloating or mood changes',
      ],
      warnings: [
        'Do not stop HRT suddenly without discussing with your doctor — bone protection diminishes rapidly after stopping.',
        'If you have a personal or family history of VTE (blood clots), tell your doctor — a patch or gel (not tablets) will be used.',
        'Report any new breast lump or nipple change promptly.',
        'You will still need a DEXA scan around age 51 to reassess bone health and decide whether to continue HRT or switch to a different bone protection medicine.',
      ],
    },
  };

  return { recommendations: [rec], flags, referrals };
}

function isGIOP(patient: PatientInput): boolean {
  if (!patient.glucocorticoidUse) return false;
  if (!patient.glucocorticoidUse.current) return false;

  const { dose, durationMonths } = patient.glucocorticoidUse;

  // High-dose (≥7.5 mg/day prednisolone equivalent): NOGG Rec 22 says start bone protection
  // immediately when planned ≥3 months — fire as soon as the dose is ticked, regardless of
  // elapsed duration, so the engine catches early-course patients.
  if (dose === 'medium' || dose === 'high') return true;

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
      urgency: 'urgent',
    });
  }

  // Standard GIOP treatment selection. Skip oral BP if AFF history (permanent ban),
  // prior GI intolerance, or patient refuses injections (note: oral BP is preferred for the latter).
  const aff = hasAFFHistory(patient);
  const giIntolerance = hasPreviousGIIntoleranceToBP(patient);
  const onj = hasONJHistory(patient);
  const refuses = patient.refusesInjections;

  if (onj) {
    // ONJ history is handled at a higher level; defensive — should not reach here.
    return { recommendations: recs, flags, referrals };
  }

  if (!aff && !giIntolerance && canUse('alendronate', egfr)) {
    // Oral first-line per HSE MMP / NOGG GIOP Rec 23
    recs.push({
      ...alendronate(),
      rationale:
        'First-line bisphosphonate for GIOP (NOGG 2024 Rec 23; HSE MMP). ' +
        'Initiate at same time as glucocorticoid if planned duration ≥3 months. ' +
        'Calcium 1000–1500 mg/day and vitamin D ≥800 IU/day required alongside.',
    });
  } else if (!aff && giIntolerance && !refuses && canUse('zoledronate', egfr)) {
    // Prior oral GI intolerance — IV zoledronate bypasses GI tract
    flags.push({
      id: 'giop_iv_after_gi_intolerance',
      severity: 'info',
      message:
        'Oral bisphosphonate contraindicated (prior GI intolerance) — IV zoledronate is the appropriate GIOP option.',
      rationale:
        'NOGG 2024 / HSE MMP: IV zoledronate has no GI exposure and is preferred when oral bisphosphonate has caused intolerance. ' +
        'Pre-medicate with paracetamol and pre-hydrate.',
      source: SRC_HSE,
    });
    recs.push({ ...zoledronate(), rationale: 'IV zoledronate for GIOP when oral bisphosphonate is contraindicated by prior intolerance.' });
  } else if (!aff && !refuses && canUse('zoledronate', egfr)) {
    recs.push({ ...zoledronate(), rationale: 'IV zoledronate for GIOP when oral bisphosphonate is contraindicated or not tolerated.' });
  } else {
    // BP options exhausted (AFF history, refusal of IV, or eGFR too low) — denosumab
    if (refuses) {
      flags.push({
        id: 'giop_no_treatment_option',
        severity: 'urgent',
        message:
          'GIOP with no acceptable treatment option (oral BP contraindicated/refused; injections refused). Specialist referral mandatory.',
        rationale:
          'Patient preference must be balanced against very high fracture risk in GIOP. Specialist input required to negotiate options.',
        source: SRC_NOGG,
      });
      referrals.push({ specialty: 'metabolic_bone', reason: 'GIOP with no acceptable antiresorptive — patient preference vs clinical need.', urgency: 'urgent' });
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
      flags.push({
        id: 'giop_denosumab_conditional',
        severity: 'info',
        message: aff
          ? 'Denosumab used for GIOP — bisphosphonates permanently contraindicated (AFF history).'
          : 'Denosumab as GIOP alternative (NOGG 2024 Rec 24 — Conditional).',
        rationale: 'Consider denosumab when bisphosphonates are contraindicated or not tolerated in GIOP.',
        source: SRC_NOGG,
      });
    }
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

// onjFlags removed — ONJ pre-start dental review is covered by the merged
// dental_check_pre_treatment flag emitted in generateTreatmentOutput.

// ─── Supplements ──────────────────────────────────────────────────────────

function getSupplements(patient: PatientInput): SupplementRecommendation[] {
  const sups: SupplementRecommendation[] = [];
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  const isGIOPPatient = isGIOP(patient);

  // ── Vitamin D ─────────────────────────────────────────────────────────
  let vitDHeadline: string;
  let vitDBullets: string[];

  if (vitD === null) {
    vitDHeadline = 'Vitamin D level unknown — check before treatment';
    vitDBullets = [
      'Measure 25-OHD before starting antiresorptive therapy',
      'Pending result: 800–1000 IU/day cholecalciferol (e.g. Desunin 800 IU)',
      'Do NOT start bisphosphonate or denosumab until level confirmed adequate',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.deficient) {
    vitDHeadline = `Severe deficiency (${vitD} nmol/L) — loading required`;
    vitDBullets = [
      'Loading: 50,000 IU cholecalciferol weekly × 6 weeks (300,000 IU total)',
      'Irish products: Dekristol 20,000 IU × 15 doses or equivalent',
      `Recheck 25-OHD after loading; target ≥${BLOOD_RANGES.vitaminD.target} nmol/L`,
      'Do NOT start any antiresorptive until loading complete and level adequate',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.insufficient) {
    vitDHeadline = `Insufficient (${vitD} nmol/L) — start 800–1000 IU/day`;
    vitDBullets = [
      'No formal loading required',
      'Start 800–1000 IU/day cholecalciferol immediately (e.g. Desunin 800 IU, InVita D3 drops)',
      'Oral bisphosphonate can start alongside supplementation',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
      `Recheck at 3 months; target ≥${BLOOD_RANGES.vitaminD.target} nmol/L`,
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.target) {
    vitDHeadline = `Adequate (${vitD} nmol/L) — maintenance only`;
    vitDBullets = [
      `Below target (≥${BLOOD_RANGES.vitaminD.target} nmol/L)`,
      '800–1000 IU/day maintenance (e.g. Desunin 800 IU or combined Ca/D3)',
      'Antiresorptive therapy can proceed',
      'Recheck in 6–12 months',
    ];
  } else {
    vitDHeadline = `Target met (${vitD} nmol/L) — maintenance only`;
    vitDBullets = [
      `≥${BLOOD_RANGES.vitaminD.target} nmol/L target reached`,
      '800 IU/day maintenance',
      'Optimise dietary sources: oily fish, fortified foods, sunlight exposure',
      'No loading required',
    ];
  }

  sups.push({
    supplement: 'vitamin_d',
    headline: vitDHeadline,
    bullets: vitDBullets,
    rationale:
      vitD !== null
        ? `Serum 25-OHD ${vitD} nmol/L — target ≥${BLOOD_RANGES.vitaminD.target} nmol/L (NOGG 2024 Rec 26). ` +
          'Most older adults in Ireland are insufficient due to latitude and limited dietary sources.'
        : `Target ≥${BLOOD_RANGES.vitaminD.target} nmol/L (NOGG 2024 Rec 26). Check before any antiresorptive.`,
  });

  // ── Calcium ──────────────────────────────────────────────────────────
  if (isGIOPPatient) {
    sups.push({
      supplement: 'calcium',
      headline: 'GIOP: 1000–1500 mg/day total intake',
      bullets: [
        'Higher requirement on glucocorticoids (reduced GI absorption, increased renal loss)',
        'Dietary sources first; supplement the deficit',
        'Combined Ca + D3 product if needed (Calcichew D3 Forte, Adcal-D3)',
        'Avoid >500–600 mg/day supplement on top of an adequate diet',
      ],
      rationale:
        'Glucocorticoids reduce GI calcium absorption and increase renal calcium excretion — ' +
        'higher intake is needed (NOGG 2024 Rec 22; IOS 2024).',
    });
  } else {
    sups.push({
      supplement: 'calcium',
      headline: 'Target 1200 mg/day total intake',
      bullets: [
        'Dietary sources preferred — dairy ~300 mg/portion, green veg 100–160 mg/portion, fortified foods',
        'Supplement only the deficit between dietary intake and 1200 mg/day target',
        'Typical supplement dose: 250–600 mg/day depending on diet',
        'Maximum: avoid >500–600 mg/day supplement on top of an adequate diet',
        'CV-risk caveat: excess supplement (not dietary calcium) linked to cardiovascular events (Bolland BMJ 2010/11)',
        'Note: serum calcium does NOT reflect dietary adequacy — assess intake directly',
      ],
      rationale:
        'IOS 2024: 1200 mg/day total intake target for adults ≥50 with bone loss or osteoporosis. ' +
        'Supplement only if dietary intake is below target. Excess supplementation carries cardiovascular risk ' +
        'evidence not seen with dietary calcium (NOGG 2024 Rec 26).',
    });
  }

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
      'Dispensed via community pharmacy on the High-Tech drug scheme. ' +
      'GMS cardholders: no cost for the medication. ' +
      'DPS patients: standard monthly DPS threshold applies (currently €80/month ceiling for out-of-pocket costs). ' +
      'Private patients: full cost of the medication unless covered by private health insurance.',
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

function addVitDBlock(patient: PatientInput, flags: ClinicalFlag[]): void {
  const vitD = patient.bloodResults?.vitaminDNmol;
  if (vitD !== undefined && vitD !== null && vitD < 50) {
    flags.push({
      id: 'denosumab_vitd_block',
      severity: 'urgent',
      message:
        `HOLD denosumab — Vit D ${vitD} nmol/L (<50). Correct first; do not administer until ≥50 nmol/L.`,
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

// ─── Treatment history contraindication helpers ───────────────────────────

function allTreatments(patient: PatientInput): PatientInput['previousTreatments'] {
  return [
    ...(patient.currentTreatment ? [patient.currentTreatment] : []),
    ...patient.previousTreatments,
  ];
}

function hasAFFHistory(patient: PatientInput): boolean {
  return allTreatments(patient).some(
    t => isBisphosphonate(t.agent) && t.reasonStopped === 'aff_confirmed',
  );
}

function hasONJHistory(patient: PatientInput): boolean {
  return allTreatments(patient).some(t => t.reasonStopped === 'onj');
}

function hasPreviousGIIntoleranceToBP(patient: PatientInput): boolean {
  return patient.previousTreatments.some(
    t => isBisphosphonate(t.agent) && t.reasonStopped === 'gi_intolerance',
  );
}
