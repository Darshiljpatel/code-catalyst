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
