// Treatment recommendations and bisphosphonate sequencing
// Prescribing preference: NOGG 2024 Strong (bisphosphonate most cost-effective first-line; denosumab alternative)
// Clinical thresholds: NOGG 2024, NICE NG187

import type {
  PatientInput,
  TreatmentHistory,
  TreatmentRecommendation,
  TreatmentAgent,
  RiskCategory,
  ClinicalFlag,
  ReferralRecommendation,
  SupplementRecommendation,
  SpecialistOption,
  GuidelineSource,
} from './types';
import {
  RENAL_LIMITS,
  BP_HOLIDAY,
  GIOP,
  BLOOD_RANGES,
  DENOSUMAB,
  GUIDELINE_VERSIONS,
  getAgeThreshold,
  effectiveGCDoseMgDay,
  isOnGC,
  isOnHighDoseGC,
  isOnMediumOrHighDoseGC,
  gcDurationMonths,
  PAUSE_REASSESSMENT_INTERVAL_MONTHS,
  BP_INDIVIDUAL_BASIS_AFTER_YEARS,
  aiAdditionalRiskFactorCount,
  gcStoppedOver12MonthsAgo,
} from './thresholds';
import type { RiskStratification } from './types';
import { deriveReferralSignals } from './referralSignals';

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
  /**
   * v1.43 Shape B — populated by buildSpecialistOptions() for VHR patients (any
   * trigger, GC-driven or not). Always present; empty array for non-VHR patients.
   * Surfaced separately from `recommendations` because these are drugs the
   * specialist may consider after the GP's referral, not drugs the GP prescribes.
   */
  specialistOptions: SpecialistOption[];
}

export function generateTreatmentOutput(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
): TreatmentOutput {
  const flags: ClinicalFlag[]               = [];
  const referrals: ReferralRecommendation[] = [];
  const supplements                         = getSupplements(patient);
  // v1.43 Shape B — specialist menu for VHR patients (any trigger, GC-driven
  // or not). Empty array for non-VHR. Computed once here; all return paths
  // include it via the object spread below.
  const specialistOptions                   = buildSpecialistOptions(patient, riskCategory);

  // v1.36 A2-impl — derived referral signals. Used by:
  //   Seq.1: post_anabolic_antiresorptive (Rec 14) — fires at referral time, not just after course
  //   Seq.2: sequential_therapy_plan_required — third push gate for new-anabolic-referral patients
  //   Seq.5: raloxifene_anabolic_follow_on_option — postmenopausal female + BP-CI + denosumab unsuitable
  // Computed once here so all downstream gates read the same source of truth.
  const referralSignals = deriveReferralSignals(patient, riskCategory);

  // Out-of-scope patients should not receive treatment logic
  if (riskCategory === 'out_of_scope') {
    return { recommendations: [], flags, referrals, supplements, specialistOptions };
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
    return { recommendations: [], flags, referrals, supplements, specialistOptions };
  }

  // ── v1.34 — BMD unavailable + prior fragility fracture (NOGG Rec 6 + Rec 8) ──
  // Prior-fx patients route to HIGH at risk.ts:177-186 (NOGG Rec 8) before the FRAX-based
  // stratification runs. That path never reaches the intermediate+bmdUnavailable branch
  // below, so the bmd_unavailable_treat_fx flag needs to fire here as a SECONDARY
  // annotation when both apply. NOGG Rec 6 conveys "treatment recommended despite
  // missing BMD" — distinct clinical signal from Rec 8's "treat regardless of FRAX".
  const hasFragilityFxAtTop =
    patient.priorFragilityFracture ||
    patient.priorHipFracture ||
    patient.priorVertebralFracture;
  if (patient.bmdUnavailable && hasFragilityFxAtTop && (riskCategory === 'high' || riskCategory === 'very_high')) {
    flags.push({
      id: 'bmd_unavailable_treat_fx',
      severity: 'info',
      message:
        'BMD not available — treatment offered based on history of fragility fracture per NOGG 2024 Rec 6 ' +
        '(in addition to the Rec 8 prior-fracture rationale).',
      rationale:
        'NOGG 2024 Rec 6 (Strong): in patients where BMD is unavailable, a previous low-trauma fracture is a ' +
        'sufficient indication for treatment. Rec 8 also applies (prior fracture → treat regardless of FRAX). ' +
        'Both pathways converge on treatment; the Rec 6 annotation records that the decision did not require BMD.',
      source: SRC_NOGG,
    });
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

  // ── BMD-included FRAX with secondary causes ticked — clarification flag ──
  // NOGG 2024: "The listed secondary causes are conservatively assumed to be mediated through
  // low BMD and carry no weight when femoral neck BMD is entered into FRAX." Surface this
  // clarification when relevant so clinicians know the FRAX numerical output isn't doubled-up.
  if (patient.fraxCalculatedWithBMD && patient.secondaryOsteoporosis.length > 0) {
    flags.push({
      id: 'frax_bmd_secondary_causes_note',
      severity: 'info',
      message:
        'FRAX calculated with BMD and secondary cause(s) ticked: when BMD is entered, secondary causes carry no additional FRAX weight (NOGG 2024). They remain relevant to clinical management and underlying-cause workup.',
      rationale:
        'FRAX assumes secondary causes act via reduced BMD, so once femoral neck BMD is entered the secondary-cause input is conservatively given no further weight. ' +
        'This is not a tool error — it reflects the FRAX algorithm. Document the secondary cause and address underlying pathology separately.',
      source: SRC_NOGG,
    });
  }

  // ── Thiazolidinedione + T2DM — additional fracture risk consideration ──
  if (patient.onThiazolidinedione) {
    flags.push({
      id: 'thiazolidinedione_fracture_risk',
      severity: 'info',
      message:
        'On a thiazolidinedione (pioglitazone) — adds to T2DM-related fracture risk. Consider alternative diabetes therapy where appropriate, in discussion with diabetes team.',
      rationale:
        'Thiazolidinediones increase fracture risk independently of T2DM (NOGG 2024 — risk modifier; PROactive and ADOPT trial data). ' +
        'No published FRAX numerical adjustment; managed as a clinical consideration rather than a multiplier.',
      source: SRC_NOGG,
    });
  }

  // ── eGFR <60 but CKD not ticked as a secondary cause — prompt ──
  // CKD 3a–5 is a Table 1 FRAX input (secondary cause). When the eGFR indicates CKD but
  // the clinician hasn't ticked it, prompt them to add it for FRAX accuracy.
  {
    const egfr = patient.bloodResults?.egfr ?? null;
    const ckdTicked = patient.secondaryOsteoporosis.includes('chronic_kidney_disease');
    if (egfr !== null && egfr < 60 && !ckdTicked) {
      flags.push({
        id: 'ckd_not_ticked_for_frax',
        severity: 'info',
        message:
          `eGFR ${egfr} ml/min indicates CKD 3a–5 — tick "Chronic kidney disease" under secondary causes to include it as a FRAX risk factor (NOGG Table 1).`,
        rationale:
          'Non-dialysis CKD (eGFR <60) is a NOGG Table 1 secondary cause of osteoporosis and a FRAX input. ' +
          'When BMD is not entered into FRAX, ticking secondary causes increases the calculated probability appropriately.',
        source: SRC_NOGG,
      });
    }
  }

  // ── Patient born outside Ireland — FRAX must use country-of-origin model ──
  if (patient.bornOutsideIreland) {
    const hasManualFrax =
      patient.fraxMOFPercent !== null || patient.fraxHipPercent !== null;
    flags.push({
      id: 'frax_country_of_origin',
      severity: hasManualFrax ? 'info' : 'warning',
      message: hasManualFrax
        ? 'Patient born outside Ireland — confirm the manual FRAX values were calculated using the patient\'s country-of-birth model on frax.shef.ac.uk (NOGG 2024 Table 2: risk characteristics persist after migration).'
        : 'Patient born outside Ireland — auto-estimated FRAX (Irish baseline) is not appropriate. Calculate FRAX at frax.shef.ac.uk with the patient\'s country of birth selected, then enter values manually.',
      rationale:
        'NOGG 2024 Table 2: individuals retain the risk characteristics of their country of origin. ' +
        'Use the FRAX model for the country of birth — Irish baselines (country code 49) are not appropriate for non-Irish-born patients. ' +
        'Primary literature: Johansson et al. 2015; Wändell et al. 2021.',
      source: SRC_NOGG,
    });
  }

  // ── Vertebral fracture imaging prompt (NOGG 2024 Rec 4) ──
  // Triggers: acute back pain + risk factors, height loss ≥4 cm, kyphosis, long-term oral
  // glucocorticoids, or T-score ≤−2.5.
  {
    const lowestT = patient.dexaResults
      ? Math.min(
          ...[
            patient.dexaResults.lumbarSpineTScore,
            patient.dexaResults.totalHipTScore,
            patient.dexaResults.femoralNeckTScore,
          ].filter((t): t is number => t != null)
        )
      : 0;
    // VF imaging trigger: long-term oral GC = current GC at ≥2.5 mg/day for ≥3 months
    // (very-low-dose <2.5 mg/day excluded; FRAX downward correction applies and bone-loss risk is minimal).
    const longTermOralGC =
      isOnMediumOrHighDoseGC(patient) && gcDurationMonths(patient) >= 3;

    const vfImagingTriggers: string[] = [];
    if (patient.acuteBackPain && patient.priorFragilityFracture) {
      vfImagingTriggers.push('acute back pain with osteoporosis risk factors');
    }
    if (patient.heightLossCm !== null && patient.heightLossCm >= 4) {
      vfImagingTriggers.push(`height loss ${patient.heightLossCm} cm`);
    }
    if (patient.kyphosis) vfImagingTriggers.push('kyphosis');
    if (longTermOralGC) vfImagingTriggers.push('long-term oral glucocorticoids');
    if (lowestT <= -2.5 && lowestT !== 0) {
      vfImagingTriggers.push(`T-score ${lowestT}`);
    }

    if (vfImagingTriggers.length > 0) {
      flags.push({
        id: 'vf_imaging_consideration',
        severity: 'info',
        message:
          'Consider imaging to look for vertebral fracture (lateral spine X-ray or VFA on DXA).',
        rationale:
          `Triggered by: ${vfImagingTriggers.join('; ')}. ` +
          'Many vertebral fractures are silent and only identifiable on imaging — they reclassify risk and ' +
          'are independently sufficient for clinical diagnosis of osteoporosis (NOGG 2024 Rec 4).',
        source: SRC_NOGG,
      });
    }
  }

  // ── Falls risk assessment prompt (NOGG 2024 Rec 5) ──
  // Fires for patients with osteoporosis (T ≤ −2.5) or any fragility fracture.
  {
    const lowestT = patient.dexaResults
      ? Math.min(
          ...[
            patient.dexaResults.lumbarSpineTScore,
            patient.dexaResults.totalHipTScore,
            patient.dexaResults.femoralNeckTScore,
          ].filter((t): t is number => t != null)
        )
      : 0;
    const hasOsteoporosis = lowestT <= -2.5 && lowestT !== 0;
    const hasFragilityFracture =
      patient.priorFragilityFracture ||
      patient.priorHipFracture ||
      patient.priorVertebralFracture;

    if (hasOsteoporosis || hasFragilityFracture) {
      const trigger = hasOsteoporosis && hasFragilityFracture
        ? 'osteoporosis (T ≤ −2.5) and fragility fracture'
        : hasOsteoporosis
        ? 'osteoporosis (T ≤ −2.5)'
        : 'fragility fracture';
      flags.push({
        id: 'falls_risk_assessment',
        severity: 'info',
        message:
          `Falls assessment indicated — ${trigger} present. NOGG 2024 Rec 7 (Strong): a falls assessment should be ` +
          'undertaken in ALL patients with osteoporosis and ALL patients with fragility fractures.',
        rationale:
          'Falls drive most fragility fractures. The falls assessment trigger is a property of the patient population ' +
          '(osteoporosis OR any fragility fracture), not a sub-stratification of "those at risk" — every patient meeting ' +
          'this criterion should be assessed. Exercise programmes that improve balance and muscle strength ' +
          '(e.g. Otago, tai chi) reduce fall and fracture risk in older adults (NOGG 2024 Rec 7, Strong).',
        source: SRC_NOGG,
      });
    }
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

  // ── Early menopause / POI — FRAX underestimation warning (v1.16 Step 8 — Section 10.3) ──
  if (patient.earlyMenopause) {
    flags.push({
      id: 'early_menopause_frax_underestimate',
      severity: 'warning',
      message:
        'POI / early menopause: FRAX UNDERESTIMATES fracture risk in this population. ' +
        'FRAX was not calibrated for women who have been oestrogen-deficient since their 30s or 40s — ' +
        'a low FRAX score does NOT rule out significant fracture risk. ' +
        'DEXA is indicated regardless of FRAX result. Do NOT use FRAX to decide whether to investigate or treat in this population.',
      rationale:
        'NOGG 2024 / NICE NG23 (Section 10.3): early oestrogen loss causes cumulative bone deficit ' +
        'beyond what FRAX clinical risk factors capture. The lower BMD treatment threshold (T-score ≤ −1.5) applies. ' +
        'HRT is first-line bone protection in women under 50 (POI); first-line for women ≤ 60 with high fracture risk ' +
        'and no VTE/breast cancer history.',
      source: SRC_IOS,
    });
  }

  // ── Glucocorticoids ≥7.5 mg/day surface flag — GIOP pathway, FRAX adjusted ──
  // Fires on current high-dose use regardless of elapsed duration (planned ≥3 mo per Rec 22).
  if (isOnHighDoseGC(patient)) {
    const _gcDose = effectiveGCDoseMgDay(patient);
    flags.push({
      id: 'gc_high_dose_giop_surface',
      severity: 'warning',
      message:
        `Glucocorticoids ${_gcDose} mg/day (≥7.5) — GIOP pathway applied; Table 8 FRAX correction MOF ×1.15 / hip ×1.20.`,
      rationale:
        'NOGG 2024 Rec 22 (Strong): start bone protection at the same time as glucocorticoids; do not wait for DEXA. ' +
        'Table 8 high-dose adjustment compensates for FRAX underestimation at ≥7.5 mg/day.',
      source: SRC_NOGG,
    });
  }

  // ── BTM / BMD restart signal during a bisphosphonate pause (v1.13 Step 9; NOGG Section 6.6, Conditional) ──
  // v1.19 — onPause now spans three patient shapes the wizard can produce:
  //   1. currentTreatment is a BP marked currentlyOn=false with reasonStopped='treatment_holiday'
  //      (the "currently on alendronate but currently paused" mental model)
  //   2. currentTreatment is null AND a previous BP has reasonStopped='treatment_holiday'
  //      (the previous mental model — patient stopped some time ago)
  //   3. EITHER slot has a BP whose monthsSinceLastDose > 0 (interrupted course; v1.19 input)
  // Pre-v1.19 the engine only saw shape 2, which created a UX trap: the wizard's "Currently on
  // bone protection treatment" YesNo with hard-coded currentlyOn=true sat the patient in shape 1
  // territory, but the engine couldn't see that as paused, so the BTM toggle never appeared and
  // the restart signal could never fire from a UI-realistic input. TC37b locks in shape 1.
  {
    const isPausedBP = (t: TreatmentHistory | null | undefined): boolean => {
      if (!t || !isBisphosphonate(t.agent)) return false;
      if (t.reasonStopped === 'treatment_holiday') return true;
      if (t.currentlyOn === false && (t.monthsSinceLastDose ?? 0) > 0) return true;
      return false;
    };
    const onPause =
      isPausedBP(patient.currentTreatment) ||
      patient.previousTreatments.some(isPausedBP);
    if (onPause && (patient.boneTurnoverMarkersRising === true || patient.bmdDecreasedDuringPause === true)) {
      const triggers: string[] = [];
      if (patient.boneTurnoverMarkersRising === true) triggers.push('rising bone turnover markers (CTX / P1NP)');
      if (patient.bmdDecreasedDuringPause === true) triggers.push('BMD decreased on repeat DEXA');
      flags.push({
        id: 'bp_pause_restart_signal',
        severity: 'warning',
        message:
          `Bisphosphonate pause restart signal: ${triggers.join('; ')}. Consider restarting bisphosphonate before the scheduled FRAX reassessment. ` +
          'Note: if the trigger includes elevated ALP, exclude liver source first (LFTs / GGT) before attributing to rising bone turnover.',
        rationale:
          'NOGG 2024 Section 6.6 Rec 7 (Conditional): in addition to fracture (Rec 3) and scheduled FRAX reassessment (Rec 4), ' +
          'consider restart if biochemical markers indicate relapse from suppressed bone turnover OR BMD has decreased on repeat DEXA. ' +
          'No definitive thresholds for BTM/BMD change have been established — clinical judgement applies.',
        source: SRC_NOGG,
      });
    }
    // v1.14 — fracture during pause: immediate FRAX reassessment + restart, regardless of
    // drug-specific reassessment interval (NOGG 2024 Section 7 Rec 3 Strong).
    if (onPause && patient.recentFractureWithin2Years === true) {
      flags.push({
        id: 'bp_pause_fracture_restart',
        severity: 'warning',
        message:
          'FRACTURE DURING PAUSE — RESTART TREATMENT. New fragility fracture during bisphosphonate pause. ' +
          'Reassess FRAX with BMD immediately; do not wait for the drug-specific reassessment interval. ' +
          'If FRAX is above the age-specific intervention threshold, or T-score ≤ −2.5, restart treatment.',
        rationale:
          'NOGG 2024 Section 7 Rec 3 (Strong): a new fragility fracture during a bisphosphonate pause is an absolute ' +
          'indication for immediate FRAX reassessment and treatment restart. The drug-specific reassessment interval ' +
          '(Rec 4) is overridden by an interval fracture event.',
        source: SRC_NOGG,
      });
    }
  }

  // ── GC withdrawal — Section 9.4 review of bone protection (v1.13/v1.14) ──
  // Patient was previously on oral GC, has now stopped, AND is currently on a bisphosphonate.
  // Bone-protective therapy may be considered for withdrawal IF FRAX (with BMD) reassessment
  // shows BOTH MOF and hip below the age-specific intervention threshold. If FRAX is provided,
  // emit either:
  //   - gc_withdrawal_bp_review (eligible)         — both axes below IT
  //   - gc_withdrawal_continue_treatment (continue) — at least one axis above IT
  // If FRAX not provided, emit the umbrella gc_withdrawal_bp_review with a recalc prompt.
  if (
    gcStoppedOver12MonthsAgo(patient) &&
    !isOnGC(patient) &&
    patient.currentTreatment?.currentlyOn === true &&
    isBisphosphonate(patient.currentTreatment.agent)
  ) {
    const ageThr = getAgeThreshold(patient.age);
    const mof = riskStratification.adjustedFraxMOFPercent;
    const hip = riskStratification.adjustedFraxHipPercent;
    const haveFrax = mof !== null && hip !== null && ageThr !== null;
    const mofBelow = haveFrax && (mof as number) < ageThr!.itMOF;
    const hipBelow = haveFrax && (hip as number) < ageThr!.itHip;

    if (haveFrax && mofBelow && hipBelow) {
      flags.push({
        id: 'gc_withdrawal_bp_review',
        severity: 'info',
        message:
          `Glucocorticoid stopped. FRAX reassessment (without GC — Table 8 correction not applied): MOF ${mof}% and hip ${hip}%, both below age-specific intervention thresholds (${ageThr!.itMOF}% / ${ageThr!.itHip}%). Bone-protective therapy withdrawal may be considered.`,
        rationale:
          'NOGG 2024 Section 9.4 (Strong): on cessation of GC therapy, withdrawal of antiresorptive may be considered ' +
          'where BOTH MOF and hip 10-year probabilities lie below the age-specific intervention threshold. ' +
          'Recalculated FRAX confirms both axes below threshold; clinical judgement applies.',
        source: SRC_NOGG,
      });
    } else if (haveFrax && (!mofBelow || !hipBelow)) {
      const aboveText = !mofBelow && !hipBelow
        ? `MOF ${mof}% (IT ${ageThr!.itMOF}%) and hip ${hip}% (IT ${ageThr!.itHip}%) both above`
        : !mofBelow
        ? `MOF ${mof}% remains above IT ${ageThr!.itMOF}%; hip ${hip}% below IT ${ageThr!.itHip}%`
        : `hip ${hip}% remains above IT ${ageThr!.itHip}%; MOF ${mof}% below IT ${ageThr!.itMOF}%`;
      flags.push({
        id: 'gc_withdrawal_continue_treatment',
        severity: 'warning',
        message:
          `Glucocorticoid stopped — CONTINUE TREATMENT. ${aboveText} the age-specific intervention threshold. Bone protection must continue; both MOF and hip must be below threshold for withdrawal to be considered.`,
        rationale:
          'NOGG 2024 Section 9.4 (Strong): withdrawal of bone-protective therapy after GC cessation requires BOTH ' +
          'MOF and hip 10-year probabilities below the age-specific intervention threshold. If either axis is above ' +
          'threshold, continue bone protection.',
        source: SRC_NOGG,
      });
    } else {
      flags.push({
        id: 'gc_withdrawal_bp_review',
        severity: 'info',
        message:
          'Glucocorticoid stopped — review bisphosphonate need. Withdrawal of bone-protective therapy may be considered, but only if FRAX reassessment (with BMD) shows BOTH MOF and hip probabilities below the age-specific intervention threshold. If either is above threshold, continue bone protection. Recalculate FRAX without the GC checkbox for this reassessment.',
        rationale:
          'NOGG 2024 Section 9.4 (Strong): on cessation of GC therapy, withdrawal of antiresorptive may be appropriate ' +
          'where both MOF and hip 10-year probabilities lie below the age-specific intervention threshold. ' +
          'The Table 8 GC dose adjustment no longer applies once GC is stopped — recalculate FRAX with the GC box unticked.',
        source: SRC_NOGG,
      });
    }
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
      collapsedByDefault: true,
      summary: 'Ask about outstanding invasive dental work before first IV zoledronate or denosumab dose.',
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

    // Borderline forearm-only (-2.5 to -3.0) with no fragility fracture, no secondary
    // cause, and no other FRAX clinical risk factors → monitor; no treatment yet.
    const fr = patient.dexaResults!.forearmTScore!;
    const hasFx =
      patient.priorFragilityFracture ||
      patient.priorHipFracture ||
      patient.priorVertebralFracture;
    const hasSecondary = patient.secondaryOsteoporosis.length > 0;
    const otherRFs =
      patient.parentalHipFracture ||
      patient.currentSmoker ||
      patient.alcoholUnitsPerWeek >= 21 ||
      (patient.bmi !== null && patient.bmi < 19) ||
      patient.rheumatoidArthritis ||
      patient.type2Diabetes ||
      patient.fallsInLastYear >= 2 ||
      patient.parkinsonsDisease ||
      isOnGC(patient) ||
      patient.adtUse ||
      patient.aromataseInhibitorUse ||
      patient.earlyMenopause;

    if (fr > -3.0 && fr <= -2.5 && !hasFx && !hasSecondary && !otherRFs) {
      flags.push({
        id: 'forearm_borderline_monitor',
        severity: 'info',
        message:
          `Borderline forearm-only osteoporosis (T ${fr}) — no fractures, no secondary cause, no other risk factors. ` +
          'Monitor: repeat DEXA in 2 years. Treatment not indicated unless risk factors develop.',
        rationale:
          'ISCD 2023 / NOGG 2024: borderline forearm-only osteoporosis without other risk factors warrants surveillance, ' +
          'not reflex treatment. Re-DEXA at 2 years to detect progression. Reassess earlier if any fragility fracture, ' +
          'newly identified secondary cause, or new clinical risk factor develops.',
        source: SRC_ISCD,
      });
    }
  }

  // v1.14 — IOF 2017 international consensus AI treatment threshold (cited by NOGG 2024).
  // Replaces the previous blanket T-score ≤ −1.5 rule (no IOS source supported it).
  //   T-score < −2.0 (any site) → treat unconditionally
  //   T-score < −1.5 + ≥1 additional FRAX clinical risk factor → treat
  //   no T-score (no DEXA) + ≥2 FRAX clinical risk factors → treat
  //   otherwise → fall through to the standard FRAX-driven cascade (high-risk by FRAX still treats)
  const aiLowerThresholdMet = (() => {
    if (!patient.aromataseInhibitorUse) return false;
    const tScores = patient.dexaResults
      ? [
          patient.dexaResults.lumbarSpineTScore,
          patient.dexaResults.totalHipTScore,
          patient.dexaResults.femoralNeckTScore,
        ].filter((t): t is number => t != null)
      : [];
    const lowestT = tScores.length > 0 ? Math.min(...tScores) : null;
    const rfCount = aiAdditionalRiskFactorCount(patient);
    if (lowestT !== null && lowestT < -2.0) return true;
    if (lowestT !== null && lowestT < -1.5 && rfCount >= 1) return true;
    if (lowestT === null && rfCount >= 2) return true;
    return false;
  })();

  // Low risk — lifestyle only
  // Bypass: recent fracture within 24 months (imminent risk → treat immediately without waiting for FRAX)
  // Bypass: AI therapy with T-score ≤-1.5 (CTIBL threshold is independent of FRAX)
  if (riskCategory === 'low' && !patient.recentFractureWithin2Years && !aiLowerThresholdMet) {
    return { recommendations: [], flags, referrals, supplements, specialistOptions };
  }

  // Intermediate risk without DEXA — branch on whether BMD is unavailable per NOGG 2024 Rec 6.
  // Bypass: recent fracture (treat immediately) or AI threshold met (DEXA not required to decide).
  // Bypass: GIOP — Section 9 owns the GC pathway (immediate-start criteria, near-threshold flag,
  // assess-and-treat). Falling through to giop() preserves dose-specific logic.
  if (
    riskCategory === 'intermediate' &&
    !patient.dexaResults &&
    !patient.currentTreatment &&
    !patient.recentFractureWithin2Years &&
    !aiLowerThresholdMet &&
    !isOnGC(patient)
  ) {
    if (patient.bmdUnavailable) {
      // NOGG 2024 Rec 6: BMD unavailable / contraindicated / impractical
      const threshold = getAgeThreshold(patient.age);
      const adjustedMOF = riskStratification.adjustedFraxMOFPercent;
      const exceedsIT =
        threshold !== null && adjustedMOF !== null && adjustedMOF >= threshold.itMOF;
      const hasFragilityFx =
        patient.priorFragilityFracture ||
        patient.priorHipFracture ||
        patient.priorVertebralFracture;

      if (hasFragilityFx) {
        flags.push({
          id: 'bmd_unavailable_treat_fx',
          severity: 'info',
          message:
            'BMD not available — treatment offered based on history of fragility fracture per NOGG 2024 Rec 6.',
          rationale:
            'NOGG 2024 Rec 6 (Strong): in intermediate-risk patients where BMD is unavailable, ' +
            'a previous low-trauma fracture is a sufficient indication for treatment.',
          source: SRC_NOGG,
        });
        // Fall through to standard treatment initiation below
      } else if (exceedsIT) {
        flags.push({
          id: 'bmd_unavailable_treat_frax',
          severity: 'info',
          message:
            `BMD not available — FRAX MOF ${adjustedMOF}% exceeds intervention threshold (${threshold!.itMOF}% at age ${patient.age}) per NOGG 2024 Rec 6.`,
          rationale:
            'NOGG 2024 Rec 6 (Strong): in intermediate-risk patients without BMD, treatment is offered ' +
            'when FRAX 10-year MOF probability exceeds the age-specific intervention threshold (Table 5).',
          source: SRC_NOGG,
        });
        // Fall through to standard treatment initiation below
      } else {
        flags.push({
          id: 'bmd_unavailable_no_treatment',
          severity: 'info',
          message:
            'BMD not available and neither treatment criterion met — lifestyle advice, reassess when BMD becomes available or if risk factors change per NOGG 2024 Rec 6.',
          rationale:
            'NOGG 2024 Rec 6 (Strong): in intermediate-risk patients without BMD, treat only if a previous ' +
            'fragility fracture is present OR FRAX exceeds the intervention threshold. Otherwise lifestyle advice and reassessment.',
          source: SRC_NOGG,
        });
        return { recommendations: [], flags, referrals, supplements, specialistOptions };
      }
    } else {
      // BMD is available / appropriate — refer for DEXA, withhold treatment until result
      flags.push({
        id: 'intermediate_await_dexa',
        severity: 'info',
        message:
          'Intermediate fracture risk — refer for DEXA. BMD will reclassify to low (no treatment) or high (treat) per NOGG 2024 Rec 4.',
        rationale:
          'NOGG 2024 Rec 4 (Strong): intermediate-risk patients require BMD measurement before treatment decision. ' +
          'Starting treatment without BMD in the amber zone is not appropriate. ' +
          'If BMD is unavailable, contraindicated, or impractical, indicate this on the investigations step to apply NOGG Rec 6.',
        source: SRC_NOGG,
      });
      return { recommendations: [], flags, referrals, supplements, specialistOptions };
    }
  }

  // v1.14 — Intermediate risk with DEXA already available, T-score above −2.5, no override:
  // BMD did not reclassify to high. NOGG 2024: amber zone with BMD that did not push above IT
  // → no treatment. Lifestyle advice + monitor.
  // Overrides that bypass this guard:
  //   - recent fragility fracture (imminent risk)
  //   - AI IOF 2017 threshold met
  //   - existing treatment (sequencing logic owns the decision)
  //   - on GC (GIOP path owns the decision)
  //   - early menopause (special-population path owns the decision)
  if (
    riskCategory === 'intermediate' &&
    patient.dexaResults &&
    !patient.currentTreatment &&
    !patient.recentFractureWithin2Years &&
    !aiLowerThresholdMet &&
    !isOnGC(patient) &&
    !patient.earlyMenopause
  ) {
    const ts = [
      patient.dexaResults.lumbarSpineTScore,
      patient.dexaResults.totalHipTScore,
      patient.dexaResults.femoralNeckTScore,
    ].filter((t): t is number => t != null);
    const lowestT = ts.length > 0 ? Math.min(...ts) : null;
    if (lowestT === null || lowestT > -2.5) {
      flags.push({
        id: 'intermediate_with_bmd_no_treatment',
        severity: 'info',
        message:
          'Intermediate FRAX risk with BMD: T-score does not meet the osteoporosis threshold (≤ −2.5) and FRAX is below the age-specific intervention threshold. No bone protection indicated at this time. Reassess when risk factors change.',
        rationale:
          'NOGG 2024 Section 3.1 (Strong): in the amber zone, BMD reclassifies the patient to either low (no treatment) ' +
          'or high (treat) risk. When BMD does not push the patient above the intervention threshold and no special ' +
          'override applies (recent fracture, GC, AI IOF 2017 criteria), treatment is not indicated.',
        source: SRC_NOGG,
      });
      // Flags downstream of this point that are *contextual* (AI/ADT near-threshold reassessment,
      // dental hygiene, etc.) still need to fire, so we push contextual flags before returning.
      adtFlags(patient, riskCategory, riskStratification, flags, referrals);
      aiFlags(patient, riskCategory, riskStratification, flags);
      return { recommendations: [], flags, referrals, supplements, specialistOptions };
    }
  }

  // High / very high risk: DEXA is for baseline comparison only — treatment must NOT be delayed.
  // (NOGG 2024 Rec 3, Strong.)
  if (
    (riskCategory === 'high' || riskCategory === 'very_high') &&
    !patient.dexaResults
  ) {
    flags.push({
      id: 'dexa_baseline_high_risk',
      severity: 'info',
      message:
        'DEXA recommended to provide a baseline for future BMD comparison. Treatment should be started without waiting for DEXA result.',
      rationale:
        'NOGG 2024 Rec 3 (Strong): high / very high risk patients should start bone protection without delay; ' +
        'DEXA provides a baseline for monitoring response, not a gate on treatment.',
      source: SRC_NOGG,
    });
  }

  // ── Post-anabolic sequencing (highest priority safety flag) ──
  // v1.36 A2-impl Seq.1: NOGG 2024 Rec 14 (Strong) — sequential antiresorptive must be planned
  // at the time the anabolic is initiated, not at the end. Trigger now widened to also fire
  // when an anabolic referral is active (the prompt is most useful BEFORE the course starts so
  // the referral letter includes the follow-on plan).
  if (patient.completedAnabolicCourse || referralSignals.anabolicReferralFired) {
    postAnabolicFlags(flags);
  }

  // ── Denosumab rebound / missed injection ──
  denosumabReboundFlags(patient, flags);

  // ── Special population overrides ──

  if (isEarlyMenopausePre50(patient)) {
    return { ...earlyMenopause(patient, flags, referrals), supplements, specialistOptions };
  }

  if (isGIOP(patient)) {
    return { ...giop(patient, riskCategory, riskStratification, flags, referrals), supplements, specialistOptions };
  }

  // ── Contextual flags ──
  adtFlags(patient, riskCategory, riskStratification, flags, referrals);
  aiFlags(patient, riskCategory, riskStratification, flags);
  affFlags(patient, flags);

  // ── High → very high re-designation consideration (NOGG 2024 Section 3 + Table 2) ──
  // High-risk patients with ≥2 Table 2 modifiers → prompt clinician to consider VHR.
  // Modifiers that already drive VHR independently (high-dose GC ≥3mo, T ≤ −3.5) are excluded.
  if (riskCategory === 'high') {
    const modifiers: string[] = [];

    if (patient.fallsInLastYear >= 2) {
      modifiers.push(`recurrent falls (${patient.fallsInLastYear}/year)`);
    }
    if (
      patient.type2Diabetes ||
      patient.type1Diabetes === true ||
      patient.secondaryOsteoporosis.includes('type1_diabetes')
    ) {
      modifiers.push('diabetes mellitus');
    }
    if (patient.parkinsonsDisease) {
      modifiers.push("Parkinson's disease");
    }
    if (patient.recentFractureWithin2Years) {
      modifiers.push('recent fragility fracture (<24 months)');
    }
    // Spine-predominant low BMD: lumbar T ≤ −3.0 AND ≥1 SD lower than femoral neck
    if (patient.dexaResults) {
      const ls = patient.dexaResults.lumbarSpineTScore;
      const fn = patient.dexaResults.femoralNeckTScore;
      if (
        ls !== null && ls > -3.5 && ls <= -3.0 &&
        fn !== null && (fn - ls) >= 1.0
      ) {
        modifiers.push(`spine-predominant low BMD (LS ${ls} vs FN ${fn})`);
      }
    }

    if (modifiers.length >= 2) {
      flags.push({
        id: 'vhr_redesignation_consideration',
        severity: 'warning',
        message:
          `High risk by FRAX with ${modifiers.length} Table 2 modifiers (${modifiers.join('; ')}). ` +
          'Consider re-designation to very high risk per NOGG 2024 — refer for specialist consideration of parenteral / anabolic treatment.',
        rationale:
          'NOGG 2024 (Conditional): in patients with FRAX probabilities in the high-risk category, ' +
          'consideration of additional clinical risk factors (e.g., frequent falls, very low spine BMD — see Table 2) ' +
          'can also lead to redesignation from high to very high risk of fracture. ' +
          'Table 2 modifiers counted: high-dose glucocorticoids (already separate VHR criterion), LS BMD discordance, ' +
          'TBS, HAL, recurrent falls, country of birth, T1DM/T2DM, Parkinson\'s disease, recent MOF. ' +
          'TBS, HAL, and country of birth are not collected by this tool. ' +
          'Threshold: ≥2 modifiers prompt re-designation consideration; clinician retains the decision.',
        source: SRC_NOGG,
      });
    }
  }

  // ── Very high risk — specialist referral (NOGG 2024 Conditional recommendation) ──
  if (riskCategory === 'very_high') {
    const gcDrivesVHR =
      isOnHighDoseGC(patient) && gcDurationMonths(patient) >= GIOP.highDoseMinMonths;

    flags.push({
      id: 'vhr_specialist_referral',
      severity: gcDrivesVHR ? 'urgent' : 'warning',
      message: gcDrivesVHR
        ? 'URGENT: refer to osteoporosis specialist in secondary care. Start an oral bisphosphonate in the meantime if any delay is anticipated — rapid bone loss post-glucocorticoid initiation.'
        : 'Refer to osteoporosis specialist in secondary care for assessment and consideration of specialist-initiated treatment. Some may need first-line anabolic drug treatment, especially those with multiple vertebral fractures.',
      rationale:
        'NOGG 2024 (Conditional): consider referral of very high-risk patients to an osteoporosis specialist in secondary care, ' +
        'for assessment and consideration of parenteral treatment (some may need first-line anabolic drug treatment, especially those with multiple vertebral fractures). ' +
        'Indications include single important risk factors (recent vertebral fracture <2y, ≥2 vertebral fractures, T-score ≤−3.5, ' +
        'high-dose glucocorticoids ≥7.5 mg/day for ≥3 months — refer urgently given rapid post-initiation bone loss), multiple clinical risk factors with a recent fragility fracture, ' +
        'or other indicators (FRAX-defined VHR). ' +
        'GP cannot initiate High-Tech anabolic drugs (teriparatide biosimilar, romosozumab) — these require specialist initiation. ' +
        'Romosozumab HSE MAP (effective 1 Nov 2024): postmenopausal women with T ≤ −2.5 + MOF within 24 months; individual patient application via approved consultant; High Tech Hub prescription only.',
      source: SRC_ROMO_MAP,
    });
    referrals.push({
      specialty: 'metabolic_bone',
      reason: gcDrivesVHR
        ? 'Very high fracture risk driven by high-dose glucocorticoid use — urgent referral; rapid bone loss post-GC initiation. Start oral bisphosphonate in the meantime if any delay anticipated.'
        : 'Very high fracture risk — assessment and consideration of parenteral treatment per NOGG 2024 (some may need first-line anabolic, especially with multiple vertebral fractures).',
      urgency: gcDrivesVHR ? 'urgent' : 'soon',
    });

    // ── v1.28 Step 10 — Romosozumab cardiovascular risk framing for VHR referral ──
    // For appropriate female VHR candidates (i.e. romosozumab eligible: postmenopausal,
    // no recent MI/stroke), surface a referral-context flag covering CV risk assessment,
    // renal cautions, and the dosing detail the specialist will need.
    if (patient.sex === 'female') {
      if (patient.priorMIOrStroke) {
        // v1.36 (TC92) — Romosozumab CV-history exclusion. Spec §5.5: "avoid if MI or
        // stroke history" — no time window. Replaces the broader CV-risk-framing flag for
        // this subgroup since romosozumab is explicitly off the table; the framing prompt
        // is for candidates still in consideration.
        flags.push({
          id: 'romosozumab_excluded_mi_stroke_history',
          severity: 'warning',
          message:
            'Romosozumab is excluded for this patient — prior MI or stroke history (any time). ' +
            'Per spec v1.36 §5.5: "avoid if MI or stroke history" with no time window. ' +
            'Teriparatide is the remaining anabolic option (specialist-initiated; document the CV history in the referral letter).',
          rationale:
            'NOGG 2024 / spec v1.36 §5.5 romosozumab row: any prior MI or stroke (historic or recent) is a contraindication ' +
            'to romosozumab. The ARCH-trial CV signal is the basis for this exclusion. Teriparatide carries no equivalent ' +
            'CV CI and remains an option for this VHR patient.',
          source: SRC_ROMO_MAP,
        });
      } else {
        flags.push({
          id: 'romosozumab_cv_risk_framing',
          severity: 'info',
          collapsedByDefault: true,
          summary: 'Romosozumab specialist review: assess CV risk and flag explicit CV history in the referral.',
          message:
            'If romosozumab is being considered at specialist review: both 1-year fracture risk AND 1-year cardiovascular risk must be assessed. ' +
            'Flag explicit CV risk factors in the referral letter (prior MI / stroke / unstable angina / heart failure / uncontrolled hypertension / CV risk score) — the specialist needs this to decide whether romosozumab is appropriate. ' +
            'Romosozumab dosing: TWO SC injections of 105 mg each (total 210 mg) given monthly for 12 months. ' +
            'Severe renal impairment or dialysis → increased hypocalcaemia risk with romosozumab — flag renal status in the referral.',
          rationale:
            'NOGG 2024 (v1.28): romosozumab carries a small but real CV signal from ARCH-trial subgroup analysis. ' +
            'The CV risk assessment is part of the prescribing decision and must accompany the referral; specialists need the full CV picture to decide between romosozumab and an alternative.',
          source: SRC_ROMO_MAP,
        });
      }
    }

    // ── v1.29 Step 11 — Bisphosphonate blunting effect in anabolic-referral letter ──
    // When a VHR patient is currently on (or has been on long-term) a bisphosphonate
    // and is being referred for anabolic consideration, surface the referral-letter
    // wording about attenuated BMD response.
    {
      const bpCurrent = patient.currentTreatment?.currentlyOn === true && isBisphosphonate(patient.currentTreatment.agent);
      const bpPriorLong = patient.previousTreatments.some(t => isBisphosphonate(t.agent) && t.durationMonths >= 12);
      if (bpCurrent || bpPriorLong) {
        const dur = bpCurrent
          ? `${patient.currentTreatment!.durationMonths} months on ${patient.currentTreatment!.agent}`
          : (() => {
              const t = patient.previousTreatments.find(p => isBisphosphonate(p.agent) && p.durationMonths >= 12)!;
              return `previous ${t.agent} (${t.durationMonths} months)`;
            })();
        flags.push({
          id: 'bp_blunting_effect_referral',
          severity: 'info',
          message:
            `REFERRAL LETTER NOTE: ${dur}. Prior bisphosphonate treatment ATTENUATES BMD response to teriparatide and romosozumab — ` +
            'attenuation is greater for teriparatide, especially at the hip. ' +
            'Romosozumab is less affected than teriparatide but still attenuated relative to treatment-naïve patients. ' +
            'State the prior bisphosphonate use and duration explicitly in the referral letter so the specialist can factor this into drug selection.',
          rationale:
            'NOGG 2024 (Evidence IIb, v1.29): the BMD-gain response to anabolic therapy is reduced in patients previously exposed to ' +
            'bisphosphonates, particularly long courses. The specialist may opt for romosozumab over teriparatide on this basis. ' +
            'This information must be supplied with the referral.',
          source: SRC_NOGG,
        });
      }
    }

    // ── v1.29 Step 12 — Denosumab → romosozumab attenuation note (referral context) ──
    {
      const denoCurrent = patient.currentTreatment?.currentlyOn === true && patient.currentTreatment.agent === 'denosumab';
      const denoPrior = patient.previousTreatments.some(t => t.agent === 'denosumab');
      if (denoCurrent || denoPrior) {
        flags.push({
          id: 'denosumab_to_romosozumab_attenuation',
          severity: 'info',
          message:
            'REFERRAL CONTEXT (v1.29): when romosozumab is given following denosumab therapy, there is ATTENUATION of the BMD increase at spine and hip ' +
            'compared to treatment-naïve patients. The specialist should be aware of the patient\'s denosumab history when considering romosozumab.',
          rationale:
            'NOGG 2024 (v1.29): the post-denosumab attenuation of the romosozumab BMD response is distinct from the rebound-fracture risk after denosumab cessation. ' +
            'Both considerations affect drug sequencing; the specialist needs to know the denosumab history.',
          source: SRC_NOGG,
        });
      }
    }

    // ── v1.20 Step 8 — Anabolic option for men ≥50 at VHR with vertebral fractures ──
    // Teriparatide is the only anabolic licensed for men. Surface it explicitly
    // as a first-line option in this population; the referral pathway above
    // already triggers — this flag adds the male-specific clinical content.
    if (
      patient.sex === 'male' &&
      patient.age >= 50 &&
      (patient.priorVertebralFracture || (patient.recentVertebralFractureYears !== null && patient.recentVertebralFractureYears <= 2))
    ) {
      const teriparatideUsed = hasCompletedTeriparatideCourse(patient);
      flags.push({
        id: 'male_vhr_anabolic_teriparatide',
        severity: 'warning',
        message: teriparatideUsed
          ? 'Male ≥50 at very high risk with vertebral fracture(s). NOTE: teriparatide has already been used (lifetime maximum reached) — specialist input required for alternative parenteral strategy. ' +
            'Romosozumab is NOT licensed for men. Discuss zoledronate or denosumab continuation under specialist guidance.'
          : 'Male ≥50 at very high risk with vertebral fracture(s) — teriparatide should be considered as a first-line option per NOGG 2024 (v1.20). ' +
            'Teriparatide is the only anabolic drug licensed for use in men in Ireland. GP cannot initiate — specialist (consultant) referral required under the HSE High-Tech scheme. ' +
            // v1.28 Step 8 — corrected hip-fracture evidence.
            'Hip fracture evidence (v1.28): no primary RCT hip-fracture endpoint, but meta-analysis evidence suggests a reduction (OR 0.44, 95% CI 0.22–0.87; Evidence Ia).',
        rationale:
          'NOGG 2024 Section 5.5 / Section 7.1 (v1.20 addition): men ≥50 at VHR with vertebral fractures benefit from anabolic-first treatment. ' +
          'Teriparatide is the licensed anabolic for men in Ireland; romosozumab and abaloparatide are not. ' +
          'A specialist initiates teriparatide under the HSE High-Tech scheme; the GP may continue under shared care after initiation. ' +
          'v1.28: the previous spec stated "teriparatide has not been shown to reduce hip fracture" — this is outdated. The current best estimate is a meta-analytic OR of 0.44 (95% CI 0.22–0.87, Evidence Ia).',
        source: SRC_NOGG,
      });
    }
  }

  // ── Active adverse event pathways (override sequencing) ──
  if (patient.thighOrGroinPain && isCurrentlyOnBisphosphonate(patient)) {
    return { ...affProdrome(patient, flags, referrals), supplements, specialistOptions };
  }

  // ONJ history — covers both current AND previous treatments
  if (hasONJHistory(patient)) {
    return { ...onjHistory(flags, referrals), supplements, specialistOptions };
  }

  // AFF history — permanent bisphosphonate CI; push flag here so it appears in all subsequent paths
  if (hasAFFHistory(patient)) {
    flags.push({
      id: 'aff_history_bp_permanent_ci',
      severity: 'urgent',
      message:
        'DO NOT prescribe any bisphosphonate — confirmed AFF history. Use denosumab or teriparatide biosimilar (HSE BVM policy March 2023); refer specialist.',
      rationale:
        'AFF is a class effect of bisphosphonates due to suppression of bone remodelling at cortical stress sites. ' +
        'Rechallenge with any bisphosphonate carries recurrence risk and is contraindicated. ' +
        'NOGG 2024 Section 7.2 / ASBMR Task Force: after confirmed AFF, bisphosphonates should generally be avoided permanently.',
      source: SRC_NOGG,
    });
  }

  // v1.23 — re-extract currentTreatment as a fresh local so the flag blocks
  // below aren't blocked by TypeScript's narrowing (the ONJ / AFF / sequencing
  // branches above each contain returns that narrow patient.currentTreatment
  // to null for the rest of this function).
  const current: TreatmentHistory | null = patient.currentTreatment as TreatmentHistory | null;

  // ── v1.23 Step 2 — Teriparatide lifetime restriction ──
  // Fires regardless of new-initiation vs continuation path so the flag
  // surfaces for established patients reviewed in primary care.
  if (hasCompletedTeriparatideCourse(patient)) {
    flags.push({
      id: 'teriparatide_lifetime_used',
      severity: 'warning',
      message:
        'Teriparatide cannot be used — lifetime maximum of one 24-month course already completed. ' +
        'Romosozumab remains an option (no lifetime restriction; women only). ' +
        'Sequential antiresorptive therapy and specialist follow-up are required for ongoing bone protection.',
      rationale:
        'NOGG 2024 / HSE BVM teriparatide policy (v1.23): a single 24-month course is the lifetime maximum. ' +
        'Romosozumab and abaloparatide have no equivalent restriction. The patient must continue with an antiresorptive ' +
        'after the teriparatide course; failure to follow on with an antiresorptive negates the BMD gain.',
      source: SRC_NOGG,
    });
  }

  // ── v1.22 Step 3 — Specialist initiation vs GP continuation flag ──
  // For teriparatide / romosozumab / abaloparatide. Don't emit a referral instruction
  // for someone already established on the drug.
  // v1.39 Round 3 Change 3 — abaloparatide added to the gate (spec v1.38B already
  // added it to the High-Tech context-flag rule; engine list was missing it).
  if (current?.currentlyOn === true && (
    current.agent === 'teriparatide' ||
    current.agent === 'romosozumab' ||
    current.agent === 'abaloparatide'
  )) {
    // v1.28 Step 9 — drug-specific side-effect + monitoring text for shared-care continuation.
    // v1.39 Round 3 — abaloparatide branch added (PTH-class side-effect profile + same
    // sequential antiresorptive mandate as teriparatide; not reimbursed in Ireland —
    // the separate abaloparatide_not_reimbursed_ireland flag covers the funding caveat).
    const sharedCareDetail =
      current.agent === 'teriparatide'
        ? 'Side effects to monitor (v1.28): headache, nausea, dizziness, postural hypotension, leg pain, transient serum calcium elevation post-injection (expected). ' +
          'Caution with moderate renal impairment — monitor eGFR during GP continuation (not just severe impairment as a CI). ' +
          'Begin planning sequential antiresorptive NOW — prescribe 1 month before final dose so there is zero gap. Failure to follow on negates the BMD gain.'
        : current.agent === 'abaloparatide'
        ? 'Abaloparatide (v1.39): PTHrP analogue with PTH-class side-effect profile similar to teriparatide ' +
          '(headache, nausea, dizziness, postural hypotension, transient post-injection serum calcium elevation expected). ' +
          'Monitor for hypercalcaemia; monitor eGFR. Begin planning sequential antiresorptive NOW — prescribe 1 month before ' +
          'final dose so there is zero gap. Note: not currently reimbursed in Ireland (no HSE High-Tech listing — private pay ' +
          'must be confirmed; see abaloparatide_not_reimbursed_ireland flag).'
        : 'Romosozumab (v1.28): two SC injections of 105 mg each (total 210 mg) monthly for 12 months total. ' +
          'Monitor for hypocalcaemia, especially in renal impairment. Plan sequential antiresorptive before the 12-month course ends. ' +
          'Flag any new CV symptoms — small CV signal in ARCH trial subgroup analysis.';
    flags.push({
      id: 'anabolic_gp_shared_care_continue',
      severity: 'info',
      message:
        `Patient established on ${current.agent} (High-Tech drug, specialist-initiated). ` +
        'GP can continue prescribing under shared care — ensure monitoring is up to date (DEXA at 1–2 years; sequential antiresorptive plan in place). ' +
        sharedCareDetail,
      rationale:
        'NOGG 2024 / HSE shared-care policy (v1.22 correction): initiation requires consultant under the HSE High-Tech scheme, ' +
        'but GPs may continue once the specialist has initiated. Do not refer back to specialist for routine continuation. ' +
        'v1.28 additions: teriparatide and romosozumab specific monitoring text for GPs continuing under shared care.',
      source: SRC_NOGG,
    });
  }

  // ── v1.27 Step 7 — Raloxifene stroke-history exclusion ──
  // Surface even when raloxifene is not in the current recommendation list —
  // the flag tells the clinician (and any downstream UI) that raloxifene is
  // off the table for this patient and why.
  if (patient.strokeHistory) {
    flags.push({
      id: 'raloxifene_excluded_stroke',
      severity: 'warning',
      message:
        'RALOXIFENE EXCLUDED — history of stroke. NOGG 2024 (Evidence IIa): raloxifene is associated with a small increase in fatal-stroke risk; ' +
        'avoid in patients with prior stroke or significant stroke risk factors. ' +
        'Prefer alendronate / risedronate / zoledronate / denosumab.',
      rationale:
        'NOGG 2024 / SmPC raloxifene: raloxifene increases the risk of fatal stroke (Evidence IIa). ' +
        'The MORE trial extension and RUTH study identified an increased stroke mortality signal; raloxifene should not be initiated in patients with prior stroke or risk factors for stroke disease.',
      source: SRC_NOGG,
    });
    // Defence-in-depth filter runs at the bottom of generateTreatmentOutput
    // (where the male-licensing filter also runs) — keeps the recommendation
    // list clean even if a future branch starts pushing raloxifene.
  }

  // ── v1.21 Step 4 — Abaloparatide reimbursement note ──
  if (current?.agent === 'abaloparatide' ||
      patient.previousTreatments.some(t => t.agent === 'abaloparatide')) {
    flags.push({
      id: 'abaloparatide_not_reimbursed_ireland',
      severity: 'info',
      message:
        'Abaloparatide (Eladynos): do not recommend as a treatment option for Irish patients unless private pay is confirmed. ' +
        'NICE-approved (England/Wales/NI Aug 2024) and SMC-approved (Scotland Jul 2025) but these do not apply in Ireland; no HSE High-Tech listing. ' +
        'If private pay is not confirmed, switch to a reimbursed anabolic alternative (teriparatide via specialist).',
      rationale:
        'HSE PCRS High-Tech scheme listings as of May 2026: abaloparatide is not present (v1.21 correction). ' +
        'The previous spec incorrectly listed it as an active Irish treatment option.',
      source: SRC_NOGG,
    });
  }

  // ── v1.23 Step 9 (partial) — Sequential therapy planning flag for already-on ──
  // Fires for anyone established on denosumab / teriparatide / romosozumab / abaloparatide.
  // (The initiation-time variant downstream also covers new denosumab recs; the
  // anabolic-referral variant in generateTreatmentOutput covers new-referral patients.)
  // v1.36 A2-impl Seq.2: abaloparatide added — was missed in v1.23.
  if (current?.currentlyOn === true &&
      (current.agent === 'denosumab' ||
       current.agent === 'teriparatide' ||
       current.agent === 'romosozumab' ||
       current.agent === 'abaloparatide')) {
    flags.push({
      id: 'sequential_therapy_plan_required',
      severity: 'info',
      collapsedByDefault: true,
      summary: 'Plan sequential antiresorptive at initiation, not retrospectively. Document the follow-on plan in the referral.',
      message:
        'Plan the sequential therapy strategy at the time of initiation — not retrospectively. ' +
        'For denosumab: IV zoledronate 5 mg at 6 months after the final injection is the NOGG 2024 Strong sequential agent (alendronate is a secondary option only). ' +
        'For teriparatide / romosozumab: an antiresorptive must follow the course (prescribed 1 month before the final dose) — failure to follow on negates the BMD gain.',
      rationale:
        'NOGG 2024 Recs 14, 18–19 (Strong, v1.23): sequential therapy after denosumab is mandatory and specific to denosumab (rebound vertebral fracture risk). ' +
        'Sequential therapy after teriparatide / romosozumab is mandatory because BMD declines rapidly post-cessation without an antiresorptive. ' +
        'Document the sequential plan at initiation so it is not missed at cessation.',
      source: SRC_NOGG,
    });
  }

  // ── v1.23 Step 10 (partial) — Hip / non-vertebral efficacy note for already-on ──
  // Patient established on ibandronate or raloxifene → flag the lack of hip-fx RCT evidence.
  if (current?.currentlyOn === true && (current.agent === 'ibandronate' || current.agent === 'raloxifene')) {
    const hipPrimaryConcern = patient.age >= 75 ||
      patient.priorHipFracture ||
      (patient.dexaResults?.totalHipTScore !== undefined && patient.dexaResults?.totalHipTScore !== null && patient.dexaResults.totalHipTScore <= -2.5) ||
      (patient.dexaResults?.femoralNeckTScore !== undefined && patient.dexaResults?.femoralNeckTScore !== null && patient.dexaResults.femoralNeckTScore <= -2.5);
    flags.push({
      id: 'low_hip_efficacy_note',
      severity: hipPrimaryConcern ? 'warning' : 'info',
      message:
        `${current.agent} has NOT been shown to reduce hip fracture risk in RCTs. ` +
        (hipPrimaryConcern
          ? 'Hip fracture is a primary concern for this patient (age ≥75 OR prior hip fracture OR severe hip osteoporosis) — prefer alendronate, risedronate, zoledronate, or denosumab where possible.'
          : 'Consider alendronate, risedronate, zoledronate, or denosumab when hip-fracture reduction is the primary goal.'),
      rationale:
        'NOGG 2024 (v1.23) Section 5 evidence summary: ibandronate, raloxifene, and calcitriol have proven vertebral-fracture reduction only. ' +
        'Hip-fracture RCT evidence supports alendronate, risedronate, zoledronate, and denosumab.',
      source: SRC_NOGG,
    });
  }

  // ── Recommendation generation ──
  // v1.30 refactor — both sequencing (established treatment) and initiateTherapy
  // (new treatment) feed into the same post-recommendation flag blocks below
  // (refusal filter, male-licensing filter, raloxifene filter, soft prompts, etc.).
  // Previously the sequencing path returned early and skipped these blocks.
  let recommendations: TreatmentRecommendation[];
  if (patient.currentTreatment) {
    const seq = sequencing(patient, riskCategory, riskStratification, flags, referrals);
    recommendations = seq.recommendations;
    // sequencing() shares the same flags/referrals arrays by reference, so any
    // flags/referrals it pushed are already in the parent arrays.
  } else {
    recommendations = initiateTherapy(patient, riskCategory, flags, referrals);
  }

  // ── v1.43 Shape B — patient-preference fallback for VHR + refusesInjections ──
  // For a non-GC-driven VHR patient who is refusing all injectable therapy
  // (denosumab SC, zoledronate IV, teriparatide SC, romosozumab SC, abaloparatide SC),
  // the v1.43 Shape B suppression at bridgingTagOrNullForVHR has left
  // treatmentRecommendations empty. The hoist + specialistOptions menu still surface
  // the referral as the first action, but the patient cannot accept any of the
  // injectable options the specialist would consider. Re-emit alendronate +
  // risedronate as patient-preference fallback — NOT a clinical recommendation
  // but an alternative therapy option for GP/patient discussion alongside the
  // specialist referral. Tagged category: 'patient_preference_fallback' so UI
  // renders distinctly from primary recipe + bridging cards. Paired info flag
  // vhr_anabolic_refusal_context carries the framing for downstream reviewers.
  //
  // Scope: this fallback handles the non-GIOP path. A VHR-GIOP patient who is
  // non-GC-driven (e.g. medium-dose GC <3mo but T ≤−3.5 driving VHR-3) AND
  // refusing injections would not currently reach this code because giop()
  // returns early at line ~759. Documented as known edge case; out of scope
  // for v1.43 — the common live-tested case is TC22's non-GIOP profile.
  applyPatientPreferenceFallbackIfRefuses(patient, riskCategory, recommendations, flags);

  // ── v1.36 Fix 3 (§6.2): pause-eligible suppresses current drug from recs ──
  // When bp_holiday_appropriate has fired, the patient is moving from active to paused —
  // the current drug should not appear in the recommendation list. Defence-in-depth filter:
  // the current sequencing code path appears NOT to push the current drug to recs for
  // simple-continue patients, but this guard locks the invariant against future regressions
  // and any path that does push (e.g. very-high-risk denosumab-switch branch only fires on
  // bp_holiday_not_appropriate, but other future branches could).
  if (
    flags.some(f => f.id === 'bp_holiday_appropriate') &&
    patient.currentTreatment &&
    isBisphosphonate(patient.currentTreatment.agent)
  ) {
    const pausingAgent = patient.currentTreatment.agent;
    recommendations = recommendations.filter(r => r.agent !== pausingAgent);
  }

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

  // ── v1.27 Step 7 — raloxifene stroke-history filter (defence-in-depth) ──
  // Strips any active raloxifene recommendation when the patient has a stroke
  // history. The exclusion flag was already pushed upstream.
  if (patient.strokeHistory) {
    recommendations = recommendations.filter(r => r.agent !== 'raloxifene');
  }

  // ── v1.23 Step 1 — Male patient drug licensing filter ──
  // Romosozumab, ibandronate (oral & IV), HRT, raloxifene, and abaloparatide are
  // not licensed for use in men. Filter post-recommendation as defence-in-depth:
  // no current pathway pushes these for males, but a regression in any upstream
  // branch must not slip through. Teriparatide is the only anabolic licensed
  // for men — referral pathway must remain available for male VHR patients.
  if (patient.sex === 'male') {
    const stripped: TreatmentAgent[] = [];
    const survivors = recommendations.filter(r => {
      if (MALE_NOT_LICENSED.has(r.agent)) {
        stripped.push(r.agent);
        return false;
      }
      return true;
    });
    if (stripped.length > 0) {
      recommendations = survivors;
      flags.push({
        id: 'male_drug_licensing_filter',
        severity: 'warning',
        message:
          `The following drug(s) were filtered from the recommendation list because they are not licensed for use in men: ${stripped.join(', ')}. ` +
          'Romosozumab, ibandronate (oral and IV), HRT, raloxifene, and abaloparatide are not licensed for men in Ireland. ' +
          'Teriparatide is the only anabolic drug licensed for use in men — refer to secondary care if anabolic therapy is indicated.',
        rationale:
          'NOGG 2024 / SmPC / HSE BVM policy (v1.23): the listed drugs have no male indication. Alendronate, risedronate, zoledronate, ' +
          'and denosumab are licensed for male osteoporosis. Teriparatide is the only anabolic available for men — specialist initiation required.',
        source: SRC_NOGG,
      });
    }
    // Surface a clarification flag if male patient is recorded as currently on any of these drugs.
    // Note: patient.currentTreatment may have been narrowed to null by an earlier
    // early-return path; cast via a fresh local to defeat narrowing.
    const currentForMaleCheck = patient.currentTreatment as TreatmentHistory | null;
    const onUnlicensed: TreatmentAgent[] = [];
    if (currentForMaleCheck && MALE_NOT_LICENSED.has(currentForMaleCheck.agent)) {
      onUnlicensed.push(currentForMaleCheck.agent);
    }
    for (const t of patient.previousTreatments) {
      if (t.currentlyOn && MALE_NOT_LICENSED.has(t.agent)) onUnlicensed.push(t.agent);
    }
    if (onUnlicensed.length > 0) {
      flags.push({
        id: 'male_on_unlicensed_drug',
        severity: 'warning',
        message:
          `Male patient recorded as currently on ${onUnlicensed.join(', ')} — this drug is not licensed for use in men in Ireland. ` +
          'Review the prescribing decision; switch to a licensed agent (alendronate, risedronate, zoledronate, denosumab, or teriparatide via specialist).',
        rationale:
          'Drug licensing by sex (v1.23): SmPC / HSE BVM. Off-label prescribing in men carries higher medico-legal and adherence risk; ' +
          'a licensed alternative is available in every category.',
        source: SRC_NOGG,
      });
    }
  }

  // ── v1.23 Step 9 (initiation-time) — Sequential therapy planning flag ──
  // When a NEW denosumab recommendation is being pushed (i.e. via initiateTherapy),
  // surface the sequential planning note immediately. Established-on-drug
  // patients already had this flag pushed upstream of the sequencing branch.
  if (recommendations.some(r => r.agent === 'denosumab') &&
      !flags.some(f => f.id === 'sequential_therapy_plan_required')) {
    flags.push({
      id: 'sequential_therapy_plan_required',
      severity: 'info',
      collapsedByDefault: true,
      summary: 'Plan sequential antiresorptive at initiation, not retrospectively. Document the follow-on plan in the referral.',
      message:
        'Plan the sequential therapy strategy at the time of initiation — not retrospectively. ' +
        'For denosumab: IV zoledronate 5 mg at 6 months after the final injection is the NOGG 2024 Strong sequential agent (alendronate is a secondary option only). ' +
        'For teriparatide / romosozumab: an antiresorptive must follow the course (prescribed 1 month before the final dose) — failure to follow on negates the BMD gain.',
      rationale:
        'NOGG 2024 Recs 14, 18–19 (Strong, v1.23): sequential therapy after denosumab is mandatory and specific to denosumab (rebound vertebral fracture risk). ' +
        'Document the sequential plan at initiation so it is not missed at cessation.',
      source: SRC_NOGG,
    });
  }

  // ── v1.36 A2-impl Seq.2 — Third push gate: new-anabolic-referral patient ──
  // The existing two gates above cover (i) already-on denosumab/teri/romo/abalo and (ii)
  // denosumab in recommendations. For a new-anabolic-REFERRAL patient (e.g. VHR woman being
  // referred for romosozumab consideration, not yet on any antiresorptive), neither gate
  // fires because the anabolic is not in `recommendations` (it's surfaced via referrals).
  // This gate closes that gap. Dedup with the earlier pushes.
  if (referralSignals.anabolicReferralFired &&
      !flags.some(f => f.id === 'sequential_therapy_plan_required')) {
    flags.push({
      id: 'sequential_therapy_plan_required',
      severity: 'info',
      collapsedByDefault: true,
      summary: 'Plan sequential antiresorptive at initiation, not retrospectively. Document the follow-on plan in the referral.',
      message:
        'Plan the sequential therapy strategy at the time of initiation — not retrospectively. ' +
        'For teriparatide / romosozumab / abaloparatide being considered at specialist review: an antiresorptive must follow the course ' +
        '(prescribed 1 month before the final anabolic dose to avoid a gap). Document the follow-on plan in the referral letter so the specialist sees it at initiation.',
      rationale:
        'NOGG 2024 Rec 14 (Strong): sequential antiresorptive after anabolic is mandatory — BMD gains are lost rapidly without it. ' +
        'The plan must accompany the referral (specialist initiates the anabolic; GP continues the follow-on antiresorptive).',
      source: SRC_NOGG,
    });
  }

  // ── v1.36 A2-impl Seq.5 — Raloxifene as follow-on sequential after anabolic (NOGG Conditional) ──
  // Postmenopausal female where BP is contraindicated AND denosumab is unsuitable. Raloxifene
  // is vertebral-only (no hip fracture efficacy) and is itself contraindicated in stroke/VTE
  // history, so surface only when raloxifene would actually be prescribable.
  {
    const seqContext =
      referralSignals.anabolicReferralFired ||
      patient.completedAnabolicCourse ||
      (patient.currentTreatment?.currentlyOn === true &&
        (patient.currentTreatment.agent === 'teriparatide' ||
         patient.currentTreatment.agent === 'romosozumab' ||
         patient.currentTreatment.agent === 'abaloparatide'));

    const postmenopausalFemale = isPostmenopausalFemale(patient);

    const egfrForRalox = resolveEGFR(patient);
    const bpContraindicated =
      patient.oesophagealDiseaseHistory ||
      hasAFFHistory(patient) ||
      (egfrForRalox !== null && egfrForRalox <= RENAL_LIMITS.alendronate.ci) ||
      hasGIIntoleranceToBothOralAndIVBP(patient);

    const denosumabUnsuitable =
      patient.refusesInjections ||
      (egfrForRalox !== null && egfrForRalox < RENAL_LIMITS.denosumab.extremeRiskBelow);

    const raloxifeneOwnEligible =
      !patient.strokeHistory && !patient.vteHistory;

    if (seqContext &&
        postmenopausalFemale &&
        bpContraindicated &&
        denosumabUnsuitable &&
        raloxifeneOwnEligible) {
      flags.push({
        id: 'raloxifene_anabolic_follow_on_option',
        severity: 'info',
        message:
          'Raloxifene is an option as follow-on sequential therapy after an anabolic — vertebral-only benefit, no hip fracture efficacy. ' +
          'NOGG 2024 Conditional. Contraindicated with VTE history.',
        rationale:
          'NOGG 2024 (Conditional): in postmenopausal women where both bisphosphonate (oral and IV) and denosumab are not options, ' +
          'raloxifene may be considered as the follow-on antiresorptive after an anabolic course. Evidence is restricted to ' +
          'vertebral fracture reduction — no hip fracture efficacy demonstrated. Contraindications: VTE history, stroke history, ' +
          'oestrogen-sensitive malignancy. Not licensed in men.',
        source: SRC_NOGG,
      });
    }
  }

  // ── v1.23 Step 10 (initiation-time) — Hip / non-vertebral efficacy note ──
  // Fires when a NEW ibandronate or raloxifene recommendation is being pushed.
  // The established-on variant was already pushed upstream.
  {
    const hipPrimaryConcern = patient.age >= 75 ||
      patient.priorHipFracture ||
      (patient.dexaResults?.totalHipTScore !== undefined && patient.dexaResults?.totalHipTScore !== null && patient.dexaResults.totalHipTScore <= -2.5) ||
      (patient.dexaResults?.femoralNeckTScore !== undefined && patient.dexaResults?.femoralNeckTScore !== null && patient.dexaResults.femoralNeckTScore <= -2.5);
    const lowHipEfficacyAgents: TreatmentAgent[] = ['ibandronate', 'raloxifene'];
    const flaggedFromRecs = recommendations
      .filter(r => lowHipEfficacyAgents.includes(r.agent))
      .map(r => r.agent);
    if (flaggedFromRecs.length > 0 && !flags.some(f => f.id === 'low_hip_efficacy_note')) {
      flags.push({
        id: 'low_hip_efficacy_note',
        severity: hipPrimaryConcern ? 'warning' : 'info',
        message:
          `${Array.from(new Set(flaggedFromRecs)).join(', ')} has/have NOT been shown to reduce hip fracture risk in RCTs. ` +
          (hipPrimaryConcern
            ? 'Hip fracture is a primary concern for this patient (age ≥75 OR prior hip fracture OR severe hip osteoporosis) — prefer alendronate, risedronate, zoledronate, or denosumab where possible.'
            : 'Consider alendronate, risedronate, zoledronate, or denosumab when hip-fracture reduction is the primary goal.'),
        rationale:
          'NOGG 2024 (v1.23) Section 5 evidence summary: ibandronate, raloxifene, and calcitriol have proven vertebral-fracture reduction only. ' +
          'Hip-fracture RCT evidence supports alendronate, risedronate, zoledronate, and denosumab.',
        source: SRC_NOGG,
      });
    }
  }

  // ── v1.30 — Denosumab second-line soft prompt ──
  // Informational nudge (NOT a warning, NOT a blocker) that surfaces when the
  // engine has produced a denosumab recommendation but the patient does NOT
  // have any of the four bisphosphonate contraindications that legitimately
  // route to denosumab as first-line. Spec requirements:
  //   * info severity (not warning / not urgent)
  //   * fires alongside the denosumab recommendation, not instead of it
  //   * does NOT fire when ANY of: eGFR <35; AFF history; oesophageal disease;
  //     documented GI intolerance to BOTH oral AND IV bisphosphonate
  //   * does NOT fire when the patient is already established on denosumab
  //     (continuation scenario — the prescribing decision has been made)
  {
    const denoInRecs = recommendations.some(r => r.agent === 'denosumab');
    const alreadyOnDenosumab =
      patient.currentTreatment?.agent === 'denosumab' &&
      patient.currentTreatment.currentlyOn === true;
    if (denoInRecs && !alreadyOnDenosumab) {
      const egfr = resolveEGFR(patient);
      const renalCI = egfr !== null && egfr <= RENAL_LIMITS.alendronate.ci;
      const affCI = hasAFFHistory(patient);
      const oesophCI = patient.oesophagealDiseaseHistory === true;
      const giBothCI = hasGIIntoleranceToBothOralAndIVBP(patient);
      const anyCI = renalCI || affCI || oesophCI || giBothCI;
      if (!anyCI) {
        flags.push({
          id: 'denosumab_second_line_soft_prompt',
          severity: 'info',
          message:
            'Denosumab is second-line for this patient on cost-effectiveness grounds — bisphosphonate is the recommended first-line treatment per NOGG 2024. ' +
            'If prescribing denosumab first-line, consider documenting your clinical rationale in the patient record.',
          rationale:
            'NOGG 2024 Strong (v1.30): bisphosphonate is preferred first-line as the most cost-effective antiresorptive; denosumab is the alternative when bisphosphonate is contraindicated. ' +
            'This soft prompt surfaces only when denosumab is recommended in the absence of the four standard bisphosphonate contraindications (eGFR <35, AFF history, oesophageal disease, GI intolerance to BOTH oral and IV bisphosphonate). ' +
            'It is informational — it does not block the recommendation. A documented clinical rationale (e.g. adherence, patient preference, formulation issues) supports the prescribing decision.',
          source: SRC_NOGG,
        });
      }
    }
  }

  return { recommendations, flags, referrals, supplements, specialistOptions };
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
          'HRT first-line option (postmenopausal ≤60, high risk, no VTE/breast Ca). ' +
          // v1.27 Step 6 — transdermal preferred for VTE only; explicit breast-cancer-route clarification.
          'Transdermal preferred — LOWER VTE risk than oral oestrogen. ' +
          'Cardiovascular: HRT does NOT increase cardiovascular disease risk when started in women aged <60 years (NOGG 2024). ' +
          'Breast cancer counselling (NOGG 2024): systemic HRT is associated with increased breast cancer risk irrespective of oestrogen type, ' +
          'progestogen type, or route of delivery. Transdermal route does NOT reduce breast cancer risk compared to oral — discuss this with the patient.',
        rationale:
          'NOGG 2024 Section 5.2 update: HRT elevated to first-line in women ≤60 alongside bisphosphonates. ' +
          'HRT also addresses menopausal symptoms. Review at 5 years. ' +
          'v1.27 corrections: the transdermal preference is for VTE risk only — breast cancer risk is increased with systemic HRT ' +
          'regardless of route. Do not imply transdermal is safer for breast cancer.',
        source: SRC_NOGG,
      });
    }
  }

  // ── Previous treatment contraindication checks ──

  // v1.19 Step 5 — Oesophageal disease contraindication. Step-1 check before
  // any drug selection (Section 5.2). All oral bisphosphonates permanently
  // contraindicated. IV zoledronate from outset; if eGFR <35, denosumab.
  if (patient.oesophagealDiseaseHistory) {
    flags.push({
      id: 'oesophageal_disease_oral_bp_ci',
      severity: 'warning',
      message:
        'Oral bisphosphonates contraindicated — history of oesophageal disease (stricture / achalasia / dysmotility). ' +
        'IV zoledronate first-line. If eGFR <35: denosumab. (NOGG 2024)',
      rationale:
        'NOGG 2024 Section 5.2 (v1.19): oesophageal abnormalities delaying gastric emptying or causing strictures are a ' +
        'permanent contraindication to all oral bisphosphonates (alendronate, risedronate, oral ibandronate). The risk of ' +
        'oesophageal ulceration or stricture worsening outweighs any benefit. IV zoledronate has no GI exposure and is ' +
        'the preferred option; denosumab when zoledronate is not feasible (eGFR <35).',
      source: SRC_NOGG,
    });
    if (canUse('zoledronate', egfr)) {
      recs.push(withBPInitiationContext(zoledronate(), patient));
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
    return recs;
  }

  // v1.19 Step 4 — Post-hip-fracture: IV zoledronate first-line (NOGG 2024
  // Strong; HORIZON-Recurrent Fractures trial — fracture AND mortality
  // reduction). Fires regardless of FRAX category. Gated on a recent hip
  // fracture (priorHipFracture + recentFractureWithin2Years), matching the
  // HORIZON-RF enrolment population (hip fx within 90 days). eGFR <35
  // contraindicates zoledronate — fall back to denosumab in that case.
  if (
    patient.priorHipFracture &&
    patient.recentFractureWithin2Years &&
    !hasPreviousGIIntoleranceToBP(patient)
  ) {
    flags.push({
      id: 'post_hip_fracture_zoledronate_first_line',
      severity: 'info',
      message:
        'Recent hip fracture — IV zoledronate 5 mg first-line. NOGG 2024 (Strong, HORIZON-Recurrent Fractures trial): ' +
        'IV zoledronate after hip fracture reduces fracture incidence AND all-cause mortality. ' +
        'Do not delay for renal function concerns unless eGFR <35.',
      rationale:
        'Section 5.1 (v1.19): post-hip-fracture patients receive IV zoledronate as first-line bone protection regardless of FRAX category. ' +
        'HORIZON-Recurrent Fractures (Lyles et al. NEJM 2007) enrolled patients within 90 days post-hip-fracture and demonstrated ' +
        '35% reduction in clinical fractures and 28% reduction in all-cause mortality vs placebo.',
      source: SRC_NOGG,
    });
    // Match the alendronate-first-line renal gate (>35, strict) so the
    // boundary eGFR=35 case routes through the standard renal cascade to
    // denosumab rather than firing a zoledronate recommendation. Spec
    // wording is "Do not delay for renal concerns unless eGFR <35"; the
    // strict-greater gate is the tool's accepted reading of "<35".
    if (canUse('zoledronate', egfr) && (egfr === null || egfr > RENAL_LIMITS.alendronate.ci)) {
      recs.push(withBPInitiationContext({
        ...zoledronate(),
        priority: 'first-line',
        rationale:
          'Post-hip-fracture first-line (NOGG 2024 Strong; HORIZON-RF — fracture AND mortality reduction). ' +
          'Do not delay for renal concerns unless eGFR <35.',
      }, patient));
      return recs;
    }
    // eGFR ≤35 — fall through to AFF / alendronate-first / denosumab cascade,
    // but the post-hip-fx info flag above stays visible so the rationale is
    // still surfaced for the clinician.
  }

  // AFF history: permanent ban on ALL bisphosphonates — go directly to denosumab
  if (hasAFFHistory(patient)) {
    addVitDBlock(patient, flags);
    recs.push(denosumab(egfr));
    referrals.push({
      specialty: 'metabolic_bone',
      reason: 'AFF history — teriparatide biosimilar (HSE BVM policy March 2023) is the preferred specialist-initiated alternative to denosumab if antiresorptive is not tolerated.',
      urgency: 'soon',
    });
    return recs;
  }

  // ADT (men on androgen deprivation therapy): v1.14 — denosumab-first designation removed.
  // NOGG 2024 makes bisphosphonate and denosumab equivalent options; no Irish guideline supports
  // denosumab-first for ADT. Falls through to the standard NOGG 2024 cost-effectiveness order
  // (bisphosphonate first-line; denosumab alternative when BP contraindicated). Zoledronate is the
  // preferred BP within the class on BMD evidence — surfaced as an info flag in adtFlags() rather
  // than reordering the recommendation list, because alendronate remains first-line and is
  // acceptable when zoledronate is not feasible. (v1.17: "HSE MMP cascade" wording removed —
  // no HSE MMP osteoporosis prescribing document exists.)

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
        'IV zoledronate has no GI exposure and is appropriate after oral bisphosphonate GI intolerance (NOGG 2024 Rec 13).',
      source: SRC_HSE,
    });
    if (canUse('zoledronate', egfr)) {
      recs.push(withBPInitiationContext(zoledronate(), patient));
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
      const tagged = bridgingTagOrNullForVHR({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection. Equivalent first-line with risedronate per NOGG 2024 Rec 12.',
        priority: 'first-line',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    if (canUse('risedronate', egfr)) {
      const tagged = bridgingTagOrNullForVHR({
        ...risedronate(),
        rationale:
          'Equivalent first-line alongside alendronate (NOGG 2024 Rec 12, Strong) — add alongside HRT where T-score remains ≤−2.5 despite HRT.',
        priority: 'first-line',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    return recs;
  }

  // v1.33 — Alendronate AND risedronate are equivalent first-line oral
  // bisphosphonates per NOGG 2024 Rec 12 / Section 6 Rec 2 (Strong). Push both.
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
    {
      const tagged = bridgingTagOrNullForVHR(alendronate(), riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    if (canUse('risedronate', egfr)) {
      const tagged = bridgingTagOrNullForVHR(risedronate(), riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
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
        `eGFR ${egfr} — all bisphosphonates contraindicated (<${RENAL_LIMITS.alendronate.ci}). Use denosumab.`,
      rationale:
        'Bisphosphonates accumulate in severe renal impairment. ' +
        'Per spec table: all BPs contraindicated at eGFR <35 (oral and IV). ' +
        'Denosumab is not renally cleared and is the preferred antiresorptive in this band.',
      source: SRC_HSE,
    });

    // Stage 5 CKD (<15 ml/min) — extreme hypocalcaemia risk; specialist-only.
    const isStage5 = egfr < RENAL_LIMITS.denosumab.extremeRiskBelow;

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
        reason: isStage5
          ? `Stage 5 CKD (eGFR ${egfr} ml/min, <15) with osteoporosis — extreme hypocalcaemia risk; URGENT specialist input before any antiresorptive.`
          : `Severe renal impairment (eGFR ${egfr} ml/min) with osteoporosis — specialist guidance on safe bone protection.`,
        urgency: isStage5 ? 'urgent' : 'routine',
      });
    }

    if (isStage5) {
      flags.push({
        id: 'severe_ckd_specialist_only',
        severity: 'urgent',
        message:
          `eGFR ${egfr} (Stage 5 CKD, <15 ml/min) — extreme hypocalcaemia risk with denosumab. Specialist initiation only. Bisphosphonates remain contraindicated. Refer urgently.`,
        rationale:
          'Stage 5 CKD (eGFR <15 ml/min, non-dialysis) carries an extreme risk of severe symptomatic hypocalcaemia following denosumab. ' +
          'Patients in this band should not be initiated on denosumab (or any antiresorptive) without specialist nephrology / metabolic bone input. ' +
          'Active vitamin D, calcium repletion, and individualised dosing decisions are required. ' +
          'Bisphosphonates are contraindicated in this band per SmPCs and clinical convention.',
        source: SRC_NICE,
      });
    }

    addVitDBlock(patient, flags);
    // At Stage 5, defer drug recommendation pending specialist input — surface only the flags.
    if (!isStage5) {
      recs.push(denosumab(egfr));
    }
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
  // v1.33 — push both equivalent first-line oral BPs.
  {
    const tagged = bridgingTagOrNullForVHR(alendronate(), riskCategory, patient);
    if (tagged) recs.push(withBPInitiationContext(tagged, patient));
  }
  {
    const tagged = bridgingTagOrNullForVHR(risedronate(), riskCategory, patient);
    if (tagged) recs.push(withBPInitiationContext(tagged, patient));
  }
  return recs;
}

// ─── Bisphosphonate sequencing (patient on existing treatment) ────────────

function sequencing(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements' | 'specialistOptions'> {
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
      const tagged = bridgingTagOrNullForVHR({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection. Equivalent first-line with risedronate per NOGG 2024 Rec 12.',
        priority: 'first-line',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    if (canUse('risedronate', egfr)) {
      const tagged = bridgingTagOrNullForVHR({
        ...risedronate(),
        rationale:
          'Equivalent first-line alongside alendronate (NOGG 2024 Rec 12, Strong) — add alongside HRT where T-score remains ≤−2.5 despite HRT.',
        priority: 'first-line',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    return { recommendations: recs, flags, referrals };
  }

  // ── GI intolerance ──
  if (current.reasonStopped === 'gi_intolerance') {
    return { ...giSwitch(patient, current.agent, egfr, flags), referrals };
  }

  // ── On-treatment fracture pathway (NOGG 2024 Section 6.3, Strong) — v1.13 Step 10 ──
  // A fragility fracture during antiresorptive therapy is NOT auto-classified as failure.
  // Mandatory pathway:
  //   1. Adherence review — poor adherence = <80% of prescribed treatment taken correctly
  //   2. Investigate secondary causes — repeat Tier 2 bloods minimum
  //   3. Failure only confirmed if adherence ≥80% AND secondary causes excluded
  // If during the first 5y oral / 3y IV course, the fracture is also an extension indication
  // (Section 7 Rec 1–2). Switch class only on confirmed failure.
  const explicitTreatmentFailure = current.reasonStopped === 'treatment_failure';
  // v1.14 — broaden trigger: a fracture-within-24-months on a patient who has been on treatment
  // for ≥12 months is the spec-aligned on-treatment fracture signal (NOGG 2024 Section 6.3 Rec 5).
  // Retain the multi-fracture heuristic as a secondary trigger.
  const possibleOnTxFracture =
    current.currentlyOn &&
    current.durationMonths >= 12 &&
    (patient.recentFractureWithin2Years === true || patient.numberOfPriorFractures >= 2);

  if (possibleOnTxFracture && !explicitTreatmentFailure) {
    // v1.19 — drug-specific adherence check per spec Step 7.
    const adherenceCheck = (() => {
      switch (current.agent) {
        case 'alendronate':
        case 'risedronate':
          return `${current.agent}: confirm weekly fasting dose, full glass of water, remain upright ≥30 min, no food/drink for 30 min. <80% of doses taken correctly = poor adherence.`;
        case 'ibandronate':
          return 'Ibandronate: confirm monthly (oral) or quarterly (IV) doses taken / administered on schedule. <80% adherence = poor adherence.';
        case 'zoledronate':
          return 'Zoledronate: confirm annual infusion attended each year. A missed annual infusion = poor adherence.';
        case 'denosumab':
          return 'Denosumab: confirm 6-monthly injection not missed (>6 months since last dose = effectively poor adherence and rebound risk — §8.1).';
        default:
          return 'Confirm patient has taken ≥80% of prescribed doses correctly.';
      }
    })();
    flags.push({
      id: 'on_treatment_fracture_pathway',
      severity: 'warning',
      message:
        `Fragility fracture on ${current.agent} (${Math.round(current.durationMonths / 12)}y duration). ` +
        `Mandatory pathway: (1) review adherence — poor adherence is <80% of prescribed treatment taken correctly. ${adherenceCheck} ` +
        '(2) investigate secondary causes — repeat Tier 2 bloods minimum, consider Tier 3 if not previously done; ' +
        '(3) only classify as treatment failure if adherence ≥80% AND secondary causes excluded. ' +
        'If within first 5y oral / 3y IV: this fracture is ALSO an extension indication (NOGG Section 7 Rec 1–2 Strong) — ' +
        'plan for the extended course (10y oral / 6y IV) once adherence is verified.',
      rationale:
        'NOGG 2024 Section 6.3 Rec 5 (Strong): a fracture during antiresorptive therapy does not automatically equal ' +
        'treatment failure. Adherence and secondary causes must be reviewed first. If adherence is adequate and no ' +
        'secondary cause is identified, the fracture confirms failure → switch class. If adherence is poor: correct, ' +
        'address technique, ensure Vit D replete, and extend the planned course.',
      source: SRC_NOGG,
    });
    // Do NOT auto-switch class. Engine surfaces guidance only.

    // v1.36 Fix 4 (§6.2 callout + §6.3): when adherence is adequate AND the patient is within
    // the first 5y oral / 3y IV course, the on-treatment fracture is an extension indication —
    // emit a structured planned-duration-extension flag (separate from the narrative flag) so
    // the new 10y/6y target appears as a filterable output, not just narrative.
    const isIVCurrent = current.agent === 'zoledronate';
    const firstCourseMonths = isIVCurrent ? 36 : 60; // 3y IV, 5y oral
    const extendedYears = isIVCurrent ? 6 : 10;
    if (
      current.adherenceAdequate === true &&
      current.durationMonths < firstCourseMonths
    ) {
      flags.push({
        id: 'bp_duration_extension_indication',
        severity: 'info',
        message:
          `Planned duration extended to ${extendedYears} years on ${current.agent} ` +
          `(currently ${Math.round(current.durationMonths / 12)}y, within the first ${isIVCurrent ? 3 : 5}y course). ` +
          'On-treatment fragility fracture with adherence ≥80% confirmed — extension indication per NOGG 2024 ' +
          'Section 7 Rec 1–2 (Strong). Treatment not changed; review at the extended-course endpoint.',
        rationale:
          'NOGG 2024 §6.2 callout + §6.3 Rec 5: a fracture during the first 5y oral / 3y IV course, with adherence ' +
          'positively confirmed at ≥80%, is an extension indication. The planned duration shifts to 10y oral / 6y IV ' +
          '(rather than the standard 5y/3y baseline) — surfaced as a structured output so the new target is visible ' +
          'in monitoring, not buried in narrative.',
        source: SRC_NOGG,
      });
    }

    // v1.36 (TC89) — push current drug to recs when on-treatment-fracture path fires with
    // adherence confirmed ≥80%. Per spec §6.3 Rec 5: treatment is NOT changed (no failure
    // route); the patient continues the current agent on the extended planned duration.
    // Without this push, recs is empty for the sequencing path's on-treatment-fracture
    // branch → treatmentRecommended is false, which contradicts "patient remains on
    // treatment, extended planned course". Symmetric to TC88's bp_holiday_not_appropriate
    // continue-drug-push. Skipped when adherenceAdequate is false (poor adherence routes
    // to correction path) or null (assessment pending).
    if (current.adherenceAdequate === true && isBisphosphonate(current.agent)) {
      const continueRecipe = (() => {
        switch (current.agent) {
          case 'alendronate': return alendronate();
          case 'risedronate': return risedronate();
          case 'ibandronate': return ibandronate();
          case 'zoledronate': return zoledronate();
          default: return null;
        }
      })();
      if (continueRecipe && !recs.some(r => r.agent === current.agent)) {
        recs.push(continueRecipe);
      }
    }
  }

  if (explicitTreatmentFailure) {
    flags.push({
      id: 'treatment_failure',
      severity: 'warning',
      message:
        'Treatment failure confirmed (clinician-flagged). Switch class.',
      rationale:
        'Adherence ≥80% confirmed AND secondary causes excluded — proceed to switch class per NOGG 2024 Section 6.3 / 7.4.',
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
        recs.push(withBPInitiationContext(zoledronate(), patient));
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
  const isTreatmentFailure = explicitTreatmentFailure;

  // ── Currently on denosumab (stable — no treatment failure): show continuation + transition plan ──
  // denosumabReboundFlags() has already added the cessation plan flag explaining transition options.
  if (current.agent === 'denosumab' && current.currentlyOn && !isTreatmentFailure) {
    addVitDBlock(patient, flags);
    recs.push(denosumab(egfr));
    return { recommendations: recs, flags, referrals };
  }

  // ── Bisphosphonate reassessment (NOGG 2024 Section 7) ──
  // Routine drug holidays are NOT supported by evidence (Evidence IIa) — individualised reassessment only.
  if (current.currentlyOn && isBisphosphonate(current.agent)) {
    const isIV = current.agent === 'zoledronate';
    const holidayYear = isIV ? BP_HOLIDAY.ivZoledronate.reviewAt : BP_HOLIDAY.oral.reviewAt;
    const individualBasisYear = isIV ? BP_INDIVIDUAL_BASIS_AFTER_YEARS.iv : BP_INDIVIDUAL_BASIS_AFTER_YEARS.oral;

    // v1.13 Step 13 — after 10 years (oral) / 6 years (IV): individual basis Conditional flag.
    if (current.durationMonths >= individualBasisYear * 12) {
      flags.push({
        id: 'bp_individual_basis_after_long_course',
        severity: 'info',
        message:
          `Bisphosphonate ${Math.round(current.durationMonths / 12)} years (${current.agent}). ` +
          `After ${individualBasisYear} years of ${isIV ? 'IV zoledronate' : 'oral bisphosphonate'}, ongoing management must be decided on an individual basis in careful consultation with the patient. Specialist advice should be sought.`,
        rationale:
          'NOGG 2024 Section 7 Rec 8 (Conditional): evidence base for continuing oral bisphosphonate beyond 10 years or IV zoledronate beyond 6 years is limited. Decisions should be individualised after specialist input.',
        source: SRC_NOGG,
      });
    }

    if (current.durationMonths >= holidayYear * 12) {
      const pauseDecision = shouldTakeBPHoliday(patient, riskCategory, riskStratification);
      const maleCaveat =
        patient.sex === 'male'
          ? ' Note: NOGG offset-kinetics evidence (alendronate 2y, risedronate/ibandronate 18m, zoledronate 3y) is derived from postmenopausal-women extension studies — applying the same intervals in men is by extrapolation. Each case must be judged individually.'
          : '';

      // v1.36 Fix 2 (§6.2 + §6.3) — fracture during current course but adherence not yet
      // assessed. Continuation decision is blocked until the clinician records adherence;
      // engine emits a structured prompt rather than silently defaulting either way.
      if (pauseDecision.needsAdherenceAssessment) {
        flags.push({
          id: 'adherence_assessment_required',
          severity: 'warning',
          message:
            `Fracture during current course of ${current.agent} but adherence not yet assessed. ` +
            'Record adherence (≥80% threshold per §6.3 Rec 5) before applying the §6.2 continuation criteria — ' +
            'adequate adherence supports extension to 10y oral / 6y IV; poor adherence routes to the correction pathway, not extension.',
          rationale:
            'NOGG 2024 §6.2 + §6.3 Rec 5 (Strong): "fracture during treatment with adequate adherence" is an extension ' +
            'indication, but only when adherence has been positively confirmed at ≥80%. The continuation decision must not ' +
            'fire silently when adherence is unknown — the clinician needs to assess and record it first.',
          source: SRC_NOGG,
        });
      }

      if (pauseDecision.takeHoliday) {
        // v1.13 Step 8 — drug-specific reassessment interval after the pause
        const reassessMonths = PAUSE_REASSESSMENT_INTERVAL_MONTHS[
          current.agent as 'alendronate' | 'risedronate' | 'ibandronate' | 'zoledronate'
        ];
        // v1.14 — render months exactly when not whole-year, otherwise present as "N years (N months)"
        const reassessText =
          reassessMonths % 12 === 0
            ? `${reassessMonths / 12} years (${reassessMonths} months)`
            : `${reassessMonths} months`;
        flags.push({
          id: 'bp_holiday_appropriate',
          severity: 'info',
          message:
            `${holidayYear}-year bisphosphonate reassessment: fracture risk appears low/intermediate ` +
            `(${pauseDecision.reasons.join('; ')}). ` +
            'An individualised treatment pause may be considered per NOGG 2024 Section 7 Rec 6 (Strong). ' +
            `Reassess with FRAX + femoral neck BMD in ${reassessText} for ${current.agent} ` +
            '(drug-specific offset kinetics; NOGG 2024 Section 7 Rec 4 / §6.4). ' +
            'If a new fracture occurs during the pause, FRAX reassessment and restart is triggered immediately ' +
            'regardless of the above interval (NOGG Section 7 Rec 3 / §6.5). ' +
            'Independent restart triggers per §6.6 (NOGG Rec 7, Conditional): consider restart if bone turnover markers ' +
            '(CTX, P1NP) rise on monitoring OR BMD decreases on repeat DEXA — no definitive thresholds, clinical judgement applies. ' +
            'This is NOT a routine recommendation — there is no standard policy for all patients.' +
            maleCaveat,
          rationale:
            'NOGG 2024 Section 7 Rec 6 (Strong, §6.2): pause considered only when continuation criteria are NOT met — ' +
            'specifically when age at start <70, no prior hip/vertebral fracture, no fracture during current course with adequate adherence, ' +
            'no ongoing GC ≥7.5 mg/day, no hip T-score ≤−2.5, and FRAX adjusted below age-specific intervention threshold. ' +
            'Rec 4 (Strong, §6.4): drug-specific reassessment intervals — risedronate/ibandronate 18 months, alendronate 2 years, zoledronate 3 years. ' +
            'Rec 3 (Strong, §6.5): a new fragility fracture during pause is an absolute indication for immediate FRAX reassessment and restart. ' +
            'Rec 7 (Conditional, §6.6): rising bone turnover markers or BMD loss on repeat DEXA are additional restart triggers. ' +
            'Routine drug holidays remain unsupported (Evidence IIa).',
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

        // v1.36 (TC88) — Symmetric to A1 Fix 3 (which strips current drug on pause):
        // on continue, push the current drug to recs so treatmentRecommended === true and
        // downstream output gating (Tier 1/2 bloods, monitoring schedule etc.) fires
        // appropriately for an active-treatment patient. Pushes the basic recipe (without
        // withBPInitiationContext) — the initiation-context wrapper carries planned-duration
        // and dental-at-initiation text that's inappropriate for a continuing patient.
        // Skipped if a class-switch recipe already populated recs (e.g. VHR→denosumab above).
        if (recs.length === 0 && isBisphosphonate(current.agent)) {
          const continueRecipe = (() => {
            switch (current.agent) {
              case 'alendronate': return alendronate();
              case 'risedronate': return risedronate();
              case 'ibandronate': return ibandronate();
              case 'zoledronate': return zoledronate();
              default: return null;
            }
          })();
          if (continueRecipe) {
            recs.push(continueRecipe);
          }
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
  riskStratification: RiskStratification,
): { takeHoliday: boolean; reasons: string[]; needsAdherenceAssessment: boolean } {
  const continueReasons: string[] = [];
  let needsAdherenceAssessment = false;
  const current = patient.currentTreatment;

  // v1.13 Step 7: continuation criteria from NOGG 2024 Section 7 Rec 1–2 + Rec 6.
  // v1.36 Fix 1 (§6.2): use age AT START of treatment, not current age. A patient who started
  // at 67 and is now 72 was previously locked into "continue" — incorrect per spec. Fallback
  // derivation when ageAtStart is undefined: floor(currentAge - durationMonths/12).
  const ageAtStart = current
    ? (current.ageAtStart ?? Math.floor(patient.age - current.durationMonths / 12))
    : patient.age;
  if (ageAtStart >= 70) {
    continueReasons.push(`age ${ageAtStart} at start of bisphosphonate (≥70, Section 7 Rec 1–2 Strong)`);
  }

  // Continue if hip or vertebral fracture history
  if (patient.priorHipFracture || patient.priorVertebralFracture) {
    continueReasons.push('prior hip or vertebral fracture (Section 7 Rec 1–2 Strong)');
  }

  // v1.36 Fix 2 (§6.2 + §6.3): fracture DURING current treatment with adequate adherence is
  // an extension indication. Previously used proxy (numberOfPriorFractures ≥2 + duration ≥12mo)
  // which conflated old fractures with on-treatment fractures and ignored adherence. Now reads
  // the two dedicated schema fields. If adherence is unknown, criterion does NOT fire as met —
  // a separate flag prompts the clinician to assess adherence before the continuation decision.
  if (current?.fractureOnCurrentTreatment === true) {
    if (current.adherenceAdequate === true) {
      continueReasons.push('fragility fracture during current course with adherence ≥80% — extension indication (Section 7 Rec 1–2 Strong; Section 6.3)');
    } else if (current.adherenceAdequate === false) {
      // Poor adherence — fracture routes to correction path (§6.3), not extension. Do not push
      // as a continuation reason here.
    } else {
      // adherence not yet assessed — surface separately via the caller's flag-emit path.
      needsAdherenceAssessment = true;
    }
  }

  // Continue if ongoing high-dose glucocorticoids (≥7.5 mg/day) — Section 6.2
  if (isOnHighDoseGC(patient)) {
    continueReasons.push('ongoing high-dose glucocorticoids ≥7.5 mg/day (Section 6.2 — ongoing GC negates pause benefit)');
  }

  // Continue if hip T-score ≤ -2.5 (Section 7 explicit criterion)
  const hipTScores = [
    patient.dexaResults?.totalHipTScore,
    patient.dexaResults?.femoralNeckTScore,
  ].filter((t): t is number => t != null);
  if (hipTScores.length > 0 && Math.min(...hipTScores) <= -2.5) {
    continueReasons.push('hip T-score ≤ −2.5 (Section 7 Strong — pause not appropriate when hip BMD still osteoporotic)');
  }

  // v1.13 Step 7: FRAX (adjusted) above age-specific intervention threshold → continue.
  // Section 7 Rec 6 Strong.
  const ageThr = getAgeThreshold(patient.age);
  if (ageThr !== null) {
    const adjMOF = riskStratification.adjustedFraxMOFPercent;
    const adjHip = riskStratification.adjustedFraxHipPercent;
    if (adjMOF !== null && adjMOF >= ageThr.itMOF) {
      continueReasons.push(`adjusted FRAX MOF ${adjMOF}% ≥ IT ${ageThr.itMOF}% (Section 7 Rec 6 Strong — continue or switch, do not pause)`);
    }
    if (adjHip !== null && adjHip >= ageThr.itHip) {
      continueReasons.push(`adjusted FRAX hip ${adjHip}% ≥ IT ${ageThr.itHip}% (Section 7 Rec 6 Strong — continue or switch, do not pause)`);
    }
  }

  // Belt-and-braces: keep the existing risk-category guard for cases where FRAX values aren't available.
  if (
    (riskCategory === 'high' || riskCategory === 'very_high') &&
    !continueReasons.some(r => r.startsWith('adjusted FRAX'))
  ) {
    continueReasons.push('overall FRAX risk category in red zone');
  }

  if (continueReasons.length > 0) {
    return { takeHoliday: false, reasons: continueReasons, needsAdherenceAssessment };
  }

  return {
    takeHoliday: true,
    reasons: ['T-score >−2.5 at hip', 'no hip or vertebral fracture', 'age at start <70', 'no ongoing steroids ≥7.5 mg/day', 'FRAX adjusted below IT'],
    needsAdherenceAssessment,
  };
}

// ─── GI intolerance switch pathway ───────────────────────────────────────

function giSwitch(
  patient: PatientInput,
  stoppedAgent: TreatmentAgent,
  egfr: number | null,
  flags: ClinicalFlag[],
): Omit<TreatmentOutput, 'supplements' | 'referrals' | 'specialistOptions'> {
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
      rationale: 'NOGG 2024 Rec 13: switch oral bisphosphonate or move to IV if GI not tolerated.',
      source: SRC_HSE,
    });
    if (!affCI && canUse('risedronate', egfr)) recs.push(withBPInitiationContext(risedronate(), patient));
    if (!affCI && canUse('ibandronate', egfr)) recs.push(withBPInitiationContext(ibandronate(), patient));
    if (!affCI && canUse('zoledronate', egfr)) recs.push(withBPInitiationContext(zoledronate(), patient));
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
    if (!affCI && canUse('ibandronate', egfr)) recs.push(withBPInitiationContext(ibandronate(), patient));
    if (!affCI && canUse('zoledronate', egfr)) {
      recs.push(withBPInitiationContext(zoledronate(), patient));
    } else {
      addVitDBlock(patient, flags);
      recs.push(denosumab(egfr));
    }
  } else {
    // Any other agent — IV or denosumab
    if (!affCI && canUse('zoledronate', egfr)) {
      recs.push(withBPInitiationContext(zoledronate(), patient));
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
): Omit<TreatmentOutput, 'supplements' | 'specialistOptions'> {
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
      'If AFF confirmed: bisphosphonates permanently contraindicated. Switch to denosumab or specialist-initiated teriparatide biosimilar (HSE BVM policy March 2023).',
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
): Omit<TreatmentOutput, 'supplements' | 'specialistOptions'> {
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

// ─── Denosumab rebound / cessation pathway (v1.19, Section 8) ────────────────
//
// Tiered timing alerts driven by monthsSinceLastDose (§8.3 Timing Alerts table):
//   approaching 6m (5–5.999):  prompt — arrange IV zoledronate now
//   ≥6m and <7m:               IV zoledronate due. Urgent if not arranged.
//   ≥7m:                       URGENT — elevated vertebral rebound risk.
//                              If >7m and no sequential antiresorptive given,
//                              also surface a refer-urgently flag.
// Sequential agent: IV zoledronate 5 mg at 6 months is the Strong NOGG 2024
// recommendation. Alendronate is a secondary option only; explicitly NOT
// equivalent (less reliable, especially after >3 years denosumab).
// Prescribing-caution flag always fires when the patient is currently on
// denosumab (younger postmenopausal women / men).
function denosumabReboundFlags(
  patient: PatientInput,
  flags: ClinicalFlag[],
): void {
  // The cessation pathway applies whether the patient is currently on
  // denosumab (and might miss a dose) OR has stopped denosumab (and now
  // needs sequential cover). Either slot — currentTreatment or
  // previousTreatments — provides the months-since-last-dose anchor.
  const currentDeno = patient.currentTreatment?.agent === 'denosumab' ? patient.currentTreatment : null;
  const previousDeno = patient.previousTreatments.find(t => t.agent === 'denosumab') ?? null;
  const denoSlot = currentDeno ?? previousDeno;
  if (!denoSlot) return;

  const isOnDenosumab = !!currentDeno && currentDeno.currentlyOn;
  const monthsSinceLastDose = denoSlot.monthsSinceLastDose;

  // Whether a sequential antiresorptive has been arranged. We treat any
  // bisphosphonate added AFTER the denosumab record (i.e. as the
  // currentTreatment when currentDeno is null, or as a later previousTreatment
  // record) as evidence of a sequential plan. eGFR <35 is acknowledged
  // separately so the "no sequential agent" alerts stay accurate.
  const sequentialBPArranged =
    (patient.currentTreatment !== null && isBisphosphonate(patient.currentTreatment.agent)) ||
    patient.previousTreatments.some(t => isBisphosphonate(t.agent) && t !== previousDeno);

  // (A) Prescribing caution — always when denosumab is in play
  flags.push({
    id: 'denosumab_prescribing_caution',
    severity: 'info',
    message:
      'Particularly careful consideration is needed before starting denosumab in younger postmenopausal women and men ' +
      'given the difficulties in stopping treatment. Once started, sequential antiresorptive therapy is mandatory on cessation.',
    rationale:
      'NOGG 2024 (Section 8, v1.19): denosumab cessation carries rebound vertebral fracture risk that is specific to ' +
      'the drug class. The longer the course and the younger the patient at planned cessation, the more important the ' +
      'sequential plan. Surface this caution at every encounter where the patient is on denosumab or recently stopped.',
    source: SRC_NOGG,
  });

  // (B) Cessation plan — surfaced whenever the patient is currently on denosumab,
  // OR has stopped denosumab without a sequential bisphosphonate yet arranged.
  if (isOnDenosumab || (!isOnDenosumab && !sequentialBPArranged)) {
    flags.push({
      id: 'denosumab_cessation_plan',
      severity: 'warning',
      message:
        'Sequential antiresorptive plan required on denosumab cessation. NOGG 2024 Strong (§8.2): IV zoledronate 5 mg at 6 months after the last injection is the recommended sequential agent — NOT equivalent to alendronate. ' +
        'After IV zoledronate, follow CTX at 3 and 6 months (Strong) to guide further infusions; if CTX is not available, give a second IV zoledronate 6 months after the first (Conditional). ' +
        'Alendronate is a secondary option where IV is not feasible; it maintains BMD for ~12 months in most patients after short denosumab courses but is less reliable, particularly after >3 years denosumab.',
      rationale:
        'NOGG 2024 Recs 18–19 (Strong): inform patients of rebound fracture risk before initiating denosumab; sequential antiresorptive therapy is mandatory on cessation. ' +
        '§8.2: IV zoledronate is the preferred sequential agent (Strong). Alendronate as alternative carries Evidence IIa — significant bone loss occurs in a minority. ' +
        'For patients on >3 years denosumab, a single zoledronate infusion may not maintain BMD beyond 12 months — plan second infusion or CTX-guided follow-up (Evidence IIb).',
      source: SRC_NOGG,
    });
  }

  // (C) Timing tiers — only relevant when we have a number
  if (monthsSinceLastDose === null) return;

  // Approaching 6 months (5 ≤ months < 6): prompt to arrange now
  if (monthsSinceLastDose >= 5 && monthsSinceLastDose < 6) {
    flags.push({
      id: 'denosumab_zoledronate_arrange_now',
      severity: 'warning',
      message:
        `Approaching 6 months since the last denosumab injection (${monthsSinceLastDose} months). ` +
        'Arrange IV zoledronate 5 mg now — it must be given at 6 months after the last denosumab dose. ' +
        'NOGG 2024 Strong (§8.2): IV zoledronate is the recommended sequential agent — NOT equivalent to alendronate.',
      rationale:
        'NOGG 2024 §8.3 Timing Alerts (v1.19): the 5–6 month window is the actionable point. Delaying beyond 6 months exposes the patient to rebound vertebral fracture risk. ' +
        'Arrange the infusion in advance so it lands at 6 months, not later.',
      source: SRC_NOGG,
    });
  }

  // 6 ≤ months < 7: IV zoledronate due now; urgent if not yet arranged
  if (monthsSinceLastDose >= 6 && monthsSinceLastDose < DENOSUMAB.reboundRiskThresholdMonths) {
    flags.push({
      id: 'denosumab_zoledronate_due',
      severity: sequentialBPArranged ? 'warning' : 'urgent',
      message:
        `IV zoledronate 5 mg is due now — ${monthsSinceLastDose} months since the last denosumab injection. ` +
        (sequentialBPArranged
          ? 'Confirm the infusion is administered without delay.'
          : 'URGENT: no sequential antiresorptive arranged. Arrange IV zoledronate immediately.'),
      rationale:
        'NOGG 2024 Rec 18 / Cummings SR et al. JBMR 2018: bone resorption markers (CTX) rise progressively from 3 months after a missed dose; ' +
        'by 6 months they exceed pre-treatment baseline. IV zoledronate at this point both replaces the missed denosumab and acts as the sequential antiresorptive (§8.2 Strong). ' +
        'Alendronate is a secondary option only — NOT equivalent.',
      source: SRC_NOGG,
    });
  }

  // ≥7 months: URGENT rebound risk. Existing FREEDOM-citation flag retained
  // for back-compatibility with TC18 (asserts on this id).
  if (monthsSinceLastDose >= DENOSUMAB.reboundRiskThresholdMonths) {
    flags.push({
      id: 'denosumab_overdue_injection',
      severity: 'urgent',
      message:
        `Injection overdue — ${monthsSinceLastDose} months since the last denosumab dose. URGENT: significantly elevated vertebral rebound risk. ` +
        'FREEDOM trial data show fracture rate increases from 1.2 to 7.1 per 100 patient-years after discontinuation. ' +
        'Arrange IV zoledronate 5 mg immediately (NOGG 2024 Strong — preferred sequential agent). Alendronate is a secondary option only.',
      rationale:
        'Cummings SR et al. Vertebral fractures after discontinuation of denosumab: a post hoc analysis of the FREEDOM trial and its extension. ' +
        'J Bone Miner Res. 2018;33(2):190–198. https://pubmed.ncbi.nlm.nih.gov/29105841/. ' +
        'Vertebral fracture rate rose from 1.2 per 100 patient-years (on denosumab) to 7.1 per 100 patient-years after stopping. ' +
        'NOGG 2024 Recs 18–19 / §8.1 Rebound Risk on Cessation: gaps ≥7 months since the last denosumab dose mark imminent rebound risk.',
      source: SRC_NOGG,
    });

    // >7m AND no sequential antiresorptive arranged → refer urgently
    if (monthsSinceLastDose > DENOSUMAB.reboundRiskThresholdMonths && !sequentialBPArranged) {
      flags.push({
        id: 'denosumab_refer_urgently',
        severity: 'urgent',
        message:
          'URGENT REFERRAL: high rebound fracture risk with no sequential antiresorptive arranged. ' +
          'Refer urgently if you cannot arrange IV zoledronate immediately in primary care.',
        rationale:
          'NOGG 2024 §8.1 Rebound Risk on Cessation (v1.19): >7 months without sequential antiresorptive marks imminent vertebral fracture risk. ' +
          'Specialist referral is appropriate when zoledronate cannot be arranged promptly in primary care.',
        source: SRC_NOGG,
      });
    }
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
): Omit<TreatmentOutput, 'supplements' | 'specialistOptions'> {
  flags.push({
    id: 'poi_hrt_first_line',
    severity: 'info',
    message:
      'Premature ovarian insufficiency / early menopause (<45 years): HRT is first-line for bone protection until at least age 51. ' +
      'TRANSDERMAL HRT (patch / gel) is preferred over oral — lower VTE risk. ' +
      // v1.16 Step 9 — bisphosphonate threshold loosened. Was: "only if DEXA shows osteoporosis".
      // Corrected to: T ≤ −2.5 OR osteopenia + additional risk factors AND HRT contraindicated/declined/insufficient.
      'Add bisphosphonate when HRT is contraindicated, declined, or insufficient AND ' +
      'DEXA shows osteoporosis (T ≤ −2.5) OR osteopenia (T between −1.0 and −2.5) with additional clinical risk factors. ' +
      'Do NOT wait for established osteoporosis to develop in HRT-ineligible women — apply the standard FRAX-based pathway.',
    rationale:
      'NICE NG23 / NOGG 2024 / Section 10.3 (v1.16): HRT addresses all consequences of oestrogen deficiency ' +
      '(bone, cardiovascular, cognitive). Transdermal route avoids first-pass hepatic metabolism and does not ' +
      'increase VTE risk. The previous tool requirement of established osteoporosis before adding bisphosphonate ' +
      'in HRT-ineligible women was too restrictive — corrected to the standard FRAX-based pathway with ' +
      'osteopenia + risk factors as a sufficient threshold.',
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

  // v1.16 Step 9 — when HRT is contraindicated/declined/insufficient AND BMD criteria met
  // (T ≤ −2.5 OR osteopenia + risk factors), layer in a bisphosphonate alongside HRT.
  // We can directly observe the contraindication signals (vteHistory + breastCancerHistory)
  // and the BMD threshold; "declined" and "insufficient" cannot be inferred from inputs, but the
  // surfaced flag (poi_hrt_first_line) tells the GP to add a BP in those scenarios.
  const recommendations: TreatmentRecommendation[] = [rec];
  const tScores = patient.dexaResults
    ? [
        patient.dexaResults.lumbarSpineTScore,
        patient.dexaResults.totalHipTScore,
        patient.dexaResults.femoralNeckTScore,
      ].filter((t): t is number => t != null)
    : [];
  const lowestT = tScores.length > 0 ? Math.min(...tScores) : null;
  const hasOsteoporosis = lowestT !== null && lowestT <= -2.5;
  const additionalRiskFactors = aiAdditionalRiskFactorCount(patient);
  const hasOsteopeniaPlusRF =
    lowestT !== null && lowestT > -2.5 && lowestT <= -1.0 && additionalRiskFactors >= 1;
  const hrtContraindicated =
    patient.vteHistory && patient.breastCancerHistory; // both is the conservative HRT-ineligible signal
  const bpCriteriaMet = hasOsteoporosis || hasOsteopeniaPlusRF;

  if (bpCriteriaMet && hrtContraindicated) {
    flags.push({
      id: 'poi_bp_layered_hrt_ineligible',
      severity: 'warning',
      message:
        `POI patient with HRT-ineligible signals (VTE + breast cancer history) and ${
          hasOsteoporosis ? `osteoporosis (T ${lowestT})` : `osteopenia (T ${lowestT}) + ${additionalRiskFactors} risk factor${additionalRiskFactors > 1 ? 's' : ''}`
        }: add bisphosphonate as primary bone protection (HRT is not the appropriate choice given combined contraindications).`,
      rationale:
        'NOGG 2024 / NICE NG23 / Section 10.3 (v1.16): when HRT is contraindicated by both VTE history and breast ' +
        'cancer history, bisphosphonate is the primary bone protection. T-score ≤ −2.5 OR osteopenia + clinical risk ' +
        'factors is sufficient to indicate treatment — do not require established osteoporosis.',
      source: SRC_BMS,
    });
    const egfr = resolveEGFR(patient);
    if (canUse('alendronate', egfr) && (egfr === null || egfr > RENAL_LIMITS.alendronate.ci)) {
      recommendations.push(withBPInitiationContext({
        ...alendronate(),
        priority: 'first-line',
        rationale:
          'Primary bone protection in HRT-ineligible POI (VTE + breast cancer history). ' +
          'BMD criterion met (osteoporosis OR osteopenia + risk factors). Equivalent first-line with risedronate per NOGG 2024 Rec 12 (Strong).',
      }, patient));
      if (canUse('risedronate', egfr)) {
        recommendations.push(withBPInitiationContext({
          ...risedronate(),
          priority: 'first-line',
          rationale:
            'Primary bone protection in HRT-ineligible POI. Equivalent first-line with alendronate per NOGG 2024 Rec 12 (Strong) — clinician choice.',
        }, patient));
      }
    }
  } else if (bpCriteriaMet) {
    // HRT remains first-line but flag bisphosphonate as a "if HRT insufficient/declined" option.
    flags.push({
      id: 'poi_bp_consider_if_hrt_insufficient',
      severity: 'info',
      message:
        `POI patient with ${
          hasOsteoporosis ? `osteoporosis (T ${lowestT})` : `osteopenia (T ${lowestT}) + ${additionalRiskFactors} risk factor${additionalRiskFactors > 1 ? 's' : ''}`
        }: HRT remains first-line. Add a bisphosphonate (e.g. alendronate) if HRT is declined, contraindicated, or insufficient to arrest bone loss.`,
      rationale:
        'Section 10.3 (v1.16): bisphosphonate addition criteria in POI are T-score ≤ −2.5 OR osteopenia + ' +
        'additional risk factors AND HRT contraindicated/declined/insufficient. The "declined / insufficient" ' +
        'limb cannot be inferred from inputs and is surfaced as a clinician decision point.',
      source: SRC_BMS,
    });
  }

  return { recommendations, flags, referrals };
}

// v1.13: GIOP pathway applies to any current GC user in scope (postmenopausal women / men ≥50).
// Within the GIOP pathway, immediate-start vs assess-and-treat decision uses NOGG criteria (a)-(d)
// — see giopImmediateStartCriteria() below.
function isGIOP(patient: PatientInput): boolean {
  return isOnGC(patient);
}

/**
 * NOGG 2024 immediate-start criteria for GIOP (Section 9.1).
 * Returns the list of criteria that match. Empty list = patient is on GC but does NOT meet
 * any immediate-start criterion → assess-and-treat path (Section 9.2).
 *
 * Criteria — any one is sufficient:
 *   (a) Prior fragility fracture, at any GC dose.
 *   (b) Female ≥70, at any GC dose.
 *   (c) Postmenopausal woman or man ≥50 on prednisolone ≥7.5 mg/day for planned ≥3 months.
 *   (d) Postmenopausal woman or man ≥50 with FRAX (after Table 8 correction) above the
 *       age-specific NOGG intervention threshold, at any GC dose.
 *
 * (d) requires the post-Table-8 FRAX values and the age-specific IT — passed in from the caller.
 */
function giopImmediateStartCriteria(
  patient: PatientInput,
  adjustedMOF: number | null,
  adjustedHip: number | null,
  itMOF: number | null,
  itHip: number | null,
): string[] {
  if (!isOnGC(patient)) return [];
  const criteria: string[] = [];
  // (a) Prior fragility fracture — any dose
  if (patient.priorFragilityFracture || patient.priorHipFracture || patient.priorVertebralFracture) {
    criteria.push('(a) Prior fragility fracture (any GC dose)');
  }
  // (b) Female ≥70 — any dose. v1.36 audit: current-age intent (the criterion is "this
  // patient is currently ≥70 and on any GC"), not age-at-start of a treatment course. Leave as is.
  if (patient.sex === 'female' && patient.age >= 70) {
    criteria.push('(b) Female ≥70 (any GC dose)');
  }
  // (c) Postmenopausal woman or man ≥50 + GC ≥7.5 mg/day
  if (patient.age >= 50 && isOnHighDoseGC(patient)) {
    criteria.push('(c) GC ≥7.5 mg/day prednisolone equivalent for planned ≥3 months');
  }
  // (d) FRAX (after Table 8) above age-specific IT — any dose.
  // Gated on manual FRAX entry: criterion (d) requires a reliable FRAX number,
  // and the in-tool estimator is too coarse for this immediate-start decision.
  // Without manual entry the patient routes to the assess-and-treat path (Section 9.2).
  const fraxIsManual = patient.fraxMOFPercent !== null || patient.fraxHipPercent !== null;
  if (patient.age >= 50 && fraxIsManual) {
    const mofAboveIT = adjustedMOF !== null && itMOF !== null && adjustedMOF >= itMOF;
    const hipAboveIT = adjustedHip !== null && itHip !== null && adjustedHip >= itHip;
    if (mofAboveIT || hipAboveIT) {
      const which =
        mofAboveIT && hipAboveIT
          ? `FRAX MOF ${adjustedMOF}% and hip ${adjustedHip}% both above IT (${itMOF}% / ${itHip}%)`
          : mofAboveIT
          ? `FRAX MOF ${adjustedMOF}% above IT ${itMOF}%`
          : `FRAX hip ${adjustedHip}% above IT ${itHip}%`;
      criteria.push(`(d) ${which} (any GC dose; Table 8 correction applied; manual FRAX)`);
    }
  }
  return criteria;
}

function giop(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): Omit<TreatmentOutput, 'supplements' | 'specialistOptions'> {
  const egfr = resolveEGFR(patient);
  const recs: TreatmentRecommendation[] = [];
  const gcDose = effectiveGCDoseMgDay(patient);

  // Compute Section 9.1 immediate-start criteria using post-Table-8 FRAX values
  // and age-specific intervention thresholds.
  const adjustedMOF = riskStratification.adjustedFraxMOFPercent;
  const adjustedHip = riskStratification.adjustedFraxHipPercent;
  const ageThr = getAgeThreshold(patient.age);
  const itMOF = ageThr ? ageThr.itMOF : null;
  const itHip = ageThr ? ageThr.itHip : null;
  const immediateStartCriteria = giopImmediateStartCriteria(
    patient, adjustedMOF, adjustedHip, itMOF, itHip,
  );
  const meetsImmediateStart = immediateStartCriteria.length > 0;

  if (meetsImmediateStart) {
    flags.push({
      id: 'giop_immediate_start',
      severity: 'warning',
      message:
        `GIOP — start bone protection immediately, do NOT wait for DEXA. Triggered by: ${immediateStartCriteria.join('; ')}.`,
      rationale:
        'NOGG 2024 Section 9.1 / Rec 22 (Strong): bone loss is greatest in the first 3–6 months of GC therapy. ' +
        'Any one of criteria (a)–(d) is sufficient to start treatment without waiting for BMD. ' +
        '(a) Prior fragility fracture — any GC dose. ' +
        '(b) Female ≥70 — any GC dose. ' +
        '(c) Postmenopausal woman or man ≥50 on prednisolone ≥7.5 mg/day for planned ≥3 months. ' +
        '(d) Postmenopausal woman or man ≥50 with FRAX (after Table 8 dose correction) above the age-specific intervention threshold.',
      source: SRC_NOGG,
    });
  } else {
    // Section 9.2 — assess and treat. Patient is on GC but does not meet immediate-start criteria.
    // The standard scenario: medium- or low-dose GC in a younger patient without fracture and
    // with FRAX below IT. DEXA-gated treatment with lower threshold T ≤ −1.5.
    flags.push({
      id: 'giop_lower_threshold_assess_and_treat',
      severity: 'info',
      message:
        `GIOP assess-and-treat: on ${gcDose ?? '?'} mg/day GC; does not meet immediate-start criteria (a)–(d). ` +
        'Measure BMD; treat if T-score ≤−1.5 (lower GIOP threshold — steroids increase fracture risk beyond BMD effect alone).',
      rationale:
        'NOGG 2024 Section 9.2: for postmenopausal women or men ≥50 on medium- or low-dose GC who do not meet ' +
        'immediate-start criteria, DEXA is required and treatment is offered if T-score ≤ −1.5 at any standard site. ' +
        'Glucocorticoids increase fracture risk independently of BMD, so the standard −2.5 threshold is lowered.',
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

    // Step 5 — Near-threshold reassessment (NOGG 2024 Section 9.2, Conditional).
    // Patient on medium/low dose GC with FRAX (after Table 8) below but within 20% of the IT.
    if (gcDose !== null && gcDose < 7.5 && itMOF !== null && itHip !== null) {
      const mofNearIT =
        adjustedMOF !== null && adjustedMOF < itMOF && adjustedMOF >= itMOF * 0.8;
      const hipNearIT =
        adjustedHip !== null && adjustedHip < itHip && adjustedHip >= itHip * 0.8;
      if (mofNearIT || hipNearIT) {
        flags.push({
          id: 'giop_near_threshold_reassess',
          severity: 'info',
          message:
            'GIOP near-threshold reassessment: FRAX is below but within 20% of the age-specific intervention threshold. ' +
            'Recommend FRAX + BMD reassessment at 12–18 months after starting GC therapy.',
          rationale:
            'NOGG 2024 (Conditional): for medium/low-dose GC patients near but below the IT, repeat fracture risk ' +
            'assessment at 12–18 months allows earlier treatment if risk crosses the threshold during the high-loss ' +
            'first year of GC therapy.',
          source: SRC_NOGG,
        });
      }
    }

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
    // T-score ≤ -1.5 — continue to standard GIOP treatment recommendations below
  }

  flags.push({
    id: 'giop_monitoring',
    severity: 'info',
    message:
      'GIOP monitoring: DEXA within 6 months of starting treatment, then every 1–2 years. ' +
      'Annual bloods: calcium, vitamin D, eGFR, ALP. ' +
      'Reassess FRAX with BMD at each DEXA repeat.',
    rationale: 'NOGG 2024 §9.6 monitoring recommendations for GIOP: ALP added (bone turnover / osteomalacia screen) and FRAX-at-DEXA-repeat made explicit.',
    source: SRC_IOS,
  });

  // v1.37 Option B (TC93) — Standard VHR-anabolic-referral cluster for GIOP-VHR patients.
  // The GIOP override at generateTreatmentOutput:746-752 returns early before the standard
  // VHR block at :815 and the post-recipe Seq.2 push gate, so GIOP-VHR patients otherwise
  // miss vhr_specialist_referral and sequential_therapy_plan_required. Mirror both pushes
  // here when riskCategory === 'very_high' so GIOP-VHR has the same flag-ID contract as
  // non-GIOP VHR (TC90 / TC92 / TC93).
  //
  // v1.40 GIOP refactor (Option C from v1.37 backlog) — vhr_specialist_referral is now the
  // CANONICAL source of the anabolic-referral mechanism + urgent-referral framing +
  // bridging-bisphosphonate instruction for VHR-GIOP patients. The renamed
  // giop_specialist_context flag below (formerly giop_anabolic_preferred) carries ONLY
  // additive teriparatide-specific clinical content (Saag NEJM 2007, HSE BVM biosimilar
  // policy, teri CIs) that nothing else produces. The flag is now subordinate to standard
  // VHR routing, not a parallel substitute.
  if (riskCategory === 'very_high') {
    const gcDrivesVHR = isOnHighDoseGC(patient) && gcDurationMonths(patient) >= GIOP.highDoseMinMonths;
    flags.push({
      id: 'vhr_specialist_referral',
      severity: gcDrivesVHR ? 'urgent' : 'warning',
      message: gcDrivesVHR
        ? 'URGENT: refer to osteoporosis specialist in secondary care. Start an oral bisphosphonate in the meantime if any delay is anticipated — rapid bone loss post-glucocorticoid initiation.'
        : 'Refer to osteoporosis specialist in secondary care for assessment and consideration of specialist-initiated treatment. Some may need first-line anabolic drug treatment, especially those with multiple vertebral fractures.',
      rationale:
        'NOGG 2024 (Conditional): consider referral of very high-risk patients to an osteoporosis specialist in secondary care, ' +
        'for assessment and consideration of parenteral treatment. GIOP-VHR: GC-driven VHR ' +
        '(≥7.5 mg/day × ≥3 months) carries rapid post-initiation bone loss — refer urgently and bridge with an oral bisphosphonate.',
      source: SRC_NOGG,
    });

    // Seq.2 third push gate equivalent: anabolic referral active → sequential planning required.
    if (!flags.some(f => f.id === 'sequential_therapy_plan_required')) {
      flags.push({
        id: 'sequential_therapy_plan_required',
        severity: 'info',
        collapsedByDefault: true,
        summary: 'Plan sequential antiresorptive at initiation, not retrospectively. Document the follow-on plan in the referral.',
        message:
          'Plan the sequential therapy strategy at the time of initiation — not retrospectively. ' +
          'For teriparatide / romosozumab / abaloparatide being considered at specialist review: an antiresorptive must follow the course ' +
          '(prescribed 1 month before the final anabolic dose to avoid a gap). Document the follow-on plan in the referral letter so the specialist sees it at initiation.',
        rationale:
          'NOGG 2024 Rec 14 (Strong): sequential antiresorptive after anabolic is mandatory — BMD gains are lost rapidly without it. ' +
          'The plan must accompany the referral (specialist initiates the anabolic; GP continues the follow-on antiresorptive).',
        source: SRC_NOGG,
      });
    }
  }

  // v1.40 GIOP refactor — giop_specialist_context (formerly giop_anabolic_preferred).
  // Repurposed to carry only ADDITIVE teriparatide-specific GIOP context for the GP. The
  // anabolic-referral mechanism, urgent-referral framing, and bridging-BP instruction are
  // now the sole responsibility of vhr_specialist_referral (Option B mirror block above)
  // for VHR-GIOP patients. The parallel rheumatology:urgent referral push has been
  // removed — vhr_specialist_referral is now the canonical referral source for these
  // patients. Predicate (giopVHR) is unchanged from the prior implementation; the gate's
  // overlap with standard NOGG VHR criteria is documented in the v1.40 audit (Section 8
  // findings tracked separately).
  const giopVHR =
    (patient.priorVertebralFracture && patient.numberOfPriorFractures >= 2) ||
    (patient.dexaResults !== null && lowestDexaTScore(patient.dexaResults) <= -3.5);

  if (giopVHR) {
    flags.push({
      id: 'giop_specialist_context',
      severity: 'warning',
      message:
        'GIOP-specific anabolic context: teriparatide has direct GIOP evidence (Saag NEJM 2007; NOGG Rec 23). HSE BVM (March 2023): biosimilar over originator. Modest hip BMD effect — relevant if hip is the worse site.',
      rationale:
        'NOGG 2024 Rec 23 / BSR 2022: teriparatide shown superior to alendronate in GIOP (Saag et al. NEJM 2007). ' +
        'GIOP VHR = multiple vertebral fractures OR T-score ≤-3.5 on steroids. ' +
        'HSE Best Value Medicine policy (1 March 2023): prescribe the recommended teriparatide biosimilar; originator Forsteo not reimbursed unless biosimilar is clinically unsuitable. ' +
        'Teriparatide contraindications: unexplained raised ALP, Paget\'s disease, prior radiation to skeleton, ' +
        'renal calculi, hypercalcaemia, hyperparathyroidism, haematological malignancy, active malignancy. ' +
        'Primary literature: Smith et al. Br J Clin Pharmacol 2025; HSE MMP BVM policy. ' +
        'v1.40 refactor: this flag is informational GIOP-context for the GP; the anabolic referral itself is carried by vhr_specialist_referral.',
      source: SRC_BSR,
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
    // Oral first-line per NOGG GIOP Rec 23 (Strong) — alendronate AND risedronate
    // are equivalent first-line oral options (v1.33). Push both.
    {
      const tagged = bridgingTagOrNullForVHR({
        ...alendronate(),
        rationale:
          'First-line oral bisphosphonate for GIOP (NOGG 2024 Rec 23 — Strong; equivalent with risedronate). ' +
          'Initiate at same time as glucocorticoid if planned duration ≥3 months. ' +
          'Calcium 1000–1500 mg/day and vitamin D ≥800 IU/day required alongside.',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
    if (canUse('risedronate', egfr)) {
      const tagged = bridgingTagOrNullForVHR({
        ...risedronate(),
        rationale:
          'First-line oral bisphosphonate for GIOP (NOGG 2024 Rec 23 — Strong; equivalent with alendronate). ' +
          'Initiate at same time as glucocorticoid if planned duration ≥3 months.',
      }, riskCategory, patient);
      if (tagged) recs.push(withBPInitiationContext(tagged, patient));
    }
  } else if (!aff && giIntolerance && !refuses && canUse('zoledronate', egfr)) {
    // Prior oral GI intolerance — IV zoledronate bypasses GI tract
    flags.push({
      id: 'giop_iv_after_gi_intolerance',
      severity: 'info',
      message:
        'Oral bisphosphonate contraindicated (prior GI intolerance) — IV zoledronate is the appropriate GIOP option.',
      rationale:
        'NOGG 2024: IV zoledronate has no GI exposure and is preferred when oral bisphosphonate has caused intolerance. ' +
        'Pre-medicate with paracetamol and pre-hydrate.',
      source: SRC_HSE,
    });
    recs.push(withBPInitiationContext({ ...zoledronate(), rationale: 'IV zoledronate for GIOP when oral bisphosphonate is contraindicated by prior intolerance.' }, patient));
  } else if (!aff && !refuses && canUse('zoledronate', egfr)) {
    recs.push(withBPInitiationContext({ ...zoledronate(), rationale: 'IV zoledronate for GIOP when oral bisphosphonate is contraindicated or not tolerated.' }, patient));
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

function adtFlags(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
  flags: ClinicalFlag[],
  referrals: ReferralRecommendation[],
): void {
  if (!patient.adtUse) return;

  // v1.14 Step 1 — bisphosphonate and denosumab presented as equivalent. Zoledronate noted as
  // preferred BP for ADT on BMD evidence. Denosumab no longer described as first-line.
  flags.push({
    id: 'adt_bone_loss',
    severity: 'info',
    message:
      'ADT (androgen deprivation therapy): causes rapid bone loss and elevated fracture risk. ' +
      'Bisphosphonate and denosumab are equivalent options (NOGG 2024). NOGG 2024 Strong: bisphosphonate is first-line as the most cost-effective antiresorptive; ' +
      'denosumab is the alternative when bisphosphonate is contraindicated. ' +
      'Within the bisphosphonate class, zoledronate is preferred on BMD evidence (NOGG 2024 Evidence IIa, network meta-analysis). ' +
      'DEXA baseline and monitoring every 1–2 years during ADT.',
    rationale:
      'NOGG 2024 Section 7 supports the Brown et al 2020 ADT consensus; HALT trial (Smith et al. NEJM 2009) ' +
      'demonstrated denosumab fracture reduction vs placebo but does not establish denosumab superiority over ' +
      'bisphosphonates — no head-to-head fracture endpoint trial exists.',
    source: SRC_NOGG,
  });

  // v1.14 Step 2 — ADT near-threshold reassessment (12–18 months).
  const ageThr = getAgeThreshold(patient.age);
  const adjMOF = riskStratification.adjustedFraxMOFPercent;
  const adjHip = riskStratification.adjustedFraxHipPercent;
  if (ageThr !== null) {
    const mofNearIT = adjMOF !== null && adjMOF < ageThr.itMOF && adjMOF >= ageThr.itMOF * 0.8;
    const hipNearIT = adjHip !== null && adjHip < ageThr.itHip && adjHip >= ageThr.itHip * 0.8;
    if (mofNearIT || hipNearIT) {
      flags.push({
        id: 'adt_near_threshold_reassess',
        severity: 'info',
        message:
          'ADT near-threshold reassessment: FRAX is below but within 20% of the age-specific intervention threshold. ' +
          'Reassess FRAX with BMD 12–18 months after starting ADT. (Note: ADT interval differs from AI 12–24 months.)',
        rationale:
          'NOGG 2024 Section 7, Rec 3 (Conditional): men starting ADT with FRAX near to but below the IT — ' +
          'particularly those going on to additional systemic therapies (e.g. concomitant glucocorticoids) — ' +
          'should have FRAX with BMD reassessed 12–18 months after ADT initiation.',
        source: SRC_NOGG,
      });
    }
  }

  // v1.14 Step 3 — ADT consider-referral when treatment threshold is met.
  // This is a Conditional "consider referring" flag, not a mandatory referral. It must not
  // conflate with the VHR mandatory referral pathway, which is handled separately.
  if (riskCategory === 'high' || riskCategory === 'very_high') {
    flags.push({
      id: 'adt_consider_secondary_care_referral',
      severity: 'info',
      message:
        'ADT patient meets the treatment threshold — consider referring to secondary care for assessment and ' +
        'initiation of bone protection. (Conditional — not mandatory; does not replace the VHR pathway if present.)',
      rationale:
        'NOGG 2024 Section 7, Rec 2 (Conditional): consider referring men with high fracture risk requiring drug ' +
        'treatment to secondary care for assessment and initiation of treatment.',
      source: SRC_NOGG,
    });
    referrals.push({
      specialty: 'metabolic_bone',
      reason: 'ADT with high fracture risk — consider secondary care for assessment and initiation of bone protection (NOGG 2024 Section 7, Rec 2 Conditional).',
      urgency: 'routine',
    });
  }
}

function aiFlags(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
  flags: ClinicalFlag[],
): void {
  if (!patient.aromataseInhibitorUse) return;

  const tScores = patient.dexaResults
    ? [
        patient.dexaResults.lumbarSpineTScore,
        patient.dexaResults.totalHipTScore,
        patient.dexaResults.femoralNeckTScore,
      ].filter((t): t is number => t != null)
    : [];
  const lowestT = tScores.length > 0 ? Math.min(...tScores) : null;
  const rfCount = aiAdditionalRiskFactorCount(patient);

  // v1.14 Step 4 — IOF 2017 international consensus (cited by NOGG 2024). Replaces the previous
  // blanket T-score ≤ −1.5 rule.
  const treatUnconditional = lowestT !== null && lowestT < -2.0;
  const treatWithRF = lowestT !== null && lowestT < -1.5 && lowestT >= -2.0 && rfCount >= 1;
  const treatNoBMD = lowestT === null && rfCount >= 2;
  const monitorOnly = lowestT !== null && lowestT >= -1.5 && rfCount === 0;

  let aiMessage: string;
  let aiSeverity: ClinicalFlag['severity'] = 'info';
  if (treatUnconditional) {
    aiSeverity = 'warning';
    aiMessage =
      `Aromatase inhibitor therapy with T-score ${lowestT} (< −2.0): TREAT — IOF 2017 unconditional threshold. ` +
      'Bisphosphonate and denosumab are equivalent options (NOGG 2024 Strong / IOF 2017). ' +
      'NOGG 2024 Strong: bisphosphonate (oral or IV zoledronate) is first-line as the most cost-effective antiresorptive; denosumab is the alternative when bisphosphonate is contraindicated. DEXA every 1–2 years.';
  } else if (treatWithRF) {
    aiSeverity = 'warning';
    aiMessage =
      `Aromatase inhibitor therapy with T-score ${lowestT} (< −1.5) plus ${rfCount} additional clinical risk factor${rfCount > 1 ? 's' : ''}: TREAT — IOF 2017 threshold. ` +
      'Bisphosphonate and denosumab are equivalent options (NOGG 2024 Strong). ' +
      'NOGG 2024 Strong: bisphosphonate is first-line as the most cost-effective antiresorptive; denosumab is the alternative when bisphosphonate is contraindicated. DEXA every 1–2 years.';
  } else if (treatNoBMD) {
    aiSeverity = 'warning';
    aiMessage =
      `Aromatase inhibitor therapy with ${rfCount} clinical risk factors and no DEXA available: TREAT — IOF 2017 threshold. ` +
      'Bisphosphonate and denosumab are equivalent options (NOGG 2024 Strong). DEXA at earliest opportunity for monitoring.';
  } else if (monitorOnly) {
    aiMessage =
      `Aromatase inhibitor therapy with T-score ${lowestT} (≥ −1.5) and no additional clinical risk factors: ` +
      'monitor BMD change at 1 year and apply standard postmenopausal osteoporosis guidelines (IOF 2017). ' +
      'Treatment is not indicated at this time on AI grounds alone — but FRAX above the age-specific intervention threshold still warrants treatment per NOGG Rec 2 (Strong).';
  } else {
    aiMessage =
      'Aromatase inhibitor therapy: assess by IOF 2017 thresholds — T-score < −2.0 unconditional; ' +
      'T-score < −1.5 with ≥1 risk factor; ≥2 risk factors without BMD; or FRAX above age-specific IT (treat regardless of T-score). ' +
      'Bisphosphonate and denosumab are equivalent options (NOGG 2024 Strong). DEXA every 1–2 years.';
  }

  flags.push({
    id: 'ai_ctibl',
    severity: aiSeverity,
    message: aiMessage,
    rationale:
      'IOF/CABS/ECTS/IEG/ESCEO/IMS/SIOG 2017 Joint Position Statement (Rizzoli R et al, Osteoporos Int 2017), cited by NOGG 2024. ' +
      'AI therapy causes rapid oestrogen suppression and accelerated bone loss — but the previous blanket T-score ≤ −1.5 rule ' +
      'over-treated AI patients without supporting Irish guideline. The IOF 2017 thresholds restrict T-score < −1.5 to patients ' +
      'with ≥1 additional risk factor.',
    source: SRC_CTIBL,
  });

  // v1.14 Step 5 — explicit equivalence flag covering treatment options (NOGG Rec 2 Strong).
  // Surfaced even when AI threshold not met, so clinicians see the option set up-front.
  flags.push({
    id: 'ai_treatment_options_equivalent',
    severity: 'info',
    message:
      'AI bone protection options: bisphosphonate (oral or IV zoledronate) and denosumab 60mg SC are equivalent ' +
      'first-line options on fracture and BMD evidence (NOGG 2024 Rec 2 Strong; IOF 2017). Per NOGG 2024 Strong, ' +
      'bisphosphonate is preferred as the most cost-effective option and denosumab is the alternative when bisphosphonate is contraindicated.',
    rationale:
      'NOGG 2024 Evidence Ia: denosumab and risedronate both reduce fracture risk in AI patients; denosumab and ' +
      'zoledronate both produce significant BMD gains at spine and hip. Neither class is elevated above the other.',
    source: SRC_NOGG,
  });

  // v1.14 Step 6 — AI near-threshold reassessment (12–24 months — note: differs from ADT/GIOP 12–18m).
  const ageThr = getAgeThreshold(patient.age);
  const adjMOF = riskStratification.adjustedFraxMOFPercent;
  const adjHip = riskStratification.adjustedFraxHipPercent;
  if (ageThr !== null) {
    const mofNearIT = adjMOF !== null && adjMOF < ageThr.itMOF && adjMOF >= ageThr.itMOF * 0.8;
    const hipNearIT = adjHip !== null && adjHip < ageThr.itHip && adjHip >= ageThr.itHip * 0.8;
    if (mofNearIT || hipNearIT) {
      flags.push({
        id: 'ai_near_threshold_reassess',
        severity: 'info',
        message:
          'AI near-threshold reassessment: FRAX is below but within 20% of the age-specific intervention threshold. ' +
          'Reassess FRAX with BMD 12–24 months after starting AI therapy. (Note: AI interval is 12–24 months — differs from ADT/GIOP 12–18 months.)',
        rationale:
          'NOGG 2024 Section 7, Rec 3 (Conditional) / IOF 2017: women starting AI with FRAX near to but below the IT — ' +
          'particularly those going on to additional systemic therapies (e.g. concomitant glucocorticoids) — ' +
          'should have FRAX with BMD reassessed 12–24 months after AI initiation.',
        source: SRC_NOGG,
      });
    }
  }

  // v1.14 Step 7 — adjuvant high-dose bisphosphonate end-of-course reassessment.
  if (patient.hadAdjuvantHighDoseBisphosphonate) {
    flags.push({
      id: 'ai_adjuvant_bp_end_of_course_reassess',
      severity: 'info',
      message:
        'Patient has received adjuvant high-dose bisphosphonate as part of breast cancer management. ' +
        'Assess fracture risk at the end of that bisphosphonate course — particularly if AI therapy is continuing.',
      rationale:
        'NOGG 2024 Section 7, Rec 4 (Conditional): adjuvant high-dose bisphosphonate (higher/more frequent dosing ' +
        'than standard osteoporosis treatment) provides residual skeletal protection that may not extend through ' +
        'continued AI therapy — fracture risk should be re-evaluated when the adjuvant course ends.',
      source: SRC_NOGG,
    });
  }

  // Mark riskCategory as observed (not currently used for AI branching beyond the IOF 2017 thresholds
  // above; surfacing it here keeps the signature uniform with adtFlags and lets future IOF revisions
  // gate on overall FRAX category without another signature change).
  void riskCategory;
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

  // Patient context that modifies dosing
  const obese = patient.bmi !== null && patient.bmi >= 30;
  const malabsorption =
    patient.secondaryOsteoporosis.includes('malabsorption') ||
    patient.secondaryOsteoporosis.includes('celiac_disease') ||
    patient.secondaryOsteoporosis.includes('inflammatory_bowel_disease');
  const ckd =
    (patient.bloodResults?.egfr ?? 999) < 60;
  const hyperPTH = patient.secondaryOsteoporosis.includes('hyperparathyroidism');

  // Context bullets reused across deficient / insufficient tiers
  const contextBullets: string[] = [];
  if (obese) {
    contextBullets.push('BMI ≥30: titrate to target rather than fixed dose — volumetric dilution reduces bioavailability');
  }
  if (malabsorption) {
    contextBullets.push('Malabsorption / bariatric surgery: ≥2,000 IU/day often needed; individualise to labs');
  }
  if (ckd) {
    contextBullets.push('CKD: follow KDIGO CKD-MBD guidance; coordinate with nephrology');
  }
  const safetyCeilingBullet = 'Safety ceiling: do not exceed 4,000 IU/day long-term without specialist supervision';
  // v1.16 Step 3 — large intermittent doses ≥60,000 IU as a single/bolus dose are NOT advised
  // (NOGG 2024 Evidence Ia). The loading protocols in this tool use divided weekly doses to avoid this.
  const intermittentBolusWarningBullet =
    'Do NOT use routine large intermittent vitamin D doses ≥60,000 IU as a single or bolus dose — ' +
    'associated with increased fracture and falls risk (NOGG 2024 Evidence Ia). ' +
    'The loading protocols above use divided weekly doses specifically to avoid this; do not substitute with an equivalent single bolus.';
  // v1.16 Step 2 — Vit D-alone effect framing: does not reduce fracture incidence, may reduce falls.
  const fractureFallsNuanceBullet =
    'Vitamin D alone does not reduce fracture incidence, but may reduce falls risk. ' +
    'It must be combined with pharmacological treatment where indicated (NOGG 2024 Evidence Ib).';
  const calciumWatchBullet =
    (ckd || hyperPTH)
      ? 'Check adjusted calcium 1–2 months after high-dose loading (CKD / hyperparathyroidism)'
      : null;

  if (vitD === null) {
    vitDHeadline = 'Vitamin D level unknown — check at baseline';
    vitDBullets = [
      'Measure 25-OHD at baseline',
      `Pending result: ${obese || malabsorption ? '2,000 IU/day' : '800–2,000 IU/day'} cholecalciferol (e.g. Desunin 800 IU, InVita D3 drops)`,
      'Bisphosphonate may start alongside supplementation — do NOT delay treatment',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
      ...contextBullets,
      safetyCeilingBullet,
      intermittentBolusWarningBullet,
      fractureFallsNuanceBullet,
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.deficient) {
    vitDHeadline = `Severe deficiency (${vitD} nmol/L) — loading required`;
    vitDBullets = [
      'Loading option A: 50,000 IU D3 once weekly × 6–8 weeks (300,000–400,000 IU total)',
      'Loading option B: 30,000 IU D3 twice weekly × 5 weeks (300,000 IU total)',
      `Recheck 25-OHD ~3 months after loading; target ≥${BLOOD_RANGES.vitaminD.target} nmol/L`,
      'Bisphosphonate may start alongside loading — do NOT delay',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
      ...(calciumWatchBullet ? [calciumWatchBullet] : []),
      ...contextBullets,
      safetyCeilingBullet,
      intermittentBolusWarningBullet,
      fractureFallsNuanceBullet,
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.insufficient) {
    vitDHeadline = `Insufficient (${vitD} nmol/L) — start 800–2,000 IU/day`;
    vitDBullets = [
      'No formal loading required',
      `Start ${obese || malabsorption ? '2,000 IU/day' : '800–2,000 IU/day'} cholecalciferol immediately (e.g. Desunin 800 IU, InVita D3 drops)`,
      'Oral bisphosphonate can start alongside supplementation',
      'Do NOT administer denosumab until Vit D ≥50 nmol/L',
      `Recheck at ~3 months; target ≥${BLOOD_RANGES.vitaminD.target} nmol/L`,
      ...contextBullets,
      safetyCeilingBullet,
      intermittentBolusWarningBullet,
      fractureFallsNuanceBullet,
    ];
  } else if (vitD < BLOOD_RANGES.vitaminD.target) {
    vitDHeadline = `Adequate (${vitD} nmol/L) — maintenance only`;
    vitDBullets = [
      `Below target (≥${BLOOD_RANGES.vitaminD.target} nmol/L)`,
      `800–2,000 IU/day maintenance${obese || malabsorption ? ' (use higher end)' : ''}`,
      'Antiresorptive therapy can proceed',
      'Recheck in 6–12 months',
      ...contextBullets,
      safetyCeilingBullet,
      intermittentBolusWarningBullet,
      fractureFallsNuanceBullet,
    ];
  } else {
    vitDHeadline = `Target met (${vitD} nmol/L) — maintenance only`;
    vitDBullets = [
      `≥${BLOOD_RANGES.vitaminD.target} nmol/L target reached`,
      `${obese || malabsorption ? '2,000 IU/day' : '800–2,000 IU/day'} maintenance`,
      'Optimise dietary sources: oily fish, fortified foods, sunlight exposure',
      'No loading required',
      ...contextBullets,
      safetyCeilingBullet,
      intermittentBolusWarningBullet,
      fractureFallsNuanceBullet,
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
  // v1.16 — priority-groups clinical note (NOGG 2024 Rec 26).
  const priorityGroupsBullet =
    'Priority groups for active supplementation (more likely to need it): housebound patients, ' +
    'residents of residential or nursing care, and patients with intestinal malabsorption ' +
    '(coeliac disease, IBD, bariatric surgery).';
  // v1.16 — kidney stone safety statement replaces the previous (incorrect) heart-disease claim.
  // NOGG 2024 (Evidence Ia): Ca + Vit D may increase kidney stone risk only — heart disease and
  // cancer risk are NOT increased. v1.3 TC42 asserts the calcium output must not contain the word
  // "cardiovascular" anywhere, so the bullet phrases the negative outcomes without that term.
  const safetyBullet =
    'Safety: calcium and vitamin D supplements may slightly increase the risk of kidney stones. ' +
    'They do NOT increase the risk of heart disease or cancer (NOGG 2024 Evidence Ia).';

  if (isGIOPPatient) {
    sups.push({
      supplement: 'calcium',
      headline: 'GIOP: 1000–1500 mg/day total intake (target); 700 mg/day Irish/UK RNI minimum floor',
      bullets: [
        'Higher requirement on glucocorticoids (reduced GI absorption, increased renal loss)',
        'Dietary sources first; supplement the deficit',
        'Combined Ca + D3 product if needed (Calcichew D3 Forte, Adcal-D3)',
        'Avoid >500–600 mg/day supplement on top of an adequate diet',
        priorityGroupsBullet,
        safetyBullet,
      ],
      rationale:
        'Glucocorticoids reduce GI calcium absorption and increase renal calcium excretion — ' +
        'higher intake is needed (NOGG 2024 Rec 22; IOF; international consensus). The Irish/UK RNI of 700 mg/day is ' +
        'the population minimum adequate intake; the 1000–1500 mg/day GIOP target reflects the ' +
        'higher requirement under glucocorticoid exposure.',
    });
  } else {
    sups.push({
      supplement: 'calcium',
      headline: 'Target 1200 mg/day total intake; 700 mg/day Irish/UK RNI minimum floor',
      bullets: [
        'Minimum (Irish/UK RNI) 700 mg/day; osteoporosis management target 1200 mg/day total from all sources',
        'Dietary sources preferred — dairy ~300 mg/portion, green veg 100–160 mg/portion, fortified foods',
        'Supplement only the deficit between dietary intake and 1200 mg/day target',
        'Typical supplement dose: 250–600 mg/day depending on diet',
        'Maximum: avoid >500–600 mg/day supplement on top of an adequate diet',
        priorityGroupsBullet,
        safetyBullet,
        'Note: serum calcium does NOT reflect dietary adequacy — assess intake directly',
      ],
      rationale:
        'IOF; NOGG 2024; international consensus: 1200 mg/day total intake target for adults ≥50 with bone loss or osteoporosis; ' +
        'the 700 mg/day Irish/UK RNI is the population minimum adequate intake (the floor below which ' +
        'deficiency is likely). Supplement only if dietary intake is below target. ' +
        'NOGG 2024 (Evidence Ia): the only relevant safety signal is a small increase in kidney stone risk; ' +
        'the previously cited Bolland heart-disease signal has been superseded by NOGG 2024 evidence and is no longer surfaced. ' +
        '(v1.18: "IOS 2024" attribution for 1200 mg/day target replaced — no standalone IOS prescribing document identified.)',
    });
  }

  return sups;
}

// ─── Treatment recipe cards ───────────────────────────────────────────────

// v1.13 Step 6 — planned duration text computed from extension criteria at initiation.
// v1.36 audit: this function is called via withBPInitiationContext when a NEW BP recipe is
// being pushed, so patient.age IS the age at start of that new course. Current-age usage is
// semantically correct here — leave as is.
function plannedBPDuration(patient: PatientInput, isIV: boolean): string {
  const hasExtensionCriterion =
    patient.age >= 70 ||
    patient.priorHipFracture ||
    patient.priorVertebralFracture ||
    isOnHighDoseGC(patient);
  if (isIV) {
    return hasExtensionCriterion
      ? 'Planned duration: at least 6 years (extension criterion at initiation: age ≥70, prior hip/vertebral fracture, or GC ≥7.5 mg/day). NOGG 2024 Section 7 Rec 2 (Strong).'
      : 'Planned duration: at least 3 years, then reassess fracture risk. NOGG 2024 Section 7 Rec 2 (Strong).';
  }
  return hasExtensionCriterion
    ? 'Planned duration: at least 10 years (extension criterion at initiation: age ≥70, prior hip/vertebral fracture, or GC ≥7.5 mg/day). NOGG 2024 Section 7 Rec 1 (Strong).'
    : 'Planned duration: at least 5 years, then reassess fracture risk. NOGG 2024 Section 7 Rec 1 (Strong).';
}

// (formerly asBridgingForGCDrivenVHR / originally asBridgingForVHR — v1.43 Shape B
// extension: three-state return distinguishing GC-driven VHR / non-GC VHR / non-VHR.
// Paired with spec v1.43 §17.6 architecture; supersedes the dd7ef05 / v1.42 §5.5 scope
// narrowing.
//
// State table:
//   GC-driven VHR  → { ...rec, category: 'bridging' }
//                    (gcDrivesVHR true; bridging-BP per NOGG Rec 8(g) — the
//                     "start oral BP in the meantime" instruction attaches only to
//                     the high-dose-GC VHR criterion)
//   Non-GC VHR     → null
//                    (caller skips the push entirely; oral BP not indicated for
//                     other VHR triggers per NOGG Rec 11 + Evidence IIb blunting
//                     of subsequent anabolic response. The patient-preference-fallback
//                     path at v1.43 §7.1.refusesInjections re-emits the BP separately
//                     via a different code path — not via this helper.)
//   Non-VHR        → rec unchanged
//                    (category left undefined; consumers treat undefined as 'primary')
//
// The dd7ef05 transitivity argument (gcDrivesVHR ⇒ VHR-4 ⇒ riskCategory==='very_high')
// is no longer sufficient on its own — the helper now needs to distinguish
// "any VHR vs non-VHR" to decide between the bridging tag and the null suppression.
// So riskCategory is back as an explicit argument. If a future change ever decouples
// VHR-4 from the bridging-instruction GC threshold, the gcDrivesVHR branch's behaviour
// will need rechecking, but the three-state structure stays valid.
function bridgingTagOrNullForVHR(
  rec: TreatmentRecommendation,
  riskCategory: RiskCategory,
  patient: PatientInput,
): TreatmentRecommendation | null {
  if (riskCategory !== 'very_high') {
    return rec;
  }
  const gcDrivesVHR =
    isOnHighDoseGC(patient) && gcDurationMonths(patient) >= GIOP.highDoseMinMonths;
  if (gcDrivesVHR) {
    return { ...rec, category: 'bridging' };
  }
  return null;
}

// Postmenopausal-female derivation — single source of truth used by Shape B
// specialistOptions logic AND the existing raloxifene-follow-on logic at
// treatment.ts:~1324. Matches the inline derivation that was at that site since
// v1.36. Hoisting avoids duplicate definitions drifting independently.
function isPostmenopausalFemale(patient: PatientInput): boolean {
  return patient.sex === 'female' && (patient.age >= 50 || patient.earlyMenopause);
}

// v1.43 Shape B — specialistOptions builder. Returns the per-patient anabolic
// menu the specialist may consider after the GP's referral. Empty array for
// non-VHR patients. Per NOGG 2024 Rec 11 + spec v1.43 §5.5 / §7.1 / §17.6:
//   Postmenopausal female VHR → teri (first_line) + romo (further_option) + abalo (further_option, reimbursement caveat)
//   Male ≥50 VHR              → teri only (first_line); romo and abalo not licensed in men
//   Non-VHR                   → []
function buildSpecialistOptions(
  patient: PatientInput,
  riskCategory: RiskCategory,
): SpecialistOption[] {
  if (riskCategory !== 'very_high') return [];

  const options: SpecialistOption[] = [];
  const postmenopausal = isPostmenopausalFemale(patient);
  const male = patient.sex === 'male';

  if (postmenopausal) {
    options.push({
      drug: 'teriparatide',
      tier: 'first_line',
      rationale:
        'Teriparatide is the first-line anabolic option for postmenopausal women at very high fracture risk ' +
        '(NOGG 2024 Rec 11, Conditional). Particularly indicated where multiple vertebral fractures are present. ' +
        'Evidence Ib (VERO study): 56% fewer new vertebral fractures and 52% fewer clinical fractures at 2 years ' +
        'vs risedronate. 24-month maximum course (lifetime limit; cannot be repeated); sequential antiresorptive ' +
        'mandatory at end of course.',
      reference: 'NOGG 2024 Rec 11; spec §5.5 + §7.1; HSE BVM policy (biosimilar required since March 2023).',
      preReferralChecks:
        'Trigger eGFR + PTH before referral — both must be available and within normal range before specialist ' +
        'initiation (severe renal impairment is a contraindication; raised PTH is a contraindication and must be ' +
        'investigated as secondary cause). Document the values in the referral letter.',
    });
    options.push({
      drug: 'romosozumab',
      tier: 'further_option',
      rationale:
        'Romosozumab is a further anabolic option for postmenopausal women at very high fracture risk ' +
        '(NOGG 2024 Rec 11). Evidence Ib (FRAME trial): 48% reduction in new vertebral fractures, 19% non-vertebral, ' +
        '27% clinical, 38% hip vs alendronate at 24 months. 12-month course (no lifetime limit). Two SC injections ' +
        'of 105 mg monthly. HSE Managed Access Protocol (Nov 2024): T-score ≤−2.5 + major fracture within 24 months. ' +
        'NOT licensed for use in men.',
      reference:
        'NOGG 2024 Rec 11; spec §5.5 + §7.1; HSE Managed Access Protocol — Romosozumab (Evenity) 2024.',
      preReferralChecks:
        'Trigger corrected serum calcium before referral — must be within normal range before specialist initiation ' +
        '(transient hypocalcaemia observed; absolute CI per NOGG p.34). Flag any CV risk factors explicitly in ' +
        'referral letter (CV safety signal per FRAME — history of MI/stroke is contraindication).',
    });
    options.push({
      drug: 'abaloparatide',
      tier: 'further_option',
      rationale:
        'Abaloparatide is a further anabolic option for postmenopausal women at very high fracture risk ' +
        '(NOGG 2024 Rec 11). 18-month maximum course; sequential antiresorptive (e.g. alendronate) required ' +
        'following the course to maintain BMD gains and fracture reduction (NOGG 2024 Evidence IIb). NOT ' +
        'licensed for use in men.',
      reimbursementNote:
        'Not currently HSE-reimbursed in Ireland. Patients may be self-funded in specialist consultation.',
      reference: 'NOGG 2024 Rec 11; spec §5.5 + §7.1.',
      preReferralChecks:
        'Specialist will assess fitness for anabolic therapy and reimbursement pathway. GP role: identify VHR, ' +
        'refer, and flag if patient has discussed private-pay anabolic options.',
    });
    return options;
  }

  if (male && patient.age >= 50) {
    options.push({
      drug: 'teriparatide',
      tier: 'first_line',
      rationale:
        'Teriparatide is the only anabolic agent licensed for men in Ireland (NOGG 2024 Rec 11; spec §5.5). ' +
        'Particularly indicated where multiple vertebral fractures are present. 24-month maximum course ' +
        '(lifetime limit); sequential antiresorptive mandatory at end of course.',
      reference: 'NOGG 2024 Rec 11; spec §5.5 + §7.1; HSE BVM policy.',
      preReferralChecks:
        'Trigger eGFR + PTH before referral — both must be available and within normal range before specialist ' +
        'initiation. Document in referral letter.',
    });
    return options;
  }

  return options;
}

// v1.43 Shape B — patient-preference fallback for VHR + refusesInjections.
// See the call site in generateTreatmentOutput for the full design rationale.
// Mutates `recommendations` and `flags` in place. No-op for any patient profile
// that doesn't match the gate (defence-in-depth: only fires when recommendations
// is empty, riskCategory is very_high, refusesInjections is true, and
// gcDrivesVHR is false).
function applyPatientPreferenceFallbackIfRefuses(
  patient: PatientInput,
  riskCategory: RiskCategory,
  recommendations: TreatmentRecommendation[],
  flags: ClinicalFlag[],
): void {
  if (riskCategory !== 'very_high') return;
  if (!patient.refusesInjections) return;
  const gcDrivesVHR =
    isOnHighDoseGC(patient) && gcDurationMonths(patient) >= GIOP.highDoseMinMonths;
  if (gcDrivesVHR) return;
  if (recommendations.length > 0) return;

  const egfr = resolveEGFR(patient);
  const fallbackRationale =
    'Patient not accepting injectable therapy. Document patient preference and ' +
    'the discussion in the referral letter. Oral bisphosphonates are an ' +
    'alternative therapy option, for further discussion with specialist.';

  if (canUse('alendronate', egfr) && (egfr === null || egfr > RENAL_LIMITS.alendronate.ci)) {
    recommendations.push(withBPInitiationContext({
      ...alendronate(),
      rationale: fallbackRationale,
      category: 'patient_preference_fallback',
    }, patient));
  }
  if (canUse('risedronate', egfr)) {
    recommendations.push(withBPInitiationContext({
      ...risedronate(),
      rationale: fallbackRationale,
      category: 'patient_preference_fallback',
    }, patient));
  }

  flags.push({
    id: 'vhr_anabolic_refusal_context',
    severity: 'info',
    message:
      'Patient not accepting injectable therapy. Oral bisphosphonates surfaced as an ' +
      'alternative therapy option for discussion with the patient and with the specialist. ' +
      "Document the patient's preference and the discussion in the referral letter — the " +
      "specialist consultation may surface considerations or alternatives that affect the patient's view.",
    rationale:
      'Per NOGG Rec 9 (Strong) patient preference is one of four factors driving treatment choice. ' +
      'For VHR patients refusing parenteral therapy (denosumab SC, IV zoledronate, all SC anabolics), ' +
      'oral bisphosphonates remain available as a patient-preference option alongside the specialist ' +
      'referral. This flag does not assert a clinical hierarchy — the specialist consultation may ' +
      'reveal options or considerations the GP cannot.',
    source: SRC_NOGG,
  });
}

// Wraps a bisphosphonate recipe with patient-specific planned-duration monitoring entry.
// Also adds Strong dental-hygiene-at-initiation advice (Step 11) for all antiresorptives.
function withBPInitiationContext(
  rec: TreatmentRecommendation,
  patient: PatientInput,
): TreatmentRecommendation {
  const isIV =
    rec.agent === 'zoledronate' ||
    (rec.agent === 'ibandronate' && rec.dose.includes('IV'));
  const monitoring = [
    plannedBPDuration(patient, isIV),
    ...rec.monitoring,
    'Dental hygiene (Strong, NOGG 2024 Rec 9): maintain good oral hygiene; attend routine dental check-ups; report dental mobility, jaw pain, swelling, or oral ulceration promptly.',
    'Dental procedures during treatment (Conditional, NOGG 2024 Rec 11): there are NO data showing that stopping bisphosphonate or denosumab reduces the risk of ONJ. Do NOT routinely stop treatment before dental procedures.',
  ];
  return { ...rec, monitoring };
}

function alendronate(): TreatmentRecommendation {
  return {
    agent: 'alendronate',
    dose: '70 mg',
    frequency: 'Once weekly, fasting with full glass of water; remain upright ≥30 minutes before eating/other medications',
    rationale:
      // v1.33 — alendronate and risedronate are equivalent first-line oral
      // bisphosphonates per NOGG 2024 Rec 12 / Section 6 Rec 2 (Strong).
      // Previous "PREFERRED" / sole-first-line framing removed.
      'Equivalent first-line oral bisphosphonate with risedronate (NOGG 2024 Rec 12 / Section 6 Rec 2, Strong — most cost-effective interventions; no preference between the two). ' +
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
    irishPrescribingNote: 'First-line (GMS) — GP can prescribe. Equivalent to risedronate per NOGG 2024 Rec 12 (Strong).',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Alendronate is a weekly tablet that strengthens bones by slowing the cells that break down bone tissue. It significantly reduces the risk of hip and spine fractures.',
      howToTake:
        // v1.25 Step 6 — explicit overnight-fast and calcium-supplement timing.
        'Take ONE tablet once a week, on the SAME day each week. Take it first thing in the morning after an overnight fast, at least 30 minutes BEFORE any food, any drink other than plain water, or any other oral medication INCLUDING calcium supplements. ' +
        'Use a full glass (~200 ml) of plain tap water (not tea, juice, mineral water, or coffee). ' +
        'Stay sitting or standing upright for at least 30 minutes afterwards — do not lie down. ' +
        'Common side effects: heartburn, indigestion, mild abdominal discomfort. If swallowing pain develops, stop and contact your GP.',
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
      // v1.33 — risedronate repositioned as equivalent first-line with alendronate
      // per NOGG 2024 Rec 12 / Section 6 Rec 2 (Strong). Previous "second-line oral"
      // framing was historical drift from removed HSE MMP cascade text.
      'Equivalent first-line oral bisphosphonate with alendronate (NOGG 2024 Rec 12 / Section 6 Rec 2, Strong — most cost-effective interventions; no preference between the two). ' +
      'Slightly lower upper-GI adverse effect rate than alendronate. Licensed for men. Generic available.',
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
    irishPrescribingNote: 'First-line (GMS) — equivalent to alendronate per NOGG 2024 Rec 12 (Strong).',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        // v1.25 Step 6 — licensed for men explicitly noted.
        'Risedronate is a weekly tablet that strengthens bones by reducing bone breakdown. Licensed for postmenopausal women AND men. An alternative to alendronate with slightly less upper-GI side effect.',
      howToTake:
        'Take ONE tablet once a week, on the SAME day each week. Take it first thing in the morning after an overnight fast, at least 30 minutes BEFORE any food, any drink other than plain water, or any other oral medication INCLUDING calcium supplements. ' +
        'Full glass (~200 ml) of plain tap water. Stay upright (sitting or standing) for at least 30 minutes afterwards — do not lie down.',
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
    dose: '150 mg oral',
    frequency: 'Once monthly, fasting with full glass of water; remain upright ≥60 minutes',
    rationale:
      'Monthly oral dosing — adherence advantage over weekly. Evidence mainly for vertebral fracture reduction; ' +
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
      'Insufficient evidence for hip fracture reduction — review fracture history at follow-up',
    ],
    irishPrescribingNote: 'GMS standard (less preferred per HSE MMP). Monthly dosing only advantage.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        // v1.25 Step 6 — non-vertebral data at T < −3.0 added.
        'Ibandronate is a monthly tablet that strengthens bones by slowing bone breakdown. Once-monthly dosing improves adherence vs weekly tablets. Note: non-vertebral fracture reduction has only been shown at T-score <−3.0 in subgroup analysis (NOGG 2024); hip fracture reduction has NOT been demonstrated in RCTs. NOT licensed for use in men.',
      howToTake:
        // v1.25 Step 6 — 60-minute fasting and explicit flag that this is longer than alendronate/risedronate.
        'Take ONE tablet on the SAME date each month, first thing in the morning after an overnight fast, at least 1 HOUR (60 minutes) BEFORE any food, any drink other than plain water, or any other oral medication INCLUDING calcium supplements. ' +
        'This is LONGER than the 30-minute requirement for alendronate or risedronate — if you are switching from a weekly tablet, note the change. ' +
        'Full glass (~200 ml) plain tap water. Stay upright for the full 1 hour after taking — do not lie down.',
      sideEffects: [
        'Stomach upset, heartburn',
        'Difficulty swallowing (rare)',
      ],
      warnings: [
        'Must remain upright for the full 1 hour after taking — this is longer than alendronate/risedronate.',
        'Tell your dentist you are on ibandronate before invasive dental work.',
        'Ibandronate has NOT been shown to reduce hip fracture risk — if hip fracture is your main concern, ask your GP about alendronate, risedronate, zoledronate, or denosumab.',
      ],
    },
  };
}

export function ibandronateIV(): TreatmentRecommendation {
  return {
    agent: 'ibandronate',
    // v1.25 Step 6 — bolus push via butterfly cannula, not a slow infusion.
    dose: '3 mg IV — given as a 15–30 second bolus push via a butterfly cannula (NOT a slow infusion like zoledronate)',
    frequency: 'Every 3 months',
    rationale:
      'IV ibandronate — option when oral bisphosphonate is not tolerated and annual zoledronate attendance is not feasible. ' +
      'Quarterly visits provide adherence safety net between annual reviews. ' +
      'NOT licensed for use in men. Insufficient evidence for hip fracture reduction (same caveat as oral ibandronate). ' +
      'Formulation equivalence: 3 mg IV every 3 months ≈ 150 mg PO once monthly. ' +
      'Acute phase reaction may occur (flu-like symptoms), usually first injection only.',
    strength: 'conditional',
    contraindications: [
      'eGFR <30 ml/min',
      'Uncorrected hypocalcaemia (CHECK adjusted calcium before each injection)',
      'Vitamin D deficiency (replete before starting)',
      'Pregnancy',
    ],
    monitoring: [
      'Adjusted calcium and eGFR before each 3-monthly injection',
      'Vitamin D adequacy at baseline (no formal block — but optimise)',
      'DEXA at 1–2 years; reassessment at 3 years',
      'Insufficient evidence for hip fracture reduction — vertebral protection only',
      'Dental review before starting if invasive dental work anticipated',
    ],
    irishPrescribingNote: 'GMS standard. IV ibandronate is less commonly used than zoledronate; appropriate when annual infusion attendance is not feasible.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'IV ibandronate is an injection given into a vein every 3 months. It strengthens bones by slowing bone breakdown. Useful if you cannot tolerate tablets and cannot attend for the annual zoledronate infusion.',
      howToTake:
        'Given as a slow injection into a vein every 3 months, in a clinic or hospital. Quicker than the annual zoledronate infusion.',
      sideEffects: [
        'Flu-like symptoms (less marked than zoledronate)',
        'Mild aches',
      ],
      warnings: [
        'Tell your dentist you are on IV ibandronate before any tooth extraction or jaw surgery.',
        'Your calcium and kidney function will be checked before each injection.',
      ],
    },
  };
}

function zoledronate(): TreatmentRecommendation {
  return {
    agent: 'zoledronate',
    // v1.24 Step 7 — minimum 15-minute infusion via IV cannula; bolus push is NOT acceptable.
    dose: '5 mg IV infusion over a MINIMUM of 15 minutes via a standard IV cannula (not a bolus push)',
    frequency: 'Once yearly — or every 18 months in postmenopausal women with osteopenia (HORIZON extension, Evidence Ib)',
    rationale:
      'IV bisphosphonate — first choice if oral not tolerated. Single annual infusion maximises adherence. ' +
      '70% hip fracture reduction (HORIZON-PFT, Black et al. NEJM 2007). Pre-hydrate (500 ml water) before infusion. ' +
      'Licensed indications (v1.24): postmenopausal osteoporosis, male osteoporosis, glucocorticoid-induced osteoporosis (men and women). ' +
      'Alternative dosing: 5 mg every 18 months in postmenopausal women with osteopenia maintains BMD benefit (HORIZON extension trial; NOGG 2024 Evidence Ib).',
    strength: 'strong',
    contraindications: [
      'eGFR <35 ml/min',
      'PRE-INFUSION SAFETY CHECK: corrected calcium MUST be measured and within normal range before each infusion — risk of severe symptomatic hypocalcaemia if administered while low',
      'Vitamin D deficiency (replete before infusion)',
      'Pregnancy',
    ],
    monitoring: [
      'CHECK adjusted calcium IMMEDIATELY before each infusion — withhold if <2.10 mmol/L until corrected',
      'Vitamin D adequacy and eGFR before each annual infusion',
      // v1.24 — MHRA recommends creatinine clearance (not eGFR) for >75, BMI <18 or >40.
      'MHRA recommendation: use CREATININE CLEARANCE (not eGFR) in patients aged >75 OR BMI <18 OR BMI >40 — eGFR formulae overestimate renal function in these groups',
      // v1.24 — post-infusion creatinine/eGFR monitoring.
      'CHECK creatinine / eGFR after the infusion (typically at the annual review) — transient creatinine rise can occur post-zoledronate',
      'Premedication: paracetamol 1g 1 hour BEFORE infusion, then again 6 hours AFTER — reduces flu-like acute-phase reaction',
      // v1.24 — rare symptomatic AF.
      'Rare adverse event: symptomatic atrial fibrillation (HORIZON trial, Evidence Ib) — uncommon but serious; warn the patient and review cardiac history before infusion',
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

// ─── SERMs ─────────────────────────────────────────────────────────────────
// Raloxifene and bazedoxifene — vertebral fracture protection only.
// Indication: postmenopausal women where bisphosphonates / denosumab are contraindicated
// or not tolerated, particularly when symptomatic menopausal status is relevant.

export function raloxifene(): TreatmentRecommendation {
  return {
    agent: 'raloxifene',
    dose: '60 mg oral',
    frequency: 'Once daily, with or without food — positive adherence note (no fasting requirement)',
    rationale:
      'SERM — vertebral fracture protection only (no robust evidence for hip or non-vertebral fracture reduction). ' +
      'Option for postmenopausal women where bisphosphonates / denosumab are contraindicated or not tolerated. ' +
      'NOT suitable in symptomatic menopausal women — raloxifene can worsen hot flushes; consider bazedoxifene instead. ' +
      'NOT licensed for use in men. ' +
      // v1.27 — added phase III breast cancer signal.
      'Phase III evidence showed reduced breast cancer risk; may be clinically relevant in women with both fracture risk and elevated breast cancer risk factors.',
    strength: 'conditional',
    contraindications: [
      // v1.27 Step 7 — full contraindications list per spec.
      'Personal or family history of VTE (DVT/PE) — VTE risk increase is mostly in the FIRST FEW MONTHS of treatment',
      'Active or recent thromboembolic event',
      // v1.27 — stroke history / risk factors for stroke disease (Evidence IIa).
      'History of stroke or risk factors for stroke disease (NOGG 2024 Evidence IIa — small increase in fatal-stroke risk)',
      'Child-bearing potential',
      'Premenopausal women',
      'Unexplained uterine bleeding',
      'Severe hepatic impairment',
      'Severe renal impairment',
      'Pregnancy',
    ],
    monitoring: [
      'Vertebral protection only — insufficient evidence for hip / non-vertebral fracture',
      'VTE risk: counsel about leg swelling / chest pain symptoms; risk is greatest in the first few months',
      'Stroke risk: small increase in fatal stroke — counsel and avoid in patients with stroke history or significant stroke risk factors',
      'May worsen hot flushes — switch to bazedoxifene if vasomotor symptoms develop',
      'DEXA at 1–2 years',
    ],
    irishPrescribingNote: 'GMS standard. Useful niche — bisphosphonate-contraindicated postmenopausal women without vasomotor symptoms.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Raloxifene is a daily tablet that mimics the effect of oestrogen on bone — it slows bone loss and reduces the risk of spinal fractures.',
      howToTake:
        'One 60 mg tablet daily, swallowed whole with water. Can be taken at any time, with or without food.',
      sideEffects: [
        // v1.27 Step 7 — added leg cramps, oedema, vasomotor symptoms.
        'Hot flushes / vasomotor symptoms — raloxifene can MAKE these WORSE; tell your doctor if vasomotor symptoms become troublesome',
        'Leg cramps',
        'Oedema (mild leg / ankle swelling)',
        'Increased risk of blood clots (DVT / PE) — tell your doctor immediately if you develop calf swelling, chest pain, or breathlessness. Risk is highest in the first few months.',
      ],
      warnings: [
        'Stop and contact a doctor if you develop calf pain or swelling, chest pain, or sudden breathlessness — possible blood clot.',
        'Tell your doctor about any history of blood clots or breast cancer before starting.',
        'If hot flushes worsen significantly, ask your doctor about bazedoxifene as an alternative SERM that does not worsen hot flushes.',
        'Stop 3 days before any planned major surgery or prolonged immobility — restart once mobile.',
      ],
    },
  };
}

export function bazedoxifene(): TreatmentRecommendation {
  return {
    agent: 'bazedoxifene',
    dose: '20 mg oral',
    frequency: 'Once daily',
    rationale:
      'SERM — vertebral fracture protection only (insufficient evidence for hip or non-vertebral). ' +
      'Advantage over raloxifene: does NOT worsen hot flushes — preferred SERM in symptomatic younger postmenopausal women. ' +
      'Also available combined with conjugated oestrogens (Duavive / Viviant) for vasomotor symptoms. ' +
      'Indication: option for symptomatic younger postmenopausal women where bisphosphonates or denosumab are contraindicated or not tolerated. ' +
      'Source: Smith et al. Br J Clin Pharmacol 2025; StatPearls 2024.',
    strength: 'conditional',
    contraindications: [
      'Personal or family history of VTE (DVT/PE) — same as raloxifene',
      'Active or recent thromboembolic event',
      'Premenopausal women',
      'Severe hepatic impairment',
      'Pregnancy',
    ],
    monitoring: [
      'Vertebral protection only — insufficient evidence for hip / non-vertebral fracture',
      'VTE risk: counsel about leg swelling / chest pain symptoms',
      'Does NOT worsen hot flushes (advantage over raloxifene)',
      'DEXA at 1–2 years',
    ],
    irishPrescribingNote:
      'GMS-reimbursed in Ireland since 2012. Niche option — bisphosphonate / denosumab contraindicated younger postmenopausal women, particularly with vasomotor symptoms.',
    source: SRC_HSE,
    patientEducation: {
      whatItDoes:
        'Bazedoxifene is a daily tablet (a SERM) that mimics oestrogen on bone to slow bone loss and reduce spinal fractures. Unlike raloxifene, it does not worsen hot flushes.',
      howToTake:
        'One 20 mg tablet daily, swallowed whole with water. Can be taken at any time, with or without food.',
      sideEffects: [
        'Leg cramps',
        'Mild stomach upset',
        'Increased risk of blood clots (DVT / PE) — tell your doctor immediately if you develop calf swelling, chest pain, or breathlessness',
      ],
      warnings: [
        'Tell your doctor if you have a personal or family history of blood clots before starting.',
        'Stop and contact a doctor if you develop calf pain or swelling, chest pain, or sudden breathlessness.',
        'Provides spinal fracture protection only — does not have proven benefit for hip fracture prevention.',
        'Stop 3 days before any planned major surgery or prolonged immobility — restart once mobile.',
        'A combined product with conjugated oestrogens (Duavive / Viviant) is also available if menopausal symptoms need treatment.',
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
      'POSITIONING: denosumab is FIRST-LINE only when bisphosphonate is contraindicated or unsuitable (AFF, eGFR <35, ' +
      'GI intolerance where IV zoledronate is also unsuitable, oesophageal disease where IV zoledronate is also unsuitable). ' +
      'For all other patients denosumab is the alternative when bisphosphonate is contraindicated (NOGG 2024 Strong) — ' +
      'bisphosphonate is preferred first-line as the most cost-effective antiresorptive. ' +
      'v1.19 — "men on ADT" no longer listed as a first-line carve-out. NOGG 2024 (Conditional, Section 10.1): for ADT-associated bone loss, ' +
      'bisphosphonate and denosumab are equivalent options and normal first-line guidelines apply. The HALT trial established efficacy vs placebo but did NOT establish superiority over bisphosphonates. ' +
      'Not renally cleared, hence the preferred antiresorptive in CKD. ' +
      // v1.26 Step 5 — licensing statement. v1.36 §5.3 rewording: "male osteoporosis (which
      // covers ADT-associated bone loss)" replaces the previous "bone loss with hormone
      // ablation in men (ADT / prostate cancer)" clause; explicit note added that denosumab
      // is NOT uniquely ADT-licensed and that BPs + denosumab are equal first-line per §10.1.
      'LICENSING (v1.26 / v1.36 §5.3): approved for postmenopausal osteoporosis, male osteoporosis (which covers ADT-associated bone loss), and glucocorticoid-induced osteoporosis in men and women. ' +
      'Note: denosumab is NOT uniquely licensed for ADT — bisphosphonates and denosumab are equal first-line for ADT-associated bone loss per NOGG 2024 / §10.1. ' +
      'Safety and efficacy maintained over 10 years of continuous use (Evidence Ib).',
    strength: 'strong',
    contraindications: [
      'Uncorrected hypocalcaemia (MUST correct before each injection)',
      'Vitamin D <50 nmol/L — correct deficiency before administering',
      ...ckdCaution,
    ],
    monitoring: [
      // v1.26 Step 1 — pre-dose calcium check for ALL patients, not just CKD.
      'PRE-DOSE CALCIUM CHECK (SPC requirement, ALL patients): corrected serum calcium must be checked before EVERY denosumab injection regardless of eGFR.',
      'Vitamin D ≥50 nmol/L before each injection (do not administer if <50 nmol/L)',
      // v1.26 — post-injection check remains specific to CKD <35.
      ...(egfr !== null && egfr < RENAL_LIMITS.denosumab.hypocalcaemiaWatch
        ? ['POST-INJECTION: eGFR <35 — corrected calcium MANDATORY at 2 weeks after EVERY injection (severe asymptomatic hypocalcaemia risk).']
        : []),
      // v1.26 Step 2 — hypocalcaemia symptom advice for ALL patients.
      'Hypocalcaemia symptom advice (ALL patients): advise the patient to report symptoms promptly — muscle cramps, spasms, tingling in fingers/toes or around the mouth, seizures. Do NOT wait for routine review.',
      'Strict 6-monthly schedule — clinical risk begins to rise after 6 months + 2 weeks; treat >7 months as urgent',
      'DEXA at 1–2 years',
      // v1.26 Step 4 — cessation hierarchy with FREEDOM statistic.
      'CRITICAL: Plan sequential antiresorptive BEFORE stopping denosumab. NOGG 2024 Strong (§8.2, v1.19/v1.26/v1.36): ' +
        '(1) IV zoledronate 5 mg given 6 months after the last denosumab injection — recommended (Strong). NOT equivalent to alendronate. ' +
        '(2) CTX monitoring at 3 and 6 months post-zoledronate to guide further infusions (Strong). ' +
        '(3) If CTX not available: second IV zoledronate 6 months after the first (Conditional). ' +
        '(4) Alendronate is a SECONDARY option only where IV is not feasible — less reliable, especially after >3 years of denosumab. ' +
        'FREEDOM study evidence: 60.7% of patients who fractured after denosumab cessation sustained MULTIPLE vertebral fractures (vs 38.7% on placebo discontinuation). ' +
        'Particularly careful consideration is needed before starting denosumab in younger postmenopausal women and men given the difficulty of stopping.',
      // v1.29 Step 12 — denosumab → romosozumab attenuation note.
      'If switching denosumab → romosozumab (specialist initiation): expect ATTENUATION of the BMD increase at spine and hip compared to treatment-naïve patients (v1.29). The specialist should be aware of denosumab history when considering romosozumab.',
      'Dental hygiene (Strong, NOGG 2024 Rec 9): maintain good oral hygiene; attend routine dental check-ups; report dental mobility, jaw pain, swelling, or oral ulceration promptly.',
      'Dental procedures during treatment (Conditional, NOGG 2024 Rec 11): there are NO data showing that stopping denosumab reduces the risk of ONJ. Do NOT routinely stop treatment before dental procedures.',
    ],
    irishPrescribingNote:
      'POSITIONING: alternative when bisphosphonate is contraindicated (NOGG 2024 Strong) — alendronate first-line for most patients as the most cost-effective antiresorptive. v1.19: "men on ADT" no longer listed here; for ADT bone loss, BP and denosumab are equivalent per NOGG Section 10.1. ' +
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
      // v1.26 Step 3 — recognised side effects expanded; ONJ / AFF flagged as rare.
      sideEffects: [
        'Mild pain or redness at the injection site',
        'Skin infections (predominantly cellulitis) — seek medical attention for any spreading redness, warmth, or fever',
        'Eczema',
        'Low blood calcium (hypocalcaemia) — your calcium will be checked BEFORE every injection',
        'Flatulence',
        'Aching in joints or muscles',
        'Rare: osteonecrosis of the jaw (ONJ); atypical femoral fracture (AFF) — see warnings below',
      ],
      warnings: [
        'CRITICAL: Never stop denosumab without talking to your doctor first. Stopping can cause several broken bones at once (rebound fractures) — a different bone-protecting drug must be started before or at the same time as stopping.',
        'You cannot donate blood after receiving denosumab.',
        'Your injection must not be delayed — fracture risk rises if more than 6 months pass since the last injection. Contact your doctor immediately if your appointment is delayed.',
        'Tell your dentist you are receiving denosumab before any tooth extraction or invasive dental work — there is a very small risk of jaw problems (osteonecrosis of the jaw).',
        'Report symptoms of low calcium promptly — muscle cramps, spasms, tingling in fingers/toes or around the mouth, seizures. Do not wait for your routine appointment.',
        'Ensure your vitamin D and calcium are adequate — you will have a blood test before each injection.',
      ],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function addVitDBlock(patient: PatientInput, flags: ClinicalFlag[]): void {
  // v1.30 follow-up — the Vit D threshold below which denosumab is held is the
  // same "insufficient" boundary used by the supplement output (Step 9) and the
  // tiered safety logic. Read it from BLOOD_RANGES so the three Vit D steps
  // (Step 2 safety block, Step 5 drug-selection filter, Step 9 patient
  // education) stay in sync if the threshold is ever revised.
  const vitD = patient.bloodResults?.vitaminDNmol;
  const threshold = BLOOD_RANGES.vitaminD.insufficient;
  if (vitD !== undefined && vitD !== null && vitD < threshold) {
    flags.push({
      id: 'denosumab_vitd_block',
      severity: 'urgent',
      message:
        `HOLD denosumab — Vit D ${vitD} nmol/L (<${threshold}). Correct first; do not administer until ≥${threshold} nmol/L. Bisphosphonate (oral or IV zoledronate) is NOT held by Vit D — only denosumab.`,
      rationale:
        'Denosumab reduces bone resorption acutely; if vitamin D and calcium are not replete, ' +
        `severe hypocalcaemia can occur. Mandatory to correct Vit D to ≥${threshold} nmol/L before each dose.`,
      source: SRC_NOGG,
    });
  }
}

function resolveEGFR(patient: PatientInput): number | null {
  // v1.31 follow-up — eGFR now has a single schema home on BloodResults.egfr.
  // The previous renalFunction slot has been removed; the UI exposes eGFR
  // only on the bloods / investigations page.
  return patient.bloodResults?.egfr ?? null;
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

// v1.23 — drugs NOT licensed for use in men.
// Romosozumab, ibandronate (oral & IV), HRT, raloxifene, abaloparatide.
// Teriparatide IS licensed for men — not in this set.
export const MALE_NOT_LICENSED: Set<TreatmentAgent> = new Set<TreatmentAgent>([
  'romosozumab',
  'ibandronate',
  'hrt',
  'raloxifene',
  'abaloparatide',
]);

// v1.23 — teriparatide lifetime limit. One 24-month course only.
// Romosozumab and abaloparatide are NOT subject to this restriction.
function hasCompletedTeriparatideCourse(patient: PatientInput): boolean {
  for (const t of patient.previousTreatments) {
    if (t.agent !== 'teriparatide') continue;
    if (t.currentlyOn) continue;
    if (t.reasonStopped === 'completed_course') return true;
    if (t.durationMonths >= 24) return true;
  }
  return false;
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

// v1.30 — stricter check than hasPreviousGIIntoleranceToBP. Returns true ONLY
// when the patient has GI intolerance documented to BOTH an oral bisphosphonate
// AND an IV bisphosphonate. Used by the denosumab-second-line soft prompt to
// avoid firing when the patient has a legitimate CI to all bisphosphonates.
// Note: the schema does not distinguish oral vs IV ibandronate; for this
// stricter test ibandronate is counted on the oral side (IV ibandronate
// rarely causes GI intolerance). IV class is therefore zoledronate only.
function hasGIIntoleranceToBothOralAndIVBP(patient: PatientInput): boolean {
  const oralGI = patient.previousTreatments.some(
    t => (t.agent === 'alendronate' || t.agent === 'risedronate' || t.agent === 'ibandronate') &&
         t.reasonStopped === 'gi_intolerance',
  );
  const ivGI = patient.previousTreatments.some(
    t => t.agent === 'zoledronate' && t.reasonStopped === 'gi_intolerance',
  );
  return oralGI && ivGI;
}
