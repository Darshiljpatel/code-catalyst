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
        line_len = len(line)  # Python len() is unicode code points
        if line.strip():
            blocks.append(TextBlock(
                id=f"p-{i+1}",
                text=line,
                paragraph=i + 1,
                start_char=current_offset,
                end_char=current_offset + line_len
            ))
        current_offset += line_len + 1  # 1 for newline delimiter

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
        fmt = img.format or ("PNG" if "png" in mime.lower() else "JPEG")
        meta = ImageMetadata(
            width=img.width,
            height=img.height,
            format=fmt,
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
        full_text_parts: List[str] = []
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
        full_text_parts: List[str] = []
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
