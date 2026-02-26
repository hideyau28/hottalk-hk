from __future__ import annotations

import re
from typing import Optional

import structlog

from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# Module-level cache
_alias_to_canonical: dict[str, str] = {}
_pattern: Optional[re.Pattern[str]] = None


def _load_entities() -> None:
    """Load entities from Supabase and build lookup + regex pattern."""
    global _alias_to_canonical, _pattern

    supabase = get_supabase_client()
    result = supabase.table("entities").select("canonical, aliases").execute()

    mapping: dict[str, str] = {}
    for row in result.data:
        canonical: str = row["canonical"]
        aliases: list[str] = row["aliases"]
        for alias in aliases:
            mapping[alias.lower()] = canonical

    # Sort by length descending so longest match wins (e.g. "港鐵公司" before "港鐵")
    sorted_aliases = sorted(mapping.keys(), key=len, reverse=True)

    if sorted_aliases:
        escaped = [re.escape(a) for a in sorted_aliases]
        _pattern = re.compile("|".join(escaped), re.IGNORECASE)
    else:
        _pattern = None

    _alias_to_canonical = mapping
    logger.info("entities_loaded", count=len(mapping))


def refresh_entity_cache() -> None:
    """Reload entities from DB. Can be called by admin trigger."""
    _load_entities()


def _ensure_loaded() -> None:
    """Lazy-load entities on first use."""
    if not _alias_to_canonical:
        _load_entities()


def normalize_text(text: str) -> str:
    """Replace all known aliases with their canonical form.

    Uses longest-match-first strategy via sorted regex alternation.
    Case-insensitive matching. Original text casing preserved for
    non-matched portions.
    """
    _ensure_loaded()

    if _pattern is None:
        return text

    def _replace(match: re.Match[str]) -> str:
        matched = match.group(0).lower()
        return _alias_to_canonical.get(matched, match.group(0))

    return _pattern.sub(_replace, text)


def build_normalized_text(title: str, description: str | None) -> str:
    """Build the normalized text used for embedding.

    Combines title + first 200 chars of description, then applies
    entity normalization. Original title/description are NOT modified.
    """
    parts = [title]
    if description:
        parts.append(description[:200])
    combined = " ".join(parts)
    return normalize_text(combined)
