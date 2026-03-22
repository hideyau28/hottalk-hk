def build_normalized_text(title: str, description: str = "") -> str:
    """Stub: v3.2 launch cut - no entity normalization, return raw text."""
    parts = [title]
    if description:
        parts.append(description[:200])
    return " ".join(parts)
