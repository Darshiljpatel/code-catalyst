import io
import pytest
from PIL import Image
from pypdf import PdfWriter
from docx import Document
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
    # Unicode code point offset test: "🚀" is 1 codepoint
    assert res.blocks[1].start_char == 13
    assert res.blocks[1].text == "Line 2 with special char: 🚀 rocket."
    assert res.original_sha256 is not None
    assert res.canonical_sha256 is not None

def test_extract_png_metadata():
    img_byte_arr = io.BytesIO()
    img = Image.new("RGBA", (400, 300), color=(255, 0, 0, 128))
    img.save(img_byte_arr, format="PNG")
    data = img_byte_arr.getvalue()
    res = extract(data, "image/png", limits={"max_bytes": 100000})
    assert res.status == "complete"
    assert res.image_metadata is not None
    assert res.image_metadata.width == 400
    assert res.image_metadata.height == 300
    assert res.image_metadata.format == "PNG"
    assert res.image_metadata.has_alpha is True

def test_extract_jpeg_metadata():
    img_byte_arr = io.BytesIO()
    img = Image.new("RGB", (200, 150), color=(0, 255, 0))
    img.save(img_byte_arr, format="JPEG")
    data = img_byte_arr.getvalue()
    res = extract(data, "image/jpeg", limits={"max_bytes": 100000})
    assert res.status == "complete"
    assert res.image_metadata is not None
    assert res.image_metadata.width == 200
    assert res.image_metadata.height == 150
    assert res.image_metadata.has_alpha is False

def test_extract_pdf_with_text():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    pdf_bytes = io.BytesIO()
    writer.write(pdf_bytes)
    # Blank PDF has no text -> must indicate unreadable / needs_manual_review per CONTRACTS.md
    res = extract(pdf_bytes.getvalue(), "application/pdf", limits={"max_bytes": 100000, "max_pages": 10})
    assert res.status == "needs_manual_review"
    assert len(res.blocks) == 0
    assert "OCR required" in res.warnings[0]

def test_extract_docx_paragraphs():
    doc = Document()
    doc.add_paragraph("First paragraph of campaign.")
    doc.add_paragraph("Second paragraph with details.")
    doc_bytes = io.BytesIO()
    doc.save(doc_bytes)
    res = extract(doc_bytes.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", limits={"max_bytes": 100000})
    assert res.status == "complete"
    assert len(res.blocks) == 2
    assert res.blocks[0].text == "First paragraph of campaign."
    assert res.blocks[0].paragraph == 1
    assert res.blocks[1].text == "Second paragraph with details."
    assert res.blocks[1].paragraph == 2

def test_extract_unsupported_media_type():
    res = extract(b"mystery content", "application/x-unknown-format", limits={"max_bytes": 10000})
    assert res.status == "failed"
    assert "Unsupported media type" in res.warnings[0]

def test_extract_size_limit_exceeded():
    res = extract(b"a" * 100, "text/plain", limits={"max_bytes": 50})
    assert res.status == "failed"
    assert "exceeds limit" in res.warnings[0]
