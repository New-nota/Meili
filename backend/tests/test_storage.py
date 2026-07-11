"""S9 WP-D: валидация загрузки в R2 (services/storage.py). Сеть не нужна —
валидация срабатывает до обращения к R2."""
import io

import pytest
from unittest.mock import patch

from app.services import storage
from app.services.storage import MAX_IMAGE_BYTES, StorageError, upload_image


def test_not_configured_gives_501():
    with pytest.raises(StorageError) as e:
        upload_image(io.BytesIO(b"x"), "avatars/u/a.png", "image/png", 10)
    assert e.value.code == "storage_not_configured"
    assert e.value.status_code == 501


def _configured():
    return patch.multiple(
        storage.settings,
        R2_ENDPOINT="https://r2.example",
        R2_BUCKET="wanderown",
        R2_ACCESS_KEY="k",
        R2_SECRET_KEY="s",
        R2_PUBLIC_BASE_URL="https://cdn.example",
    )


def test_rejects_non_image():
    with _configured():
        with pytest.raises(StorageError) as e:
            upload_image(io.BytesIO(b"x"), "k", "application/pdf", 10)
    assert e.value.code == "avatar_bad_type"


def test_rejects_oversized_file():
    with _configured():
        with pytest.raises(StorageError) as e:
            upload_image(io.BytesIO(b"x"), "k", "image/png", MAX_IMAGE_BYTES + 1)
    assert e.value.code == "avatar_too_large"


def test_uploads_and_returns_public_url():
    fake_client = type("C", (), {"upload_fileobj": lambda *a, **kw: None})()
    with _configured():
        with patch.object(storage, "_client", return_value=fake_client):
            url = upload_image(
                io.BytesIO(b"png"), "avatars/u1/abc.png", "image/png", 3
            )
    assert url == "https://cdn.example/avatars/u1/abc.png"
