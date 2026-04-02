"""Shared fixtures for worker tests."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure env vars are set so imports don't blow up."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_AI_API_KEY", "test-google-key")


@pytest.fixture()
def mock_supabase() -> MagicMock:
    """Return a mock Supabase client and patch get_supabase_client."""
    client = MagicMock()
    with patch("utils.supabase_client.get_supabase_client", return_value=client):
        yield client


def _chain_mock(client: MagicMock, table_name: str, data: list | dict | None = None, count: int | None = None) -> MagicMock:
    """Helper to set up chained Supabase query mock.

    Usage:
        _chain_mock(mock_supabase, "topics", data={"id": "t1", "status": "emerging"})
    """
    table = MagicMock()
    client.table.return_value = table

    # Every chained method returns the same mock so .select().eq().execute() works
    chain = MagicMock()
    table.select.return_value = chain
    table.insert.return_value = chain
    table.update.return_value = chain

    for method in ("eq", "neq", "gte", "lte", "gt", "lt", "in_", "order", "limit", "single", "is_"):
        getattr(chain, method).return_value = chain

    result = MagicMock()
    result.data = data
    result.count = count
    chain.execute.return_value = result

    return table
