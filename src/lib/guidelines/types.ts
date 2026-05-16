// Clinical types for bone protection decision support
// All types are plain data — no UI dependencies

export type Sex = 'male' | 'female';

export type RiskCategory = 'low' | 'intermediate' | 'high' | 'very_high' | 'out_of_scope';

export type TrafficLight = 'green' | 'amber' | 'red' | 'dark_red' | 'grey';

export type FlagSeverity = 'info' | 'warning' | 'urgent';

export type Urgency = 'routine' | 'soon' | 'urgent';

export type RecommendationStrength = 'strong' | 'conditional';

export type GlucocorticoidDose =
  | 'very_low'  // prednisolone <2.5 mg/day — FRAX may slightly overestimate
  | 'low'       // 2.5–7.4 mg/day — FRAX relatively accurate
  | 'medium'    // 7.5–20 mg/day — high-dose; FRAX underestimates; apply arithmetic adjustment
  | 'high';     // >20 mg/day — high-dose; FRAX underestimates; apply arithmetic adjustment

export interface GlucocorticoidUse {
  current: boolean;
  durationMonths: number;
  dose: GlucocorticoidDose;
}

// v1.13 schema change: numeric GC dose field is now the canonical input for the
// three-tier FRAX Table 8 adjustment, GIOP immediate-start criteria, VHR
// classification, BP extension criteria, and holiday eligibility. The legacy
// categorical field (glucocorticoidUse) is kept for UI compatibility; engine
// reads the numeric field via the effectiveGCDoseMgDay() helper which falls
// back to a mapping of the legacy categorical when the numeric is null.

export type SecondaryOsteoporosisCause =
  | 'type1_diabetes'
  | 'osteogenesis_imperfecta'
  | 'untreated_hyperthyroidism'
  | 'hypogonadism'
  | 'chronic_malnutrition'
  | 'malabsorption'                  // coeliac, IBD, bariatric
  | 'chronic_liver_disease'
  | 'inflammatory_bowel_disease'
  | 'celiac_disease'
  | 'cushing_syndrome'
  | 'hyperparathyroidism'
  | 'antiepileptic_use'              // enzyme-inducing: phenytoin, carbamazepine
  | 'copd'                           // often combined with steroid use
  | 'chronic_kidney_disease';        // CKD 3a–5 / non-dialysis (NOGG Table 1)

// v1.31 follow-up — RenalFunction removed. eGFR now lives only on
// BloodResults.egfr. Single source of truth for kidney function across UI,
// engine, and tests.

export interface DexaResults {
  lumbarSpineTScore: number | null;
  totalHipTScore: number | null;
  femoralNeckTScore: number | null;
  forearmTScore: number | null; // 33% radius — peripheral DEXA; forearm-only osteoporosis
}

export interface BloodResults {
  adjustedCalciumMmol: number | null;       // mmol/L
  vitaminDNmol: number | null;              // nmol/L (25-OHD)
  egfr: number | null;                      // ml/min/1.73 m²
  alp: number | null;                       // U/L — bone turnover, Paget's, osteomalacia screen (normal 30–130)
  tshMUL: number | null;                    // mU/L — TSH (normal 0.4–4.0)
  hbGramsPerLitre: number | null;           // g/L — Hb (anaemia threshold: <120 women, <130 men)
  esrOrCrp: 'normal' | 'elevated' | null;   // ESR or CRP categorical — null = not done
}

export type BisphosphonateAgent = 'alendronate' | 'risedronate' | 'zoledronate' | 'ibandronate';

export type AnabolicAgent = 'teriparatide' | 'romosozumab' | 'abaloparatide';

export type TreatmentAgent =
  | BisphosphonateAgent
  | AnabolicAgent
  | 'denosumab'
  | 'hrt'
  | 'raloxifene'
  | 'bazedoxifene';

export type TreatmentStopReason =
  | 'gi_intolerance'
  | 'aff_confirmed'
  | 'onj'
  | 'treatment_holiday'
  | 'treatment_failure'
  | 'renal_impairment'
  | 'completed_course'
  | 'patient_choice';

export interface TreatmentHistory {
  agent: TreatmentAgent;
  /** Total months the patient was on this treatment (cumulative drug exposure). */
  durationMonths: number;
  reasonStopped: TreatmentStopReason | null;
  /** True iff the patient is actively dosing right now. False = paused, stopped, or holiday. */
  currentlyOn: boolean;
  /**
   * Months since the last dose of THIS treatment.
   *   - null  = not provided / not applicable
   *   - 0     = dosed today / actively on (ignored when currentlyOn=true unless paused)
   *   - >0    = on a pause / cessation
   * Drives:
   *   - Bisphosphonate holiday reassessment interval (Section 6.4) — the drug-specific
   *     intervals (risedronate/ibandronate 18m, alendronate 2y, zoledronate 3y) count from
   *     last dose, not from the end of the planned course.
   *   - Denosumab rebound alerts (Section 8) — 6 m / 7 m alerts and the zoledronate
   *     bridging recommendation must fire from the last injection date, not from
   *     treatment duration.
   *   - Bone turnover marker / BMD restart signal (Section 6.6) — only relevant during an
   *     active pause period.
   */
  monthsSinceLastDose: number | null;
  /**
   * v1.36 (§6.2) — patient age at the START of this treatment course. Drives the
   * NOGG 2024 §6.2 "age ≥70 at start of bisphosphonate" continuation criterion.
   * If undefined, shouldTakeBPHoliday falls back to floor(patient.age - durationMonths/12)
   * as a transitional safety net — production builders should set explicitly.
   */
  ageAtStart?: number;
  /**
   * v1.36 (§6.3) — true iff a fragility fracture occurred DURING this current drug
   * course (vs. before the course started). Distinct from numberOfPriorFractures
   * which is cumulative across the patient's history. Drives the §6.2 continuation
   * criterion "fracture during treatment with adequate adherence", and the §6.3
   * on-treatment-fracture pathway. Undefined treated as false.
   */
  fractureOnCurrentTreatment?: boolean;
  /**
   * v1.36 (§6.3) — clinician-assessed adherence ≥80% of prescribed doses (per
   * §6.3 Rec 5 threshold). Three states:
   *   - true     adherence ≥80% confirmed; supports continuation + structured extension
   *   - false    adherence <80%; routes on-treatment fracture to correction path
   *   - null     not yet assessed; engine emits "adherence assessment required" flag
   *              and the §6.2 fracture-with-adherence criterion does NOT fire as met.
   * Read by both shouldTakeBPHoliday (continuation decision) and the §6.3
   * on-treatment-fracture pathway — single source of truth, two output paths.
   */
  adherenceAdequate?: boolean | null;
}

// v1.19 — single 4-option GC status. Replaces the previous pair of booleans
// (recentOralGlucocorticoidUse, glucocorticoidPreviouslyUsed) which were ambiguous
// (a 6-month-stopped patient was simultaneously "recent" and "previously used") and
// served different downstream pathways. The dose fields (glucocorticoidUse,
// glucocorticoidDoseMgDay) carry the current course's dose and are orthogonal —
// they remain in PatientInput unchanged.
//
//   'current'              → drives Table 8 FRAX correction, GIOP immediate-start,
//                            BP-holiday ineligibility, extension criteria.
//   'stopped_within_12m'   → drives VFA recommendation (silent vertebral fractures
//                            may have occurred during the GC period).
//   'stopped_over_12m_ago' → drives Section 9.4 GC withdrawal bone-protection review
//                            (fires when patient is currently off GC AND on a BP).
//   'never'                → no GC-related logic fires.
//   null                   → not assessed in this session (treated as 'never' by the
//                            engine but distinguishable in the UI).
export type GlucocorticoidStatus =
  | 'current'
  | 'stopped_within_12m'
  | 'stopped_over_12m_ago'
  | 'never';

// ─── Patient input ─────────────────────────────────────────────────────────

export interface PatientInput {
  age: number;
  sex: Sex;

  // Out-of-scope flags (trigger specialist referral rather than standard algorithm)
  pregnantOrBreastfeeding: boolean;
  pagetsDiseaseOfBone: boolean;

  // Fracture history
  priorFragilityFracture: boolean;
  priorHipFracture: boolean;
  priorVertebralFracture: boolean;
  recentVertebralFractureYears: number | null; // how many years ago was the last vertebral fracture
  numberOfPriorFractures: number; // total fracture count across all sites (vert + non-vert)
  /**
   * v1.37 Fix B1 — vertebral-specific fracture count. Separate from numberOfPriorFractures
   * (which counts all sites). Drives VHR-2 ("≥2 vertebral fractures, whenever they have
   * occurred" per NOGG Rec 8). Optional with undefined = 0 — no false-positive risk for
   * existing patient builders that haven't been updated.
   */
  numberOfVertebralFractures?: number;

  // FRAX clinical risk factors (Section 2.1)
  parentalHipFracture: boolean;
  currentSmoker: boolean;
  vaping: boolean;                    // NOGG 2024 addition — possible risk factor
  alcoholUnitsPerWeek: number;
  bmi: number | null;
  rheumatoidArthritis: boolean;
  secondaryOsteoporosis: SecondaryOsteoporosisCause[];

  // FRAX arithmetic adjustment factors (Section 2.2, NOGG 2024 Table 2)
  type2Diabetes: boolean;             // FRAX underestimates — MOF ×1.2 (engine-side operational approximation; see v1.39 audit note)
  /**
   * v1.39 Round 3 Change 1 — T1DM handling.
   * Per NOGG 2024 body para y (Evidence level IV): "Although type 1 diabetes carries a
   * risk of fracture over and above that provided by FRAX, there are yet no empirical
   * data from which to recommend adjustment. In the meanwhile, the same adjustment can
   * be used as for type 2 diabetes." Engine applies ×1.2 MOF matching T2DM. Single-
   * application gate: if both type1Diabetes AND type2Diabetes are true, multiplier
   * fires ONCE via the T2DM block (NOGG doesn't address compounding explicitly;
   * single-application is the conservative read).
   * Engine also OR's with secondaryOsteoporosis.includes('type1_diabetes') for backwards
   * compatibility with existing UI/data paths that store T1DM in the array.
   */
  type1Diabetes: boolean;
  fallsInLastYear: number;            // ≥2 → hip ×1.3
  parkinsonsDisease: boolean;         // hip ×1.5 (engine-side operational approximation; see v1.39 audit note)
  lowerLimbAmputation: boolean;       // NOGG 2024 addition — clinical judgement
  learningDisabilities: boolean;      // NOGG 2024 addition — e.g. Down syndrome

  // Medications
  glucocorticoidUse: GlucocorticoidUse | null;
  /** Canonical GC dose input (mg/day prednisolone equivalent). v1.13. */
  glucocorticoidDoseMgDay: number | null;
  /**
   * v1.19 — single 4-option GC status. Replaces the previous pair of booleans:
   *   recentOralGlucocorticoidUse  → 'stopped_within_12m'
   *   glucocorticoidPreviouslyUsed → 'stopped_over_12m_ago'
   * See GlucocorticoidStatus type comment for the four downstream pathways. null = not assessed.
   */
  glucocorticoidStatus: GlucocorticoidStatus | null;
  /** Bone turnover markers (CTX / P1NP) rising during a bisphosphonate pause. v1.13 — drives restart consideration (NOGG Section 6.6). */
  boneTurnoverMarkersRising: boolean | null;
  /** BMD has decreased on repeat DEXA during a pause. v1.13 — drives restart consideration. */
  bmdDecreasedDuringPause: boolean | null;
  adtUse: boolean;                    // Androgen Deprivation Therapy (prostate cancer)
  aromataseInhibitorUse: boolean;     // Breast cancer treatment
  /** v1.14 — patient has received adjuvant high-dose bisphosphonate as part of breast cancer
   *  management (higher/more frequent dosing than standard osteoporosis treatment). When true
   *  AND AI continuing → end-of-course fracture risk reassessment flag fires (NOGG 2024 Rec 4 Conditional). */
  hadAdjuvantHighDoseBisphosphonate: boolean;

  // Special populations
  earlyMenopause: boolean;            // Menopause < 45 years
  ageAtMenopause: number | null;

  // Physical findings (VFA indications)
  heightLossCm: number | null;             // ≥4 cm historical → VFA
  heightLossProspectiveCm: number | null;  // ≥2 cm prospective (measured in clinic) → VFA
  kyphosis: boolean;
  acuteBackPain: boolean;                  // with osteoporosis risk factors → VFA

  // HRT safety checks
  vteHistory: boolean;                // personal or family VTE history
  breastCancerHistory: boolean;       // personal breast cancer or high familial risk

  // Cardiovascular history (romosozumab contraindication).
  // v1.36 — broadened from "within 12 months" to "any history" per spec §5.5 romosozumab
  // row: "avoid if MI or stroke history" — no time window. The previous 12-month framing
  // was an engine-side narrowing; spec has always read "history". A patient with MI 5
  // years ago was incorrectly cleared under the old field. Field renamed from
  // priorMIOrStrokeWithin12Months to priorMIOrStroke; semantics broadened. Only the
  // romosozumab CV gate (referralSignals.ts) consumed this field — no other consumer
  // depended on the 12-month window.
  priorMIOrStroke: boolean;

  /**
   * v1.27 — any history of stroke (ischaemic OR haemorrhagic), regardless of timing.
   * Drives raloxifene exclusion: NOGG 2024 (Evidence IIa) notes a small increase in
   * fatal-stroke risk on raloxifene. Use with caution in patients with prior stroke
   * or risk factors for stroke disease. Distinct from priorMIOrStroke (which is the
   * romosozumab CV gate covering MI and stroke).
   */
  strokeHistory: boolean;

  // Imminent fracture risk
  recentFractureWithin2Years: boolean; // any fragility fracture within last 24 months → treat immediately

  // (Renal function — eGFR moved to BloodResults.egfr; renalFunction field
  // removed in v1.31 follow-up to avoid dual sources of truth.)

  // Investigations
  dexaResults: DexaResults | null;
  bloodResults: BloodResults | null;

  // FRAX — calculated externally at frax.shef.ac.uk, country code 49 (Ireland)
  fraxMOFPercent: number | null;      // 10-year major osteoporotic fracture probability (raw, pre-adjustment)
  fraxHipPercent: number | null;      // 10-year hip fracture probability (raw, pre-adjustment)
  fraxCalculatedWithBMD: boolean;

  // Treatment history
  currentTreatment: TreatmentHistory | null;
  previousTreatments: TreatmentHistory[];

  // v1.19 — patient-level denosumabMonthsSinceLastDose removed; the engine now reads
  // the per-treatment monthsSinceLastDose on currentTreatment / previousTreatments.

  // Post-anabolic sequencing
  completedAnabolicCourse: boolean;   // just finished teriparatide/romosozumab/abaloparatide

  // AFF prodrome
  thighOrGroinPain: boolean;

  // Thyroid context (gates the thyroid Tier 3 investigation recommendation)
  onThyroidReplacement: boolean; // currently on levothyroxine

  // Patient preference — refuses all injection-based treatments
  // (denosumab SC, zoledronate IV, teriparatide SC, romosozumab SC)
  refusesInjections: boolean;

  // BMD unavailable / contraindicated / impractical (frailty, severe immobility, etc.)
  // Triggers NOGG 2024 Rec 6 logic in the intermediate-risk pathway.
  bmdUnavailable: boolean;

  // v1.19 — recentOralGlucocorticoidUse removed; replaced by glucocorticoidStatus
  // ('stopped_within_12m'). VFA indication now reads glucocorticoidStatus.

  /**
   * v1.19 — history of oesophageal disease (stricture, achalasia, dysmotility).
   * Permanent contraindication to ALL oral bisphosphonates. Engine routes to
   * IV zoledronate from outset (or denosumab if eGFR <35). Drives a Step-1
   * contraindication check before any drug selection (Section 5.2).
   */
  oesophagealDiseaseHistory: boolean;

  // Born outside Ireland — FRAX must use the country-of-origin model
  // (NOGG 2024 Table 2: individuals retain risk characteristics of their country of birth).
  // The in-tool FRAX estimator uses Irish baselines (country code 49), so for non-Irish
  // patients the estimator is suppressed and manual FRAX entry from frax.shef.ac.uk
  // (with the patient's country selected) is required.
  bornOutsideIreland: boolean;

  // On a thiazolidinedione (pioglitazone) — adds to T2DM-related fracture risk.
  // Surfaced as a clinical flag; not numerically adjusted in FRAX (no NOGG multiplier).
  onThiazolidinedione: boolean;

  // v1.34 — clinician override of the NOGG 2024 Rec 1 no-risk-factor gate.
  // When true AND hasAnyClinicalRiskFactor() returns false, the engine still runs FRAX
  // and surfaces an info flag with the documentation prompt. Default false — the gate
  // behaves as before. Intended for cases where the clinician identifies an additional
  // risk factor outside the tool's explicit input fields.
  noRiskFactorOverride: boolean;
}

// ─── Risk factor summary ──────────────────────────────────────────────────
// Surfaced in the output as 'Risk factors identified' — only factors that
// materially changed the recommendation are included.

export interface RiskFactorEffect {
  factor: string;       // e.g. "Falls ≥2/year"
  effect: string;       // e.g. "FRAX hip probability adjusted ×1.3"
}

// ─── Output types ──────────────────────────────────────────────────────────

export interface GuidelineSource {
  guideline: string;
  version: string;
  year: number;
  section?: string;
}

export interface ClinicalFlag {
  id: string;
  severity: FlagSeverity;
  message: string;
  rationale: string;
  source: GuidelineSource;
  /**
   * When true, UI renders `summary` (one-line preview) + a "▾ show details" toggle
   * that expands the full `message` inline. Used for specialist-aimed info flags
   * where the dense referral-letter prose is useful for audit / specialist review
   * but should not dominate the GP's view at the point of care. Existing
   * "▾ show rationale" toggle remains independent.
   * Defaults to undefined; consumers treat undefined as `false` (existing
   * behaviour — full message renders inline, only rationale toggle present).
   */
  collapsedByDefault?: boolean;
  /**
   * One-line preview rendered in place of `message` when `collapsedByDefault === true`.
   * Author-controlled (not auto-extracted) so the preview can be more action-oriented
   * than the message's first sentence. Required in practice when collapsedByDefault
   * is true; left optional in the type for additive backwards-compatibility.
   */
  summary?: string;
}

export interface InvestigationRecommendation {
  investigation:
    | 'dexa'
    | 'vfa'
    | 'calcium'
    | 'vitamin_d'
    | 'egfr'
    | 'pth'
    | 'thyroid'
    | 'testosterone'
    | 'lh_fsh'
    | 'alp'
    | 'fbc'
    | 'frax'
    | 'spep_upep'
    | 'phosphate'
    | 'lfts'
    | 'esr_crp';
  reason: string;
  urgency: Urgency;
  tier?: 1 | 2 | 3; // 1 = mandatory pre-treatment, 2 = routine baseline, 3 = secondary cause
}

export interface PatientEducation {
  whatItDoes: string;
  howToTake: string;
  sideEffects: string[];
  warnings: string[];
}

export interface TreatmentRecommendation {
  agent: TreatmentAgent;
  dose: string;
  frequency: string;
  rationale: string;
  strength: RecommendationStrength;
  contraindications: string[];
  monitoring: string[];
  irishPrescribingNote?: string;
  source: GuidelineSource;
  patientEducation?: PatientEducation;
  /** First-line vs alternative (e.g. ADT: denosumab first, alendronate alternative). Defaults to first-line. */
  priority?: 'first-line' | 'alternative';
  /**
   * v1.37 Filters 1-5 (NOGG 2024 p.29/30/34 hypoCa CI + Rec 17 parenteral Vit D).
   *   'active'  — currently recommendable, no block (default; undefined treated as 'active')
   *   'blocked' — recommendation withheld pending corrective action (e.g. hypoCa correction,
   *               Vit D treatment). Entry stays in treatmentRecommendations so UI can show
   *               "this is what you'd be prescribing once the blocker is resolved".
   *   'pending' — recommendation withheld pending investigation (e.g. Ca or Vit D not measured).
   * Blocked/pending entries carry blockReason + unblockAction below.
   */
  status?: 'active' | 'blocked' | 'pending';
  /** Short label naming the blocker — for UI to display alongside the recommendation. */
  blockReason?: string;
  /** What the GP needs to do to unblock the recommendation. */
  unblockAction?: string;
  /**
   * Role of this recommendation in the overall treatment plan.
   *   'primary'                     — definitive treatment for the patient at their risk level (default; undefined treated as 'primary')
   *   'bridging'                    — interim cover while the patient awaits specialist initiation of definitive treatment
   *                                   (used for oral bisphosphonates in GC-driven VHR patients, where the definitive
   *                                   treatment is anabolic specialist-initiated therapy surfaced via vhr_specialist_referral
   *                                   flag; gated on isOnHighDoseGC && gcDurationMonths >= 3 per NOGG Rec 8(g))
   *   'patient_preference_fallback' — oral bisphosphonate re-emitted for a VHR patient who is refusing all parenteral
   *                                   therapy (refusesInjections === true) — the patient cannot accept any anabolic
   *                                   (all SC) or any injectable antiresorptive (denosumab SC, zoledronate IV), so oral
   *                                   bisphosphonate is surfaced as a patient-preference option for GP/patient discussion
   *                                   alongside the specialist referral. This is NOT a clinical hierarchy decision; the
   *                                   specialist consultation may reveal considerations or alternatives. Paired with
   *                                   vhr_anabolic_refusal_context info flag.
   */
  category?: 'primary' | 'bridging' | 'patient_preference_fallback';
}

/**
 * v1.43 Shape B — specialist-menu options surfaced for VHR patients after referral.
 * Distinct from TreatmentRecommendation: these are drugs the SPECIALIST may consider
 * after the GP's referral, not drugs the GP prescribes in primary care. UI renders
 * them in a separate "Specialist may consider" section with tier-based sub-grouping.
 *
 * Per NOGG 2024 Rec 11 + spec §5.5 + §7.1:
 *   - Teriparatide: first-line anabolic for any VHR patient (sex-independent;
 *     only anabolic licensed for men in Ireland).
 *   - Romosozumab: further option for postmenopausal women VHR only (HSE MAP gated;
 *     not licensed in men).
 *   - Abaloparatide: further option for postmenopausal women VHR only; carries
 *     reimbursement caveat (not HSE-reimbursed; self-funded only).
 *
 * `tier` is required — drives UI's first-line-vs-further-options sub-grouping.
 * `reimbursementNote` populated for abaloparatide (Irish-specific caveat).
 * `preReferralChecks` describes GP-side prep before the referral letter goes out.
 * `contextNotes` is reserved for future per-patient context; not populated in v1.43.
 */
export interface SpecialistOption {
  drug: 'teriparatide' | 'romosozumab' | 'abaloparatide';
  tier: 'first_line' | 'further_option';
  rationale: string;
  reference: string;
  preReferralChecks?: string;
  reimbursementNote?: string;
  contextNotes?: string;
}

export interface ReferralRecommendation {
  specialty: 'rheumatology' | 'endocrinology' | 'metabolic_bone' | 'nephrology' | 'oncology' | 'gynaecology' | 'oral_maxfac' | 'orthopaedics' | 'haematology';
  reason: string;
  urgency: Urgency;
}

export interface SupplementRecommendation {
  supplement: 'calcium' | 'vitamin_d';
  headline: string;     // one-line summary (e.g. "Insufficient — 800–1000 IU/day")
  bullets: string[];    // scannable detail points
  rationale: string;
}

export interface FraxAdjustment {
  factor: string;
  multiplier: number;
  appliedTo: 'MOF' | 'hip' | 'both';
}

export interface RiskStratification {
  category: RiskCategory;
  trafficLight: TrafficLight;
  fraxMOFPercent: number | null;         // raw FRAX as entered
  fraxHipPercent: number | null;         // raw FRAX as entered
  adjustedFraxMOFPercent: number | null; // after arithmetic adjustments
  adjustedFraxHipPercent: number | null;
  fraxAdjustments: FraxAdjustment[];
  lowerThreshold: number | null;
  upperThreshold: number | null;
  rationale: string;
  source: GuidelineSource;
  /** v1.34 — true iff the NOGG Rec 1 no-clinical-risk-factor gate fired (FRAX suppressed).
   *  Used by the UI to render the "Show calculated FRAX anyway" override toggle without
   *  string-matching the rationale text. False on every other path, including the override
   *  path (where the gate explicitly does NOT fire). */
  gatedNoRfs: boolean;
}

export interface ClinicalDecision {
  patientSummary: string;
  outOfScope: boolean;
  /**
   * v1.31 — true iff the engine has placed at least one pharmacological agent in
   * treatmentRecommendations. Used by Section 17.5 output-gating: Tier 1/2 bloods,
   * ONJ pre-treatment dental, denosumab pre-dose Ca, AFF prodrome, sequential
   * therapy planning, drug-specific patient education, monitoring schedule, and
   * Vit D / calcium prescription frameworks all suppress when this is false
   * (unless an independent trigger applies — see Section 17.5 for exceptions).
   */
  treatmentRecommended: boolean;
  riskStratification: RiskStratification;
  riskFactorsIdentified: RiskFactorEffect[]; // factors that materially changed the recommendation
  investigationsNeeded: InvestigationRecommendation[];
  flags: ClinicalFlag[];
  treatmentRecommendations: TreatmentRecommendation[];
  /**
   * v1.43 Shape B — drugs the specialist may consider after the GP's referral.
   * Always present; empty array for non-VHR patients (UI doesn't render the
   * "Specialist may consider" section when empty). Populated per Section 7.1 +
   * Section 17.6 selection logic — see SpecialistOption interface.
   */
  specialistOptions: SpecialistOption[];
  referrals: ReferralRecommendation[];
  supplements: SupplementRecommendation[];
  lifestyleAdvice: string[];
  reviewSchedule: string;
  guidelinesUsed: string[];
}
