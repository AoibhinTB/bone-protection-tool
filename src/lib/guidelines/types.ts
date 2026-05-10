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
  | 'antiepileptic_use'              // enzyme-inducing: phenytoin, carbamazepine, valproate
  | 'copd'                           // often combined with steroid use
  | 'chronic_kidney_disease';        // CKD 3a–5 / non-dialysis (NOGG Table 1)

export interface RenalFunction {
  egfr: number; // ml/min/1.73 m²
}

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
  durationMonths: number;
  reasonStopped: TreatmentStopReason | null;
  currentlyOn: boolean;
}

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
  numberOfPriorFractures: number;

  // FRAX clinical risk factors (Section 2.1)
  parentalHipFracture: boolean;
  currentSmoker: boolean;
  vaping: boolean;                    // NOGG 2024 addition — possible risk factor
  alcoholUnitsPerWeek: number;
  bmi: number | null;
  rheumatoidArthritis: boolean;
  secondaryOsteoporosis: SecondaryOsteoporosisCause[];

  // FRAX arithmetic adjustment factors (Section 2.2, NOGG 2024 Table 2)
  type2Diabetes: boolean;             // FRAX underestimates — MOF ×1.2
  fallsInLastYear: number;            // ≥2 → hip ×1.3
  parkinsonsDisease: boolean;         // hip ×1.5
  lowerLimbAmputation: boolean;       // NOGG 2024 addition — clinical judgement
  learningDisabilities: boolean;      // NOGG 2024 addition — e.g. Down syndrome

  // Medications
  glucocorticoidUse: GlucocorticoidUse | null;
  /** Canonical GC dose input (mg/day prednisolone equivalent). v1.13. */
  glucocorticoidDoseMgDay: number | null;
  /** Patient previously took oral GC and has now stopped. v1.13 — drives Section 9.4 withdrawal review. */
  glucocorticoidPreviouslyUsed: boolean;
  /** Bone turnover markers (CTX / P1NP) rising during a bisphosphonate pause. v1.13 — drives restart consideration (NOGG Section 6.6). */
  boneTurnoverMarkersRising: boolean | null;
  /** BMD has decreased on repeat DEXA during a pause. v1.13 — drives restart consideration. */
  bmdDecreasedDuringPause: boolean | null;
  adtUse: boolean;                    // Androgen Deprivation Therapy (prostate cancer)
  aromataseInhibitorUse: boolean;     // Breast cancer treatment

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

  // Cardiovascular history (romosozumab contraindication)
  priorMIOrStrokeWithin12Months: boolean;

  // Imminent fracture risk
  recentFractureWithin2Years: boolean; // any fragility fracture within last 24 months → treat immediately

  // Renal function
  renalFunction: RenalFunction | null;

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

  // Denosumab-specific (rebound / missed injection)
  denosumabMonthsSinceLastDose: number | null; // if currently on denosumab — is injection overdue?

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

  // Recent past oral glucocorticoid use — stopped within the last ~12 months.
  // Used as a VFA indication (silent vertebral fractures may have occurred during the GC period).
  recentOralGlucocorticoidUse: boolean;

  // Born outside Ireland — FRAX must use the country-of-origin model
  // (NOGG 2024 Table 2: individuals retain risk characteristics of their country of birth).
  // The in-tool FRAX estimator uses Irish baselines (country code 49), so for non-Irish
  // patients the estimator is suppressed and manual FRAX entry from frax.shef.ac.uk
  // (with the patient's country selected) is required.
  bornOutsideIreland: boolean;

  // On a thiazolidinedione (pioglitazone) — adds to T2DM-related fracture risk.
  // Surfaced as a clinical flag; not numerically adjusted in FRAX (no NOGG multiplier).
  onThiazolidinedione: boolean;
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
}

export interface ClinicalDecision {
  patientSummary: string;
  outOfScope: boolean;
  riskStratification: RiskStratification;
  riskFactorsIdentified: RiskFactorEffect[]; // factors that materially changed the recommendation
  investigationsNeeded: InvestigationRecommendation[];
  flags: ClinicalFlag[];
  treatmentRecommendations: TreatmentRecommendation[];
  referrals: ReferralRecommendation[];
  supplements: SupplementRecommendation[];
  lifestyleAdvice: string[];
  reviewSchedule: string;
  guidelinesUsed: string[];
}
