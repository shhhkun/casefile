"""Tests for the FastAPI service (skipped when FastAPI is not installed)."""

import pytest

fastapi = pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from casefile.api.server import app  # noqa: E402

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_missing_url_returns_422():
    """Pydantic validation returns 422 for a missing required `url` field."""
    response = client.post("/analyze", json={})
    assert response.status_code == 422


def test_analyze_with_empty_url():
    response = client.post("/analyze", json={"url": ""})
    assert response.status_code == 400
    assert response.json() == {"detail": "URL is required"}