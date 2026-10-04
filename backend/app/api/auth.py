from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from starlette.responses import RedirectResponse
from app.core.config import settings
from app.core.database import get_db
from app.core.i18n import Lang, get_lang
from app.core.redis import (
    CODE_TTL,
    MAX_CODE_ATTEMPTS,
    clear_login_fails,
    clear_register_quota,
    clear_resend_cooldown,
    consume_refresh,
    delete_pending_registration,
    get_pending_registration,
    login_blocked,
    register_login_fail,
    revoke_all_refresh,
    revoke_refresh,
    save_pending_registration,
    start_resend_cooldown,
    store_pending_registration,
    take_register_slot,
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
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    ResendRequest,
    TokenResponse,
    VerifyRequest,
)
from app.services.email import send_registration_code
import logging
import secrets
import time
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("meili.auth")

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


def _cookie_clearing_headers() -> dict[str, str]:
    """Ревью: заголовки Set-Cookie для УДАЛЕНИЯ refresh-куки в ответе-ошибке.

    Инъектированный `Response` FastAPI сливает в ответ только на успешном
    возврате: после `raise HTTPException` его заголовки теряются, и битая
    кука оставалась в браузере навсегда (фронт молча ретраил мёртвый refresh).
    Собираем заголовок тем же starlette-кодом и отдаём его исключению.
    """
    probe = Response()
    _clear_refresh_cookie(probe)
    return {"set-cookie": probe.headers["set-cookie"]}


def _unauthorized(detail: str, *, clear_cookie: bool = False) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers=_cookie_clearing_headers() if clear_cookie else None,
    )

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

# --- S14: регистрация по коду на почту (жёсткий гейт) -------------------------
# До подтверждения кода User в БД не создаётся: черновик живёт в Redis (TTL 1ч).
# Повторный register на неподтверждённый email просто перезаписывает черновик
# новым кодом — реальный владелец почты всегда может «перехватить» регистрацию.

def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@router.post("/register", response_model=RegisterResponse)
async def register(
    data: RegisterRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    lang: Lang = Depends(get_lang),
):
    # занят только ПОДТВЕРЖДЁННЫЙ юзер (в БД все такие — S14)
    result = await db.execute(select(User).where(func.lower(User.email) == data.email))
    if result.scalar_one_or_none():
        # машинный код — текст локализует фронт (стиль S9 WP-C)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email_taken"
        )
    # Ревью: без троттла любой мог долбить /auth/register на чужой адрес
    # (спам письмами) и жечь наш CPU на bcrypt — ручка публичная. Именно
    # квота, а не кулдаун: S14 нарочно разрешает повторный register на
    # неподтверждённый адрес, чтобы владелец почты перехватил регистрацию.
    # Считаем ДО хеширования — иначе bcrypt отработает зря.
    if not await take_register_slot(data.email):
        raise HTTPException(status_code=429, detail="too_many_registrations")
    code = _new_code()
    await store_pending_registration(
        data.email, hash_password(data.password), data.name, code
    )
    # Ревью: письмо уходит ФОНОМ. send_email и так best-effort (ошибку глотает,
    # результат никто не читает), но ждали мы его прямо в запросе — с лежащим
    # SMTP каждая регистрация висела на таймаут сокета (10 с) на ровном месте.
    # dev без SMTP: код уходит в лог (docker logs backend)
    background.add_task(send_registration_code, data.email, code, lang)
    return RegisterResponse()


@router.post("/verify", response_model=TokenResponse)
async def verify(
    data: VerifyRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    pending = await get_pending_registration(data.email)
    if pending is None:
        raise HTTPException(status_code=400, detail="no_pending_registration")
    if pending["attempts"] >= MAX_CODE_ATTEMPTS:
        # код сгорел от перебора — нужен resend
        raise HTTPException(status_code=400, detail="too_many_attempts")
    if time.time() > pending["code_expires"]:
        raise HTTPException(status_code=400, detail="code_expired")
    if not secrets.compare_digest(pending["code"], data.code):
        pending["attempts"] += 1
        await save_pending_registration(data.email, pending)
        raise HTTPException(status_code=400, detail="invalid_code")

    # код верный → создаём настоящего юзера (гонка: email могли занять)
    result = await db.execute(select(User).where(func.lower(User.email) == data.email))
    if result.scalar_one_or_none():
        await delete_pending_registration(data.email)
        await clear_resend_cooldown(data.email)
        await clear_register_quota(data.email)
        raise HTTPException(status_code=400, detail="email_taken")
    user = User(
        id=uuid.uuid4(),
        email=data.email,
        password_hash=pending["password_hash"],
        name=pending["name"],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await delete_pending_registration(data.email)
    await clear_resend_cooldown(data.email)
    await clear_register_quota(data.email)
    return await _issue_tokens(response, user)


@router.post("/resend-code", response_model=RegisterResponse)
async def resend_code(
    data: ResendRequest,
    background: BackgroundTasks,
    lang: Lang = Depends(get_lang),
):
    pending = await get_pending_registration(data.email)
    if pending is None:
        raise HTTPException(status_code=400, detail="no_pending_registration")
    if not await start_resend_cooldown(data.email):
        raise HTTPException(status_code=429, detail="resend_cooldown")
    pending["code"] = _new_code()
    pending["code_expires"] = time.time() + CODE_TTL
    pending["attempts"] = 0
    await save_pending_registration(data.email, pending)
    background.add_task(send_registration_code, data.email, pending["code"], lang)
    return RegisterResponse()

@router.post("/login",response_model=TokenResponse)
async def login(
    data: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
):
    ip = request.client.host if request.client else "unknown"
    # QA: перебор паролей — до bcrypt, чтобы заблокированный не жёг CPU
    if await login_blocked(data.email, ip):
        raise HTTPException(status_code=429, detail="too_many_login_attempts")
    result = await db.execute(select(User).where(func.lower(User.email) == data.email))
    user = result.scalar_one_or_none()
    # user.password_hash is None у OAuth-пользователей — им вход по паролю недоступен
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        await register_login_fail(data.email, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    await clear_login_fails(data.email, ip)
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
        raise _unauthorized("Invalid refresh token", clear_cookie=True)

    user_id, jti = payload["sub"], payload["jti"]

    # ротация: старый jti гасим атомарно (см. consume_refresh — гонка
    # параллельных refresh больше не выкидывает юзера из всех сессий)
    state = await consume_refresh(user_id, jti)
    if state == "invalid":
        # переиспользование давно ротированного/отозванного refresh —
        # подозрение на кражу: отзываем ВСЕ сессии пользователя
        await revoke_all_refresh(user_id)
        raise _unauthorized("Refresh token reuse detected", clear_cookie=True)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise _unauthorized("User not found", clear_cookie=True)

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

    # QA: «Отмена» на экране Google (?error=access_denied), протухший/чужой
    # state (кука сессии потерялась) или сбой обмена кода — раньше голый 500
    # JSON на домене API. Теперь назад на страницу входа с машинным кодом.
    try:
        token = await client.authorize_access_token(request)
        userinfo = token.get("userinfo") or await client.userinfo(token=token)
    except Exception as e:  # noqa: BLE001 — любые сбои OAuth одинаково ведут на /auth
        logger.warning("google_oauth_failed error=%s", f"{type(e).__name__}: {e}"[:200])
        return RedirectResponse(f"{settings.FRONTEND_URL}/auth#error=oauth_failed")
    email = (userinfo.get("email") or "").strip().lower()
    if not email:
        return RedirectResponse(f"{settings.FRONTEND_URL}/auth#error=oauth_failed")

    # QA: тот же регистронезависимый поиск, что и в логине по паролю
    result = await db.execute(select(User).where(func.lower(User.email) == email))
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