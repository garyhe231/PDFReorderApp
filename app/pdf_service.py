"""
PDF service: extract page numbers printed on each page using OCR/text extraction,
then reorder the PDF according to those numbers.
"""
import re
import fitz  # PyMuPDF
from pypdf import PdfReader, PdfWriter
from typing import List, Optional, Tuple


def _extract_page_number_from_text(text: str) -> Optional[int]:
    """
    Try to find a printed page number in the extracted text.
    Looks for common patterns:
      - Standalone number on its own line
      - "Page N", "P. N", "- N -", "N of M"
    Returns the first confident match, or None.
    """
    text = text.strip()

    # "Page N" / "Page N of M"
    m = re.search(r'\bpage\s+(\d+)', text, re.IGNORECASE)
    if m:
        return int(m.group(1))

    # "N of M"
    m = re.search(r'\b(\d+)\s+of\s+\d+\b', text, re.IGNORECASE)
    if m:
        return int(m.group(1))

    # "- N -" or "– N –"
    m = re.search(r'[-–]\s*(\d+)\s*[-–]', text)
    if m:
        return int(m.group(1))

    # "P. N" or "p N"
    m = re.search(r'\bp\.?\s*(\d+)\b', text, re.IGNORECASE)
    if m:
        return int(m.group(1))

    # Standalone number on its own line (header/footer region)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for line in lines:
        if re.fullmatch(r'\d{1,4}', line):
            return int(line)

    return None


def extract_page_numbers(pdf_path: str) -> List[dict]:
    """
    For each page in the PDF, extract the printed page number using text extraction
    with fitz. Falls back to page index+1 if no number found.

    Returns a list of dicts:
      { index: 0-based PDF index, detected: int|None, label: str, preview_text: str }
    """
    doc = fitz.open(pdf_path)
    results = []

    for i, page in enumerate(doc):
        # Get full text
        text = page.get_text("text")

        # Also try just header (top 15% of page) and footer (bottom 15%)
        rect = page.rect
        h = rect.height

        header_clip = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + h * 0.15)
        footer_clip = fitz.Rect(rect.x0, rect.y1 - h * 0.15, rect.x1, rect.y1)

        header_text = page.get_text("text", clip=header_clip)
        footer_text = page.get_text("text", clip=footer_clip)

        # Priority: header/footer first (more likely to contain page numbers)
        detected = _extract_page_number_from_text(header_text)
        if detected is None:
            detected = _extract_page_number_from_text(footer_text)
        if detected is None:
            detected = _extract_page_number_from_text(text)

        # Preview: first 200 chars of full text
        preview = text[:200].replace("\n", " ").strip()

        results.append({
            "index": i,
            "detected": detected,
            "label": str(detected) if detected is not None else f"? (pg {i+1})",
            "preview_text": preview,
        })

    doc.close()
    return results


def reorder_pdf(pdf_path: str, order: List[int], output_path: str) -> str:
    """
    Reorder pages of the PDF.
    `order` is a list of 0-based page indices in the desired output order.
    Returns the output_path.
    """
    reader = PdfReader(pdf_path)
    writer = PdfWriter()

    for idx in order:
        writer.add_page(reader.pages[idx])

    with open(output_path, "wb") as f:
        writer.write(f)

    return output_path


def render_page_thumbnail(pdf_path: str, page_index: int, width: int = 200) -> bytes:
    """Render a page as a PNG thumbnail and return PNG bytes."""
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes
