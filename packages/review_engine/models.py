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

class Finding(BaseModel):
    id: str
    org_id: Optional[str] = None
    revision_id: Optional[str] = None
    run_id: Optional[str] = None
    category: str  # terminology, tone, messaging, facts_claims, visual, accessibility
    severity: str  # blocker, warning, advisory
    evidence_status: str  # supported_violation, contradicted, unsupported, conflicting, manual
    origin: str = "deterministic"  # deterministic, model, human
    location: Dict[str, Any]  # {block_id, start_char, end_char} or {field, bounding_box}
    rule_id: Optional[str] = None
    source_version_id: Optional[str] = None
    evidence_quote: str
    rationale: str
    suggested_edit: Optional[str] = None
    resolution: Optional[str] = None

class CheckResult(BaseModel):
    check_name: str
    category: Optional[str] = None  # terminology | facts_claims | visual | accessibility | tone | messaging
    status: str  # complete | unavailable | failed | needs_manual_review | not_applicable
    reason: Optional[str] = None
    findings: List[Finding] = Field(default_factory=list)
