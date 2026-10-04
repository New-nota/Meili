from datetime import datetime, timedelta
from uuid import uuid4

import structlog
import jwt
from jwt import PyJWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.core.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class RefreshTokenError(Exception):
    """Refresh-токен невалиден: подпись/срок/тип."""


def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_refresh_token(user_id: str) -> tuple[str, str]:
    """Возвращает (token, jti). jti хранится в Redis — им управляется отзыв."""
    jti = uuid4().hex
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "jti": jti, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), jti

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except PyJWTError:
        return None

def decode_refresh_token(token: str) -> dict:
    """Проверяет подпись, exp и type == 'refresh'; иначе RefreshTokenError."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except PyJWTError as e:
        raise RefreshTokenError(f"invalid refresh token: {e}") from e
    if payload.get("type") != "refresh":
        raise RefreshTokenError("token is not a refresh token")
    if not payload.get("sub") or not payload.get("jti"):
        raise RefreshTokenError("refresh token missing sub/jti")
    return payload

async def get_current_user(
       request: Request,
        db: AsyncSession = Depends(get_db),
):
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise credentials_error

    token = auth_header.split(" ")[1]
    payload = decode_token(token)
    if payload is None:
        raise credentials_error

    # refresh нельзя использовать как access (WP-1)
    if payload.get("type") != "access":
        raise credentials_error

    user_id: str = payload.get("sub")
    if user_id is None:
        raise credentials_error

    from app.models.user import User
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()


    if user is None:
        raise credentials_error

    # user_id попадает во все строки лога этого запроса (WP-0)
    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return user
