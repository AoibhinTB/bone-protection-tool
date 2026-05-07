// Plain-language definitions for clinical abbreviations used in the UI.
// Tooltips render these via <Term term="MOF">MOF</Term>.

export type GlossaryTerm =
  | 'MOF'
  | 'FRAX'
  | 'BMD'
  | 'T-score'
  | 'VFA'
  | 'eGFR'
  | 'DEXA'
  | 'ALP'
  | 'TSH'
  | 'LAT'
  | 'IT'
  | 'UAT'
  | 'VHRT'
  | 'NOGG'
  | 'PTH'
  | 'SPEP/UPEP'
  | 'LH/FSH'
  | 'AFF'
  | 'ONJ'
  | 'CTIBL'
  | 'ADT'
  | 'POI'
  | 'GIOP'
  | 'HSE MMP';

export const GLOSSARY: Record<GlossaryTerm, string> = {
  'MOF':       'Major Osteoporotic Fracture — the 10-year probability of fracture at the spine, hip, forearm, or humerus.',
  'FRAX':      'Fracture Risk Assessment Tool — calculate at frax.shef.ac.uk using country code 49 for Ireland.',
  'BMD':       'Bone Mineral Density — measured by DEXA scanning; reported as a T-score.',
  'T-score':   'Standard deviations from peak young-adult bone mass. ≤−2.5 = osteoporosis; −1.0 to −2.5 = osteopenia; ≥−1.0 = normal.',
  'VFA':       'Vertebral Fracture Assessment — a low-dose lateral spine image (often included with DEXA) to detect prevalent vertebral fractures.',
  'eGFR':      'Estimated Glomerular Filtration Rate — kidney function in ml/min/1.73 m². Bisphosphonates contraindicated when eGFR <35.',
  'DEXA':      'Dual-energy X-ray Absorptiometry — the standard scan for measuring bone mineral density at the spine and hip.',
  'ALP':       'Alkaline Phosphatase — bone turnover marker (normal 30–130 U/L). Elevated values suggest Paget\'s disease, osteomalacia, or active bone disease.',
  'TSH':       'Thyroid Stimulating Hormone (normal 0.4–4.0 mU/L). Suppressed = hyperthyroidism (a secondary cause of bone loss); elevated on levothyroxine = under-replacement.',
  'LAT':       'Lower Assessment Threshold — below this 10-year FRAX probability the patient is low risk; no DEXA needed (NOGG 2024 Table 5).',
  'IT':        'Intervention Threshold — above this 10-year FRAX probability the patient is high risk and treatment is offered (NOGG 2024 Table 5).',
  'UAT':       'Upper Assessment Threshold — above this, treatment is indicated without further BMD measurement (NOGG 2024 Table 5).',
  'VHRT':      'Very High Risk Threshold — FRAX above this band warrants specialist referral and consideration of anabolic-first therapy (NOGG 2024).',
  'NOGG':      'National Osteoporosis Guideline Group (UK & Ireland) — published the 2024 osteoporosis guideline used by this tool.',
  'PTH':       'Parathyroid Hormone — checked when calcium or ALP are abnormal, or when forearm-only osteoporosis is found, to exclude primary hyperparathyroidism.',
  'SPEP/UPEP': 'Serum / Urine Protein Electrophoresis — screens for myeloma (especially with anaemia, abnormal FBC, or unexplained vertebral fracture).',
  'LH/FSH':    'Luteinising Hormone / Follicle-Stimulating Hormone — confirms premature ovarian insufficiency (POI) in women under 45.',
  'AFF':       'Atypical Femoral Fracture — a rare adverse effect of long-term bisphosphonate or denosumab use; presents with thigh or groin pain.',
  'ONJ':       'Osteonecrosis of the Jaw — rare adverse event of antiresorptive therapy. Risk reduced by pre-treatment dental review.',
  'CTIBL':     'Cancer Treatment-Induced Bone Loss — rapid bone loss caused by aromatase inhibitors (breast cancer) or androgen deprivation (prostate cancer).',
  'ADT':       'Androgen Deprivation Therapy — used for prostate cancer; causes rapid bone loss.',
  'POI':       'Premature Ovarian Insufficiency — menopause before age 40. HRT is first-line bone protection.',
  'GIOP':      'Glucocorticoid-Induced Osteoporosis — bone loss from prednisolone ≥7.5 mg/day for ≥3 months (or lower-dose with risk factors).',
  'HSE MMP':   'Health Service Executive Medicines Management Programme — Ireland\'s preferred-drug guidance.',
};
