"""The README's privacy bullets say what the backend does with audio after Task 6."""

from pathlib import Path

README = (Path(__file__).resolve().parents[2] / "README.md").read_text(encoding="utf-8")


def privacy_section() -> str:
    start = README.index("## Privacy")
    end = README.index("## AI disclosure")
    return README[start:end]


def test_privacy_section_says_assemblyai_is_asked_to_delete() -> None:
    section = privacy_section()
    assert "`DELETE /v2/transcript/{id}`" in section
    assert "asks AssemblyAI to delete" in section
    assert "Deepgram" in section, "the other provider's retention is still named"


def test_how_it_works_step_three_names_the_delete() -> None:
    start = README.index("## How it works")
    end = README.index("### API")
    assert "asks AssemblyAI to delete" in README[start:end]


def test_readme_no_longer_claims_nothing_is_stored_on_the_server() -> None:
    assert "No accounts, nothing stored on the server" not in README
    assert "Guests need no account." in README
