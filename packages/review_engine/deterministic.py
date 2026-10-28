import math
from decimal import Decimal
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

def _make_boundary_regex(pattern: str, ignore_case: bool = False) -> re.Pattern:
    """Builds regex with smart boundary anchors handling non-word leading/trailing chars."""
    escaped = re.escape(pattern)
    prefix = r"(?<!\w)" if re.match(r"^\w", pattern) else r"(?<!\S)"
    suffix = r"(?!\w)" if re.search(r"\w$", pattern) else r"(?!\S)"
    flags = re.IGNORECASE if ignore_case else 0
    return re.compile(f"{prefix}{escaped}{suffix}", flags)



def _one_typo_apart(candidate: str, canonical: str) -> bool:
    """One insertion, deletion, substitution, or adjacent transposition; bounded and linear."""
    if candidate == canonical or abs(len(candidate) - len(canonical)) > 1:
        return False
    if len(candidate) == len(canonical):
        different = [i for i, (a, b) in enumerate(zip(candidate, canonical)) if a != b]
        return len(different) == 1 or (len(different) == 2 and different[1] == different[0] + 1
            and candidate[different[0]] == canonical[different[1]]
            and candidate[different[1]] == canonical[different[0]])
    shorter, longer = sorted((candidate, canonical), key=len)
    for i, character in enumerate(shorter):
        if character != longer[i]:
            return shorter[i:] == longer[i + 1:]
    return True


def _check_terminology(extraction: ExtractionResult, rules: List[Dict[str, Any]]) -> CheckResult:
    findings: List[Finding] = []
    term_rules = [r for r in rules if r.get("category") == "terminology" or r.get("kind") == "terminology"]
    approved_terms = {(r.get("canonical_term") or r.get("value") or "").casefold() for r in term_rules}
    approved_terms |= {v.casefold() for r in term_rules for v in (r.get("allowed_variants") or [])}

    for block in extraction.blocks:
        for rule in term_rules:
            canonical = rule.get("canonical_term") or rule.get("value") or ""
            seen = set()

            def add(match, *, probable=False):
                start, end = block.start_char + match.start(), block.start_char + match.end()
                if (start, end) in seen:
                    return
                seen.add((start, end))
                findings.append(Finding(
                    id=f"find-{uuid.uuid4().hex[:8]}", category="terminology",
                    severity="advisory" if probable else "blocker", evidence_status="supported_violation",
                    origin="deterministic", location={"block_id": block.id, "start_char": start, "end_char": end},
                    rule_id=rule.get("id"), source_version_id=rule.get("source_version_id"),
                    evidence_quote=match.group(0),
                    rationale=(f"Possible misspelling of the approved brand name '{canonical}'. Verify before applying."
                               if probable else rule.get("rationale", f"Use the approved brand term '{canonical}'.")),
                    suggested_edit=canonical,
                ))

            # Exact alternative spellings the guideline explicitly allows (e.g. an all-caps headline).
            allowed = {canonical, *(rule.get("allowed_variants") or [])}
            if canonical:
                for match in _make_boundary_regex(canonical, ignore_case=True).finditer(block.text):
                    if match.group(0) not in allowed:
                        add(match)
            for pattern in [*rule.get("forbidden_patterns", []), *(rule.get("forbidden_variants") or [])]:
                for match in _make_boundary_regex(pattern, ignore_case=True).finditer(block.text):
                    if match.group(0) not in allowed:
                        add(match)

            # Only an approved, single-word brand name can anchor a likely typo.
            # General prose and short terms must not turn into speculative spelling errors.
            is_brand = rule.get("key") in ("brand_name", "product_name") or ("canonical_term" in rule and not rule.get("key"))
            if is_brand and canonical.isalpha() and 5 <= len(canonical) <= 64:
                for match in re.finditer(r"(?<!\w)[^\W\d_]+(?!\w)", block.text):
                    token = match.group(0).casefold()
                    if token not in approved_terms and len(token) >= 5 and _one_typo_apart(token, canonical.casefold()):
                        add(match, probable=True)

    return CheckResult(check_name="terminology_check", category="terminology", status="complete", findings=findings)


# ---------------------------------------------------------------------------
# 2. Fact Verification Engine (T05: Fact Contradictions)
# ---------------------------------------------------------------------------

_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def fact_template(approved_value: str) -> Optional[re.Pattern]:
    """A pattern for the approved phrase with its one number left free, so "$12 per seat" also matches
    "$10 per seat". Only values with exactly one number and at least one anchoring word qualify,
    so a bare number or percentage never matches unrelated figures in the copy."""
    numbers = list(_NUMBER.finditer(approved_value))
    if len(numbers) != 1:
        return None
    number = numbers[0]
    before, after = approved_value[:number.start()], approved_value[number.end():]
    if not re.search(r"[^\W\d_]", before + after):
        return None

    def literal(part: str) -> str:
        tokens = re.findall(r"[^\W\d_]+|[$€£%]", part)
        return r"[\s-]*".join(re.escape(t) for t in tokens)

    head, tail = literal(before), literal(after)
    pattern = (head + r"\s?" if head else "") + r"(\d+(?:[.,]\d+)?)" + (r"[\s-]?" + tail if tail else "")
    return re.compile(r"(?<![\w.])" + pattern + r"(?!\w)", re.IGNORECASE)


def _template_fact_findings(block, rule, approved_val, findings):
    template = fact_template(approved_val)
    approved_num = _NUMBER.search(approved_val)
    if template is None or approved_num is None:
        return
    for match in template.finditer(block.text):
        if Decimal(match.group(1).replace(",", ".")) == Decimal(approved_num.group(0).replace(",", ".")):
            continue
        start, end = block.start_char + match.start(), block.start_char + match.end()
        if any(f.location.get("start_char") is not None and f.location["start_char"] < end and start < f.location["end_char"]
               for f in findings):
            continue
        findings.append(Finding(
            id=f"find-{uuid.uuid4().hex[:8]}", category="facts_claims", severity="blocker", evidence_status="contradicted",
            origin="deterministic", location={"block_id": block.id, "start_char": start, "end_char": end},
            rule_id=rule.get("id"), source_version_id=rule.get("source_version_id"), evidence_quote=match.group(0),
            rationale=rule.get("rationale", f"Contradicts the approved value '{approved_val}'."), suggested_edit=approved_val))


def _check_facts(extraction: ExtractionResult, rules: List[Dict[str, Any]]) -> CheckResult:
    findings: List[Finding] = []
    fact_rules = [r for r in rules if r.get("category") == "facts_claims" or r.get("kind") == "fact"]

    for block in extraction.blocks:
        for rule in fact_rules:
            approved_val = rule.get("approved_value") or rule.get("value") or ""
            contradicted_list = list(rule.get("contradicted_values", []))

            # Check explicit contradicted strings
            for contradicted in contradicted_list:
                regex = _make_boundary_regex(contradicted, ignore_case=True)
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

            # Prices, percentages and counts: the approved phrase with a different number.
            if rule.get("key") != "trial_duration":
                _template_fact_findings(block, rule, approved_val, findings)

            # Specialized check for trial durations if not already caught
            if rule.get("key") == "trial_duration" or "day" in approved_val.lower():
                # Extract number from approved value e.g. "14" from "14 days" or "14-day"
                approved_num_match = re.search(r"\b(\d+(?:\.\d+)?)\b", approved_val)
                if approved_num_match:
                    approved_num = approved_num_match.group(1)
                    # Find any pattern like "30-day" or "30 days" or "60 day"
                    duration_regex = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)[-\s]?(?:day|days)\b", re.IGNORECASE)
                    for match in duration_regex.finditer(block.text):
                        # Bind the duration to its subject, including "30-day free trial"
                        # and "trial lasts 30 days"; a refund/onboarding duration is unrelated.
                        before, after = block.text[:match.start()], block.text[match.end():]
                        trial_after = re.match(r'(?:\s+(?:free|paid|product|software|evaluation))*\s+trial\b', after, re.IGNORECASE)
                        trial_before = re.search(
                            r'\btrial(?:\s+(?:lasts?|for|of|is|a|period|users|customers|members|teams|everyone|all|new))*\s*[:=]?\s*$',
                            before, re.IGNORECASE)
                        if not (trial_after or trial_before):
                            continue
                        found_num = match.group(1)
                        if Decimal(found_num) != Decimal(approved_num):
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
    """Computes the WCAG contrast ratio (L1 + 0.05) / (L2 + 0.05) without rounding before threshold comparison."""
    lum1 = calculate_relative_luminance(foreground_hex)
    lum2 = calculate_relative_luminance(background_hex)
    l_max = max(lum1, lum2)
    l_min = min(lum1, lum2)
    return (l_max + 0.05) / (l_min + 0.05)


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
    if not color_pair and ("foreground_hex" in context or "foreground" in context) and ("background_hex" in context or "background" in context):
        color_pair = {
            "foreground": context.get("foreground_hex") or context.get("foreground"),
            "background": context.get("background_hex") or context.get("background"),
            "font_size_pt": context.get("font_size_pt", 12)
        }
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
