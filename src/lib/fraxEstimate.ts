// FRAX probability estimate for Ireland (country 49)
// Algorithm: Kanis JA et al., Osteoporosis Int 2008;19:1032–1048
// Baseline calibrated to Irish epidemiology (SRAN study & HSE data)
//
// IMPORTANT: This is a clinical estimate — use frax.shef.ac.uk (country 49)
// to obtain official values, particularly when BMD is available.

import type { PatientInput } from './guidelines/types';

export interface FraxEstimate {
  mof: number; // 10-year major osteoporotic fracture probability (%)
  hip: number; // 10-year hip fracture probability (%)
}

// ── Baseline tables: reference patient (BMI=25, no risk factors) ────────────
// Age → [MOF%, Hip%] calibrated to Irish fracture/mortality rates

const FEMALE_BASE: [number, number, number][] = [
  // [age, MOF%, Hip%]
  [50,  6.0,  0.5],
  [55,  7.0,  0.9],
  [60,  9.0,  1.6],
  [65, 12.0,  2.8],
  [70, 15.5,  5.0],
  [75, 18.5,  7.8],
  [80, 20.5, 10.5],
  [85, 19.5, 11.5],
  [90, 17.5, 11.5],
];

const MALE_BASE: [number, number, number][] = [
  // [age, MOF%, Hip%]
  [50,  3.0,  0.4],
  [55,  3.5,  0.6],
  [60,  4.5,  1.0],
  [65,  6.5,  2.0],
  [70,  9.0,  3.6],
  [75, 12.0,  6.0],
  [80, 14.0,  8.5],
  [85, 14.5,  9.5],
  [90, 13.5,  9.5],
];

function interpolate(table: [number, number, number][], age: number): [number, number] {
  const clamped = Math.max(table[0][0], Math.min(table[table.length - 1][0], age));
  for (let i = 0; i < table.length - 1; i++) {
    const [a0, m0, h0] = table[i];
    const [a1, m1, h1] = table[i + 1];
    if (clamped >= a0 && clamped <= a1) {
      const t = (clamped - a0) / (a1 - a0);
      return [m0 + t * (m1 - m0), h0 + t * (h1 - h0)];
    }
  }
  const last = table[table.length - 1];
  return [last[1], last[2]];
}

// ── Published log-hazard-ratio (β) coefficients ──────────────────────────────
// Source: Kanis JA et al. Osteoporosis Int 2008 (Table 3)

const BETA = {
  female: {
    mof: {
      priorFracture: 0.6309,
      parentHipFx:  0.3240,
      smoker:       0.2007,
      gc:           0.4373,
      ra:           0.3928,
      secondaryOp:  0.2793,
      alcohol:      0.1518,
    },
    hip: {
      priorFracture: 1.1361,
      parentHipFx:   0.5416,
      smoker:        0.5916,
      gc:            0.8148,
      ra:            0.2616,
      secondaryOp:   0.1193,
      alcohol:       0.2150,
    },
  },
  male: {
    mof: {
      priorFracture: 0.5217,
      parentHipFx:   0.2788,
      smoker:        0.2390,
      gc:            0.4173,
      ra:            0.3619,
      secondaryOp:   0.2226,
      alcohol:       0.2214,
    },
    hip: {
      priorFracture: 0.7927,
      parentHipFx:   0.4003,
      smoker:        0.5616,
      gc:            0.5917,
      ra:            0.4396,
      secondaryOp:   0.1543,
      alcohol:       0.5740,
    },
  },
};

// ── BMI adjustment (approximate — FRAX uses a non-linear polynomial) ─────────
// Below 25: each unit decreases MOF by ~2.2%, hip by ~3.5%
// Above 25: protective effect; each unit decreases risk by ~1.4% MOF / 2.5% hip

function bmiAdjustment(bmi: number): { mofFactor: number; hipFactor: number } {
  const delta = bmi - 25;
  const mofBeta = delta < 0 ? delta * 0.022 : delta * 0.014;
  const hipBeta = delta < 0 ? delta * 0.035 : delta * 0.025;
  return {
    mofFactor: Math.exp(-mofBeta),
    hipFactor: Math.exp(-hipBeta),
  };
}

// ── Main estimation function ──────────────────────────────────────────────────

export function estimateFrax(patient: PatientInput): FraxEstimate {
  const table = patient.sex === 'female' ? FEMALE_BASE : MALE_BASE;
  const beta  = patient.sex === 'female' ? BETA.female : BETA.male;

  const [baseMof, baseHip] = interpolate(table, patient.age);

  // Binary risk factor linear predictor
  const gc = patient.glucocorticoidUse !== null && patient.glucocorticoidUse.current;
  const hasSecondary = patient.secondaryOsteoporosis.length > 0 || patient.rheumatoidArthritis;

  const lp = (b: typeof beta.mof) =>
    (patient.priorFragilityFracture ? b.priorFracture : 0) +
    (patient.parentalHipFracture    ? b.parentHipFx  : 0) +
    (patient.currentSmoker          ? b.smoker        : 0) +
    (gc                             ? b.gc            : 0) +
    (patient.rheumatoidArthritis    ? b.ra            : 0) +
    (hasSecondary                   ? b.secondaryOp   : 0) +
    (patient.alcoholUnitsPerWeek >= 21 ? b.alcohol    : 0);

  const mofRF = Math.exp(lp(beta.mof));
  const hipRF = Math.exp(lp(beta.hip));

  // BMI adjustment
  const bmiAdj = bmiAdjustment(patient.bmi ?? 25);

  let mof = baseMof * mofRF * bmiAdj.mofFactor;
  let hip  = baseHip  * hipRF  * bmiAdj.hipFactor;

  // Cap at 100%
  mof = Math.min(99, Math.max(0.1, mof));
  hip = Math.min(99, Math.max(0.1, hip));

  return {
    mof: Math.round(mof * 10) / 10,
    hip: Math.round(hip * 10) / 10,
  };
}
