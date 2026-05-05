import type { SecondaryOsteoporosisCause, TreatmentAgent, TreatmentStopReason } from './guidelines/types';

export const SECONDARY_CAUSE_LABELS: Record<SecondaryOsteoporosisCause, string> = {
  type1_diabetes:           'Type 1 diabetes',
  osteogenesis_imperfecta:  'Osteogenesis imperfecta',
  untreated_hyperthyroidism:'Hyperthyroidism (untreated)',
  hypogonadism:             'Hypogonadism',
  chronic_malnutrition:     'Chronic malnutrition',
  malabsorption:            'Malabsorption (coeliac, IBD, bariatric)',
  chronic_liver_disease:    'Chronic liver disease',
  inflammatory_bowel_disease:'Inflammatory bowel disease',
  celiac_disease:           'Coeliac disease',
  cushing_syndrome:         "Cushing's syndrome",
  hyperparathyroidism:      'Hyperparathyroidism',
  antiepileptic_use:        'Antiepileptic drugs (enzyme-inducing: phenytoin, carbamazepine, valproate)',
  copd:                     'COPD (often combined with steroid use)',
};

export const AGENT_LABELS: Record<TreatmentAgent, string> = {
  alendronate:   'Alendronate 70 mg weekly (oral)',
  risedronate:   'Risedronate 35 mg weekly (oral)',
  ibandronate:   'Ibandronate 150 mg monthly (oral)',
  zoledronate:   'Zoledronate 5 mg IV yearly (Aclasta)',
  denosumab:     'Denosumab 60 mg SC 6-monthly (Prolia)',
  teriparatide:  'Teriparatide 20 μg daily SC (Forsteo)',
  romosozumab:   'Romosozumab 210 mg monthly SC × 12 (Evenity)',
  abaloparatide: 'Abaloparatide 80 μg daily SC (Eladynos)',
  hrt:           'HRT — oestrogen ± progestogen',
  raloxifene:    'Raloxifene 60 mg daily (Evista)',
};

export const STOP_REASON_LABELS: Record<TreatmentStopReason, string> = {
  gi_intolerance:    'GI intolerance',
  aff_confirmed:     'Atypical femoral fracture (AFF)',
  onj:               'Osteonecrosis of the jaw (ONJ)',
  treatment_holiday: 'Planned treatment holiday',
  treatment_failure: 'Treatment failure (new fracture on therapy)',
  renal_impairment:  'Renal impairment',
  completed_course:  'Completed course (e.g. teriparatide 24 months)',
  patient_choice:    'Patient choice',
};
