// Generates the "Risk factors identified" summary — a list of patient risk factors
// that materially changed the recommendation. Only factors that had a downstream
// effect on the decision are included; ticked factors with no effect are omitted.

import type { PatientInput, ClinicalDecision, RiskFactorEffect } from './types';

export function generateRiskFactorsIdentified(
  patient: PatientInput,
  decision: Pick<ClinicalDecision, 'riskStratification' | 'flags'>,
): RiskFactorEffect[] {
  const items: RiskFactorEffect[] = [];

  // Previous fragility fracture (any site) → treatment regardless of FRAX
  if (patient.priorHipFracture) {
    items.push({
      factor: 'Previous hip fracture',
      effect: 'Treatment indicated regardless of FRAX (NOGG Rec 8); recent hip fx within 24 months drives very high risk',
    });
  } else if (patient.priorVertebralFracture) {
    const yrs = patient.recentVertebralFractureYears;
    items.push({
      factor: 'Previous vertebral fracture',
      effect:
        yrs !== null && yrs <= 2
          ? 'Treatment indicated regardless of FRAX; recent VF (<2 years) drives very high risk'
          : 'Treatment indicated regardless of FRAX (NOGG Rec 8)',
    });
  } else if (patient.priorFragilityFracture) {
    items.push({
      factor: 'Previous fragility fracture',
      effect: 'Treatment indicated regardless of FRAX score',
    });
  }

  // Glucocorticoids
  // Glucocorticoid effect summary — driven by the canonical numeric dose helper.
  {
    const gcDose =
      patient.glucocorticoidDoseMgDay !== null && patient.glucocorticoidDoseMgDay > 0
        ? patient.glucocorticoidDoseMgDay
        : patient.glucocorticoidUse?.current
        ? ({ very_low: 1.25, low: 5, medium: 10, high: 25 } as const)[patient.glucocorticoidUse.dose]
        : null;
    if (gcDose !== null) {
      if (gcDose >= 7.5) {
        items.push({
          factor: `Glucocorticoids ${gcDose} mg/day (≥7.5)`,
          effect: 'Table 8 FRAX correction: MOF ×1.15, hip ×1.20. GIOP immediate-start criterion (c).',
        });
      } else if (gcDose < 2.5) {
        items.push({
          factor: `Glucocorticoids ${gcDose} mg/day (<2.5)`,
          effect: 'Table 8 downward FRAX correction: MOF ×0.80, hip ×0.65 (FRAX overestimates at very low dose).',
        });
      } else {
        items.push({
          factor: `Glucocorticoids ${gcDose} mg/day (2.5–7.5)`,
          effect: 'GIOP pathway applies; no FRAX adjustment at medium dose. Lower BMD threshold (T ≤−1.5) for treatment.',
        });
      }
    }
  }

  // FRAX arithmetic adjustments — pull from riskStratification
  for (const adj of decision.riskStratification.fraxAdjustments) {
    if (adj.factor.toLowerCase().includes('glucocorticoid')) continue; // already covered above
    items.push({
      factor: adj.factor,
      effect: `FRAX ${adj.appliedTo} probability adjusted ×${adj.multiplier}`,
    });
  }

  // Rheumatoid arthritis
  if (patient.rheumatoidArthritis) {
    items.push({
      factor: 'Rheumatoid arthritis',
      effect: 'FRAX risk factor (already counted) — do not also tick Secondary Osteoporosis (double-count warning)',
    });
  }

  // Early menopause / POI
  if (patient.earlyMenopause) {
    const isPOI = patient.age < 50;
    items.push({
      factor: 'Early menopause / POI',
      effect: isPOI
        ? 'HRT first-line for bone protection; FRAX may underestimate fracture risk'
        : 'Lower BMD treatment threshold (T-score ≤−1.5); HRT first-line for women ≤60; FRAX may underestimate',
    });
  }

  // ADT
  if (patient.adtUse) {
    items.push({
      factor: 'Androgen deprivation therapy',
      effect: 'Denosumab first-line (HALT trial evidence); lower BMD threshold (T ≤−2.0); annual DEXA monitoring',
    });
  }

  // Aromatase inhibitor
  if (patient.aromataseInhibitorUse) {
    items.push({
      factor: 'Aromatase inhibitor',
      effect: 'Lower BMD treatment threshold (T-score ≤−1.5) regardless of FRAX; annual DEXA monitoring',
    });
  }

  // Malabsorption
  const malabsorption = patient.secondaryOsteoporosis.filter(c =>
    ['malabsorption', 'celiac_disease', 'inflammatory_bowel_disease'].includes(c)
  );
  if (malabsorption.length > 0) {
    items.push({
      factor: 'Malabsorption (coeliac/IBD/bariatric)',
      effect: 'Calcium and vitamin D absorption may be impaired — check levels and supplement; consider IV/SC over oral BP',
    });
  }

  // Other secondary causes (excluding already-covered ones)
  const otherSecondary = patient.secondaryOsteoporosis.filter(c =>
    !['malabsorption', 'celiac_disease', 'inflammatory_bowel_disease'].includes(c)
  );
  if (otherSecondary.length > 0) {
    const labels = otherSecondary.map(c => c.replace(/_/g, ' ')).join(', ');
    items.push({
      factor: `Secondary cause: ${labels}`,
      effect: 'Tier 3 secondary cause workup recommended; DEXA indicated',
    });
  }

  // Hypogonadism (already covered as secondary cause if listed; surface specifically when
  // present so testosterone investigation is justified)
  if (patient.secondaryOsteoporosis.includes('hypogonadism')) {
    // already added above as part of "secondary cause"; skip duplicate
  }

  // Lower limb amputation — NOGG 2024 Table 4 case-finder (no FRAX multiplier).
  if (patient.lowerLimbAmputation) {
    items.push({
      factor: 'Lower limb amputation',
      effect: 'NOGG 2024 Table 4 case-finder for fracture risk assessment — included in identified risk factors (qualitative; no FRAX numeric adjustment).',
    });
  }

  // Adult learning disability — NOGG 2024 Table 4 case-finder (no FRAX multiplier).
  if (patient.learningDisabilities) {
    items.push({
      factor: 'Adult learning disability (e.g. Down syndrome)',
      effect: 'NOGG 2024 Table 4 case-finder for fracture risk assessment — included in identified risk factors (qualitative; no FRAX numeric adjustment).',
    });
  }

  // Thiazolidinedione (TZD) — additional T2DM fracture risk
  if (patient.onThiazolidinedione) {
    items.push({
      factor: 'On a thiazolidinedione (pioglitazone)',
      effect: 'Adds to T2DM-related fracture risk; consider alternative diabetes therapy where appropriate',
    });
  }

  // Born outside Ireland — FRAX needs country-of-origin model
  if (patient.bornOutsideIreland) {
    items.push({
      factor: 'Born outside Ireland',
      effect: 'In-tool FRAX estimator suppressed (uses Irish baselines); calculate FRAX at frax.shef.ac.uk with country of birth selected and enter manually',
    });
  }

  // Patient refuses injections
  if (patient.refusesInjections) {
    items.push({
      factor: 'Refuses injections',
      effect: 'Denosumab, zoledronate, teriparatide, romosozumab removed from output — oral options only',
    });
  }

  // Renal function — only material if it changed treatment
  const renalCI = decision.flags.some(f => f.id === 'renal_bp_ci' || f.id === 'denosumab_ckd_hypocalcaemia');
  const egfr = patient.bloodResults?.egfr ?? null;
  if (renalCI && egfr !== null) {
    items.push({
      factor: `eGFR ${egfr} ml/min`,
      effect: 'Bisphosphonates contraindicated/borderline; denosumab preferred (with mandatory Ca check 2 weeks post-injection)',
    });
  }

  // Thyroid replacement context
  if (patient.onThyroidReplacement) {
    const tshFlag = decision.flags.some(f => f.id.startsWith('tsh_'));
    if (tshFlag) {
      items.push({
        factor: 'On levothyroxine',
        effect: 'TSH abnormal — adjust dose; over/under-replacement contributes to bone loss',
      });
    }
  }

  // Recent fracture within 24 months — imminent risk
  if (patient.recentFractureWithin2Years && !patient.priorVertebralFracture && !patient.priorHipFracture) {
    items.push({
      factor: 'Fracture within last 24 months',
      effect: 'Imminent fracture risk — treat immediately; do not wait for DEXA',
    });
  }

  return items;
}
