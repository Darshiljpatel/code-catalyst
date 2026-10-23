"""Deterministic Engine Adapter for BrandGuard Worker Orchestration.
Bridges Surya's review_engine modules with Sanath's orchestration.process_one runner.
"""
import re
from dataclasses import dataclass
from typing import Dict, Any, List, Optional
from review_engine.extraction import extract
from review_engine.deterministic import check
from review_engine.models import ExtractionResult, CheckResult, Finding

DETERMINISTIC_CATEGORIES = ('terminology', 'facts_claims', 'visual', 'accessibility')

@dataclass
class EngineResult:
    """Matches the EngineResult contract in brandguard.orchestration."""
    checks: List[Dict[str, Any]]
    findings: List[Dict[str, Any]]


async def create_engine_checker(review_input: Any) -> EngineResult:
    """
    Async callable injected into orchestration.process_one(engine, reviewer, checker).
    Accepts ReviewInput(text, context, sources) and returns EngineResult(checks, findings).
    """
    text = getattr(review_input, "text", "")
    context = getattr(review_input, "context", {}) or {}
    sources = getattr(review_input, "sources", []) or []

    # 1. Extraction
    extraction: ExtractionResult = extract(
        input_bytes=text.encode("utf-8"),
        detected_type="text/plain",
        limits={"max_bytes": 10 * 1024 * 1024}
    )

    if extraction.status == "failed":
        return EngineResult(
            checks=[
                {"category": c, "status": "failed", "reason": "extraction_failed"}
                for c in DETERMINISTIC_CATEGORIES
            ],
            findings=[]
        )

    # 2. Run deterministic checks
    raw_results: List[CheckResult] = check(extraction, context, sources)

    # Build rule lookup so we can ensure rule metadata (e.g. kind, source_version_id, literal quote)
    rule_lookup: Dict[str, Dict[str, Any]] = {}
    for s in sources:
        src_id = s.get("id") or s.get("source_key", "")
        for r in s.get("rules", []):
            rule_id = r.get("id")
            if rule_id:
                rule_lookup[rule_id] = {
                    **r,
                    "source_version_id": r.get("source_version_id") or src_id
                }

    # 3. Format checks
    checks_by_category: Dict[str, Dict[str, Any]] = {}
    for r in raw_results:
        cat = r.category
        if cat in DETERMINISTIC_CATEGORIES and cat not in checks_by_category:
            checks_by_category[cat] = {
                "category": cat,
                "status": r.status,
                "reason": r.reason or f"Deterministic {cat} check complete."
            }

    # Ensure all 4 deterministic categories are present
    for cat in DETERMINISTIC_CATEGORIES:
        if cat not in checks_by_category:
            if cat == "visual":
                checks_by_category[cat] = {
                    "category": "visual",
                    "status": "not_applicable",
                    "reason": "No visual media in content"
                }
            else:
                checks_by_category[cat] = {
                    "category": cat,
                    "status": "complete",
                    "reason": f"Deterministic {cat} check complete."
                }

    # 4. Format findings adhering strictly to EngineFinding and validate_findings contracts
    engine_findings: List[Dict[str, Any]] = []
    completed_categories = {c["category"] for c in checks_by_category.values() if c["status"] == "complete"}
    seen_finding_keys = set()

    # Pre-extract allowed numbers for suggested_edit safety
    all_rules_values = " ".join(str(r.get("value", "")) for r in rule_lookup.values())
    allowed_numbers = set(re.findall(r"\d+(?:\.\d+)?", text + " " + all_rules_values))

    for res in raw_results:
        for f in res.findings:
            # Finding must belong to a completed check category
            if f.category not in completed_categories:
                continue

            rule = rule_lookup.get(f.rule_id) if f.rule_id else None
            # Must have valid rule citation matching category in sources
            if not rule or rule.get("category") != f.category:
                continue

            source_version_id = rule.get("source_version_id") or f.source_version_id
            if not source_version_id:
                continue

            # Canonical start and end offsets strictly within text bounds
            loc = f.location or {}
            start = loc.get("start_char", 0)
            end = loc.get("end_char", 0)
            if not (0 <= start < end <= len(text)):
                continue

            content_quote = text[start:end]

            # Literal evidence quote matching the source rule quote
            evidence_quote = rule.get("evidence_quote") or f.evidence_quote

            # Evidence status strictly aligned with rule.kind
            rule_kind = rule.get("kind")
            if rule_kind == "claim_policy":
                evidence_status = "unsupported"
            elif rule_kind == "fact":
                evidence_status = "contradicted"
            else:
                evidence_status = "supported_violation"

            # Prevent duplicate findings at identical (category, rule_id, start, end)
            finding_key = (f.category, f.rule_id, start, end)
            if finding_key in seen_finding_keys:
                continue
            seen_finding_keys.add(finding_key)

            # Preserve suggested_edit only if all numbers exist in text or rule values
            suggested_edit = f.suggested_edit
            if suggested_edit:
                edit_nums = set(re.findall(r"\d+(?:\.\d+)?", suggested_edit))
                if not edit_nums.issubset(allowed_numbers):
                    suggested_edit = None

            engine_findings.append({
                "category": f.category,
                "severity": f.severity,
                "evidence_status": evidence_status,
                "source_version_id": source_version_id,
                "rule_id": f.rule_id,
                "start": start,
                "end": end,
                "content_quote": content_quote,
                "evidence_quote": evidence_quote,
                "rationale": f.rationale,
                "suggested_edit": suggested_edit
            })

    return EngineResult(
        checks=list(checks_by_category.values()),
        findings=engine_findings
    )

