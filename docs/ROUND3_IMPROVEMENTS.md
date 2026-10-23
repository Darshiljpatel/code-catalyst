# Three Round 3 improvements

These extend a completed Round 2 core. Missing upload integration, approval UI, deployment and required reliability checks remain current work.

## 1. Source-change impact and re-review inbox

Round 2 rejects stale approval/export. Add a manager-visible dependency inbox showing which content is affected by a changed source, the changed facts/rules, assigned re-review batches and progress.

Acceptance: change one seeded fact; identify every dependent review, exclude unrelated brand/source work, show a meaningful old/new diff and complete the assigned batch with an auditable re-review decision. Retain earlier evidence. Measure missed/incorrect impact assignments on frozen dependency cases. Owner: Sanath backend with Darshilkumar UI and Surya fixtures.

## 2. Campaign-graphic evidence review

Extend basic image/asset/contrast checks with OCR bounding boxes, reviewer-confirmed extracted claims and annotated logo/layout review tasks. Keep uncertain text and flattened-logo interpretation visible as human tasks.

Acceptance: freeze and evaluate 20 unseen graphics with embedded claims, low contrast and unreadable regions. Report OCR transcription/location errors, claim-check misses and false flags separately. A reviewer can correct extracted text while preserving the original image and provenance. Do not claim automated logo-placement certification. Owner: Surya engine with Darshilkumar annotations and Sanath evidence records.

## 3. Guideline improvement workflow

Extend recurring counts and ambiguity reports into manager adjudication: examples, disputed rule, proposed revised guideline, independent review, activation and before/after evaluation.

Acceptance: take one recurring ambiguous rule through revision and independent activation; show affected reviews and retained historical evidence. Report changed false-positive/miss counts on frozen cases, including any regression. A count alone cannot establish that a guideline is defective. Owner: Darshilkumar workflow with Sanath lifecycle controls and Surya evaluation.
