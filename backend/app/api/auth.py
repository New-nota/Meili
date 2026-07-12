from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from starlette.responses import RedirectResponse
from app.core.config import settings
from app.core.database import get_db
from app.core.redis import (
    is_refresh_valid,
    revoke_all_refresh,
    revoke_refresh,
    store_refresh,
)
from app.core.security import (
    RefreshTokenError,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"
# cookie отдаётся только на /auth/* — /auth/refresh и /auth/logout
REFRESH_COOKIE_PATH = "/auth"


async def _issue_tokens(response: Response, user: User) -> TokenResponse:
    """Выдать пару токенов: access — в тело, refresh — в httpOnly cookie,
    jti refresh-а регистрируется в Redis (WP-1)."""
    access = create_access_token(str(user.id))
    refresh, jti = create_refresh_token(str(user.id))
    await store_refresh(str(user.id), jti)
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path=REFRESH_COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )
    return TokenResponse(access_token=access)


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)

# --- Google OAuth2 (S7) -------------------------------------------------
# Клиент регистрируется лениво: без GOOGLE_CLIENT_ID/SECRET эндпоинты
# отвечают 501, приложение работает как обычно.
oauth = OAuth()

def _google_client():
    client = oauth.create_client("google")
    if client is None and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
        # статические URL вместо metadata-discovery: authorize_redirect
        # не требует похода в сеть
        oauth.register(
            name="google",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            access_token_url="https://oauth2.googleapis.com/token",
            userinfo_endpoint="https://openidconnect.googleapis.com/v1/userinfo",
            jwks_uri="https://www.googleapis.com/oauth2/v3/certs",
            client_kwargs={"scope": "openid email profile"},
        )
        client = oauth.create_client("google")
    return client

@router.post("/register", response_model=TokenResponse)
async def register(
    data: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    # email check
    result = await db.execute(select(User).where(User.email == data.email))
    existing = result.scalar_one_or_none()
    if existing:
        # машинный код — текст локализует фронт (стиль S9 WP-C)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email_taken"
        )
    user = User(
        id=uuid.uuid4(),
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(response, user)

@router.post("/login",response_model=TokenResponse)
async def login(
    data: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    # user.password_hash is None у OAuth-пользователей — им вход по паролю недоступен
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    return await _issue_tokens(response, user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
):
    """Обновление access по refresh-cookie с ротацией refresh (WP-1)."""
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = decode_refresh_token(token)
    except RefreshTokenError:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id, jti = payload["sub"], payload["jti"]

    if not await is_refresh_valid(user_id, jti):
        # переиспользование ротированного/отозванного refresh —
        # подозрение на кражу: отзываем ВСЕ сессии пользователя
        await revoke_all_refresh(user_id)
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh token reuse detected")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="User not found")

    # ротация: старый jti гасим, выдаём новую пару
    await revoke_refresh(user_id, jti)
    return await _issue_tokens(response, user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response):
    """Инвалидирует refresh и чистит cookie (WP-1)."""
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        try:
            payload = decode_refresh_token(token)
            await revoke_refresh(payload["sub"], payload["jti"])
        except RefreshTokenError:
            pass  # битый токен — просто чистим cookie
    _clear_refresh_cookie(response)


@router.get("/google/login")
async def google_login(request: Request):
    """Редирект на страницу согласия Google."""
    client = _google_client()
    if client is None:
        raise HTTPException(
            status_code=501,
            detail="Google OAuth не настроен: задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET",
        )
    redirect_uri = str(request.url_for("google_callback"))
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Google вернул code → обмениваем на профиль, находим/создаём юзера,
    отдаём наш JWT редиректом на фронт."""
    client = _google_client()
    if client is None:
        raise HTTPException(status_code=501, detail="Google OAuth не настроен")

    token = await client.authorize_access_token(request)
    userinfo = token.get("userinfo") or await client.userinfo(token=token)
    email = userinfo.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Google не вернул email")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        # OAuth-пользователь: password_hash=None (модель это позволяет)
        user = User(
            id=uuid.uuid4(),
            email=email,
            password_hash=None,
            name=userinfo.get("name"),
            avatar_url=userinfo.get("picture"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # юзер получает и access (hash во фрагменте URL), и refresh-cookie (WP-1)
    redirect = RedirectResponse(f"{settings.FRONTEND_URL}/auth")
    tokens = await _issue_tokens(redirect, user)
    redirect.headers["location"] = f"{settings.FRONTEND_URL}/auth#token={tokens.access_token}"
    return redirect