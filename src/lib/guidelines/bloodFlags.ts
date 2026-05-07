// Clinical alert flags driven by blood result values.
// Called from runClinicalDecision; output appended to ClinicalDecision.flags.

import type { PatientInput, ClinicalFlag } from './types';
import { GUIDELINE_VERSIONS, BLOOD_RANGES } from './thresholds';

const SRC_NOGG = GUIDELINE_VERSIONS.nogg;
const SRC_IOS = GUIDELINE_VERSIONS.ios;

export function generateBloodFlags(patient: PatientInput): ClinicalFlag[] {
  const flags: ClinicalFlag[] = [];
  const blood = patient.bloodResults;
  if (!blood) return flags;

  // ── ALP ───────────────────────────────────────────────────────────────
  // Normal 30–130 U/L. Mildly raised 130–200; markedly raised >200.
  if (blood.alp !== null) {
    if (blood.alp > 200) {
      flags.push({
        id: 'alp_markedly_elevated',
        severity: 'urgent',
        message: `ALP markedly elevated (${blood.alp} U/L) — exclude Paget's disease and osteomalacia BEFORE starting any bone treatment.`,
        rationale:
          'ALP >200 U/L (>~1.5× upper limit) raises suspicion of Paget\'s disease, osteomalacia, fracture, ' +
          'liver disease, or bone metastases. Unexplained raised ALP is a contraindication to teriparatide. ' +
          'Investigate cause (LFTs, vitamin D, calcium, PTH, isoenzymes) before initiating antiresorptive or anabolic therapy.',
        source: SRC_NOGG,
      });
    } else if (blood.alp > 130) {
      flags.push({
        id: 'alp_mildly_elevated',
        severity: 'warning',
        message: `ALP mildly elevated (${blood.alp} U/L). Review LFTs and vitamin D before treatment.`,
        rationale:
          'Mild ALP elevation (130–200 U/L) is non-specific. Common causes: vitamin D deficiency, ' +
          'recent fracture, mild liver pathology, accelerated bone turnover. ' +
          'Recheck after vitamin D repletion; consider GGT to differentiate hepatic vs bone source.',
        source: SRC_NOGG,
      });
    } else if (blood.alp < 30) {
      flags.push({
        id: 'alp_low',
        severity: 'info',
        message: `ALP low (${blood.alp} U/L). Consider hypophosphatasia or zinc/magnesium deficiency.`,
        rationale:
          'Low ALP is rare but specific. Causes include hypophosphatasia (heritable; bisphosphonate may worsen), ' +
          'zinc deficiency, malnutrition, hypothyroidism. Bisphosphonates may be relatively contraindicated — discuss with specialist.',
        source: SRC_NOGG,
      });
    }
  }

  // ── TSH ───────────────────────────────────────────────────────────────
  // Normal 0.4–4.0 mU/L. <0.1 suppressed; 0.1–0.4 mild suppression;
  // 4.0–10 mild rise; >10 markedly elevated.
  if (blood.tshMUL !== null) {
    const tsh = blood.tshMUL;
    const onLevo = patient.onThyroidReplacement;

    if (tsh < 0.1) {
      flags.push({
        id: 'tsh_suppressed',
        severity: 'urgent',
        message: onLevo
          ? `TSH fully suppressed (${tsh} mU/L) — likely levothyroxine over-replacement. Reduce dose; recheck in 6 weeks.`
          : `TSH fully suppressed (${tsh} mU/L) — investigate hyperthyroidism BEFORE starting bone treatment.`,
        rationale:
          'Suppressed TSH causes increased bone turnover and accelerated bone loss. ' +
          'Endogenous hyperthyroidism (Graves, toxic nodule) needs treatment before bone therapy. ' +
          'Iatrogenic suppression from levothyroxine over-replacement should be corrected — bone density gains follow dose reduction.',
        source: SRC_NOGG,
      });
    } else if (tsh < 0.4) {
      flags.push({
        id: 'tsh_mild_suppression',
        severity: 'warning',
        message: onLevo
          ? `TSH below normal (${tsh} mU/L) on levothyroxine. Consider dose reduction; recheck in 6 weeks.`
          : `TSH below normal (${tsh} mU/L). Consider subclinical hyperthyroidism — recheck and refer if persistent.`,
        rationale:
          'Mild TSH suppression (0.1–0.4 mU/L) is associated with increased fracture risk in older adults, particularly postmenopausal women. ' +
          'Persistent subclinical hyperthyroidism warrants endocrinology input.',
        source: SRC_NOGG,
      });
    } else if (tsh > 10) {
      flags.push({
        id: 'tsh_markedly_elevated',
        severity: 'warning',
        message: onLevo
          ? `TSH markedly elevated (${tsh} mU/L) on levothyroxine — under-replacement; increase dose and recheck.`
          : `TSH markedly elevated (${tsh} mU/L) — likely overt hypothyroidism. Treat before or alongside bone therapy.`,
        rationale:
          'Marked TSH elevation indicates overt hypothyroidism (or significant under-replacement on levothyroxine). ' +
          'Untreated severe hypothyroidism affects calcium handling and bone health. Optimise thyroid status before initiating bisphosphonate.',
        source: SRC_NOGG,
      });
    } else if (tsh > 4.0) {
      flags.push({
        id: 'tsh_mildly_elevated',
        severity: 'info',
        message: onLevo
          ? `TSH above normal (${tsh} mU/L) on levothyroxine — consider dose increase; recheck in 6 weeks.`
          : `TSH above normal (${tsh} mU/L). Consider subclinical hypothyroidism — recheck.`,
        rationale:
          'Mild TSH elevation (4–10 mU/L) often represents subclinical hypothyroidism. ' +
          'On levothyroxine, suggests under-replacement — adjust dose. Off levothyroxine, recheck and consider treatment if persistent or symptomatic.',
        source: SRC_NOGG,
      });
    }
  }

  // ── Calcium ──────────────────────────────────────────────────────────
  if (blood.adjustedCalciumMmol !== null) {
    const ca = blood.adjustedCalciumMmol;
    if (ca > BLOOD_RANGES.adjustedCalcium.high) {
      flags.push({
        id: 'hypercalcaemia',
        severity: 'urgent',
        message: `Hypercalcaemia (${ca} mmol/L). Investigate cause (PTH, malignancy) BEFORE starting any bone treatment.`,
        rationale:
          'Adjusted calcium >2.6 mmol/L is abnormal. Common causes: primary hyperparathyroidism, malignancy, vitamin D toxicity. ' +
          'Bisphosphonate or denosumab contraindicated in untreated hypercalcaemia of malignancy without specialist input.',
        source: SRC_NOGG,
      });
    } else if (ca < BLOOD_RANGES.adjustedCalcium.low) {
      flags.push({
        id: 'hypocalcaemia',
        severity: 'urgent',
        message: `Hypocalcaemia (${ca} mmol/L). Correct calcium and vitamin D BEFORE bisphosphonate or denosumab.`,
        rationale:
          'Adjusted calcium <2.10 mmol/L is a contraindication to antiresorptive therapy — risk of severe acute hypocalcaemia. ' +
          'Replace vitamin D first; supplement calcium; recheck before any bisphosphonate or denosumab dose.',
        source: SRC_IOS,
      });
    }
  }

  return flags;
}
