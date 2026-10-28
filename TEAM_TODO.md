# Team TODO — Darshilkumar and Surya

All code is on branch `ONE-FINAL-SCORE` (pushed). Pull it first:

```
git fetch origin && git checkout ONE-FINAL-SCORE
source .venv/bin/activate && pytest apps/api/tests tests -q
npm --prefix apps/web ci && npm --prefix apps/web run build
```

Run the tests before every push. Keep commits small and under your own name.

## Darshilkumar — owns Improvement 3 (guideline requests, peer review, regression runs)

1. **Learn and test Improvement 3.** Click through the Guideline health page, raise an
   improvement request, run a comparison, peer-review and activate it. Report bugs.
   Be ready to explain it to the judges in 2 minutes.
2. **Check the usability work.** Private demo sandboxes, the role switcher, the
   Judge guide's "Round 3 missions" tab and the plain-language copy. Fix wording that feels off.
3. **Review the benchmark labels with Surya.** `evaluation/fixtures/benchmark_v2.json`
   has 60 campaigns. Fix wrong labels, then re-freeze the SHA in `evaluation/benchmark_v2.py`.
4. **Label-agreement study with Surya.** Both of you label the same 15 campaigns
   separately, then compute Cohen's kappa and log the disagreements.
5. **User study.** 6 people, time-on-task plus SUS scores.
6. **Docs.** Write the README (judge can follow in 1 minute), `ARCHITECTURE.md`, the
   Round 2 → 3 changelog and the final PDF, including the AI-tool disclosure.
7. **Final check.** Open every submission link in a private window.

## Surya — owns Improvement 2 (image campaigns, OCR, region-linked findings)

1. **Learn and test Improvement 2.** Upload PNG/JPEG ads, correct the OCR text, and
   check that findings are linked to image regions. Also check PDF/DOCX import and
   scanned-PDF → image. Be ready to explain the OCR pipeline in 2 minutes.
2. **Hosting (with Sanath, since it costs money).** Follow `MORNING_TODO.md` §1–3:
   - Render Blueprint from `render.yaml`: an API and a separate worker.
   - Check the database plan. If it's free Postgres, back it up and move it.
   - Uptime monitors on `/api/v1/health/ready` and `/api/v1/health/worker`.
   - The `BRANDGUARD_URL` GitHub variable for the synthetic journey.
   - Do all of this **before** `ONE-FINAL-SCORE` is merged into `master`.
3. **Test OCR on staging.** Install Tesseract locally
   (`sudo apt install tesseract-ocr tesseract-ocr-eng`), upload a few **real** ads and
   confirm the OCR boxes appear on the deployed worker.
4. **Real ad graphics.** The OCR benchmark uses 20 synthetic ads. If you can, add real
   ones and run `python -m evaluation.ocr_benchmark`.
5. **Review the impact benchmark labels** in `evaluation/fixtures/impact_benchmark.json`
   with Sanath, plus the benchmark v2 and label-agreement work with Darshilkumar above.
6. **Load test** on staging:
   `python scripts/load_test.py https://<app>.vercel.app --users 10 --minutes 10`.
7. **Evidence docs.** Write `evaluation/REPORT.md` with all benchmark results and
   `TESTING.md` with how to run the tests and the latest results.
8. **On submission day,** watch production and the monitors.

## Together
- Label the benchmark campaigns (2 hours, everyone).
- Record the demo video against production.
- Each person rehearses a 2-minute explanation of their own improvement.
