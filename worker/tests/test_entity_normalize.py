"""Tests for entity_normalize.py — build_normalized_text."""

from utils.entity_normalize import build_normalized_text


class TestBuildNormalizedText:
    def test_title_only(self) -> None:
        assert build_normalized_text("Hello World") == "Hello World"

    def test_title_and_description(self) -> None:
        result = build_normalized_text("Title", "Description here")
        assert result == "Title Description here"

    def test_description_truncated_at_200(self) -> None:
        long_desc = "a" * 300
        result = build_normalized_text("Title", long_desc)
        assert result == f"Title {'a' * 200}"

    def test_empty_description_ignored(self) -> None:
        result = build_normalized_text("Title", "")
        assert result == "Title"

    def test_whitespace_handling(self) -> None:
        result = build_normalized_text("  Spaced Title  ", "  desc  ")
        assert "Spaced Title" in result
        assert "desc" in result
