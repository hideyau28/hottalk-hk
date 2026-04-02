"""Tests for summarize.py — pure functions (no DB/API calls)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from jobs.summarize import (
    _build_posts_text,
    _fallback_keywords,
    _normalize_sentiment,
    _parse_llm_response,
)


# ============================================
# _parse_llm_response
# ============================================


class TestParseLLMResponse:
    def test_valid_json(self) -> None:
        text = '{"title": "test", "summary": "hello"}'
        result = _parse_llm_response(text)
        assert result is not None
        assert result["title"] == "test"

    def test_json_in_code_block(self) -> None:
        text = '```json\n{"title": "test"}\n```'
        result = _parse_llm_response(text)
        assert result is not None
        assert result["title"] == "test"

    def test_json_in_plain_code_block(self) -> None:
        text = '```\n{"title": "test"}\n```'
        result = _parse_llm_response(text)
        assert result is not None

    def test_json_with_surrounding_text(self) -> None:
        text = 'Here is the result: {"title": "test", "summary": "hello"} hope that helps!'
        result = _parse_llm_response(text)
        assert result is not None
        assert result["title"] == "test"

    def test_invalid_json_returns_none(self) -> None:
        assert _parse_llm_response("not json at all") is None

    def test_empty_string(self) -> None:
        assert _parse_llm_response("") is None

    def test_nested_json(self) -> None:
        text = json.dumps({
            "title": "test",
            "sentiment": {"positive": 0.5, "negative": 0.3, "neutral": 0.1, "controversial": 0.1},
        })
        result = _parse_llm_response(text)
        assert result is not None
        assert result["sentiment"]["positive"] == 0.5


# ============================================
# _normalize_sentiment
# ============================================


class TestNormalizeSentiment:
    def test_already_normalized(self) -> None:
        s = {"positive": 0.3, "negative": 0.4, "neutral": 0.2, "controversial": 0.1}
        result = _normalize_sentiment(s)
        assert sum(result.values()) == pytest.approx(1.0)

    def test_unnormalized_values(self) -> None:
        s = {"positive": 3, "negative": 4, "neutral": 2, "controversial": 1}
        result = _normalize_sentiment(s)
        assert sum(result.values()) == pytest.approx(1.0)
        assert result["negative"] == pytest.approx(0.4)

    def test_all_zero_defaults_to_neutral(self) -> None:
        s = {"positive": 0, "negative": 0, "neutral": 0, "controversial": 0}
        result = _normalize_sentiment(s)
        assert result["neutral"] == 1.0
        assert result["positive"] == 0.0

    def test_missing_keys(self) -> None:
        s = {"positive": 0.8}
        result = _normalize_sentiment(s)
        assert sum(result.values()) == pytest.approx(1.0)
        assert result["positive"] == pytest.approx(1.0)

    def test_negative_values_clamped(self) -> None:
        s = {"positive": -0.5, "negative": 0.5, "neutral": 0.3, "controversial": 0.2}
        result = _normalize_sentiment(s)
        # negative should be treated as 0
        assert result["positive"] == 0.0
        assert sum(result.values()) == pytest.approx(1.0)

    def test_empty_dict(self) -> None:
        result = _normalize_sentiment({})
        assert result["neutral"] == 1.0


# ============================================
# _build_posts_text
# ============================================


class TestBuildPostsText:
    def test_single_post(self) -> None:
        posts = [{"platform": "youtube", "title": "Test Title", "description": "desc"}]
        text = _build_posts_text(posts)
        assert "1. [youtube] Test Title" in text
        assert "desc" in text

    def test_multiple_posts(self) -> None:
        posts = [
            {"platform": "youtube", "title": "A"},
            {"platform": "lihkg", "title": "B"},
        ]
        text = _build_posts_text(posts)
        assert "1. [youtube] A" in text
        assert "2. [lihkg] B" in text

    def test_max_20_posts(self) -> None:
        posts = [{"platform": "news", "title": f"Title {i}"} for i in range(30)]
        text = _build_posts_text(posts)
        assert "20. [news]" in text
        assert "21." not in text

    def test_description_truncated(self) -> None:
        posts = [{"platform": "youtube", "title": "T", "description": "x" * 300}]
        text = _build_posts_text(posts)
        # Description truncated to 150 chars
        lines = text.split("\n")
        desc_line = [l for l in lines if l.strip().startswith("x")][0]
        assert len(desc_line.strip()) <= 150

    def test_no_description(self) -> None:
        posts = [{"platform": "lihkg", "title": "Title"}]
        text = _build_posts_text(posts)
        lines = [l for l in text.split("\n") if l.strip()]
        assert len(lines) == 1


# ============================================
# _fallback_keywords
# ============================================


class TestFallbackKeywords:
    def test_returns_top_3(self) -> None:
        posts = [
            {"title": "港鐵觀塘線故障 港鐵再出事", "description": "港鐵觀塘線"},
            {"title": "港鐵觀塘線延誤", "description": ""},
        ]
        keywords = _fallback_keywords(posts)
        assert len(keywords) <= 3

    def test_empty_posts(self) -> None:
        keywords = _fallback_keywords([])
        assert keywords == []

    def test_latin_words_extracted(self) -> None:
        posts = [
            {"title": "MTR delay MTR shutdown MTR problem", "description": ""},
        ]
        keywords = _fallback_keywords(posts)
        assert any("mtr" in k.lower() for k in keywords)

    def test_stopwords_filtered(self) -> None:
        posts = [
            {"title": "the and for are this that with", "description": ""},
        ]
        keywords = _fallback_keywords(posts)
        stopwords = {"the", "and", "for", "are", "this", "that", "with"}
        assert all(k not in stopwords for k in keywords)
