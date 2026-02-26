"""Sensitive keyword filter — checks text against sensitive_keywords table.

Also includes PII regex filters (phone, HKID, address patterns).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import structlog

from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# Module-level cache
_keywords: list[dict[str, str]] = []
_loaded: bool = False

# PII regex patterns
_PII_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("phone_hk", re.compile(r"\b[2-9]\d{7}\b")),  # HK phone: 8 digits starting 2-9
    ("phone_mobile", re.compile(r"\b[569]\d{3}[\s-]?\d{4}\b")),  # HK mobile
    ("hkid", re.compile(r"\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?\b", re.IGNORECASE)),  # HKID
]


@dataclass
class SensitiveResult:
    is_sensitive: bool = False
    action: str = "none"  # 'block_summary' | 'block_topic' | 'flag_only' | 'none'
    matched_keywords: list[str] = field(default_factory=list)
    matched_pii: list[str] = field(default_factory=list)


def _load_keywords() -> None:
    global _keywords, _loaded
    supabase = get_supabase_client()
    result = (
        supabase.table("sensitive_keywords")
        .select("keyword, action")
        .eq("is_active", True)
        .execute()
    )
    _keywords = result.data or []
    _loaded = True
    logger.info("sensitive_keywords_loaded", count=len(_keywords))


def refresh_sensitive_cache() -> None:
    """Reload keywords from DB."""
    _load_keywords()


def _ensure_loaded() -> None:
    if not _loaded:
        _load_keywords()


def check_sensitive(text: str) -> SensitiveResult:
    """Check text for sensitive keywords and PII patterns.

    Returns the most restrictive action found.
    Priority: block_topic > block_summary > flag_only > none.
    """
    _ensure_loaded()

    result = SensitiveResult()
    text_lower = text.lower()

    # Check keywords
    action_priority = {"block_topic": 3, "block_summary": 2, "flag_only": 1, "none": 0}
    max_priority = 0

    for entry in _keywords:
        keyword = entry["keyword"].lower()
        action = entry.get("action", "block_summary")
        if keyword in text_lower:
            result.is_sensitive = True
            result.matched_keywords.append(entry["keyword"])
            priority = action_priority.get(action, 0)
            if priority > max_priority:
                max_priority = priority
                result.action = action

    # Check PII
    for pii_name, pattern in _PII_PATTERNS:
        if pattern.search(text):
            result.is_sensitive = True
            result.matched_pii.append(pii_name)
            if max_priority < action_priority["flag_only"]:
                result.action = "flag_only"

    return result
