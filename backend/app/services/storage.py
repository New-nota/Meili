"""Единый загрузчик файлов поверх Cloudflare R2 (S3-совместимый) — S9 WP-D.

Через него грузятся аватары; фото мест в дальнейшем грузить через этот же
сервис — единая точка загрузки.

Без R2_* в .env сервис не сконфигурирован: эндпоинты отвечают 501
(код storage_not_configured) — как с Google OAuth.
"""
import boto3

from app.core.config import settings

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 МБ


class StorageError(Exception):
    """code — машинный код для фронта (S9 WP-C), текст локализует он."""

    def __init__(self, code: str, status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def is_configured() -> bool:
    return all([
        settings.R2_ENDPOINT,
        settings.R2_BUCKET,
        settings.R2_ACCESS_KEY,
        settings.R2_SECRET_KEY,
        settings.R2_PUBLIC_BASE_URL,
    ])


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY,
        aws_secret_access_key=settings.R2_SECRET_KEY,
    )


def upload_image(fileobj, key: str, content_type: str, size: int) -> str:
    """Загрузить картинку, вернуть публичный URL.

    Валидация: только image/*, не больше 5 МБ.
    """
    if not is_configured():
        raise StorageError("storage_not_configured", status_code=501)
    if not content_type or not content_type.startswith("image/"):
        raise StorageError("avatar_bad_type")
    if size > MAX_IMAGE_BYTES:
        raise StorageError("avatar_too_large")

    _client().upload_fileobj(
        fileobj,
        settings.R2_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{settings.R2_PUBLIC_BASE_URL}/{key}"
