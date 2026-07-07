from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from starlette.responses import RedirectResponse
from app.core.config import settings
from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])

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

@router.post("/register", response_model=UserResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # email check
    result = await db.execute(select(User).where(User.email == data.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
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
    return user

@router.post("/login",response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    # user.password_hash is None у OAuth-пользователей — им вход по паролю недоступен
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    access_token = create_access_token(str(user.id))
    return TokenResponse(access_token=access_token)


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

    access_token = create_access_token(str(user.id))
    return RedirectResponse(f"{settings.FRONTEND_URL}/auth#token={access_token}")