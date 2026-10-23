import asyncio
import pytest
from apps.worker.adapter import create_engine_checker, EngineResult, DETERMINISTIC_CATEGORIES

class DummyReviewInput:
    def __init__(self, text, context=None, sources=None):
        self.text = text
        self.context = context or {}
        self.sources = sources or []


def test_adapter_all_deterministic_categories_present():
    """Verify that the adapter always produces the 4 required deterministic categories."""
    review_input = DummyReviewInput(text="This is a simple campaign draft.")
    result = asyncio.run(create_engine_checker(review_input))

    assert isinstance(result, EngineResult)
    categories = {c["category"] for c in result.checks}
    assert categories == set(DETERMINISTIC_CATEGORIES)
    
    # Text-only draft should have visual check marked as not_applicable
    visual_check = next(c for c in result.checks if c["category"] == "visual")
    assert visual_check["status"] == "not_applicable"
    assert "No visual" in visual_check["reason"]


def test_adapter_lumadesk_findings_formatting():
    """Verify LumaDesk draft produces findings conforming to EngineFinding."""
    text = "Lumadesk guarantees 10x productivity. Get your 30-day free trial."
    sources = [
        {
            "id": "src-uuid-1",
            "source_key": "trial_terms",
            "title": "Approved trial terms",
            "text": "The trial lasts 14 days. No credit card is required.",
            "rules": [
                {
                    "id": "F-01",
                    "category": "facts_claims",
                    "kind": "fact",
                    "key": "trial_duration",
                    "value": "14 days",
                    "evidence_quote": "The trial lasts 14 days."
                },
                {
                    "id": "T-01",
                    "category": "terminology",
                    "kind": "terminology",
                    "key": "brand_name",
                    "value": "LumaDesk",
                    "canonical_term": "LumaDesk",
                    "evidence_quote": "LumaDesk"
                }
            ]
        }
    ]

    review_input = DummyReviewInput(text=text, sources=sources)
    result = asyncio.run(create_engine_checker(review_input))

    assert len(result.findings) >= 2

    # Check Terminology finding
    term_f = next(f for f in result.findings if f["category"] == "terminology")
    assert term_f["rule_id"] == "T-01"
    assert term_f["source_version_id"] == "src-uuid-1"
    assert term_f["content_quote"] == "Lumadesk"
    assert term_f["start"] == 0
    assert term_f["end"] == 8
    assert text[term_f["start"]:term_f["end"]] == term_f["content_quote"]
    assert term_f["suggested_edit"] == "LumaDesk"

    # Check Fact finding
    fact_f = next(f for f in result.findings if f["category"] == "facts_claims")
    assert fact_f["rule_id"] == "F-01"
    assert fact_f["source_version_id"] == "src-uuid-1"
    assert fact_f["content_quote"] == "30-day"
    assert fact_f["evidence_status"] == "contradicted"
    assert fact_f["suggested_edit"] == "14 days"
    assert text[fact_f["start"]:fact_f["end"]] == fact_f["content_quote"]
    assert fact_f["evidence_quote"] == "The trial lasts 14 days."


def test_adapter_clean_draft_returns_zero_findings():
    """Verify clean compliant content returns zero findings and complete statuses."""
    text = "LumaDesk brings productivity. Get your 14-day free trial."
    sources = [
        {
            "id": "src-uuid-1",
            "source_key": "trial_terms",
            "title": "Approved trial terms",
            "text": "The trial lasts 14 days. No credit card is required.",
            "rules": [
                {
                    "id": "F-01",
                    "category": "facts_claims",
                    "kind": "fact",
                    "key": "trial_duration",
                    "value": "14 days",
                    "evidence_quote": "The trial lasts 14 days."
                },
                {
                    "id": "T-01",
                    "category": "terminology",
                    "kind": "terminology",
                    "key": "brand_name",
                    "value": "LumaDesk",
                    "canonical_term": "LumaDesk",
                    "evidence_quote": "LumaDesk"
                }
            ]
        }
    ]

    review_input = DummyReviewInput(text=text, sources=sources)
    result = asyncio.run(create_engine_checker(review_input))

    assert len(result.findings) == 0
    for chk in result.checks:
        if chk["category"] == "visual":
            assert chk["status"] == "not_applicable"
        else:
            assert chk["status"] == "complete"


def test_adapter_passes_orchestration_checked_engine_result():
    """Verify that our adapter output satisfies brandguard.orchestration.checked_engine_result()."""
    from brandguard.orchestration import checked_engine_result, ReviewInput

    text = "Lumadesk guarantees 10x productivity. Get your 30-day free trial."
    sources = [
        {
            "id": "src-uuid-1",
            "source_key": "trial_terms",
            "title": "Approved trial terms",
            "text": "The trial lasts 14 days. No credit card is required.",
            "rules": [
                {
                    "id": "F-01",
                    "category": "facts_claims",
                    "kind": "fact",
                    "key": "trial_duration",
                    "value": "14 days",
                    "evidence_quote": "The trial lasts 14 days."
                },
                {
                    "id": "T-01",
                    "category": "terminology",
                    "kind": "terminology",
                    "key": "brand_name",
                    "value": "LumaDesk",
                    "canonical_term": "LumaDesk",
                    "evidence_quote": "The trial lasts 14 days."  # must be in source text
                }
            ]
        }
    ]

    review_input = ReviewInput(text=text, context={}, sources=sources)
    result = asyncio.run(create_engine_checker(review_input))

    checks, findings = checked_engine_result(result, review_input)
    assert len(checks) == 4
    assert len(findings) >= 2


def test_adapter_hardened_invariants():
    """Verify deduplication, citation filtering, and numeric safety."""
    from brandguard.orchestration import checked_engine_result, ReviewInput

    text = "Lumadesk guarantees 10x productivity. Get your 30-day free trial."
    sources = [
        {
            "id": "src-1",
            "source_key": "k1",
            "title": "Title",
            "text": "14 days trial duration approved.",
            "rules": [
                {
                    "id": "F-01",
                    "category": "facts_claims",
                    "kind": "fact",
                    "key": "trial_duration",
                    "value": "14 days",
                    "evidence_quote": "14 days"
                }
            ]
        }
    ]

    review_input = ReviewInput(text=text, context={}, sources=sources)
    result = asyncio.run(create_engine_checker(review_input))

    # All findings must resolve cleanly through orchestration's strict validator
    checks, findings = checked_engine_result(result, review_input)
    assert all(c["status"] == "complete" for c in checks if c["category"] != "visual")
    # Finding must have fact evidence_status = "contradicted"
    for f in findings:
        assert f["evidence_status"] == "contradicted"
        assert f["rule_id"] == "F-01"

