"""The README and the architecture doc say what goes to Anthropic after the guided-coach work:
the coach's moments, and the grammar check only when tapped."""

import re
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
ARCHITECTURE = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
SVG = ROOT / "docs" / "architecture.svg"


def flat(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def privacy_section() -> str:
    start = README.index("## Privacy")
    return flat(README[start : README.index("## AI disclosure")])


def test_privacy_says_the_coach_gets_the_moments_the_app_found() -> None:
    section = privacy_section()
    assert "the moments the app found" in section
    assert "the words around it" in section


def test_privacy_says_the_grammar_check_sends_the_transcript_only_on_a_tap() -> None:
    section = privacy_section()
    assert "`POST /api/language-check`" in section
    assert "only when you tap" in section
    assert "up to 8,000 characters" in section


def test_privacy_says_there_is_no_account_and_no_backup() -> None:
    section = privacy_section()
    assert "There is no account and no sign-in." in section
    assert "There is no backup." in section


def test_privacy_says_unclear_word_hints_are_never_counted() -> None:
    section = privacy_section()
    assert "never counted" in section
    assert "nothing is sent" in section


def test_architecture_doc_says_where_the_moments_and_the_check_go() -> None:
    text = flat(ARCHITECTURE)
    assert "POST /api/language-check" in text
    assert "only when the speaker taps" in text
    assert "moments" in text


def test_the_diagram_shows_both_anthropic_calls() -> None:
    root = ElementTree.fromstring(SVG.read_bytes())
    text = " ".join(t.text or "" for t in root.iter() if t.text)
    assert "language-check" in text
    assert "moments" in text
    assert "only on tap" in text
