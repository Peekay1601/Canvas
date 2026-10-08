"""Reading the script, whatever it was written in."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# INT. / EXT. sluglines, or "SCENE 12", "Sc 12", "12." style headings used in many Indian/TV scripts.
SCENE_HEADING = re.compile(
    r"^\s*(?:\d+[A-Z]?[.)]?\s+)?(?:INT\.?|EXT\.?|INT/EXT\.?|I/E\.?)\s.+"
    r"|^\s*(?:SCENE|SC\.?)\s*[-:#]?\s*\d+[A-Z]?\b.*",
    re.IGNORECASE,
)


def read_script_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".docx":
        return _docx(path)
    if ext == ".fdx":
        return _fdx(path)
    if ext == ".pdf":
        return _pdf(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    if ext == ".rtf":
        text = _strip_rtf(text)
    return text


def _docx(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    lines = []
    for p in root.iter(f"{_W}p"):
        lines.append("".join(t.text or "" for t in p.iter(f"{_W}t")))
    return "\n".join(lines)


def _fdx(path: Path) -> str:
    root = ET.parse(path).getroot()
    lines = []
    for para in root.iter("Paragraph"):
        kind = para.get("Type", "")
        text = "".join(t.text or "" for t in para.iter("Text")).strip()
        if not text:
            continue
        if kind == "Scene Heading":
            number = para.get("Number")
            lines.append("")
            lines.append(f"{number + '. ' if number else ''}{text.upper()}")
        elif kind == "Character":
            lines.append(f"\n{text.upper()}")
        elif kind == "Parenthetical":
            lines.append(f"  {text}")
        elif kind == "Dialogue":
            lines.append(f"  {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def _pdf(path: Path) -> str:
    from pypdf import PdfReader

    return "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)


def _strip_rtf(text: str) -> str:
    text = re.sub(r"\\par[d]?\b", "\n", text)
    text = re.sub(r"\\'[0-9a-f]{2}", "", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    return re.sub(r"[{}]", "", text)


def scene_outline(text: str) -> list[dict]:
    """Scene headings with their line numbers, so Claude can page through a long script by scene."""
    scenes = []
    for number, line in enumerate(text.splitlines(), start=1):
        if SCENE_HEADING.match(line) and len(line.strip()) < 120:
            scenes.append({"line": number, "heading": line.strip()})
    return scenes
