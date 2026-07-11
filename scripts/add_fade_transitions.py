"""Add a restrained PowerPoint fade transition to every slide.

Uses presentation XML because python-pptx does not expose transitions.
The output remains a standard .pptx and is verified after packaging.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
ET.register_namespace("p", P_NS)


def add_fade_transition(slide_xml: bytes) -> bytes:
    root = ET.fromstring(slide_xml)
    transition_tag = f"{{{P_NS}}}transition"
    for old in root.findall(transition_tag):
        root.remove(old)

    transition = ET.Element(transition_tag, {"spd": "med", "advClick": "1"})
    ET.SubElement(transition, f"{{{P_NS}}}fade")

    # OOXML order: cSld, clrMapOvr, transition, timing, extLst
    insert_at = len(root)
    for idx, child in enumerate(list(root)):
        if child.tag in {f"{{{P_NS}}}timing", f"{{{P_NS}}}extLst"}:
            insert_at = idx
            break
    root.insert(insert_at, transition)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main(path_text: str) -> None:
    deck = Path(path_text).expanduser().resolve()
    if not deck.is_file():
        raise FileNotFoundError(deck)

    with tempfile.TemporaryDirectory() as temp_dir:
        staged = Path(temp_dir) / deck.name
        with zipfile.ZipFile(deck, "r") as source, zipfile.ZipFile(staged, "w", zipfile.ZIP_DEFLATED) as target:
            slides = []
            for info in source.infolist():
                payload = source.read(info.filename)
                if info.filename.startswith("ppt/slides/slide") and info.filename.endswith(".xml"):
                    payload = add_fade_transition(payload)
                    slides.append(info.filename)
                target.writestr(info, payload)
        with zipfile.ZipFile(staged, "r") as check:
            bad = check.testzip()
            if bad:
                raise RuntimeError(f"Corrupt PPTX entry: {bad}")
            missing = [name for name in slides if b"<p:transition" not in check.read(name)]
            if missing:
                raise RuntimeError(f"Transitions missing from: {missing}")
        shutil.move(staged, deck)
    print(f"Added medium fade transitions to {len(slides)} slides: {deck}")


if __name__ == "__main__":
    main(sys.argv[1])
