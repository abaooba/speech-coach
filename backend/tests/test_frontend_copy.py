"""Static checks on the frontend's fixed copy and its state blocks (DESIGN.md sections 6 and 8).

Each fixed body sentence lives in exactly one string literal across api.js and the screens, so
a wording change is made in one place. Only app.ui.renderState in ui.js builds .state markup.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
API_JS = FRONTEND_DIR / "api.js"
SCREENS_DIR = FRONTEND_DIR / "screens"
INDEX_HTML = FRONTEND_DIR / "index.html"
UI_JS = FRONTEND_DIR / "ui.js"
HUMAN_OWNED_JS = FRONTEND_DIR / "pauses.js"
FRONTEND_TESTS_DIR = FRONTEND_DIR / "tests"

# The body sentence of every empty, error and loading block, word for word from DESIGN.md
# section 8 (the microphone one included: it ends "then try again.").
FIXED_SENTENCES = [
    "Could not reach the server. Your recording is still here.",
    "That was under 5 seconds. Try again.",
    "Analysis failed on our side. Your recording is still here.",
    "Microphone is blocked. Allow it in your browser settings, then try again.",
    "Usually 5 to 15 seconds.",
    "It may have been deleted.",
    "Your first recording will show up here.",
    "Record one more to see a trend.",
]

# Markup only renderState may build: a state modifier class, or a class attribute starting it.
STATE_MARKUP_NEEDLES = ["state--", 'class="state']


def copy_sources() -> list[Path]:
    """api.js and every screen module: the files that hold the fixed copy."""
    return [API_JS, *sorted(SCREENS_DIR.glob("*.js"))]


def markup_sources() -> list[Path]:
    """Every frontend script and index.html, except ui.js, the tests and the human-owned file."""
    scripts = [
        path
        for path in FRONTEND_DIR.rglob("*.js")
        if path not in (UI_JS, HUMAN_OWNED_JS) and FRONTEND_TESTS_DIR not in path.parents
    ]
    return [INDEX_HTML, *sorted(scripts)]


def test_copy_sources_are_found() -> None:
    names = [path.relative_to(FRONTEND_DIR).as_posix() for path in copy_sources()]
    assert "api.js" in names
    assert "screens/practice.js" in names
    assert len(names) >= 6, f"expected api.js and five screens, found {names}"


def test_each_fixed_sentence_appears_exactly_once() -> None:
    combined = "\n".join(path.read_text(encoding="utf-8") for path in copy_sources())
    counts = {sentence: combined.count(sentence) for sentence in FIXED_SENTENCES}
    wrong = {sentence: count for sentence, count in counts.items() if count != 1}
    assert wrong == {}, f"sentences not found exactly once (sentence: count): {wrong}"


def test_state_markup_is_built_only_in_ui_js() -> None:
    sources = markup_sources()
    assert INDEX_HTML in sources
    assert UI_JS not in sources
    offenders = [
        f"{path.relative_to(REPO_ROOT)}: {needle}"
        for path in sources
        for needle in STATE_MARKUP_NEEDLES
        if needle in path.read_text(encoding="utf-8")
    ]
    assert offenders == [], f"state markup outside ui.js: {offenders}"


def test_ui_js_builds_the_state_classes() -> None:
    assert "state--" in UI_JS.read_text(encoding="utf-8"), "ui.js no longer builds .state--*"
