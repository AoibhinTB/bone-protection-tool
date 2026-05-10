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
  getAgeThreshold,
  effectiveGCDoseMgDay,
  isOnGC,
  isOnHighDoseGC,
  isOnMediumOrHighDoseGC,
  gcDurationMonths,
  PAUSE_REASSESSMENT_INTERVAL_MONTHS,
  BP_INDIVIDUAL_BASIS_AFTER_YEARS,
} from './thresholds';
import type { RiskStratification } from './types';

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
  riskStratification: RiskStratification,
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
    const egfr = patient.renalFunction?.egfr ?? patient.bloodResults?.egfr ?? null;
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
        'Source: Johansson et al. 2015; Wändell et al. 2021.',
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
          'are independently sufficient for clinical diagnosis of osteoporosis. Source: NOGG 2024 Rec 4.',
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
      flags.push({
        id: 'falls_risk_assessment',
        severity: 'info',
        message:
          'Assess falls risk. Offer exercise programme to improve balance and muscle strength to those at risk.',
        rationale:
          'Falls drive most fragility fractures. Exercise programmes that improve balance and muscle strength ' +
          '(e.g. Otago, tai chi) reduce fall and fracture risk in older adults. Combine with home-hazard review, ' +
          'medication review for fall risk, and annual vision check. Source: NOGG 2024 Rec 5.',
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
  // Patient is currently NOT on a BP, but had a previous BP stopped for treatment_holiday.
  // Surface a restart-consideration flag if BTM is rising OR BMD has decreased on repeat DEXA.
  {
    const onPause =
      !patient.currentTreatment &&
      patient.previousTreatments.some(
        t => isBisphosphonate(t.agent) && t.reasonStopped === 'treatment_holiday',
      );
    if (onPause && (patient.boneTurnoverMarkersRising === true || patient.bmdDecreasedDuringPause === true)) {
      const triggers: string[] = [];
      if (patient.boneTurnoverMarkersRising === true) triggers.push('rising bone turnover markers (CTX / P1NP)');
      if (patient.bmdDecreasedDuringPause === true) triggers.push('BMD decreased on repeat DEXA');
      flags.push({
        id: 'bp_pause_restart_signal',
        severity: 'warning',
        message:
          `Bisphosphonate pause restart signal: ${triggers.join('; ')}. Consider restarting bisphosphonate before the scheduled FRAX reassessment.`,
        rationale:
          'NOGG 2024 Section 6.6 Rec 7 (Conditional): in addition to fracture (Rec 3) and scheduled FRAX reassessment (Rec 4), ' +
          'consider restart if biochemical markers indicate relapse from suppressed bone turnover OR BMD has decreased on repeat DEXA. ' +
          'No definitive thresholds for BTM/BMD change have been established — clinical judgement applies.',
        source: SRC_NOGG,
      });
    }
  }

  // ── GC withdrawal — Section 9.4 review of bone protection (v1.13) ──
  // Patient was previously on oral GC, has now stopped, AND is currently on a bisphosphonate.
  // Bone-protective therapy may be considered for withdrawal IF FRAX (with BMD) reassessment
  // shows BOTH MOF and hip below the age-specific intervention threshold.
  if (
    patient.glucocorticoidPreviouslyUsed &&
    !isOnGC(patient) &&
    patient.currentTreatment?.currentlyOn === true &&
    isBisphosphonate(patient.currentTreatment.agent)
  ) {
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

  // Intermediate risk without DEXA — branch on whether BMD is unavailable per NOGG 2024 Rec 6.
  // Bypass: recent fracture (treat immediately) or AI threshold met (DEXA not required to decide).
  if (
    riskCategory === 'intermediate' &&
    !patient.dexaResults &&
    !patient.currentTreatment &&
    !patient.recentFractureWithin2Years &&
    !aiLowerThresholdMet
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
        return { recommendations: [], flags, referrals, supplements };
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
      return { recommendations: [], flags, referrals, supplements };
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
    return { ...giop(patient, riskCategory, riskStratification, flags, referrals), supplements };
  }

  // ── Contextual flags ──
  adtFlags(patient, flags);
  aiFlags(patient, flags);
  affFlags(patient, flags);

  // ── High → very high re-designation consideration (NOGG 2024 Section 3 + Table 2) ──
  // High-risk patients with ≥2 Table 2 modifiers → prompt clinician to consider VHR.
  // Modifiers that already drive VHR independently (high-dose GC ≥3mo, T ≤ −3.5) are excluded.
  if (riskCategory === 'high') {
    const modifiers: string[] = [];

    if (patient.fallsInLastYear >= 2) {
      modifiers.push(`recurrent falls (${patient.fallsInLastYear}/year)`);
    }
    if (patient.type2Diabetes || patient.secondaryOsteoporosis.includes('type1_diabetes')) {
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
        : 'Refer to osteoporosis specialist in secondary care for assessment and consideration of parenteral treatment. Some may need first-line anabolic drug treatment, especially those with multiple vertebral fractures.',
      rationale:
        'NOGG 2024 (Conditional): consider referral of very high-risk patients to an osteoporosis specialist in secondary care, ' +
        'for assessment and consideration of parenteral treatment (some may need first-line anabolic drug treatment, especially those with multiple vertebral fractures). ' +
        'Indications include single important risk factors (recent vertebral fracture <2y, ≥2 vertebral fractures, T-score ≤−3.5, ' +
        'high-dose glucocorticoids ≥7.5 mg/day for ≥3 months — refer urgently given rapid post-initiation bone loss), multiple clinical risk factors with a recent fragility fracture, ' +
        'or other indicators (FRAX-defined VHR). ' +
        'GP cannot initiate High-Tech anabolic drugs (teriparatide biosimilar, romosozumab) — these require specialist initiation. ' +
        'Romosozumab HSE MAP (effective 1 Nov 2024): postmenopausal women with T ≤ −2.5 + MOF within 24 months; individual patient application via approved consultant; High Tech Hub prescription only. ' +
        'Source: HSE Managed Access Protocol — Romosozumab (Evenity), available at assets.hse.ie/media/documents/HSE_Managed_Access_Protocol_Romosozumab.pdf',
      source: SRC_ROMO_MAP,
    });
    referrals.push({
      specialty: 'metabolic_bone',
      reason: gcDrivesVHR
        ? 'Very high fracture risk driven by high-dose glucocorticoid use — urgent referral; rapid bone loss post-GC initiation. Start oral bisphosphonate in the meantime if any delay anticipated.'
        : 'Very high fracture risk — assessment and consideration of parenteral treatment per NOGG 2024 (some may need first-line anabolic, especially with multiple vertebral fractures).',
      urgency: gcDrivesVHR ? 'urgent' : 'soon',
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
        'DO NOT prescribe any bisphosphonate — confirmed AFF history. Use denosumab or teriparatide biosimilar (HSE BVM policy March 2023); refer specialist.',
      rationale:
        'AFF is a class effect of bisphosphonates due to suppression of bone remodelling at cortical stress sites. ' +
        'Rechallenge with any bisphosphonate carries recurrence risk and is contraindicated. ' +
        'NOGG 2024 Section 7.2 / ASBMR Task Force: after confirmed AFF, bisphosphonates should generally be avoided permanently.',
      source: SRC_NOGG,
    });
  }

  // ── Existing treatment — sequencing logic ──
  if (patient.currentTreatment) {
    const seq = sequencing(patient, riskCategory, riskStratification, flags, referrals);
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
      reason: 'AFF history — teriparatide biosimilar (HSE BVM policy March 2023) is the preferred specialist-initiated alternative to denosumab if antiresorptive is not tolerated.',
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
      recs.push(withBPInitiationContext({
        ...alendronate(),
        priority: 'alternative',
        rationale:
          'Second-line alternative on ADT. Consider if denosumab not feasible (cost, adherence, patient preference). ' +
          'Note: denosumab has the strongest fracture-reduction RCT evidence in this population (HALT trial, Smith et al. NEJM 2009).',
      }, patient));
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
      recs.push(withBPInitiationContext({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection.',
        priority: 'first-line',
      }, patient));
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
    recs.push(withBPInitiationContext(alendronate(), patient));
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
  recs.push(withBPInitiationContext(alendronate(), patient));
  return recs;
}

// ─── Bisphosphonate sequencing (patient on existing treatment) ────────────

function sequencing(
  patient: PatientInput,
  riskCategory: RiskCategory,
  riskStratification: RiskStratification,
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
      recs.push(withBPInitiationContext({
        ...alendronate(),
        rationale:
          'Add alendronate alongside HRT: T-score remains ≤−2.5 despite HRT, suggesting HRT alone is insufficient bone protection.',
        priority: 'first-line',
      }, patient));
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
  const possibleOnTxFracture =
    current.currentlyOn && current.durationMonths >= 12 && patient.numberOfPriorFractures >= 2;

  if (possibleOnTxFracture && !explicitTreatmentFailure) {
    flags.push({
      id: 'on_treatment_fracture_pathway',
      severity: 'warning',
      message:
        `Fragility fracture on ${current.agent} (${Math.round(current.durationMonths / 12)}y duration). ` +
        'Mandatory pathway: (1) review adherence — poor adherence is <80% of prescribed treatment taken correctly; ' +
        '(2) investigate secondary causes — repeat Tier 2 bloods minimum, consider Tier 3 if not previously done; ' +
        '(3) only classify as treatment failure if adherence ≥80% and secondary causes excluded. ' +
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
          ? ' No specific evidence base exists for treatment pauses in men — each case must be judged individually.'
          : '';

      if (pauseDecision.takeHoliday) {
        // v1.13 Step 8 — drug-specific reassessment interval after the pause
        const reassessMonths = PAUSE_REASSESSMENT_INTERVAL_MONTHS[
          current.agent as 'alendronate' | 'risedronate' | 'ibandronate' | 'zoledronate'
        ];
        flags.push({
          id: 'bp_holiday_appropriate',
          severity: 'info',
          message:
            `${holidayYear}-year bisphosphonate reassessment: fracture risk appears low/intermediate ` +
            `(${pauseDecision.reasons.join('; ')}). ` +
            `An individualised treatment pause may be considered. Reassess with FRAX + femoral neck BMD at ` +
            `${reassessMonths} months for ${current.agent} (drug-specific offset kinetics; NOGG 2024 Section 7 Rec 4). ` +
            'If a new fracture occurs during the pause, FRAX reassessment and restart is triggered immediately ' +
            'regardless of the above interval (NOGG Section 7 Rec 3). ' +
            'This is NOT a routine recommendation — there is no standard policy for all patients.' +
            maleCaveat,
          rationale:
            'NOGG 2024 Section 7 Rec 4 (Strong): after a pause, FRAX reassessment intervals are drug-specific — ' +
            'risedronate / ibandronate at 18 months, alendronate at 2 years, zoledronate at 3 years (offset kinetics differ). ' +
            'Routine drug holidays remain unsupported (Evidence IIa); pause considered only if risk falls to low/intermediate.',
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
  riskStratification: RiskStratification,
): { takeHoliday: boolean; reasons: string[] } {
  const continueReasons: string[] = [];

  // v1.13 Step 7: continuation criteria from NOGG 2024 Section 7 Rec 1–2 + Rec 6.
  // Continue if age ≥70
  if (patient.age >= 70) {
    continueReasons.push('age ≥70 at start of bisphosphonate (Section 7 Rec 1–2 Strong)');
  }

  // Continue if hip or vertebral fracture history
  if (patient.priorHipFracture || patient.priorVertebralFracture) {
    continueReasons.push('prior hip or vertebral fracture (Section 7 Rec 1–2 Strong)');
  }

  // Continue if fracture during the first 5 yr (oral) / 3 yr (IV) — extension indication (Section 7 Rec 1–2).
  // Note: this is NOT auto-failure (see Section 6.3); adherence/secondary cause review required first.
  if (patient.numberOfPriorFractures >= 2 && patient.currentTreatment?.durationMonths && patient.currentTreatment.durationMonths >= 12) {
    continueReasons.push('fragility fracture during treatment — extension indication (Section 7 Rec 1–2; review adherence + secondary causes first per Section 6.3)');
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
    return { takeHoliday: false, reasons: continueReasons };
  }

  return {
    takeHoliday: true,
    reasons: ['T-score >−2.5 at hip', 'no hip or vertebral fracture', 'age <70', 'no ongoing steroids ≥7.5 mg/day', 'FRAX adjusted below IT'],
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
    // Injection due at 6 months — warning. Bone turnover markers rise from ~3 months and
    // exceed baseline by 6 months after a missed dose.
    if (
      patient.denosumabMonthsSinceLastDose !== null &&
      patient.denosumabMonthsSinceLastDose >= 6 &&
      patient.denosumabMonthsSinceLastDose < DENOSUMAB.reboundRiskThresholdMonths
    ) {
      flags.push({
        id: 'denosumab_injection_due',
        severity: 'warning',
        message:
          'Injection due — schedule immediately. Bone turnover markers begin rising 3 months after a missed dose and reach above-baseline levels by 6 months.',
        rationale:
          'NOGG 2024 Rec 18 / Cummings SR et al. JBMR 2018: bone resorption markers (CTX) rise progressively from 3 months after a missed dose. ' +
          'By 6 months, levels exceed pre-treatment baseline — schedule the next dose without further delay.',
        source: SRC_NOGG,
      });
    }

    // Overdue injection ≥7 months — urgent (FREEDOM trial citation)
    if (
      patient.denosumabMonthsSinceLastDose !== null &&
      patient.denosumabMonthsSinceLastDose >= DENOSUMAB.reboundRiskThresholdMonths
    ) {
      flags.push({
        id: 'denosumab_overdue_injection',
        severity: 'urgent',
        message:
          `Injection overdue — significant rebound vertebral fracture risk. FREEDOM trial data show fracture rate increases from 1.2 to 7.1 per 100 patient-years after discontinuation.`,
        rationale:
          'Cummings SR et al. Vertebral fractures after discontinuation of denosumab: a post hoc analysis of the FREEDOM trial and its extension. ' +
          'J Bone Miner Res. 2018;33(2):190–198. https://pubmed.ncbi.nlm.nih.gov/29105841/. ' +
          'Vertebral fracture rate rose from 1.2 per 100 patient-years (on denosumab) to 7.1 per 100 patient-years after stopping. ' +
          'NOGG 2024 Rec 18–19: gaps ≥7 months since the last denosumab dose mark imminent vertebral fracture risk.',
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
  // (b) Female ≥70 — any dose
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
): Omit<TreatmentOutput, 'supplements'> {
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
        'Very high risk GIOP (multiple VFs or T ≤−3.5 on glucocorticoids): teriparatide biosimilar (HSE BVM policy March 2023) preferred over bisphosphonate; specialist initiation. Modest hip BMD effect — consider BP first then teriparatide if severe hip osteoporosis.',
      rationale:
        'NOGG 2024 Rec 23 / BSR 2022: teriparatide shown superior to alendronate in GIOP (Saag et al. NEJM 2007). ' +
        'GIOP VHR = multiple vertebral fractures OR T-score ≤-3.5 on steroids. ' +
        'HSE Best Value Medicine policy (1 March 2023): prescribe the recommended teriparatide biosimilar; originator Forsteo not reimbursed unless biosimilar is clinically unsuitable. ' +
        'Teriparatide contraindications: unexplained raised ALP, Paget\'s disease, prior radiation to skeleton, ' +
        'renal calculi, hypercalcaemia, hyperparathyroidism, haematological malignancy, active malignancy. ' +
        'Source: Smith et al. Br J Clin Pharmacol 2025; HSE MMP BVM policy.',
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
    recs.push(withBPInitiationContext({
      ...alendronate(),
      rationale:
        'First-line bisphosphonate for GIOP (NOGG 2024 Rec 23; HSE MMP). ' +
        'Initiate at same time as glucocorticoid if planned duration ≥3 months. ' +
        'Calcium 1000–1500 mg/day and vitamin D ≥800 IU/day required alongside.',
    }, patient));
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

  // Patient context that modifies dosing
  const obese = patient.bmi !== null && patient.bmi >= 30;
  const malabsorption =
    patient.secondaryOsteoporosis.includes('malabsorption') ||
    patient.secondaryOsteoporosis.includes('celiac_disease') ||
    patient.secondaryOsteoporosis.includes('inflammatory_bowel_disease');
  const ckd =
    (patient.renalFunction?.egfr ?? patient.bloodResults?.egfr ?? 999) < 60;
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

// v1.13 Step 6 — planned duration text computed from extension criteria at initiation.
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

export function ibandronateIV(): TreatmentRecommendation {
  return {
    agent: 'ibandronate',
    dose: '3 mg IV bolus',
    frequency: 'Every 3 months',
    rationale:
      'IV ibandronate — option when oral bisphosphonate is not tolerated and annual zoledronate attendance is not feasible. ' +
      'Quarterly visits provide adherence safety net between annual reviews. ' +
      'Insufficient evidence for hip fracture reduction (same caveat as oral ibandronate).',
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
    dose: '5 mg IV infusion over ≥15 minutes',
    frequency: 'Once yearly',
    rationale:
      'IV bisphosphonate — first choice if oral not tolerated. Single annual infusion maximises adherence. ' +
      '70% hip fracture reduction (HORIZON-PFT, Black et al. NEJM 2007). Pre-hydrate (500ml water) before infusion.',
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

// ─── SERMs ─────────────────────────────────────────────────────────────────
// Raloxifene and bazedoxifene — vertebral fracture protection only.
// Indication: postmenopausal women where bisphosphonates / denosumab are contraindicated
// or not tolerated, particularly when symptomatic menopausal status is relevant.

export function raloxifene(): TreatmentRecommendation {
  return {
    agent: 'raloxifene',
    dose: '60 mg oral',
    frequency: 'Once daily, with or without food',
    rationale:
      'SERM — vertebral fracture protection only (no robust evidence for hip or non-vertebral fracture reduction). ' +
      'Option for postmenopausal women where bisphosphonates / denosumab are contraindicated or not tolerated. ' +
      'NOT suitable in symptomatic menopausal women — raloxifene can worsen hot flushes; consider bazedoxifene instead.',
    strength: 'conditional',
    contraindications: [
      'Personal or family history of VTE (DVT/PE)',
      'Active or recent thromboembolic event',
      'Premenopausal women',
      'Severe hepatic impairment',
      'Pregnancy',
    ],
    monitoring: [
      'Vertebral protection only — insufficient evidence for hip / non-vertebral fracture',
      'VTE risk: counsel about leg swelling / chest pain symptoms',
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
        'Hot flushes — raloxifene can MAKE vasomotor symptoms WORSE; tell your doctor if these become a problem',
        'Leg cramps',
        'Increased risk of blood clots (DVT / PE) — tell your doctor immediately if you develop calf swelling, chest pain, or breathlessness',
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
      'POSITIONING: denosumab is FIRST-LINE only in specific populations — eGFR <35, men on ADT (HALT trial), ' +
      'and bisphosphonate contraindication (AFF, severe renal impairment, GI intolerance where IV zoledronate is also unsuitable). ' +
      'For all other patients denosumab is SECOND-LINE per HSE MMP cascade and NICE positioning — bisphosphonate is preferred first-line. ' +
      'Not renally cleared, hence the preferred antiresorptive in CKD.',
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
      'Dental hygiene (Strong, NOGG 2024 Rec 9): maintain good oral hygiene; attend routine dental check-ups; report dental mobility, jaw pain, swelling, or oral ulceration promptly.',
      'Dental procedures during treatment (Conditional, NOGG 2024 Rec 11): there are NO data showing that stopping denosumab reduces the risk of ONJ. Do NOT routinely stop treatment before dental procedures.',
    ],
    irishPrescribingNote:
      'POSITIONING: first-line only in specific groups (eGFR <35, men on ADT, BP contraindications). Otherwise second-line per HSE MMP cascade — alendronate first-line for most patients. ' +
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
        `HOLD denosumab — Vit D ${vitD} nmol/L (<50). Correct first; do not administer until ≥50 nmol/L. Bisphosphonate (oral or IV zoledronate) is NOT held by Vit D — only denosumab.`,
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
