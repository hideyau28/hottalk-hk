"""Tests for sensitive_filter.py — PII regex + keyword matching."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from utils.sensitive_filter import (
    SensitiveResult,
    _PII_PATTERNS,
    check_sensitive,
)


# ============================================
# PII regex patterns
# ============================================


class TestPIIPatterns:
    """Test PII regex patterns directly without DB."""

    @pytest.fixture(autouse=True)
    def _reset_cache(self) -> None:
        """Reset module-level keyword cache before each test."""
        import utils.sensitive_filter as sf
        sf._keywords = []
        sf._loaded = True  # pretend loaded so it won't hit DB

    def _find_match(self, name: str, text: str) -> bool:
        for pii_name, pattern in _PII_PATTERNS:
            if pii_name == name:
                return pattern.search(text) is not None
        raise ValueError(f"Unknown PII pattern: {name}")

    # HK phone (8 digits starting 2-9)
    def test_hk_phone_valid(self) -> None:
        assert self._find_match("phone_hk", "call 23456789 now")

    def test_hk_phone_starting_1_rejected(self) -> None:
        assert not self._find_match("phone_hk", "call 12345678 now")

    def test_hk_phone_too_short(self) -> None:
        assert not self._find_match("phone_hk", "call 2345678 now")

    # HK mobile (starts 5/6/9)
    def test_hk_mobile_valid(self) -> None:
        assert self._find_match("phone_mobile", "call 91234567 now")

    def test_hk_mobile_with_dash(self) -> None:
        assert self._find_match("phone_mobile", "call 9123-4567 now")

    def test_hk_mobile_with_space(self) -> None:
        assert self._find_match("phone_mobile", "call 9123 4567 now")

    # HKID
    def test_hkid_single_letter(self) -> None:
        assert self._find_match("hkid", "HKID: A123456(7)")

    def test_hkid_double_letter(self) -> None:
        assert self._find_match("hkid", "AB123456(A)")

    def test_hkid_lowercase(self) -> None:
        assert self._find_match("hkid", "a1234567")

    def test_hkid_no_match_random(self) -> None:
        assert not self._find_match("hkid", "hello world 123")


# ============================================
# check_sensitive (with mocked keywords)
# ============================================


class TestCheckSensitive:
    @pytest.fixture(autouse=True)
    def _load_keywords(self) -> None:
        """Inject test keywords without hitting DB."""
        import utils.sensitive_filter as sf
        sf._keywords = [
            {"keyword": "賭博", "action": "block_topic"},
            {"keyword": "色情", "action": "block_summary"},
            {"keyword": "爭議", "action": "flag_only"},
        ]
        sf._loaded = True

    def test_no_match(self) -> None:
        result = check_sensitive("今日天氣好好")
        assert not result.is_sensitive
        assert result.action == "none"
        assert result.matched_keywords == []

    def test_keyword_match_block_topic(self) -> None:
        result = check_sensitive("網上賭博好危險")
        assert result.is_sensitive
        assert result.action == "block_topic"
        assert "賭博" in result.matched_keywords

    def test_keyword_match_block_summary(self) -> None:
        result = check_sensitive("色情網站被封")
        assert result.is_sensitive
        assert result.action == "block_summary"

    def test_keyword_match_flag_only(self) -> None:
        result = check_sensitive("政策爭議持續")
        assert result.is_sensitive
        assert result.action == "flag_only"

    def test_most_restrictive_action_wins(self) -> None:
        """When multiple keywords match, highest priority action wins."""
        result = check_sensitive("賭博同色情爭議")
        assert result.is_sensitive
        assert result.action == "block_topic"  # highest priority
        assert len(result.matched_keywords) == 3

    def test_pii_phone_detected(self) -> None:
        result = check_sensitive("聯絡 91234567 查詢")
        assert result.is_sensitive
        assert "phone_mobile" in result.matched_pii

    def test_pii_hkid_detected(self) -> None:
        result = check_sensitive("HKID A123456(7) leaked")
        assert result.is_sensitive
        assert "hkid" in result.matched_pii

    def test_keyword_plus_pii(self) -> None:
        """Keyword action takes priority over PII flag_only."""
        result = check_sensitive("賭博 call 91234567")
        assert result.is_sensitive
        assert result.action == "block_topic"
        assert len(result.matched_keywords) >= 1
        assert len(result.matched_pii) >= 1

    def test_case_insensitive_keyword_match(self) -> None:
        """Keywords are matched case-insensitively (Chinese chars are already lowercase)."""
        import utils.sensitive_filter as sf
        sf._keywords = [{"keyword": "NSFW", "action": "block_summary"}]
        result = check_sensitive("this is nsfw content")
        assert result.is_sensitive
