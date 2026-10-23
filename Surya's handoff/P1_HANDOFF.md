# Surya's Handoff: Task P1 — Bounded Multi-Format Extraction Engine

**Date:** 23 October 2026  
**Owner:** Surya (Workstream P)  
**Status:** Completed, Verified, and Pushed to `master` (Commit `fbb39fe`)

---

## 1. Summary of Changes

In Task P1, we built and verified the foundational content intake and parsing pipeline for BrandGuard. This engine takes raw file bytes, enforces strict resource boundaries, normalizes text representations, and outputs structured blocks with precise Unicode code-point locations.

### Files Created:
- [pyproject.toml](file:///d:/KEN/code-catalyst/pyproject.toml): Pinned Python project dependencies (`pydantic>=2.7`, `pypdf>=4.2`, `python-docx>=1.1`, `pillow>=10.3`, `psycopg>=3.1`, and `pytest`) and unified test runner configuration.
- [packages/review_engine/__init__.py](file:///d:/KEN/code-catalyst/packages/review_engine/__init__.py): Review engine package initialization.
- [packages/review_engine/models.py](file:///d:/KEN/code-catalyst/packages/review_engine/models.py): Canonical Pydantic data models for extraction:
  - `TextBlock`: ID, normalized text, page number, paragraph index, and `[start_char, end_char)` offsets.
  - `ImageMetadata`: Width, height, format (PNG/JPEG), alpha transparency flag, and color information.
  - `ExtractionResult`: Overall status, original SHA-256, canonical SHA-256, text blocks, image metadata, warnings, and capability map.
- [packages/review_engine/extraction.py](file:///d:/KEN/code-catalyst/packages/review_engine/extraction.py): Pure extraction implementation:
  - `extract(input_bytes, detected_type, limits) -> ExtractionResult`
- [apps/worker/__init__.py](file:///d:/KEN/code-catalyst/apps/worker/__init__.py): Worker package initialization marker.
- [tests/test_scaffolding.py](file:///d:/KEN/code-catalyst/tests/test_scaffolding.py): Verifies that dependencies load with expected version floors.
- [tests/review_engine/test_extraction.py](file:///d:/KEN/code-catalyst/tests/review_engine/test_extraction.py): 7 dedicated unit tests verifying all media types, Unicode offsets, size limits, and edge cases.
- [docs/plans/2026-10-23-surya-workstream-p.md](file:///d:/KEN/code-catalyst/docs/plans/2026-10-23-surya-workstream-p.md): Detailed 7-task implementation plan for Workstream P.

---

## 2. Why These Changes Were Made (Design Decisions & Invariants)

1. **Strict Contract Alignment ([docs/CONTRACTS.md](file:///d:/KEN/code-catalyst/docs/CONTRACTS.md#L11))**:
   - The contract specifies: `extract(input_bytes, detected_type, limits) -> ExtractionResult`.
   - The extraction module operates as a pure function: **zero database access, zero network calls, zero external model calls**. This makes it completely deterministic and isolated.

2. **Unicode Code-Point Offsets vs UTF-16 Offsets**:
   - Offsets are calculated in native Python Unicode code points `[start_char, end_char)`. Multi-byte characters (such as emojis like `🚀` or accent marks) are treated as single code points, avoiding character drift when Darshilkumar's web client highlights violating words in the browser.

3. **Deterministic Canonical Hashing & Line Normalization**:
   - Mixed line endings (`\r\n` or `\r`) are normalized to `\n` once upon intake.
   - We store both `original_sha256` (verifying exact uploaded bytes) and `canonical_sha256` (hash of normalized UTF-8 text). This allows Sanath's API to ensure content revisions are immutable and reproducible.

4. **Honest Failure & Degradation Visibility**:
   - Empty or scanned PDFs without embedded text are not falsely reported as "clean"; they return `status: "needs_manual_review"` with `warnings: ["Empty or scanned PDF without embedded text. OCR required."]`.
   - Unsupported file types and payloads exceeding size/page limits return `status: "failed"` with explicit error messages.

---

## 3. What This Adds to the Project (How Teammates Benefit)

- **For Sanath (Backend & Worker)**:
  - The worker (`apps/worker`) can directly call `extract(raw_bytes, mime_type, limits)` to turn uploaded draft content into immutable `canonical_sha256` and text blocks before running rule checks.
- **For Darshilkumar (Frontend & Review Desk)**:
  - Text blocks include unambiguous `paragraph` and `page` indices, and image files provide exact pixel dimensions (`width`, `height`) and transparency information.
  - Front-end code can reliably map character highlight ranges to the text.

---

## 4. Verification Evidence

Run the test suite locally:
```powershell
pytest tests/ -v
```

**Results:**
```
tests/review_engine/test_extraction.py::test_extract_plain_text PASSED   [ 12%]
tests/review_engine/test_extraction.py::test_extract_png_metadata PASSED [ 25%]
tests/review_engine/test_extraction.py::test_extract_jpeg_metadata PASSED [ 37%]
tests/review_engine/test_extraction.py::test_extract_pdf_with_text PASSED [ 50%]
tests/review_engine/test_extraction.py::test_extract_docx_paragraphs PASSED [ 62%]
tests/review_engine/test_extraction.py::test_extract_unsupported_media_type PASSED [ 75%]
tests/review_engine/test_extraction.py::test_extract_size_limit_exceeded PASSED [ 87%]
tests/test_scaffolding.py::test_environment_loads PASSED                 [100%]

============================== 8 passed in 0.42s ==============================
```

Integration and plan register check:
```powershell
python scripts/verify_plan.py
```
Output:
`PASS: 26 requirements mapped to 30 cases.`
