from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, EmailStr, Field, field_validator
from uuid import UUID

# QA: email — регистронезависимый идентификатор. EmailStr приводит к нижнему
# регистру только домен, локальную часть оставляет как ввели: «QA@x.dev» и
# «qa@x.dev» становились РАЗНЫМИ аккаунтами (unique-индекс регистрозависимый),
# логин падал на другом регистре, а черновик регистрации в Redis уже ключевался
# по lower() — один и тот же ящик мог завести два аккаунта. Нормализуем на входе
# всех auth-ручек: strip (автозаполнение любит хвостовой пробел) + lower.
NormalizedEmail = Annotated[
    EmailStr,
    BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v),
    AfterValidator(lambda v: v.lower()),
]
# имя — свободный текст, но без потолка в БД улетало бы хоть 10 МБ
NAME_MAX_LEN = 100
# Ревью: bcrypt режет пароль на 72 БАЙТАХ молча — без верхней границы юзер
# с длинным паролем логинился бы первыми 72 байтами и не знал об этом.
# Кап по символам (не байтам) заведомо строже: 72 символа <= 72 байт только
# для ASCII, поэтому дополнительно проверяем закодированную длину.
MAX_PASSWORD_BYTES = 72


def _password_fits_bcrypt(v: str) -> str:
    if len(v.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes")
    return v


class RegisterRequest(BaseModel):
    email: NormalizedEmail
    # минимум 8 символов — согласовано со сменой пароля в профиле (S9)
    password: str = Field(min_length=8)
    name: str | None = Field(default=None, max_length=NAME_MAX_LEN)

    @field_validator("name")
    @classmethod
    def _blank_name_is_none(cls, v: str | None) -> str | None:
        # «   » — не имя: иначе в профиле и аватарке рисовалась пустота
        v = v.strip() if v is not None else None
        return v or None

    _pw_len = field_validator("password")(_password_fits_bcrypt)

class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: str

# --- S14: регистрация по коду на почту ---------------------------------------

class RegisterResponse(BaseModel):
    # токенов нет — они выдаются только после /auth/verify
    status: str = "code_sent"

class VerifyRequest(BaseModel):
    email: NormalizedEmail
    # Ревью: ровно 6 ЦИФР. Без pattern сюда пролезала не-ASCII строка, а
    # secrets.compare_digest на такой падает TypeError -> 500 на публичной ручке.
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")

class ResendRequest(BaseModel):
    email: NormalizedEmail

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str | None

    class Config:
        from_attributes = True