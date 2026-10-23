import io
import pytest
from PIL import Image
from review_engine.extraction import extract
from review_engine.deterministic import (
    check,
    calculate_contrast_ratio,
    calculate_relative_luminance
)
from review_engine.models import CheckResult, Finding


# ===========================================================================
# Test Case T05: Multi-Brand & Word-Boundary Near Matches
# ===========================================================================

def test_t05_brand_1_lumadesk_terminology_and_facts():
    """Verify Brand 1 (LumaDesk) detects wrong spelling and contradicted trial fact."""
    text = "Lumadesk guarantees 10x productivity. Get your 30-day free trial."
    extraction = extract(text.encode("utf-8"), "text/plain", {})

    snapshot = {
        "brand_name": "LumaDesk",
        "rules": [
            {
                "id": "term-luma",
                "source_version_id": "v1",
                "category": "terminology",
                "canonical_term": "LumaDesk",
                "forbidden_patterns": ["Lumadesk", "luma desk"],
                "rationale": "Brand name must be capitalized as LumaDesk."
            },
            {
                "id": "fact-trial",
                "source_version_id": "v1",
                "category": "facts_claims",
                "fact_type": "trial_duration",
                "approved_value": "14-day",
                "contradicted_values": ["30-day", "60-day"],
                "rationale": "Approved trial is 14 days."
            }
        ]
    }

    results = check(extraction, context={}, source_snapshot=snapshot)
    
    # 1. Terminology
    term = next(r for r in results if r.category == "terminology")
    assert term.status == "complete"
    assert len(term.findings) == 1
    assert term.findings[0].evidence_quote == "Lumadesk"
    assert term.findings[0].suggested_edit == "LumaDesk"
    assert term.findings[0].location["start_char"] == 0
    assert term.findings[0].location["end_char"] == 8

    # 2. Fact
    fact = next(r for r in results if r.category == "facts_claims")
    assert fact.status == "complete"
    assert len(fact.findings) == 1
    assert fact.findings[0].evidence_quote == "30-day"
    assert fact.findings[0].suggested_edit == "14-day"
    assert fact.findings[0].evidence_status == "contradicted"


def test_t05_brand_2_apexcloud_proves_no_hardcoding():
    """Verify Brand 2 (ApexCloud) with completely different terms and 7-day trial fact."""
    text = "Deploy with apex cloud in seconds. Free 14 days trial for enterprise."
    extraction = extract(text.encode("utf-8"), "text/plain", {})

    snapshot = {
        "brand_name": "ApexCloud",
        "rules": [
            {
                "id": "term-apex",
                "source_version_id": "apex-v1",
                "category": "terminology",
                "canonical_term": "ApexCloud",
                "forbidden_patterns": ["apex cloud", "Apex Cloud", "apexcloud"],
                "rationale": "Must be written as ApexCloud."
            },
            {
                "id": "fact-apex-trial",
                "source_version_id": "apex-v1",
                "category": "facts_claims",
                "fact_type": "trial_duration",
                "approved_value": "7 days",
                "contradicted_values": ["14 days", "30 days"],
                "rationale": "ApexCloud trial duration is 7 days only."
            }
        ]
    }

    results = check(extraction, context={}, source_snapshot=snapshot)

    term = next(r for r in results if r.category == "terminology")
    assert len(term.findings) == 1
    assert term.findings[0].evidence_quote == "apex cloud"
    assert term.findings[0].suggested_edit == "ApexCloud"

    fact = next(r for r in results if r.category == "facts_claims")
    assert len(fact.findings) == 1
    assert fact.findings[0].evidence_quote == "14 days"
    assert fact.findings[0].suggested_edit == "7 days"


def test_t05_word_boundary_near_matches():
    """Verify word boundaries correctly separate near-matches without false positives."""
    text = "Use LumadeskApp for desktop and Lumadesk-compatible keyboards."
    extraction = extract(text.encode("utf-8"), "text/plain", {})

    snapshot = {
        "rules": [
            {
                "id": "term-luma",
                "category": "terminology",
                "canonical_term": "LumaDesk",
                "forbidden_patterns": ["Lumadesk"]
            }
        ]
    }

    results = check(extraction, context={}, source_snapshot=snapshot)
    term = next(r for r in results if r.category == "terminology")
    
    # Should only match "Lumadesk" in "Lumadesk-compatible", NOT in "LumadeskApp"
    assert len(term.findings) == 1
    assert term.findings[0].location["start_char"] == 32
    assert term.findings[0].location["end_char"] == 40


def test_t05_sanath_database_list_of_sources_shape():
    """Verify engine seamlessly digests Sanath's database JSON format (list of sources)."""
    text = "Lumadesk offers a 30-day trial."
    extraction = extract(text.encode("utf-8"), "text/plain", {})

    # Sanath's SourceOut schema as stored in database ReviewRun.source_snapshot
    database_snapshot = [
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
                    "evidence_quote": "LumaDesk"
                }
            ]
        }
    ]

    results = check(extraction, context={}, source_snapshot=database_snapshot)

    # 1. Terminology auto-detected casing violation "Lumadesk" vs "LumaDesk"
    term = next(r for r in results if r.category == "terminology")
    assert len(term.findings) == 1
    assert term.findings[0].evidence_quote == "Lumadesk"
    assert term.findings[0].suggested_edit == "LumaDesk"
    assert term.findings[0].source_version_id == "src-uuid-1"

    # 2. Fact contradiction auto-detected 30-day vs 14 days
    fact = next(r for r in results if r.category == "facts_claims")
    assert len(fact.findings) == 1
    assert fact.findings[0].evidence_quote == "30-day"
    assert fact.findings[0].suggested_edit == "14 days"


# ===========================================================================
# Test Case T10: Asset Integrity & WCAG Contrast Boundaries
# ===========================================================================

def test_t10_asset_hash_original_vs_altered():
    """Verify uploaded asset hash matches approved original asset, or flags alteration."""
    buf_orig = io.BytesIO()
    Image.new("RGB", (200, 200), color="red").save(buf_orig, format="PNG")
    orig_bytes = buf_orig.getvalue()
    extraction_orig = extract(orig_bytes, "image/png", {})
    orig_sha = extraction_orig.original_sha256

    buf_alt = io.BytesIO()
    img_alt = Image.new("RGB", (200, 200), color="red")
    img_alt.putpixel((0, 0), (0, 0, 255))
    img_alt.save(buf_alt, format="PNG")
    extraction_alt = extract(buf_alt.getvalue(), "image/png", {})

    snapshot = {
        "approved_assets": [
            {"id": "asset-logo-01", "name": "Primary Logo", "sha256": orig_sha}
        ]
    }

    # Original asset passes
    res_orig = check(extraction_orig, context={"expected_asset_id": "asset-logo-01"}, source_snapshot=snapshot)
    identity_check_orig = next(r for r in res_orig if r.category == "visual")
    assert len(identity_check_orig.findings) == 0

    # Altered asset is flagged as blocker
    res_alt = check(extraction_alt, context={"expected_asset_id": "asset-logo-01"}, source_snapshot=snapshot)
    identity_check_alt = next(r for r in res_alt if r.category == "visual")
    assert len(identity_check_alt.findings) == 1
    assert identity_check_alt.findings[0].severity == "blocker"
    assert "altered" in identity_check_alt.findings[0].rationale.lower()


def test_t10_image_dimension_bounds():
    """Verify image dimension checks enforce approved minimum resolution."""
    buf = io.BytesIO()
    Image.new("RGB", (300, 200)).save(buf, format="PNG")
    extraction = extract(buf.getvalue(), "image/png", {})

    snapshot = {"min_image_dimensions": {"width": 800, "height": 600}}
    results = check(extraction, context={}, source_snapshot=snapshot)
    identity = next(r for r in results if r.category == "visual")
    assert len(identity.findings) == 1
    assert identity.findings[0].severity == "warning"
    assert "below the approved brand minimum" in identity.findings[0].rationale


def test_t10_contrast_449_vs_450_boundary_normal_text():
    """
    Verify exact contrast threshold of 4.5:1 for normal text (< 18pt):
    4.48 fails (flagged), 4.54 passes (zero findings).
    """
    dummy_extraction = extract(b"sample text", "text/plain", {})

    # Pair with 4.48:1 (fails normal text)
    res_fail = check(
        dummy_extraction,
        context={"color_pair": {"foreground": "#777777", "background": "#FFFFFF", "font_size_pt": 12}},
        source_snapshot={}
    )
    chk_fail = next(r for r in res_fail if r.category == "accessibility")
    assert len(chk_fail.findings) == 1
    assert "fails WCAG AA standard of 4.5:1" in chk_fail.findings[0].rationale

    # Pair with 4.54:1 (passes normal text)
    res_pass = check(
        dummy_extraction,
        context={"color_pair": {"foreground": "#767676", "background": "#FFFFFF", "font_size_pt": 12}},
        source_snapshot={}
    )
    chk_pass = next(r for r in res_pass if r.category == "accessibility")
    assert len(chk_pass.findings) == 0


def test_t10_contrast_299_vs_300_boundary_large_text():
    """
    Verify exact contrast threshold of 3.0:1 for large text (>= 18pt):
    2.92 fails, 3.03 passes.
    """
    dummy_extraction = extract(b"sample text", "text/plain", {})

    # Pair with 2.92:1 (fails large text)
    res_fail = check(
        dummy_extraction,
        context={"color_pair": {"foreground": "#969696", "background": "#FFFFFF", "font_size_pt": 18}},
        source_snapshot={}
    )
    chk_fail = next(r for r in res_fail if r.category == "accessibility")
    assert len(chk_fail.findings) == 1
    assert "fails WCAG AA standard of 3.0:1" in chk_fail.findings[0].rationale

    # Pair with 3.03:1 (passes large text)
    res_pass = check(
        dummy_extraction,
        context={"color_pair": {"foreground": "#949494", "background": "#FFFFFF", "font_size_pt": 18}},
        source_snapshot={}
    )
    chk_pass = next(r for r in res_pass if r.category == "accessibility")
    assert len(chk_pass.findings) == 0


def test_t10_contrast_unknown_font_size_honest_uncertainty():
    """
    When contrast is between 3.0 and 4.49 but font size is UNKNOWN:
    Engine MUST return status: 'needs_manual_review' (honest uncertainty).
    """
    dummy_extraction = extract(b"sample text", "text/plain", {})

    # FG #888888 on BG #FFFFFF has contrast ratio ~3.54:1 (passes large, fails normal)
    # font_size_pt is omitted / None
    res = check(
        dummy_extraction,
        context={"color_pair": {"foreground": "#888888", "background": "#FFFFFF"}},
        source_snapshot={}
    )
    chk = next(r for r in res if r.category == "accessibility")
    assert chk.status == "needs_manual_review"
    assert "requires manual human review" in chk.reason
    assert "Font size is unknown" in chk.reason


def test_clean_draft_produces_zero_findings_with_complete_status():
    text = "LumaDesk brings seamless ergonomics. Get your 14-day free trial."
    extraction = extract(text.encode("utf-8"), "text/plain", {})

    snapshot = {
        "rules": [
            {
                "id": "rule-term-01",
                "category": "terminology",
                "canonical_term": "LumaDesk"
            },
            {
                "id": "rule-fact-01",
                "category": "facts_claims",
                "fact_type": "trial_duration",
                "approved_value": "14-day"
            }
        ]
    }

    results = check(extraction, context={}, source_snapshot=snapshot)
    for r in results:
        assert r.status in ("complete", "not_applicable")
        assert len(r.findings) == 0
