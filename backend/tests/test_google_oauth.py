"""Google OAuth2 (app/api/auth.py) — Sprint 7.

Без GOOGLE_CLIENT_ID/SECRET эндпоинты отвечают 501; с ключами
/auth/google/login редиректит на accounts.google.com (без сети —
authorize_url задан статически).
"""
import pytest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def google_unconfigured(monkeypatch):
    """Ревью: «не настроен» надо ЗАДАВАТЬ, а не надеяться на пустой .env.

    Тесты читали живой settings-синглтон, поэтому на машине с реальными
    GOOGLE_* в backend/.env падали на ровном месте. Заодно чистим реестр
    authlib: клиент там кэшируется, и тест-сосед, зарегистрировавший его,
    протекал бы сюда.
    """
    from app.api import auth as auth_module

    monkeypatch.setattr(auth_module.settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(auth_module.settings, "GOOGLE_CLIENT_SECRET", None)
    _reset_oauth_registry()
    yield
    _reset_oauth_registry()


def _reset_oauth_registry() -> None:
    from app.api import auth as auth_module

    auth_module.oauth._registry.pop("google", None)
    auth_module.oauth._clients.pop("google", None)


def test_login_returns_501_when_not_configured(google_unconfigured):
    resp = client.get("/auth/google/login", follow_redirects=False)
    assert resp.status_code == 501
    assert "GOOGLE_CLIENT_ID" in resp.json()["detail"]


def test_callback_returns_501_when_not_configured(google_unconfigured):
    resp = client.get("/auth/google/callback", follow_redirects=False)
    assert resp.status_code == 501


def test_login_redirects_to_google_when_configured():
    from app.api import auth as auth_module

    _reset_oauth_registry()
    with patch.object(auth_module.settings, "GOOGLE_CLIENT_ID", "test-client-id"), \
         patch.object(auth_module.settings, "GOOGLE_CLIENT_SECRET", "test-secret"):
        resp = client.get("/auth/google/login", follow_redirects=False)

    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "client_id=test-client-id" in location
    # state для CSRF-защиты присутствует
    assert "state=" in location
    # callback-URL указывает на наш бэкенд
    assert "google%2Fcallback" in location or "google/callback" in location
