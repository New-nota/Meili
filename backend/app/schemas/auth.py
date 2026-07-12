from pydantic import BaseModel, EmailStr, Field
from uuid import UUID
class RegisterRequest(BaseModel):
    email: EmailStr
    # минимум 8 символов — согласовано со сменой пароля в профиле (S9)
    password: str = Field(min_length=8)
    name: str | None = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str | None

    class Config:
        from_attributes = True