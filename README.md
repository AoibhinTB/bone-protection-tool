# Ireland Bone Protection Tool

Clinical decision support reference for osteoporosis in postmenopausal women and men aged ≥50, mapped to NOGG 2024 and localised for Irish primary care.

---

> ## ⚠️ NOT FOR CLINICAL USE
>
> This is a personal learning project. The expected outputs have **not** been independently clinically validated. This tool is **not** a registered medical device, has **not** undergone conformity assessment, and **must not** be used to make treatment decisions for real patients. It is published as a learning artefact and discussion piece only.

---

## What this is

A reference implementation of risk classification and pharmacological recommendation for osteoporosis in postmenopausal women and men aged ≥50, written against NOGG 2024 and localised to Irish primary care. The engine takes patient clinical information — medical history, risk factors, FRAX, DEXA where available, treatment history, and baseline bloods — produces a NOGG risk category with rationale, and emits drug recommendations annotated with prescribing context relevant to Ireland (FRAX country code 49; HSE BVM teriparatide biosimilar policy, March 2023; the cost-effectiveness order NOGG 2024 endorses — bisphosphonate first-line, denosumab the alternative when bisphosphonate is contraindicated).

## What this is NOT

- **Not a deployment-ready clinical tool.** It is a working prototype, not a production system.
- **Not validated by a consultant.** Expected outputs are one author's synthesis of the source guidelines.
- **Not a registered medical device.** No CE marking. No regulatory submission. No QMS.
- **Not a substitute for clinical judgement.** Recommendations must be verified against current SmPCs and HSE reimbursement criteria before any prescribing decision.
- **Not a replacement for FRAX itself.** The regulated FRAX calculator at [frax.shef.ac.uk](https://frax.shef.ac.uk/FRAX/) is the authoritative source of FRAX probability; this tool consumes those values, it does not replace the calculator.

## Clinical scope

**In scope:** postmenopausal women and men aged ≥50 (NOGG 2024 scope), with adjuncts for premature ovarian insufficiency / early menopause, glucocorticoid-induced osteoporosis (GIOP), androgen deprivation therapy (ADT) and aromatase inhibitor–induced bone loss.

**Out of scope:** premenopausal women with osteoporosis, men aged <50, pregnancy / breastfeeding, Paget's disease of bone, malignancy-associated hypercalcaemia or bone metastases — these route to specialist referral.

**Guideline sources mapped** (per the in-tool disclaimer footer): NOGG 2024 · NICE NG23 · NICE NG187 · FRAX Ireland (country code 49) · IOF · ISCD 2023 · HSE BVM (teriparatide biosimilar policy).

## Architecture

Next.js 14 + TypeScript. The clinical logic in `src/lib/guidelines/` is a set of pure deterministic functions — same patient input always produces the same output. There is no server-side state, no database, and no patient data is ever persisted: every recommendation is computed in-browser and discarded when the page is closed. Tests run via a custom runner (`run-tcs.ts`) executed through `ts-node` and invoked with `npm test`.

## How to run it

```bash
git clone https://github.com/AoibhinTB/bone-protection-tool.git
cd bone-protection-tool
npm install
npm test         # runs the full clinical test suite
npm run dev      # starts the wizard at http://localhost:3000
```

## Where to find things

- **`src/lib/guidelines/`** — the deterministic clinical engine. Risk stratification, FRAX adjustments, treatment cascades, drug-specific recipes, flag-generation logic, and the test runner all live here. This directory is the source of truth for clinical behaviour.

The clinical spec and test-case documents are tracked separately from this repository.

## Regulatory position

The engine computes a quantitative clinical risk classification and emits pharmacological treatment recommendations. Under **EU MDR Rule 11**, software intended to provide information used to take decisions with therapeutic purposes is classified **Class IIa as a minimum** (and higher in many cases). This tool has not been through CE marking, ISO 13485 conformity assessment, a clinical evaluation, or any independent verification. It is published as a learning artefact and discussion piece, not a medical device.

## Author

Aoibhín Bardon — [Substack](https://substack.com/@aoibhintb) · [LinkedIn](https://www.linkedin.com/in/aoibhin-bardon)
