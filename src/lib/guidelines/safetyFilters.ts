// v1.37 Filters 1-5 — structural pre-treatment safety filters for hypocalcaemia and Vit D.
//
// Sources:
//   - NOGG 2024 p.29 §a: oral and intravenous bisphosphonates are contraindicated in
//     patients with hypocalcaemia.
//   - NOGG 2024 p.30 §a: denosumab is contraindicated in patients with hypocalcaemia.
//   - NOGG 2024 p.34 §c: romosozumab is contraindicated in patients with hypocalcaemia.
//   - NOGG 2024 Recommendation 17 (Strong): treat vitamin D deficiency and insufficiency
//     prior to initiation of parenteral anti-osteoporosis drug treatment, and alongside
//     initiation of oral anti-osteoporosis drug treatment.
//
// Architectural pattern:
//   - Recommendations are NOT removed when blocked/pending. They are tagged via the
//     status/blockReason/unblockAction fields on TreatmentRecommendation. This preserves
//     the "planned treatment once blocker resolved" UX requirement — clinician sees what
//     they'd be prescribing and what to do to unblock it.
//   - Filters fire urgent flags that accumulate (all reasons surfaced). The status tag
//     uses precedence Ca-low > Ca-missing > Vit D-low > Vit D-missing: implemented by
//     processing filters in order and only mutating entries currently 'active' (undefined
//     treated as 'active').
//   - teriparatide + abaloparatide are explicitly NOT in scope (anabolics, hyperCa CI not
//     hypoCa).
//   - HRT, raloxifene, bazedoxifene also NOT in scope (NOGG p.29-34 hypoCa CI text covers
//     bisphosphonates / denosumab / romosozumab specifically).
//   - The existing combined safety gate at treatment.ts:77-95 (severe Vit D <25 AND hypoCa
//     <2.10 simultaneously) continues to return empty recommendations and is unaffected by
//     this filter — that gate is a hard halt, this filter operates on the post-recipe set.

import type {
  PatientInput,
  TreatmentRecommendation,
  ClinicalFlag,
  TreatmentAgent,
} from './types';
import { GUIDELINE_VERSIONS } from './thresholds';

const SRC_NOGG = GUIDELINE_VERSIONS.nogg;

const CA_LOW = 2.10; // mmol/L — NOGG threshold for hypocalcaemia
const VITD_INSUFFICIENT = 50; // nmol/L — NOGG Rec 17 parenteral threshold

// v1.47 — Pending-prerequisites caption variants (locked wording). Surfaced to
// the UI via TreatmentRecommendation.pendingCaption at every pending-tagging
// site below. Variant chosen at filter-chain entry based on the global
// missing-prerequisite state — NOT per-filter (filters carry filter-specific
// blockReason/unblockAction subject to precedence; the caption must summarise
// every gap, which a single filter's view can't reflect). See types.ts
// TreatmentRecommendation.pendingCaption comment for the variant table.
const CAPTION_CALCIUM_ONLY =
  'Complete corrected calcium before initiating treatment. Reassess once result available.';
const CAPTION_VITD_ONLY_PARENTERAL =
  'Complete Vit D measurement before initiating parenteral therapy. Reassess once result available.';
const CAPTION_MULTI_MISSING =
  'Complete Tier 1 bloods (calcium, Vit D, serum creatinine as applicable) before initiating treatment. Reassess once results available.';

const ANTIRESORPTIVES: ReadonlySet<TreatmentAgent> = new Set<TreatmentAgent>([
  'alendronate',
  'risedronate',
  'ibandronate',
  'zoledronate',
  'denosumab',
  'romosozumab',
]);

function isAntiresorptive(rec: TreatmentRecommendation): boolean {
  return ANTIRESORPTIVES.has(rec.agent);
}

// Parenteral antiresorptive: SC injection or IV infusion. Ibandronate has both oral and
// IV preparations and shares the 'ibandronate' agent enum; distinguish via the dose string
// (same pattern used by withBPInitiationContext at treatment.ts).
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

/**
 * Mutates recommendations array in place to tag entries with status/blockReason/unblockAction
 * per NOGG 2024 p.29/30/34 + Rec 17, and pushes urgent flags into the flags array.
 *
 * Called once from index.ts after generateTreatmentOutput returns — single call site applies
 * to every code path that produced recommendations (standard recipe, GIOP, early menopause,
 * oesophageal disease pathway, sequencing continuation).
 */
export function applyPreTreatmentSafetyFilters(
  patient: PatientInput,
  recommendations: TreatmentRecommendation[],
  flags: ClinicalFlag[],
): void {
  const ca = patient.bloodResults?.adjustedCalciumMmol ?? null;
  const vitD = patient.bloodResults?.vitaminDNmol ?? null;

  const caLow = ca !== null && ca < CA_LOW;
  const caMissing = ca === null;
  const vitDLow = vitD !== null && vitD < VITD_INSUFFICIENT;
  const vitDMissing = vitD === null;

  // v1.47 — pending-caption variant selection based on the global missing-
  // prerequisite state. F2 (caMissing) tags all antiresorptives — when
  // vitDMissing is also true, caption captures both gaps because F2's mutation
  // wins precedence over F4's (status-already-set guard skips F4's mutation).
  // F4 (vitDMissing standalone) only runs on entries not already tagged by F2,
  // so by construction caMissing is false at F4's mutation site → Vit D-only
  // caption applies.
  const f2PendingCaption =
    caMissing && vitDMissing ? CAPTION_MULTI_MISSING : CAPTION_CALCIUM_ONLY;
  const f4PendingCaption = CAPTION_VITD_ONLY_PARENTERAL;

  // ─── Filter 1: Universal hypocalcaemia (Ca < 2.10) ──────────────────────
  // NOGG p.29 §a (oral + IV BPs), p.30 §a (denosumab), p.34 §c (romosozumab) —
  // hypocalcaemia is an absolute contraindication for all antiresorptives.
  if (caLow) {
    for (const rec of recommendations) {
      if (!isAntiresorptive(rec)) continue;
      if (rec.status && rec.status !== 'active') continue; // precedence: don't override
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

  // ─── Filter 2: Missing calcium (Ca null) ─────────────────────────────────
  // Spec v1.37 §4 line 323 + §5.3 line 444 — calcium must be measured before any
  // antiresorptive can be initiated (cannot verify CI without measurement; pre-each-dose
  // Ca check is SmPC mandate for denosumab and IV zoledronate).
  if (caMissing) {
    for (const rec of recommendations) {
      if (!isAntiresorptive(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.status = 'pending';
      rec.blockReason = 'Pre-treatment corrected calcium not yet measured';
      rec.unblockAction =
        'Check corrected calcium (Tier 1 bloods); confirm in range (2.10–2.55 mmol/L) before initiation.';
      rec.pendingCaption = f2PendingCaption;
    }
    flags.push({
      id: 'calcium_unmeasured_antiresorptive_block',
      severity: 'urgent',
      message:
        'Mandatory pre-treatment corrected calcium check required before any antiresorptive can be initiated. ' +
        'Measure Ca, Vit D, and serum creatinine as Tier 1 bloods (see investigationsNeeded). Reassess once results available.',
      rationale:
        'Spec v1.37 §4 line 323 + §5.3 line 444: corrected calcium must be measured before any antiresorptive ' +
        'initiation (cannot verify NOGG hypoCa CI without measurement; pre-each-dose Ca check is the SmPC mandate ' +
        'for denosumab and IV zoledronate). The Tier 1 missing-Ca investigation entry continues to surface in ' +
        'investigationsNeeded — this flag adds the recommendation-time gate.',
      source: SRC_NOGG,
    });
  }

  // ─── Filter 3: Vit D < 50 — parenteral block ────────────────────────────
  // NOGG Rec 17 (Strong) — treat Vit D deficiency/insufficiency prior to initiation of
  // PARENTERAL anti-osteoporosis drug treatment. Oral BPs continue alongside Vit D
  // supplementation per Rec 17. Scope: parenterals only.
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
    // Oral BPs continue with NOGG Rec 17 concurrent-supplementation note.
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

  // ─── Filter 4: Vit D missing — parenteral block ─────────────────────────
  // NOGG Rec 17 (Strong) — cannot verify replete status without measurement. Same scope
  // as Filter 3 (parenterals).
  if (vitDMissing) {
    for (const rec of recommendations) {
      if (!isParenteralAntiresorptive(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.status = 'pending';
      rec.blockReason = 'Vit D not yet measured — parenteral antiresorptives require Vit D ≥50 before initiation';
      rec.unblockAction =
        'Check Vit D (Tier 1 bloods); confirm ≥50 nmol/L before parenteral initiation.';
      rec.pendingCaption = f4PendingCaption;
    }
    // Oral BPs continue with NOGG Rec 17 concurrent-supplementation note.
    for (const rec of recommendations) {
      if (!isOralBisphosphonate(rec)) continue;
      if (rec.status && rec.status !== 'active') continue;
      rec.monitoring = [
        ...rec.monitoring,
        'NOGG Rec 17: Vit D not yet measured. Check Vit D; supplement alongside oral bisphosphonate; recheck at 8–12 weeks.',
      ];
    }
    // v1.45 dedup — suppress F4 flag emission when F2
    // (calcium_unmeasured_antiresorptive_block) is already firing. F2's
    // message explicitly says "Measure Ca, Vit D, and serum creatinine as Tier 1 bloods"
    // — the parenteral-specific Vit D message below duplicates that
    // guidance, producing two URGENT alerts both prompting Vit D
    // measurement. The recipe-status mutation block above (pending +
    // blockReason on parenteral entries; Rec 17 monitoring note on oral
    // BPs) is preserved regardless — parenteral entries should still be
    // tagged 'pending' even when the user-facing message is consolidated
    // under F2. F3 (vitd_parenteral_block, Vit D measured + LOW) is NOT
    // affected by this dedup — F3 carries distinct "Treat Vit D first"
    // actionable guidance that F2 does not duplicate.
    //
    // v1.46.2 — refactored from `flags.some(f => f.id === '...')` runtime
    // introspection to deterministic boolean check on the precondition
    // (caMissing) that gates F2. F2's emission is unconditional inside
    // its `if (caMissing)` block, so caMissing ⇔ F2 fires. Using the
    // boolean directly decouples the dedup from source order — even if
    // a future refactor moves F4 above F2, the guard remains correct.
    // Locked structurally by TC112 (F2+F4 dedup contract).
    const f2WouldFire = caMissing;
    if (!f2WouldFire) {
      flags.push({
        id: 'vitd_unmeasured_parenteral_block',
        severity: 'urgent',
        message:
          'Parenteral antiresorptives require pre-treatment Vit D measurement (NOGG 2024 Rec 17). ' +
          'Measure as part of Tier 1 bloods. Oral bisphosphonates may be initiated with concurrent supplementation.',
        rationale:
          'NOGG 2024 Recommendation 17 (Strong): Vit D status must be established before parenteral initiation. ' +
          'Without measurement, the Rec 17 precondition cannot be verified.',
        source: SRC_NOGG,
      });
    }
  }

  // ─── Filter 5: Continuation-context hypocalcaemia for on-denosumab patients ──
  // Distinct from initiation context (Filter 1 covers initiation). NOGG p.30 §c +
  // denosumab SmPC: corrected Ca must be measured before EVERY dose. This flag fires
  // alongside the existing bloodFlags.ts hypocalcaemia narrative — the new flag adds
  // the continuation-specific "withhold next dose" action.
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
    // Filter 1 has already tagged the denosumab recipe as 'blocked' with the generic
    // initiation-context unblockAction. Override with continuation-specific wording so
    // the UI surfaces the right action for an already-on patient.
    for (const rec of recommendations) {
      if (rec.agent === 'denosumab' && rec.status === 'blocked') {
        rec.unblockAction =
          'HOLD next denosumab dose. Correct hypocalcaemia; recheck Ca; do not exceed 7 months from last injection (rebound risk).';
      }
    }
  }
}
