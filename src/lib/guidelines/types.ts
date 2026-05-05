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

export type SecondaryOsteoporosisCause =
  | 'type1_diabetes'
  | 'osteogenesis_imperfecta'
  | 'untreated_hyperthyroidism'
  | 'hypogonadism'
  | 'chronic_malnutrition'
  | 'malabsorption'          // coeliac, IBD, bariatric
  | 'chronic_liver_disease'
  | 'inflammatory_bowel_disease'
  | 'celiac_disease'
  | 'cushing_syndrome'
  | 'hyperparathyroidism'
  | 'antiepileptic_use'      // enzyme-inducing: phenytoin, carbamazepine, valproate
  | 'copd';                  // often combined with steroid use

export interface RenalFunction {
  egfr: number; // ml/min/1.73 m²
}

export interface DexaResults {
  lumbarSpineTScore: number | null;
  totalHipTScore: number | null;
  femoralNeckTScore: number | null;
}

export interface BloodResults {
  adjustedCalciumMmol: number | null; // mmol/L
  vitaminDNmol: number | null;        // nmol/L (25-OHD)
  egfr: number | null;                // ml/min/1.73 m²
  alp: number | null;                 // U/L — bone turnover, Paget's, osteomalacia screen
  tshNormal: boolean | null;          // flag — abnormal TSH triggers referral/treatment review
  fbc: boolean | null;                // true = done and normal; false = done and abnormal
}

export type BisphosphonateAgent = 'alendronate' | 'risedronate' | 'zoledronate' | 'ibandronate';

export type AnabolicAgent = 'teriparatide' | 'romosozumab' | 'abaloparatide';

export type TreatmentAgent =
  | BisphosphonateAgent
  | AnabolicAgent
  | 'denosumab'
  | 'hrt'
  | 'raloxifene';

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
  adtUse: boolean;                    // Androgen Deprivation Therapy (prostate cancer)
  aromataseInhibitorUse: boolean;     // Breast cancer treatment

  // Special populations
  earlyMenopause: boolean;            // Menopause < 45 years
  ageAtMenopause: number | null;

  // Physical findings (VFA indications)
  heightLossCm: number | null;        // ≥4 cm → VFA
  kyphosis: boolean;
  acuteBackPain: boolean;             // with osteoporosis risk factors → VFA

  // Cardiovascular history (romosozumab contraindication)
  priorMIOrStrokeWithin12Months: boolean;

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
    | 'frax';
  reason: string;
  urgency: Urgency;
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
}

export interface ReferralRecommendation {
  specialty: 'rheumatology' | 'endocrinology' | 'metabolic_bone' | 'nephrology' | 'oncology' | 'gynaecology' | 'oral_maxfac' | 'orthopaedics' | 'haematology';
  reason: string;
  urgency: Urgency;
}

export interface SupplementRecommendation {
  supplement: 'calcium' | 'vitamin_d';
  dose: string;
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
  investigationsNeeded: InvestigationRecommendation[];
  flags: ClinicalFlag[];
  treatmentRecommendations: TreatmentRecommendation[];
  referrals: ReferralRecommendation[];
  supplements: SupplementRecommendation[];
  lifestyleAdvice: string[];
  reviewSchedule: string;
  guidelinesUsed: string[];
}
