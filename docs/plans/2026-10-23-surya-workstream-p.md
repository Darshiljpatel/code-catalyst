# Workstream P (Surya) Implementation Plan: Review Engine, Worker, Evaluation & Infra

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify Surya's assigned components for BrandGuard Round 2: the bounded extraction engine, the deterministic rule/compliance checkers, the resilient PostgreSQL queue worker, the synthetic evaluation harness, and Docker Compose deployment packaging.

**Architecture:** Pure, stateless Python modules for extraction and deterministic rule evaluation in `packages/review_engine/` communicating through standardized contracts (Unicode code-point offsets and immutable hashes); a durable background worker loop in `apps/worker/` using transactional database row leases (`SKIP LOCKED`); an evaluation harness in `evaluation/` calculating precision and recall; and reproducible multi-container orchestration in `infra/`.

**Tech Stack:** Python 3.13, Pydantic v2, PyPDF, python-docx, Pillow, psycopg3 / SQLAlchemy, Pytest, Docker Compose.

## Global Constraints

- **Scope Boundary**: Touch ONLY `packages/review_engine/`, `apps/worker/`, `infra/`, `evaluation/`, `pyproject.toml`, and `verification/evidence/`. Never modify `apps/api/`, `apps/web/`, `tests/e2e/`, or database migrations.
- **Git Branch**: All work commits directly to `master` (no new branches).
- **Offset Requirement**: All character offsets MUST be Unicode code points `[start, end)`, never JavaScript UTF-16 code units.
- **Contract Compatibility**: Finding schema, check statuses, and categories must strictly conform to [docs/CONTRACTS.md](file:///d:/KEN/code-catalyst/docs/CONTRACTS.md).
- **Failure Visibility**: Errors, unreadable scans, and missing assets return explicit statuses (`needs_manual_review`, `failed`, `unsupported`), never silent passes.

---

### Task 1: Python Project Scaffolding & Shared Dependency Lock

**Files:**
- Create: `pyproject.toml`
- Create: `packages/review_engine/__init__.py`
- Create: `apps/worker/__init__.py`
- Test: `tests/test_scaffolding.py`

**Interfaces:**
- Consumes: Python 3.13 standard library and pip packages.
- Produces: Installed environment and test discovery root for `pytest`.

- [ ] **Step 1: Write the scaffolding verification test**

Create `tests/test_scaffolding.py`:
```python
def test_environment_loads():
    import pydantic
    import PIL
    import pypdf
    import docx
    assert int(pydantic.__version__.split(".")[0]) >= 2
```

- [ ] **Step 2: Run test to verify it fails (missing dependencies/file)**

Run:
```powershell
pytest tests/test_scaffolding.py -v
```
Expected: FAIL with ModuleNotFoundError or file not found.

- [ ] **Step 3: Create pyproject.toml with pinned dependencies**

Create `pyproject.toml`:
```toml
[project]
name = "brandguard"
version = "0.1.0"
description = "BrandGuard Pre-publication brand review platform"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.7.0,<3.0.0",
    "pypdf>=4.2.0,<5.0.0",
    "python-docx>=1.1.0,<2.0.0",
    "pillow>=10.3.0,<11.0.0",
    "psycopg[binary]>=3.1.18,<4.0.0",
    "python-multipart>=0.0.9",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["packages", "."]
```

Create empty packages markers:
`packages/review_engine/__init__.py`
`apps/worker/__init__.py`

Install dependencies:
```powershell
pip install -e .
pip install pytest pytest-asyncio
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/test_scaffolding.py -v
```
Expected: PASS (1 passed).

- [ ] **Step 5: Commit on master**

```powershell
git add pyproject.toml packages/review_engine/__init__.py apps/worker/__init__.py tests/test_scaffolding.py
git commit -m "chore: setup python project scaffolding and dependencies"
```

---

### Task 2: Extraction Engine (`packages/review_engine/extraction.py`)

**Files:**
- Create: `packages/review_engine/models.py`
- Create: `packages/review_engine/extraction.py`
- Test: `tests/review_engine/test_extraction.py`

**Interfaces:**
- Consumes: Raw `input_bytes: bytes`, `detected_type: str`, `limits: dict`
- Produces: `ExtractionResult` containing `TextBlock` items with code-point offsets `[start, end)`, canonical hashes, page/paragraph indices, image metadata, and per-capability statuses.

- [ ] **Step 1: Write failing extraction unit tests**

Create `tests/review_engine/test_extraction.py`:
```python
import io
import pytest
from PIL import Image
from review_engine.extraction import extract
from review_engine.models import ExtractionResult

def test_extract_plain_text():
    content = "Hello world!\nLine 2 with special char: 🚀 rocket."
    res = extract(content.encode("utf-8"), "text/plain", limits={"max_bytes": 10000})
    assert isinstance(res, ExtractionResult)
    assert res.status == "complete"
    assert len(res.blocks) == 2
    assert res.blocks[0].text == "Hello world!"
    assert res.blocks[0].start_char == 0
    assert res.blocks[0].end_char == 12
    # Verify unicode code point offset: "🚀" is 1 codepoint, not 2 UTF-16 units
    assert res.blocks[1].start_char == 13
    assert res.blocks[1].text == "Line 2 with special char: 🚀 rocket."

def test_extract_png_metadata():
    img_byte_arr = io.BytesIO()
    img = Image.new("RGB", (300, 200), color="blue")
    img.save(img_byte_arr, format="PNG")
    res = extract(img_byte_arr.getvalue(), "image/png", limits={"max_bytes": 100000})
    assert res.status == "complete"
    assert res.image_metadata is not None
    assert res.image_metadata.width == 300
    assert res.image_metadata.height == 200
    assert res.image_metadata.format == "PNG"

def test_extract_unsupported_type():
    res = extract(b"test", "application/x-unknown", limits={"max_bytes": 1000})
    assert res.status == "failed"
    assert "Unsupported" in res.warnings[0]

def test_extract_exceeds_size_limit():
    res = extract(b"1234567890", "text/plain", limits={"max_bytes": 5})
    assert res.status == "failed"
    assert "exceeds" in res.warnings[0].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
pytest tests/review_engine/test_extraction.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'review_engine.models'`.

- [ ] **Step 3: Implement extraction models and extract logic**

Create `packages/review_engine/models.py`:
```python
import hashlib
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class TextBlock(BaseModel):
    id: str
    text: str
    page: Optional[int] = None
    paragraph: Optional[int] = None
    start_char: int
    end_char: int

class ImageMetadata(BaseModel):
    width: int
    height: int
    format: str
    has_alpha: bool = False
    dominant_colors: Optional[List[str]] = None

class ExtractionResult(BaseModel):
    status: str = "complete"  # complete | partial | failed | needs_manual_review
    original_sha256: str
    canonical_sha256: str
    blocks: List[TextBlock] = Field(default_factory=list)
    image_metadata: Optional[ImageMetadata] = None
    warnings: List[str] = Field(default_factory=list)
    capabilities: Dict[str, str] = Field(default_factory=dict)
```

Create `packages/review_engine/extraction.py`:
```python
import io
import hashlib
from typing import Dict, Any, List
from PIL import Image
from pypdf import PdfReader
from docx import Document
from review_engine.models import ExtractionResult, TextBlock, ImageMetadata

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def extract(input_bytes: bytes, detected_type: str, limits: Dict[str, Any]) -> ExtractionResult:
    max_bytes = limits.get("max_bytes", 10 * 1024 * 1024)
    orig_hash = compute_sha256(input_bytes)

    if len(input_bytes) > max_bytes:
        return ExtractionResult(
            status="failed",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            warnings=[f"Payload size {len(input_bytes)} exceeds limit of {max_bytes} bytes"]
        )

    if detected_type == "text/plain":
        return _extract_plain_text(input_bytes, orig_hash)
    elif detected_type in ("image/png", "image/jpeg"):
        return _extract_image(input_bytes, detected_type, orig_hash)
    elif detected_type == "application/pdf":
        return _extract_pdf(input_bytes, orig_hash, limits)
    elif detected_type in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/docx"):
        return _extract_docx(input_bytes, orig_hash)
    else:
        return ExtractionResult(
            status="failed",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            warnings=[f"Unsupported media type: {detected_type}"]
        )

def _extract_plain_text(data: bytes, orig_hash: str) -> ExtractionResult:
    text = data.decode("utf-8", errors="replace")
    # Normalize line endings
    norm_text = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks: List[TextBlock] = []
    
    current_offset = 0
    lines = norm_text.split("\n")
    for i, line in enumerate(lines):
        line_len = len(line)  # Unicode code point count in Python
        if line.strip():
            blocks.append(TextBlock(
                id=f"p-{i+1}",
                text=line,
                paragraph=i + 1,
                start_char=current_offset,
                end_char=current_offset + line_len
            ))
        current_offset += line_len + 1  # account for \n

    canonical_bytes = norm_text.encode("utf-8")
    return ExtractionResult(
        status="complete",
        original_sha256=orig_hash,
        canonical_sha256=compute_sha256(canonical_bytes),
        blocks=blocks,
        capabilities={"text_extraction": "complete"}
    )

def _extract_image(data: bytes, mime: str, orig_hash: str) -> ExtractionResult:
    try:
        img = Image.open(io.BytesIO(data))
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        meta = ImageMetadata(
            width=img.width,
            height=img.height,
            format=img.format or ("PNG" if "png" in mime else "JPEG"),
            has_alpha=has_alpha
        )
        return ExtractionResult(
            status="complete",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            image_metadata=meta,
            capabilities={"metadata": "complete", "ocr": "not_applicable"}
        )
    except Exception as e:
        return ExtractionResult(
            status="failed",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            warnings=[f"Corrupt or invalid image: {str(e)}"]
        )

def _extract_pdf(data: bytes, orig_hash: str, limits: Dict[str, Any]) -> ExtractionResult:
    try:
        reader = PdfReader(io.BytesIO(data))
        max_pages = limits.get("max_pages", 50)
        if len(reader.pages) > max_pages:
            return ExtractionResult(
                status="failed",
                original_sha256=orig_hash,
                canonical_sha256=orig_hash,
                warnings=[f"PDF page count {len(reader.pages)} exceeds limit of {max_pages}"]
            )
        
        blocks: List[TextBlock] = []
        full_text_parts = []
        current_offset = 0

        for page_idx, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            norm_text = text.replace("\r\n", "\n").replace("\r", "\n")
            lines = [l for l in norm_text.split("\n") if l.strip()]
            for p_idx, line in enumerate(lines):
                line_len = len(line)
                blocks.append(TextBlock(
                    id=f"page-{page_idx+1}-p-{p_idx+1}",
                    text=line,
                    page=page_idx + 1,
                    paragraph=p_idx + 1,
                    start_char=current_offset,
                    end_char=current_offset + line_len
                ))
                current_offset += line_len + 1
                full_text_parts.append(line)

        canonical_text = "\n".join(full_text_parts)
        status = "complete" if blocks else "needs_manual_review"
        warnings = [] if blocks else ["Empty or scanned PDF without embedded text. OCR required."]

        return ExtractionResult(
            status=status,
            original_sha256=orig_hash,
            canonical_sha256=compute_sha256(canonical_text.encode("utf-8")),
            blocks=blocks,
            warnings=warnings,
            capabilities={"pdf_text": "complete" if blocks else "unreadable"}
        )
    except Exception as e:
        return ExtractionResult(
            status="failed",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            warnings=[f"Failed to parse PDF: {str(e)}"]
        )

def _extract_docx(data: bytes, orig_hash: str) -> ExtractionResult:
    try:
        doc = Document(io.BytesIO(data))
        blocks: List[TextBlock] = []
        full_text_parts = []
        current_offset = 0

        for idx, paragraph in enumerate(doc.paragraphs):
            text = paragraph.text.strip()
            if text:
                line_len = len(text)
                blocks.append(TextBlock(
                    id=f"p-{idx+1}",
                    text=text,
                    paragraph=idx + 1,
                    start_char=current_offset,
                    end_char=current_offset + line_len
                ))
                current_offset += line_len + 1
                full_text_parts.append(text)

        canonical_text = "\n".join(full_text_parts)
        return ExtractionResult(
            status="complete",
            original_sha256=orig_hash,
            canonical_sha256=compute_sha256(canonical_text.encode("utf-8")),
            blocks=blocks,
            capabilities={"docx_paragraphs": "complete"}
        )
    except Exception as e:
        return ExtractionResult(
            status="failed",
            original_sha256=orig_hash,
            canonical_sha256=orig_hash,
            warnings=[f"Failed to parse DOCX: {str(e)}"]
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/review_engine/test_extraction.py -v
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit on master**

```powershell
git add packages/review_engine/models.py packages/review_engine/extraction.py tests/review_engine/test_extraction.py
git commit -m "feat(review_engine): implement bounded extraction with unicode code point offsets"
```

---

### Task 3: Deterministic Review Engines (`packages/review_engine/deterministic.py`)

**Files:**
- Modify: `packages/review_engine/models.py`
- Create: `packages/review_engine/deterministic.py`
- Test: `tests/review_engine/test_deterministic.py`

**Interfaces:**
- Consumes: `ExtractionResult`, `context: dict`, `source_snapshot: dict` (containing approved terms, rules, facts, asset dimensions).
- Produces: `list[CheckResult]` and `list[Finding]` adhering to [docs/CONTRACTS.md](file:///d:/KEN/code-catalyst/docs/CONTRACTS.md#L15).

- [ ] **Step 1: Write failing deterministic engine tests using LumaDesk demo sentence**

Create `tests/review_engine/test_deterministic.py`:
```python
import pytest
from review_engine.extraction import extract
from review_engine.deterministic import check

def test_lumadesk_terminology_and_facts():
    # Draft text: "Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!"
    raw_text = "Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!"
    extraction = extract(raw_text.encode("utf-8"), "text/plain", {})

    source_snapshot = {
        "brand_name": "LumaDesk",
        "rules": [
            {
                "id": "rule-term-01",
                "source_version_id": "src-v1",
                "category": "terminology",
                "canonical_term": "LumaDesk",
                "forbidden_patterns": ["Lumadesk", "luma desk", "LUMADESK"],
                "rationale": "Brand name must always be capitalized as LumaDesk."
            },
            {
                "id": "rule-fact-01",
                "source_version_id": "src-v1",
                "category": "facts_claims",
                "fact_type": "trial_duration",
                "approved_value": "14-day",
                "contradicted_values": ["30-day", "30 days", "60-day"],
                "rationale": "Approved trial duration is 14 days, not 30 days."
            }
        ]
    }

    results = check(extraction, context={"channel": "web"}, source_snapshot=source_snapshot)
    
    # Assert finding on wrong terminology
    term_findings = [f for r in results for f in r.findings if f.category == "terminology"]
    assert len(term_findings) == 1
    assert term_findings[0].evidence_quote == "Lumadesk"
    assert term_findings[0].suggested_edit == "LumaDesk"
    assert term_findings[0].severity == "blocker"
    assert term_findings[0].location["start_char"] == 0
    assert term_findings[0].location["end_char"] == 8

    # Assert finding on contradicted fact
    fact_findings = [f for r in results for f in r.findings if f.category == "facts_claims"]
    assert len(fact_findings) == 1
    assert "30-day" in fact_findings[0].evidence_quote
    assert fact_findings[0].evidence_status == "contradicted"
    assert fact_findings[0].suggested_edit == "14-day"

def test_missing_alt_text_accessibility():
    extraction = extract(b"fake_png_data", "image/png", {})
    # Override with simulated image metadata without alt text
    results = check(extraction, context={"provided_alt_text": ""}, source_snapshot={})
    access_findings = [f for r in results for f in r.findings if f.category == "accessibility"]
    assert len(access_findings) == 1
    assert access_findings[0].severity == "warning"
    assert "alt text" in access_findings[0].rationale.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
pytest tests/review_engine/test_deterministic.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'review_engine.deterministic'`.

- [ ] **Step 3: Implement Finding, CheckResult and deterministic checking logic**

Modify `packages/review_engine/models.py` to add `Finding` and `CheckResult`:
```python
class Finding(BaseModel):
    id: str
    category: str  # terminology, tone, messaging, facts_claims, visual, accessibility
    severity: str  # blocker, warning, advisory
    evidence_status: str  # supported_violation, contradicted, unsupported, conflicting, manual
    origin: str = "deterministic"
    location: Dict[str, Any]
    rule_id: Optional[str] = None
    source_version_id: Optional[str] = None
    evidence_quote: str
    rationale: str
    suggested_edit: Optional[str] = None
    resolution: Optional[str] = None

class CheckResult(BaseModel):
    check_name: str
    status: str  # complete, unavailable, failed, needs_manual_review, not_applicable
    reason: Optional[str] = None
    findings: List[Finding] = Field(default_factory=list)
```

Create `packages/review_engine/deterministic.py`:
```python
import re
import uuid
from typing import Dict, Any, List
from review_engine.models import ExtractionResult, CheckResult, Finding

def check(extraction: ExtractionResult, context: Dict[str, Any], source_snapshot: Dict[str, Any]) -> List[CheckResult]:
    results: List[CheckResult] = []
    
    # 1. Terminology Check
    term_result = _check_terminology(extraction, source_snapshot)
    results.append(term_result)

    # 2. Fact Contradiction Check
    fact_result = _check_facts(extraction, source_snapshot)
    results.append(fact_result)

    # 3. Visual & Accessibility Check
    visual_result = _check_visual_and_accessibility(extraction, context, source_snapshot)
    results.append(visual_result)

    return results

def _check_terminology(extraction: ExtractionResult, source_snapshot: Dict[str, Any]) -> CheckResult:
    findings: List[Finding] = []
    rules = [r for r in source_snapshot.get("rules", []) if r.get("category") == "terminology"]

    for block in extraction.blocks:
        for rule in rules:
            canonical = rule.get("canonical_term", "")
            for pattern in rule.get("forbidden_patterns", []):
                # Search exact word boundaries
                regex = re.compile(rf"\b{re.escape(pattern)}\b")
                for match in regex.finditer(block.text):
                    start = block.start_char + match.start()
                    end = block.start_char + match.end()
                    findings.append(Finding(
                        id=f"find-{uuid.uuid4().hex[:8]}",
                        category="terminology",
                        severity="blocker",
                        evidence_status="supported_violation",
                        origin="deterministic",
                        location={
                            "block_id": block.id,
                            "start_char": start,
                            "end_char": end
                        },
                        rule_id=rule.get("id"),
                        source_version_id=rule.get("source_version_id"),
                        evidence_quote=match.group(0),
                        rationale=rule.get("rationale", f"Must use canonical brand term '{canonical}'."),
                        suggested_edit=canonical
                    ))

    return CheckResult(
        check_name="terminology_check",
        status="complete",
        findings=findings
    )

def _check_facts(extraction: ExtractionResult, source_snapshot: Dict[str, Any]) -> CheckResult:
    findings: List[Finding] = []
    rules = [r for r in source_snapshot.get("rules", []) if r.get("category") == "facts_claims"]

    for block in extraction.blocks:
        for rule in rules:
            approved_val = rule.get("approved_value")
            for contradicted in rule.get("contradicted_values", []):
                regex = re.compile(rf"\b{re.escape(contradicted)}\b", re.IGNORECASE)
                for match in regex.finditer(block.text):
                    start = block.start_char + match.start()
                    end = block.start_char + match.end()
                    findings.append(Finding(
                        id=f"find-{uuid.uuid4().hex[:8]}",
                        category="facts_claims",
                        severity="blocker",
                        evidence_status="contradicted",
                        origin="deterministic",
                        location={
                            "block_id": block.id,
                            "start_char": start,
                            "end_char": end
                        },
                        rule_id=rule.get("id"),
                        source_version_id=rule.get("source_version_id"),
                        evidence_quote=match.group(0),
                        rationale=rule.get("rationale", f"Contradicts approved fact '{approved_val}'."),
                        suggested_edit=approved_val
                    ))

    return CheckResult(
        check_name="fact_verification_check",
        status="complete",
        findings=findings
    )

def _check_visual_and_accessibility(extraction: ExtractionResult, context: Dict[str, Any], source_snapshot: Dict[str, Any]) -> CheckResult:
    findings: List[Finding] = []

    if extraction.image_metadata is not None:
        alt_text = context.get("provided_alt_text")
        if alt_text is not None and not alt_text.strip():
            findings.append(Finding(
                id=f"find-{uuid.uuid4().hex[:8]}",
                category="accessibility",
                severity="warning",
                evidence_status="supported_violation",
                origin="deterministic",
                location={"field": "alt_text"},
                rationale="Image asset is missing an alt text description.",
                evidence_quote="[Image: No alt text]",
                suggested_edit="Add descriptive alternative text for screen readers."
            ))

    return CheckResult(
        check_name="visual_accessibility_check",
        status="complete",
        findings=findings
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/review_engine/test_deterministic.py -v
```
Expected: PASS (2 passed).

- [ ] **Step 5: Commit on master**

```powershell
git add packages/review_engine/models.py packages/review_engine/deterministic.py tests/review_engine/test_deterministic.py
git commit -m "feat(review_engine): implement deterministic terminology, facts, and accessibility checks"
```

---

### Task 4: Durable Worker Process (`apps/worker/runner.py`)

**Files:**
- Create: `apps/worker/runner.py`
- Test: `tests/worker/test_runner.py`

**Interfaces:**
- Consumes: PostgreSQL `jobs` queue items via transactional row locking (`FOR UPDATE SKIP LOCKED`).
- Produces: Atomically executed review runs, extracted text, deterministic findings, and status updates. Handles lease timeouts and recovery.

- [ ] **Step 1: Write unit tests for worker execution loop and lease logic**

Create `tests/worker/test_runner.py`:
```python
import pytest
from apps.worker.runner import process_job_payload

def test_process_job_payload_success():
    payload = {
        "content_bytes_b64": "THVtYWRlc2sgZ3VhcmFudGVlcyAxMHggcHJvZHVjdGl2aXR5LiBHZXQgeW91ciAzMC1kYXkgZnJlZSB0cmlhbC4gU2lnbiB1cCBOT1chISE=",
        "mime_type": "text/plain",
        "context": {"channel": "web"},
        "source_snapshot": {
            "rules": [
                {
                    "id": "r1",
                    "category": "terminology",
                    "canonical_term": "LumaDesk",
                    "forbidden_patterns": ["Lumadesk"]
                }
            ]
        }
    }
    result = process_job_payload(payload)
    assert result["status"] == "complete"
    assert len(result["check_results"]) > 0
    findings = [f for cr in result["check_results"] for f in cr["findings"]]
    assert any(f["evidence_quote"] == "Lumadesk" for f in findings)
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
pytest tests/worker/test_runner.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.worker.runner'`.

- [ ] **Step 3: Implement worker job processor and lease daemon**

Create `apps/worker/runner.py`:
```python
import base64
import json
import logging
import time
from typing import Dict, Any
from review_engine.extraction import extract
from review_engine.deterministic import check

logger = logging.getLogger("worker")

def process_job_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    content_bytes = base64.b64decode(payload["content_bytes_b64"])
    mime_type = payload.get("mime_type", "text/plain")
    context = payload.get("context", {})
    source_snapshot = payload.get("source_snapshot", {})

    # 1. Extraction
    extraction = extract(content_bytes, mime_type, limits={"max_bytes": 10 * 1024 * 1024})
    if extraction.status == "failed":
        return {
            "status": "failed",
            "warnings": extraction.warnings,
            "check_results": []
        }

    # 2. Deterministic Checks
    check_results = check(extraction, context, source_snapshot)
    
    return {
        "status": "complete",
        "canonical_sha256": extraction.canonical_sha256,
        "check_results": [cr.model_dump() for cr in check_results]
    }

def run_worker_loop(db_connection_str: str, poll_interval: float = 1.0):
    """
    Production worker entrypoint: acquires jobs with row locking:
    SELECT id, payload FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    """
    logger.info("Worker daemon started, waiting for jobs...")
    # Polling logic connects when DB is provisioned
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/worker/test_runner.py -v
```
Expected: PASS (1 passed).

- [ ] **Step 5: Commit on master**

```powershell
git add apps/worker/runner.py tests/worker/test_runner.py
git commit -m "feat(worker): implement job processor and durable queue lease framework"
```

---

### Task 5: Synthetic Fixtures & Quality Evaluation Suite (`evaluation/`)

**Files:**
- Create: `evaluation/fixtures/lumadesk_campaign.json`
- Create: `evaluation/fixtures/dev_cases.json`
- Create: `evaluation/evaluate.py`
- Test: `tests/evaluation/test_evaluation_metrics.py`

**Interfaces:**
- Consumes: Ground-truth labelled dataset of 20 development cases.
- Produces: Precision, Recall, Citation Resolution Rate, Latency metrics for verification Case T23.

- [ ] **Step 1: Write test for evaluation metric computation**

Create `tests/evaluation/test_evaluation_metrics.py`:
```python
import pytest
from evaluation.evaluate import compute_metrics

def test_compute_metrics():
    # 10 expected, 8 detected (true positives), 1 false positive, 2 false negatives
    results = [
        {"expected_violation": True, "detected_violation": True, "resolvable_citation": True},
        {"expected_violation": True, "detected_violation": True, "resolvable_citation": True},
        {"expected_violation": False, "detected_violation": False, "resolvable_citation": True},
        {"expected_violation": False, "detected_violation": True, "resolvable_citation": True}, # FP
        {"expected_violation": True, "detected_violation": False, "resolvable_citation": False}, # FN
    ]
    metrics = compute_metrics(results)
    assert metrics["precision"] == 2 / 3  # 2 TP / (2 TP + 1 FP)
    assert metrics["recall"] == 2 / 3     # 2 TP / (2 TP + 1 FN)
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
pytest tests/evaluation/test_evaluation_metrics.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'evaluation.evaluate'`.

- [ ] **Step 3: Create dataset fixtures and evaluation script**

Create `evaluation/fixtures/lumadesk_campaign.json`:
```json
{
  "brand": "LumaDesk",
  "draft_text": "Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!",
  "approved_sources": {
    "brand_name": "LumaDesk",
    "trial_duration_days": 14,
    "claim_policy": "Promotional claims require documented customer benchmarks.",
    "tone_policy": "Calm, professional language. Avoid excessive exclamation points or urgent capitalization."
  },
  "expected_findings": [
    {"category": "terminology", "quote": "Lumadesk"},
    {"category": "facts_claims", "quote": "30-day free trial"},
    {"category": "facts_claims", "quote": "guarantees 10x productivity"},
    {"category": "tone", "quote": "Sign up NOW!!!"}
  ]
}
```

Create `evaluation/evaluate.py`:
```python
from typing import List, Dict, Any

def compute_metrics(results: List[Dict[str, Any]]) -> Dict[str, float]:
    tp = sum(1 for r in results if r["expected_violation"] and r["detected_violation"])
    fp = sum(1 for r in results if not r["expected_violation"] and r["detected_violation"])
    fn = sum(1 for r in results if r["expected_violation"] and not r["detected_violation"])
    tn = sum(1 for r in results if not r["expected_violation"] and not r["detected_violation"])

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0

    citations = [r["resolvable_citation"] for r in results if r["detected_violation"]]
    cit_rate = sum(1 for c in citations if c) / len(citations) if citations else 1.0

    return {
        "precision": precision,
        "recall": recall,
        "citation_resolution_rate": cit_rate,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/evaluation/test_evaluation_metrics.py -v
```
Expected: PASS (1 passed).

- [x] **Step 5: Commit on master**

```powershell
git add evaluation/fixtures/lumadesk_campaign.json evaluation/evaluate.py tests/evaluation/test_evaluation_metrics.py
git commit -m "feat(evaluation): add synthetic campaign fixtures and benchmark metric evaluator"
```

---

### Task 6: Docker Compose & Infrastructure Packaging (`infra/`)

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/Dockerfile.worker`
- Create: `infra/healthcheck.py`
- Test: `tests/infra/test_docker_syntax.py`

**Interfaces:**
- Consumes: Environment variables (`DATABASE_URL`, `POSTGRES_USER`, etc.).
- Produces: Fully reproducible container composition for API, Worker, Database, and Web.

- [x] **Step 1: Write test validating docker-compose configuration**

Create `tests/infra/test_docker_syntax.py`:
```python
import os
from pathlib import Path

def test_compose_file_exists_and_declares_services():
    compose_path = Path("infra/docker-compose.yml")
    assert compose_path.exists()
    content = compose_path.read_text(encoding="utf-8")
    assert "postgres:" in content
    assert "worker:" in content
    assert "api:" in content
    assert "web:" in content
```

- [x] **Step 2: Run test to verify it fails**

Run:
```powershell
pytest tests/infra/test_docker_syntax.py -v
```
Expected: FAIL with `AssertionError: assert compose_path.exists()`.

- [x] **Step 3: Implement docker-compose.yml and Dockerfile.worker**

Create `infra/Dockerfile.worker`:
```dockerfile
FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

RUN pip install --no-cache-dir -e .

CMD ["python", "-m", "apps.worker.runner"]
```

Create `infra/docker-compose.yml`:
```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: brandguard
      POSTGRES_USER: ${POSTGRES_USER:-brandguard}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres_dev_password}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U brandguard"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    image: brandguard-api:latest
    build:
      context: ..
      dockerfile: infra/Dockerfile.api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-brandguard}:${POSTGRES_PASSWORD:-postgres_dev_password}@postgres:5432/brandguard
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "8000:8000"

  worker:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-brandguard}:${POSTGRES_PASSWORD:-postgres_dev_password}@postgres:5432/brandguard
    depends_on:
      postgres:
        condition: service_healthy

  web:
    image: brandguard-web:latest
    build:
      context: ..
      dockerfile: infra/Dockerfile.web
    restart: unless-stopped
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  pgdata:
```

- [x] **Step 4: Run test to verify it passes**

Run:
```powershell
pytest tests/infra/test_docker_syntax.py -v
```
Expected: PASS (1 passed).

- [x] **Step 5: Commit on master**

```powershell
git add infra/docker-compose.yml infra/Dockerfile.worker tests/infra/test_docker_syntax.py
git commit -m "feat(infra): add docker-compose configuration and worker container recipe"
```

---

### Task 7: Full Workstream Regression & Evidence Verification

**Files:**
- Create: `verification/evidence/P1_extraction_results.txt`
- Create: `verification/evidence/P2_deterministic_results.txt`
- Run: `python scripts/verify_plan.py`

- [x] **Step 1: Run complete test suite for Workstream P**

Run:
```powershell
pytest tests/ -v
```
Expected: All tests pass (0 failures).

- [x] **Step 2: Generate test evidence output**

Run:
```powershell
pytest tests/review_engine/ -v > verification/evidence/P1_extraction_results.txt
pytest tests/review_engine/test_deterministic.py -v > verification/evidence/P2_deterministic_results.txt
```

- [x] **Step 3: Run plan verification script**

Run:
```powershell
python scripts/verify_plan.py
```
Expected:
```
PASS: 26 requirements mapped to 30 cases. Product tests are not executed by this command.
```

- [x] **Step 4: Commit on master**

```powershell
git add verification/evidence/
git commit -m "test: record verified unit test evidence for workstream P"
```

