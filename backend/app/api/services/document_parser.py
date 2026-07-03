"""Document parser — PDF and DOCX to clean plain text."""

from __future__ import annotations

import io
import re
from pathlib import Path

import pdfplumber
from docx import Document as DocxDocument

from app.core.logging import get_logger

logger = get_logger(__name__)


def parse_document(content: bytes, filename: str) -> str:
    """Dispatch to the correct parser based on file extension."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return parse_pdf(content)
    elif ext in (".docx", ".doc"):
        return parse_docx(content)
    else:
        raise ValueError(f"Unsupported file type: {ext}")


def parse_pdf(content: bytes) -> str:
    """Extract text from PDF preserving paragraph structure."""
    buf = io.BytesIO(content)
    pages: list[str] = []

    with pdfplumber.open(buf) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if text:
                pages.append(text)

    raw = "\n\n".join(pages)
    return _clean_text(raw)


def parse_docx(content: bytes) -> str:
    """Extract text from DOCX, preserving heading hierarchy."""
    buf = io.BytesIO(content)
    doc = DocxDocument(buf)

    paragraphs: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        # Capitalise headings for easier downstream segmentation
        if para.style and para.style.name and para.style.name.startswith("Heading"):
            text = text.upper()
        paragraphs.append(text)

    raw = "\n\n".join(paragraphs)
    return _clean_text(raw)


def _clean_text(text: str) -> str:
    """Normalise whitespace, remove page numbers, fix ligatures."""
    replacements = {
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "--",
    }
    for bad, good in replacements.items():
        text = text.replace(bad, good)

    # Remove standalone page numbers
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)

    # Collapse >2 consecutive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
