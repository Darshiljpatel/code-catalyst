import math
import re
import uuid
from typing import Dict, Any, List, Optional, Tuple, Union
from review_engine.models import ExtractionResult, CheckResult, Finding

def check(extraction: ExtractionResult, context: Dict[str, Any], source_snapshot: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[CheckResult]:
    """
    Core deterministic review engine adhering to CONTRACTS.md.
    Evaluates:
    1. Terminology (forbidden case/variants, word-boundaries)
    2. Structured Facts (contradicted values and numerical discrepancies)
    3. Asset Identity & Integrity (original vs altered asset hashes, dimensions)
    4. Accessibility (missing alt text, WCAG 2.1 luminance ratios, unknown font-size uncertainty)
    """
    normalized_rules, approved_assets, min_dimensions = _normalize_snapshot(source_snapshot)

    results: List[CheckResult] = []

    # 1. Terminology Check
    results.append(_check_terminology(extraction, normalized_rules))

    # 2. Fact Verification Check
    results.append(_check_facts(extraction, normalized_rules))

    # 3. Visual / Asset Identity Check
    results.append(_check_asset_identity(extraction, context, approved_assets, min_dimensions))

    # 4. Accessibility Check
    results.append(_check_contrast_and_accessibility(extraction, context))

    return results


def _normalize_snapshot(source_snapshot: Union[Dict[str, Any], List[Dict[str, Any]]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Optional[Dict[str, int]]]:
    """
    Normalizes source_snapshot into rules, approved assets, and dimension constraints.
    Supports:
    - Sanath's database JSON structure (list of SourceOut objects)
    - Flat test snapshot dictionaries (with 'rules', 'approved_assets', etc.)
    """
    rules: List[Dict[str, Any]] = []
    approved_assets: List[Dict[str, Any]] = []
    min_dimensions: Optional[Dict[str, int]] = None

    if isinstance(source_snapshot, list):
        for src in source_snapshot:
            if isinstance(src, dict):
                src_id = src.get("id") or src.get("source_key")
                for r in src.get("rules", []):
                    r_copy = dict(r)
                    if "source_version_id" not in r_copy and src_id:
                        r_copy["source_version_id"] = src_id
                    rules.append(r_copy)
                for a in src.get("approved_assets", []):
                    approved_assets.append(a)
    elif isinstance(source_snapshot, dict):
        if "sources" in source_snapshot:
            for src in source_snapshot["sources"]:
                src_id = src.get("id") or src.get("source_key")
                for r in src.get("rules", []):
                    r_copy = dict(r)
                    if "source_version_id" not in r_copy and src_id:
                        r_copy["source_version_id"] = src_id
                    rules.append(r_copy)
                for a in src.get("approved_assets", []):
                    approved_assets.append(a)
        rules.extend(source_snapshot.get("rules", []))
        approved_assets.extend(source_snapshot.get("approved_assets", []))
        min_dimensions = source_snapshot.get("min_image_dimensions")

    return rules, approved_assets, min_dimensions


# ---------------------------------------------------------------------------
# 1. Terminology Engine (T05: Brand-Agnostic, Exact Locations, Word Boundaries)
# ---------------------------------------------------------------------------

def _check_terminology(extraction: ExtractionResult, rules: List[Dict[str, Any]]) -> CheckResult:
    findings: List[Finding] = []
    term_rules = [r for r in rules if r.get("category") == "terminology" or r.get("kind") == "terminology"]

    for block in extraction.blocks:
        for rule in term_rules:
            canonical = rule.get("canonical_term") or rule.get("value") or ""
            forbidden = list(rule.get("forbidden_patterns", []))

            # If forbidden patterns not explicitly listed, check case-insensitive match differing from canonical
            if not forbidden and canonical:
                regex = re.compile(rf"\b{re.escape(canonical)}\b", re.IGNORECASE)
                for match in regex.finditer(block.text):
                    if match.group(0) != canonical:
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
                            rationale=rule.get("rationale", f"Brand term must be capitalized as '{canonical}'."),
                            suggested_edit=canonical
                        ))

            # Check explicit forbidden patterns with word boundaries
            for pattern in forbidden:
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
        category="terminology",
        status="complete",
        findings=findings
    )


# ---------------------------------------------------------------------------
# 2. Fact Verification Engine (T05: Fact Contradictions)
# ---------------------------------------------------------------------------

def _check_facts(extraction: ExtractionResult, rules: List[Dict[str, Any]]) -> CheckResult:
    findings: List[Finding] = []
    fact_rules = [r for r in rules if r.get("category") == "facts_claims" or r.get("kind") == "fact"]

    for block in extraction.blocks:
        for rule in fact_rules:
            approved_val = rule.get("approved_value") or rule.get("value") or ""
            contradicted_list = list(rule.get("contradicted_values", []))

            # Check explicit contradicted strings
            for contradicted in contradicted_list:
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

            # Specialized check for trial durations if not already caught
            if rule.get("key") == "trial_duration" or "day" in approved_val.lower():
                # Extract number from approved value e.g. "14" from "14 days" or "14-day"
                approved_num_match = re.search(r"\b(\d+)\b", approved_val)
                if approved_num_match:
                    approved_num = approved_num_match.group(1)
                    # Find any pattern like "30-day" or "30 days" or "60 day"
                    duration_regex = re.compile(r"\b(\d+)[-\s]?(?:day|days)\b", re.IGNORECASE)
                    for match in duration_regex.finditer(block.text):
                        found_num = match.group(1)
                        if found_num != approved_num:
                            # Avoid duplicate finding if already caught by explicit contradicted list
                            start = block.start_char + match.start()
                            end = block.start_char + match.end()
                            if not any(f.location.get("start_char") == start for f in findings):
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
                                    rationale=rule.get("rationale", f"Contradicts approved trial duration of {approved_val}."),
                                    suggested_edit=approved_val
                                ))

    return CheckResult(
        check_name="fact_verification_check",
        category="facts_claims",
        status="complete",
        findings=findings
    )


# ---------------------------------------------------------------------------
# 3. Asset Identity & Integrity Engine (T10: Original vs Altered Asset Hash)
# ---------------------------------------------------------------------------

def _check_asset_identity(extraction: ExtractionResult, context: Dict[str, Any], approved_assets: List[Dict[str, Any]], min_dimensions: Optional[Dict[str, int]]) -> CheckResult:
    findings: List[Finding] = []

    # If no image in content, check is not applicable
    if extraction.image_metadata is None:
        return CheckResult(
            check_name="asset_identity_check",
            category="visual",
            status="not_applicable",
            reason="No visual image asset present in extracted content.",
            findings=[]
        )

    expected_asset_id = context.get("expected_asset_id")

    # If the user/context claims this is an approved brand asset
    if expected_asset_id and approved_assets:
        matching_asset = next((a for a in approved_assets if a.get("id") == expected_asset_id), None)
        if matching_asset:
            expected_hash = matching_asset.get("sha256")
            if extraction.original_sha256 != expected_hash:
                findings.append(Finding(
                    id=f"find-{uuid.uuid4().hex[:8]}",
                    category="visual",
                    severity="blocker",
                    evidence_status="supported_violation",
                    origin="deterministic",
                    location={"field": "asset_hash"},
                    rule_id=matching_asset.get("id"),
                    evidence_quote=f"SHA-256: {extraction.original_sha256[:16]}...",
                    rationale=(
                        f"Asset has been altered. Uploaded hash does not match approved "
                        f"original asset '{matching_asset.get('name', expected_asset_id)}'."
                    ),
                    suggested_edit=f"Use the unedited original asset (SHA-256: {expected_hash[:16]}...)"
                ))

    # Dimension checking against brand bounds
    if min_dimensions and extraction.image_metadata:
        min_w = min_dimensions.get("width", 0)
        min_h = min_dimensions.get("height", 0)
        if extraction.image_metadata.width < min_w or extraction.image_metadata.height < min_h:
            findings.append(Finding(
                id=f"find-{uuid.uuid4().hex[:8]}",
                category="visual",
                severity="warning",
                evidence_status="supported_violation",
                origin="deterministic",
                location={"field": "dimensions"},
                evidence_quote=f"{extraction.image_metadata.width}x{extraction.image_metadata.height}px",
                rationale=f"Image resolution is below the approved brand minimum of {min_w}x{min_h}px.",
                suggested_edit=f"Provide asset meeting minimum resolution of {min_w}x{min_h}px."
            ))

    return CheckResult(
        check_name="asset_identity_check",
        category="visual",
        status="complete",
        findings=findings
    )


# ---------------------------------------------------------------------------
# 4. WCAG 2.1 Contrast & Accessibility Engine (T10: 4.5:1 & 3.0:1 Boundaries)
# ---------------------------------------------------------------------------

def calculate_relative_luminance(rgb_hex: str) -> float:
    """Computes relative luminance for an sRGB hex code per WCAG 2.1 formula."""
    hex_clean = rgb_hex.lstrip("#")
    if len(hex_clean) == 3:
        hex_clean = "".join(c * 2 for c in hex_clean)
    r = int(hex_clean[0:2], 16) / 255.0
    g = int(hex_clean[2:4], 16) / 255.0
    b = int(hex_clean[4:6], 16) / 255.0

    def to_linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else math.pow((c + 0.055) / 1.055, 2.4)

    return 0.2126 * to_linear(r) + 0.7152 * to_linear(g) + 0.0722 * to_linear(b)


def calculate_contrast_ratio(foreground_hex: str, background_hex: str) -> float:
    """Computes the WCAG contrast ratio (L1 + 0.05) / (L2 + 0.05) rounded to 2 decimal places."""
    lum1 = calculate_relative_luminance(foreground_hex)
    lum2 = calculate_relative_luminance(background_hex)
    l_max = max(lum1, lum2)
    l_min = min(lum1, lum2)
    return round((l_max + 0.05) / (l_min + 0.05), 2)


def _check_contrast_and_accessibility(extraction: ExtractionResult, context: Dict[str, Any]) -> CheckResult:
    findings: List[Finding] = []
    status = "complete"
    reason: Optional[str] = None

    # Alt text check
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

    # Color contrast pair check (if color metadata or context provides text/background pairs)
    color_pair = context.get("color_pair")
    if color_pair:
        fg = color_pair.get("foreground")
        bg = color_pair.get("background")
        font_size_pt = color_pair.get("font_size_pt")  # e.g., 14, 18, or None

        if fg and bg:
            ratio = calculate_contrast_ratio(fg, bg)
            is_large_text = font_size_pt is not None and (
                font_size_pt >= 18 or (font_size_pt >= 14 and color_pair.get("is_bold", False))
            )

            # Case A: Known normal text size (< 18pt regular)
            if font_size_pt is not None and not is_large_text:
                if ratio < 4.5:
                    findings.append(Finding(
                        id=f"find-{uuid.uuid4().hex[:8]}",
                        category="accessibility",
                        severity="blocker" if ratio < 3.0 else "warning",
                        evidence_status="supported_violation",
                        origin="deterministic",
                        location={"field": "contrast_ratio"},
                        evidence_quote=f"Contrast ratio {ratio:.2f}:1 (FG: {fg}, BG: {bg})",
                        rationale=f"Contrast ratio {ratio:.2f}:1 fails WCAG AA standard of 4.5:1 for normal text.",
                        suggested_edit="Adjust foreground or background color to achieve at least 4.5:1 contrast."
                    ))

            # Case B: Known large text size (>= 18pt or >= 14pt bold)
            elif font_size_pt is not None and is_large_text:
                if ratio < 3.0:
                    findings.append(Finding(
                        id=f"find-{uuid.uuid4().hex[:8]}",
                        category="accessibility",
                        severity="blocker",
                        evidence_status="supported_violation",
                        origin="deterministic",
                        location={"field": "contrast_ratio"},
                        evidence_quote=f"Contrast ratio {ratio:.2f}:1 (FG: {fg}, BG: {bg})",
                        rationale=f"Contrast ratio {ratio:.2f}:1 fails WCAG AA standard of 3.0:1 for large text.",
                        suggested_edit="Adjust colors to achieve at least 3.0:1 contrast."
                    ))

            # Case C: Unknown font size (T10 Honest Uncertainty requirement)
            else:
                if ratio < 3.0:
                    # Fails all WCAG standards regardless of size
                    findings.append(Finding(
                        id=f"find-{uuid.uuid4().hex[:8]}",
                        category="accessibility",
                        severity="blocker",
                        evidence_status="supported_violation",
                        origin="deterministic",
                        location={"field": "contrast_ratio"},
                        evidence_quote=f"Contrast ratio {ratio:.2f}:1 (FG: {fg}, BG: {bg})",
                        rationale=f"Contrast ratio {ratio:.2f}:1 fails all WCAG text standards (< 3.0:1).",
                        suggested_edit="Increase contrast above 4.5:1."
                    ))
                elif 3.0 <= ratio < 4.5:
                    # Passes large text (>=18pt) but fails normal text (<18pt).
                    # Since font size is unknown, engine must show honest uncertainty!
                    status = "needs_manual_review"
                    reason = (
                        f"Contrast ratio is {ratio:.2f}:1. This passes for large text (>=18pt) "
                        f"but fails normal body text (requires 4.5:1). Font size is unknown; "
                        f"requires manual human review."
                    )
                else:
                    # ratio >= 4.5 passes all standards
                    pass

    return CheckResult(
        check_name="accessibility_check",
        category="accessibility",
        status=status,
        reason=reason,
        findings=findings
    )
