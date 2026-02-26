import hashlib
import hmac
import os
from typing import Optional

from fastapi import Request


async def verify_qstash_signature(request: Request) -> bool:
    """Verify QStash webhook signature."""
    signature = request.headers.get("upstash-signature")
    if not signature:
        return False

    current_key = os.environ.get("QSTASH_CURRENT_SIGNING_KEY")
    next_key = os.environ.get("QSTASH_NEXT_SIGNING_KEY")

    if not current_key or not next_key:
        return False

    body = await request.body()

    for key in [current_key, next_key]:
        expected = hmac.new(
            key.encode(), body, hashlib.sha256
        ).hexdigest()
        if hmac.compare_digest(signature, expected):
            return True

    return False
