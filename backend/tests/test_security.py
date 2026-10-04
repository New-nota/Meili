"""Хеширование паролей и JWT-токены (app/core/security.py)."""
from datetime import timedelta

import jwt

from app.core import security
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_password_is_not_plaintext():
    hashed = hash_password("Frenchfries0728")
    assert hashed != "Frenchfries0728"
    assert hashed.startswith("$2")  # bcrypt-префикс


def test_verify_password_roundtrip():
    hashed = hash_password("correct horse")
    assert verify_password("correct horse", hashed) is True
    assert verify_password("wrong horse", hashed) is False


def test_hash_is_salted():
    # два хеша одного пароля не совпадают (случайная соль)
    assert hash_password("same") != hash_password("same")


def test_access_token_roundtrip():
    token = create_access_token("user-123")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"


def test_refresh_token_has_correct_type():
    token, jti = create_refresh_token("user-42")
    payload = decode_token(token)
    assert payload["sub"] == "user-42"
    assert payload["type"] == "refresh"
    assert payload["jti"] == jti  # jti возвращается и лежит в payload


def test_decode_refresh_rejects_access_token():
    from pytest import raises

    from app.core.security import RefreshTokenError, decode_refresh_token

    with raises(RefreshTokenError):
        decode_refresh_token(create_access_token("user-1"))


def test_decode_refresh_accepts_valid_refresh():
    from app.core.security import decode_refresh_token

    token, jti = create_refresh_token("user-9")
    payload = decode_refresh_token(token)
    assert payload["jti"] == jti


def test_decode_garbage_returns_none():
    assert decode_token("not.a.jwt") is None


def test_decode_wrong_signature_returns_none():
    forged = jwt.encode({"sub": "x"}, "some-other-key", algorithm="HS256")
    assert decode_token(forged) is None


def test_decode_expired_token_returns_none():
    expired = jwt.encode(
        {
            "sub": "u",
            "exp": security.datetime.utcnow() - timedelta(minutes=1),
            "type": "access",
        },
        security.settings.SECRET_KEY,
        algorithm=security.settings.ALGORITHM,
    )
    assert decode_token(expired) is None
