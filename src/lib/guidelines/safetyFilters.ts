// Pre-treatment structural safety filter chain — flag emission + recipe-status
// mutations for missing/abnormal Tier 1 prerequisites before any antiresorptive
// initiation.
//
// Filter inventory (by flag ID; numbering retired v1.48):
//   - hypocalcaemia_antiresorptive_block       Ca measured + <2.10
//   - calcium_unmeasured_antiresorptive_block  Ca missing (+ antiresorptive candidate)
//   - vitd_parenteral_block                    Vit D measured + <50
//   - vitd_unmeasured_parenteral_block         Vit D missing (+ parenteral candidate)
//   - crcl_pending_renal_drug                  CrCl uncomputable (+ renally-cleared candidate)
//   - denosumab_continuation_hypocalcaemia_hold  Ca low + currently-on denosumab
//
// Two emission classes (v1.48 — D3):
//   - Measurement filters (Ca low, Vit D low): fire regardless of recommendations
//     content. Hypocalcaemia / Vit D deficiency are clinical findings worth
//     surfacing in their own right.
//   - Missingness filters (Ca missing, Vit D missing, CrCl uncomputable): gate
//     on the relevant drug class being in `treatmentRecommendations` OR
//     `specialistOptions` (Shape B specialist-menu inclusion per D4). If no
//     relevant drug is being considered for this patient, the prerequisite
//     would create cognitive friction for no clinical action.
//
// Multi-flag emission (v1.48 — D2): the prior F2/F4 dedup is retired. When
// multiple missingness conditions hold, all relevant flags fire. Each filter's
// message is specific to its own prerequisite so duplication-of-information is
// not a concern (D7).
//
// Status-mutation precedence: filters mutate `rec.status` in source order
// (Ca low → Ca missing → Vit D low → Vit D missing → CrCl uncomputable). The
// guard `if (rec.status && rec.status !== 'active') continue;` ensures the
// first filter to fire on a given recommendation wins both the status tag and
// the pendingCaption. Subsequent filters still emit their FLAGS (additive) but
// do not overwrite per-rec state.
//
// Sources:
//   - NOGG 2024 p.29 §a (oral + IV bisphosphonates CI in hypocalcaemia)
//   - NOGG 2024 p.30 §a (denosumab CI in hypocalcaemia)
//   - NOGG 2024 p.34 §c (romosozumab CI in hypocalcaemia)
//   - NOGG 2024 Recommendation 17 (Strong, Vit D parenteral pre-condition)
//   - Spec v1.46 §4.2 Tier 1 row (CrCl prerequisite for renally-cleared
//     antiresorptive initiation)
//   - Per-drug SmPC renal thresholds — RENAL_LIMITS at thresholds.ts:354

import type {
  PatientInput,
  TreatmentRecommendation,
  ClinicalFlag,
  TreatmentAgent,
  SpecialistOption,
} from './types';
import { GUIDELINE_VERSIONS, computeCrCl } from './thresholds';

const SRC_NOGG = GUIDELINE_VERSIONS.nogg;

const CA_LOW = 2.10; // mmol/L — NOGG threshold for hypocalcaemia
const VITD_INSUFFICIENT = 50; // nmol/L — NOGG Rec 17 parenteral threshold

// Pending-prerequisite captions (D7) — each missingness filter carries its own
// caption; no MULTI variant. Surfaced via TreatmentRecommendation.pendingCaption
// at every pending-tagging site below.
const CAPTION_CALCIUM_ONLY =
  'Complete corrected calcium before initiating treatment. Reassess once result available.';
const CAPTION_VITD_ONLY =
  'Complete Vit D measurement before initiating parenteral therapy. Reassess once result available.';
const CAPTION_CRCL_ONLY =
  'Complete CrCl (Cockcroft-Gault) before initiating renally-cleared therapy. Reassess once result available.';

const ANTIRESORPTIVES: ReadonlySet<TreatmentAgent> = new Set<TreatmentAgent>([
  'alendronate',
  'risedronate',
  'ibandronate',
  'zoledronate',
  'denosumab',
  'romosozumab',
]);

// Renally-cleared drug set. Includes the RENAL_LIMITS keys at thresholds.ts:354
// (bisphosphonates + denosumab — CrCl-based CI cascade / Ca-watch threshold)
// AND the specialist-anabolic SPCs that carry severe-renal-impairment absolute
// CIs (teriparatide per Forsteo SPC §4.3; abaloparatide per Eladynos SPC §4.3).
//
// v1.48 — Resolution flipped from γ to α (Backlog #18 eyeball Fix 2): the
// earlier γ rationale ("specialist will catch the renal CI") was wrong. The
// teri/abalo SPCs read as hard contraindications equivalent in shape to the
// bisphosphonate cascade, not specialist-judgement caveats. GP-level
// prerequisite surfacing of CrCl is therefore appropriate when teri or abalo
// sits in specialistOptions — completes the bloods before referral.
//
// Romosozumab remains OUT of RENALLY_CLEARED: the Evenity SPC has no renal
// dose adjustment, and severe-renal-impairment hypocalcaemia risk is covered
// by F1 (measurement filter, fires regardless). Romo is in ANTIRESORPTIVES
// + parenteral sets per existing classification, so F2/F4 still fire on
// romo-bearing profiles.
const RENALLY_CLEARED: ReadonlySet<TreatmentAgent> = new Set<TreatmentAgent>([
  'alendronate',
  'risedronate',
  'ibandronate',
  'zoledronate',
  'denosumab',
  'teriparatide',
  'abaloparatide',
]);

function isAntiresorptive(rec: TreatmentRecommendation): boolean {
  return ANTIRESORPTIVES.has(rec.agent);
}

// Parenteral antiresorptive: SC injection or IV infusion. Ibandronate has both
// oral and IV preparations and shares the 'ibandronate' agent enum; distinguish
// via the dose string (same pattern used by withBPInitiationContext at
// treatment.ts).
function isParenteralAntiresorptive(rec: TreatmentRecommendation): boolean {
  if (rec.agent === 'denosumab' || rec.agent === 'romosozumab' || rec.agent === 'zoledronate') return true;
  if (rec.agent === 'ibandronate' && rec.dose.includes('IV')) return true;
  return false;
}

function isOralBisphosphonate(rec: TreatmentRecommendation): boolean {
  if (rec.agent === 'alendronate' || rec.agent === 'risedronate') return true;
  if (rec.agent === 'ibandronate' && !rec.dose.includes('IV')) return true;
  return false;
}

function isRenallyCleared(rec: TreatmentRecommendation): boolean {
  return RENALLY_CLEARED.has(rec.agent);
}

// SpecialistOption gate helpers. SpecialistOption.drug is the AnabolicAgent set
// (teriparatide / romosozumab / abaloparatide). Of those:
//   - romosozumab IS in ANTIRESORPTIVES and IS parenteral.
//   - none are in RENALLY_CLEARED (per Resolution γ).
function specialistOptionsIncludesAntiresorptive(opts: SpecialistOption[]): boolean {
  return opts.some(o => ANTIRESORPTIVES.has(o.drug));
}
function specialistOptionsIncludesParenteralAntiresorptive(opts: SpecialistOption[]): boolean {
  return opts.some(o => o.drug === 'romosozumab');
}
function specialistOptionsIncludesRenallyCleared(opts: SpecialistOption[]): boolean {
  // v1.48 — RENALLY_CLEARED ∩ AnabolicAgent = {teriparatide, abaloparatide}
  // (romosozumab is not in RENALLY_CLEARED — see set comment above). When
  // either anabolic appears in specialistOptions and CrCl is uncomputable,
  // the crcl_pending_renal_drug gate is satisfied even with empty
  // treatmentRecommendations.
  return opts.some(o => RENALLY_CLEARED.has(o.drug));
}

/**
 * Mutates `recommendations` array in place to tag entries with status /
 * blockReason / unblockAction per the safety-filter chain, and pushes urgent
 * flags into the `flags` array.
 *
 * Called once from index.ts after generateTreatmentOutput returns — single call
 * site applies to every code path that produced recommendations (standard
 * recipe, GIOP, early menopause, oesophageal disease, sequencing continuation).
 *
 * `specialistOptions` participates in the missingness-filter gate predicates per
 * D4 (Shape B specialist-menu drugs count as "in scope for prerequisite
 * surfacing"). It is not itself mutated.
 */
export function applyPreTreatmentSafetyFilters(
  patient: PatientInput,
  recommendations: TreatmentRecommendation[],
  specialistOptions: SpecialistOption[],
  flags: ClinicalFlag[],
): void {
  const ca = patient.bloodResults?.adjustedCalciumMmol ?? null;
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;
  const crcl = computeCrCl(patient);

  const caLow = ca !== null && ca < CA_LOW;
  const caMissing = ca === null;
  const vitDLow = vitD !== null && vitD < VITD_INSUFFICIENT;
  const vitDMissing = vitD === null;
  const crclUnknown = crcl === null;

  // Gate predicates for missingness filters (D3 + D4). Computed once.
  const anyAntiresorptiveCandidate =
    recommendations.some(isAntiresorptive) ||
    specialistOptionsIncludesAntiresorptive(specialistOptions);
  const anyParenteralAntiresorptiveCandidate =
    recommendations.some(isParenteralAntiresorptive) ||
    specialistOptionsIncludesParenteralAntiresorptive(specialistOptions);
  const anyRenallyClearedCandidate =
    recommendations.some(isRenallyCleared) ||
    specialistOptionsIncludesRenallyCleared(specialistOptions);

  // ─── hypocalcaemia_antiresorptive_block — measurement filter (Ca low) ───
  // NOGG p.29 §a (oral + IV BPs), p.30 §a (denosumab), p.34 §c (romosozumab) —
  // hypocalcaemia is an absolute contraindication for all antiresorptives.
  // Fires regardless of recommendations content (D3 — clinical urgency
  // independent of treatment context).
  if (caLow) {
    for (const rec of recommendations) {
      if (!isAntiresorptive(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.status = 'blocked';
      rec.blockReason = `Hypocalcaemia: corrected calcium ${ca} mmol/L below 2.10`;
      rec.unblockAction =
        'Correct hypocalcaemia (investigate cause — likely Vit D deficiency if Vit D not yet measured or low; ' +
        'consider PTH if Vit D replete); recheck Ca; then reassess treatment.';
    }
    flags.push({
      id: 'hypocalcaemia_antiresorptive_block',
      severity: 'urgent',
      message:
        `ALL antiresorptives contraindicated — corrected calcium ${ca} mmol/L (NOGG 2024 p.29, p.30, p.34). ` +
        'Correct hypocalcaemia before initiation. Investigate cause: if Vit D deficient, treat with Vit D ' +
        '100,000–300,000 IU orally as loading dose; if Vit D replete, consider PTH and other causes. ' +
        'Recheck corrected calcium before reassessment.',
      rationale:
        'NOGG 2024 p.29 §a (oral and intravenous bisphosphonates contraindicated in hypocalcaemia), ' +
        'p.30 §a (denosumab contraindicated in hypocalcaemia), p.34 §c (romosozumab contraindicated in hypocalcaemia). ' +
        'Hypocalcaemia is an absolute CI to all antiresorptive classes; correct before initiation regardless of agent choice.',
      source: SRC_NOGG,
    });
  }

  // ─── calcium_unmeasured_antiresorptive_block — missingness filter ───
  // Spec v1.46 §4.2 Tier 1 row + §5.3: calcium must be measured before any
  // antiresorptive can be initiated (cannot verify CI without measurement;
  // pre-each-dose Ca check is SmPC mandate for denosumab and IV zoledronate).
  // Gated on antiresorptive candidate (D3): if no antiresorptive is being
  // considered for this patient, the Ca prerequisite is not yet load-bearing.
  if (caMissing && anyAntiresorptiveCandidate) {
    for (const rec of recommendations) {
      if (!isAntiresorptive(rec)) continue;
      if (rec.status === 'blocked') continue;
      // Caption accumulates per-card (Backlog #18 Fix 1) — every filter that
      // applies to this rec appends its prerequisite to the array.
      rec.pendingCaption = [...(rec.pendingCaption ?? []), CAPTION_CALCIUM_ONLY];
      // Status / blockReason / unblockAction respect first-fire precedence.
      if (rec.status === 'pending') continue;
      rec.status = 'pending';
      rec.blockReason = 'Pre-treatment corrected calcium not yet measured';
      rec.unblockAction =
        'Check corrected calcium (Tier 1 bloods); confirm in range (2.10–2.55 mmol/L) before initiation.';
    }
    flags.push({
      id: 'calcium_unmeasured_antiresorptive_block',
      severity: 'urgent',
      message:
        'Corrected calcium has not been measured. Complete corrected calcium as a Tier 1 blood and reassess once result is available.',
      rationale:
        'Spec v1.46 §4.2 Tier 1 row + §5.3: corrected calcium must be measured before any antiresorptive ' +
        'initiation (cannot verify NOGG hypoCa CI without measurement; pre-each-dose Ca check is the SmPC mandate ' +
        'for denosumab and IV zoledronate). The Tier 1 missing-Ca investigation entry continues to surface in ' +
        'investigationsNeeded — this flag adds the recommendation-time gate.',
      source: SRC_NOGG,
    });
  }

  // ─── vitd_parenteral_block — measurement filter (Vit D low) ───
  // NOGG Rec 17 (Strong) — treat Vit D deficiency/insufficiency prior to
  // initiation of PARENTERAL anti-osteoporosis drug treatment. Oral BPs
  // continue alongside Vit D supplementation per Rec 17. Scope: parenterals
  // only. Fires regardless of recommendations content (D3 — Vit D deficiency
  // is a clinical finding worth surfacing).
  if (vitDLow) {
    for (const rec of recommendations) {
      if (!isParenteralAntiresorptive(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.status = 'blocked';
      rec.blockReason = `Vit D insufficient (${vitD} nmol/L) — parenteral antiresorptives blocked until Vit D treated`;
      rec.unblockAction =
        'Treat Vit D per spec §4.3 loading protocol; recheck after loading; once Vit D ≥50 nmol/L ' +
        '(or consultant-confirmed target — see §14.11), reassess parenteral options.';
    }
    for (const rec of recommendations) {
      if (!isOralBisphosphonate(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.monitoring = [
        ...rec.monitoring,
        `NOGG Rec 17: Vit D ${vitD} nmol/L (<50). Initiate Vit D supplementation alongside oral bisphosphonate; recheck Vit D at 8–12 weeks.`,
      ];
    }
    flags.push({
      id: 'vitd_parenteral_block',
      severity: 'urgent',
      message:
        `Parenteral antiresorptives (denosumab, IV bisphosphonates, romosozumab) contraindicated — Vit D ${vitD} nmol/L below 50 (NOGG 2024 Rec 17). ` +
        'Treat Vit D first, recheck, then reassess parenteral options. Oral bisphosphonates may be initiated with concurrent Vit D supplementation.',
      rationale:
        'NOGG 2024 Recommendation 17 (Strong): "Treat vitamin D deficiency and insufficiency prior to initiation of ' +
        'parenteral anti-osteoporosis drug treatment, and alongside initiation of oral anti-osteoporosis drug treatment." ' +
        'Parenteral initiation requires Vit D ≥50; oral BPs initiate with concurrent supplementation.',
      source: SRC_NOGG,
    });
  }

  // ─── vitd_unmeasured_parenteral_block — missingness filter ───
  // NOGG Rec 17 (Strong) — cannot verify replete status without measurement.
  // Same drug scope as vitd_parenteral_block (parenterals). Gated on parenteral
  // antiresorptive candidate (D3); the prior F2/F4 dedup is retired (D2 —
  // each filter speaks for its own prerequisite, so co-firing with the
  // calcium-missing flag does not duplicate guidance).
  if (vitDMissing && anyParenteralAntiresorptiveCandidate) {
    for (const rec of recommendations) {
      if (!isParenteralAntiresorptive(rec)) continue;
      if (rec.status === 'blocked') continue;
      rec.pendingCaption = [...(rec.pendingCaption ?? []), CAPTION_VITD_ONLY];
      if (rec.status === 'pending') continue;
      rec.status = 'pending';
      rec.blockReason = 'Vit D not yet measured — parenteral antiresorptives require Vit D ≥50 before initiation';
      rec.unblockAction =
        'Check Vit D (Tier 1 bloods); confirm ≥50 nmol/L before parenteral initiation.';
    }
    for (const rec of recommendations) {
      if (!isOralBisphosphonate(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.monitoring = [
        ...rec.monitoring,
        'NOGG Rec 17: Vit D not yet measured. Check Vit D; supplement alongside oral bisphosphonate; recheck at 8–12 weeks.',
      ];
    }
    flags.push({
      id: 'vitd_unmeasured_parenteral_block',
      severity: 'urgent',
      message:
        'Vit D has not been measured. Parenteral antiresorptives require pre-treatment Vit D per NOGG 2024 Rec 17. ' +
        'Measure serum Vit D as a Tier 1 blood. Oral bisphosphonates may be initiated with concurrent supplementation.',
      rationale:
        'NOGG 2024 Recommendation 17 (Strong): Vit D status must be established before parenteral initiation. ' +
        'Without measurement, the Rec 17 precondition cannot be verified.',
      source: SRC_NOGG,
    });
  }

  // ─── crcl_pending_renal_drug — missingness filter (NEW v1.48) ───
  // Spec v1.46 §4.2 Tier 1 row: CrCl must be available before initiating any
  // renally-cleared antiresorptive. CrCl is computed via Cockcroft-Gault
  // (creatinine + weight + age + sex) — when any required input is missing
  // the renal cascade at RENAL_LIMITS (thresholds.ts:354) cannot be evaluated.
  //
  // Drug scope (Resolution γ): bisphosphonates (alendronate / risedronate /
  // ibandronate / zoledronate) + denosumab. Teriparatide / romosozumab /
  // abaloparatide are excluded — their renal considerations are
  // specialist-judgement, not GP-level prerequisite gating.
  if (crclUnknown && anyRenallyClearedCandidate) {
    for (const rec of recommendations) {
      if (!isRenallyCleared(rec)) continue;
      if (rec.status === 'blocked') continue;
      rec.pendingCaption = [...(rec.pendingCaption ?? []), CAPTION_CRCL_ONLY];
      if (rec.status === 'pending') continue;
      rec.status = 'pending';
      rec.blockReason = 'CrCl (Cockcroft-Gault) not yet computable — required for renally-cleared antiresorptive selection';
      rec.unblockAction =
        'Complete the inputs needed for CrCl computation (serum creatinine, weight, age); recheck before initiation.';
    }
    // Dynamic body listing the actual missing CrCl inputs. computeCrCl returns
    // null when any of {creatinine, weight, age} is missing or non-positive.
    // creatinine is BloodResults.creatinine (nullable). weightKg is nullable.
    // age is typed non-null in PatientInput but defensively listed when <=0
    // for completeness; in practice the wizard prevents that case.
    const creat = patient.bloodResults?.creatinine ?? null;
    const missing: string[] = [];
    if (creat === null || creat <= 0) missing.push('serum creatinine (Tier 1 blood)');
    if (patient.weightKg === null || patient.weightKg <= 0) missing.push('patient weight');
    if (patient.age <= 0) missing.push('patient age');
    const list =
      missing.length === 0
        ? 'the inputs required for Cockcroft-Gault computation'
        : missing.length === 1
          ? missing[0]
          : missing.length === 2
            ? `${missing[0]} and ${missing[1]}`
            : `${missing[0]}, ${missing[1]}, and ${missing[2]}`;
    flags.push({
      id: 'crcl_pending_renal_drug',
      severity: 'urgent',
      message:
        `CrCl (Cockcroft-Gault) cannot be computed for this patient. Complete ${list} to enable computation. Reassess once available.`,
      rationale:
        'Spec v1.46 §4.2 Tier 1 row: CrCl must be available before initiation of any renally-cleared ' +
        'antiresorptive (bisphosphonates have CrCl-based CI thresholds; denosumab has CrCl-based Ca-watch + ' +
        'specialist-only thresholds; teriparatide and abaloparatide have severe-renal absolute CIs per SPC §4.3). ' +
        'Cockcroft-Gault requires creatinine, weight, and age — when any input is missing the renal cascade at ' +
        'thresholds.ts:354 cannot be evaluated.',
      source: SRC_NOGG,
    });
  }

  // ─── denosumab_continuation_hypocalcaemia_hold — continuation-context (Ca low + on deno) ───
  // Distinct from initiation context (hypocalcaemia_antiresorptive_block covers
  // initiation). NOGG p.30 §c + denosumab SmPC: corrected Ca must be measured
  // before EVERY dose. Fires alongside the existing bloodFlags.ts hypocalcaemia
  // narrative — adds the continuation-specific "withhold next dose" action.
  if (
    caLow &&
    patient.currentTreatment?.currentlyOn === true &&
    patient.currentTreatment.agent === 'denosumab'
  ) {
    flags.push({
      id: 'denosumab_continuation_hypocalcaemia_hold',
      severity: 'urgent',
      message:
        `HOLD next denosumab dose — corrected calcium ${ca} mmol/L below 2.10. ` +
        'Pre-each-dose Ca check is SmPC requirement (NOGG 2024 p.30). ' +
        'Correct hypocalcaemia (investigate cause; if Vit D deficient, treat with Vit D); recheck Ca before next dose. ' +
        'Do not extend dosing interval beyond 7 months from last injection (rebound vertebral fracture risk).',
      rationale:
        'NOGG 2024 p.30 §c + denosumab SmPC: corrected calcium must be measured before every 6-monthly dose. ' +
        'Continuation-context hypocalcaemia requires a hold-and-correct action distinct from the initiation-context ' +
        '"correct before initiation" message — the patient is already on the drug; the next dose is the issue. ' +
        'The 7-month rebound risk window constrains how long the hold can safely run.',
      source: SRC_NOGG,
    });
    // hypocalcaemia_antiresorptive_block already tagged the denosumab recipe as
    // 'blocked' with the generic initiation-context unblockAction. Override
    // with continuation-specific wording so the UI surfaces the right action
    // for an already-on patient.
    for (const rec of recommendations) {
      if (rec.agent === 'denosumab' && rec.status === 'blocked') {
        rec.unblockAction =
          'HOLD next denosumab dose. Correct hypocalcaemia; recheck Ca; do not exceed 7 months from last injection (rebound risk).';
      }
    }
  }
}
