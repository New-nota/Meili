import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { apiFetch, API_URL, setAccessToken, ApiError } from "../api/client"
import LanguageSwitcher from "../components/LanguageSwitcher"
import HermodLogo from "../components/HermodLogo"
import { apiErrorMessage } from "../utils/apiError"

// Вход и регистрация. S14: жёсткий гейт — register шлёт 6-значный код на
// почту (юзер в БД не создаётся), токены выдаёт только /auth/verify.
type Mode = 'login' | 'register' | 'verify'

const RESEND_COOLDOWN_S = 60
// грубая проверка формы адреса — точную делает бэкенд (EmailStr)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Auth() {
    const { t } = useTranslation()
    const [mode, setMode] = useState<Mode>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [code, setCode] = useState('')
    // возврат из Google с ошибкой (#error=oauth_failed) — сразу в начальное состояние
    const [error, setError] = useState<string | null>(
        () => /error=oauth_failed/.test(window.location.hash) ? t('errors.oauth_failed') : null,
    )
    const [busy, setBusy] = useState(false)
    // отсчёт до следующего «выслать заново»
    const [resendIn, setResendIn] = useState(0)
    const timerRef = useRef<number | undefined>(undefined)
    const navigate = useNavigate()

    // возврат из Google OAuth: бэкенд редиректит на /auth#token=<jwt>
    // (или #error=oauth_failed — отмена/сбой на стороне Google, QA)
    useEffect(() => {
        const match = window.location.hash.match(/token=([^&]+)/)
        if (match) {
            setAccessToken(match[1])
            window.history.replaceState(null, '', window.location.pathname)
            navigate('/discover')
        } else if (/error=oauth_failed/.test(window.location.hash)) {
            window.history.replaceState(null, '', window.location.pathname)
        }
    }, [navigate])

    useEffect(() => () => window.clearInterval(timerRef.current), [])

    const startResendTimer = () => {
        setResendIn(RESEND_COOLDOWN_S)
        window.clearInterval(timerRef.current)
        timerRef.current = window.setInterval(() => {
            setResendIn(prev => {
                if (prev <= 1) { window.clearInterval(timerRef.current); return 0 }
                return prev - 1
            })
        }, 1000)
    }

    const switchMode = (next: Mode) => {
        setMode(next)
        setError(null)
    }

    // машинный код ошибки с бэка -> локализованный текст (стиль S9 WP-C)
    const showApiError = (e: unknown) => setError(apiErrorMessage(e, t))

    const handleSubmit = async (ev?: React.FormEvent) => {
        ev?.preventDefault()
        if (busy) return
        setError(null)
        // QA: пустой сабмит уходил на бэк и возвращался как «неверный пароль»
        if (!email.trim() || !password) {
            setError(t('auth.fillAll'))
            return
        }
        if (!EMAIL_RE.test(email.trim())) {
            setError(t('auth.invalidEmail'))
            return
        }
        if (mode === 'register' && password.length < 8) {
            setError(t('auth.passwordMin'))
            return
        }
        setBusy(true)
        try {
            if (mode === 'login') {
                const data = await apiFetch<{ access_token: string }>('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password }),
                })
                setAccessToken(data.access_token)
                navigate('/discover')
            } else {
                // S14: register -> код на почту, переходим к вводу кода
                await apiFetch('/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({ email, password, name: name || null }),
                })
                setCode('')
                switchMode('verify')
                startResendTimer()
            }
        } catch (e) {
            // «неверный пароль» — только на настоящий 401; лежащий бэк / 429 /
            // 5xx раньше тоже выдавались за опечатку в пароле
            if (mode === 'login' && e instanceof ApiError && e.status === 401) {
                setError(t('auth.invalidCredentials'))
            } else {
                showApiError(e)
            }
        } finally {
            setBusy(false)
        }
    }

    const handleVerify = async () => {
        if (busy) return
        if (code.length !== 6) {
            setError(t('auth.codeSixDigits'))
            return
        }
        setError(null)
        setBusy(true)
        try {
            const data = await apiFetch<{ access_token: string }>('/auth/verify', {
                method: 'POST',
                body: JSON.stringify({ email, code }),
            })
            setAccessToken(data.access_token)
            navigate('/discover')
        } catch (e) {
            showApiError(e)
        } finally {
            setBusy(false)
        }
    }

    const handleResend = async () => {
        setError(null)
        try {
            await apiFetch('/auth/resend-code', {
                method: 'POST',
                body: JSON.stringify({ email }),
            })
            startResendTimer()
        } catch (e) {
            showApiError(e)
        }
    }

    const shell = (children: React.ReactNode) => (
        <div className="auth">
            <div style={{ position: 'absolute', top: 16, right: 16 }}>
                <LanguageSwitcher />
            </div>
            <div className="auth-col">
                <HermodLogo size={56} withWordmark vertical />
                {children}
            </div>
        </div>
    )

    // --- Экран ввода кода (S14) ---------------------------------------------
    if (mode === 'verify') {
        return shell(
            <>
                <h1 className="auth-title">{t('auth.verifyTitle')}</h1>
                <p style={{ fontSize: 15, color: 'var(--ink-2)', textAlign: 'center' }}>
                    {t('auth.codeSentTo', { email })}
                </p>

                <input placeholder="••••••" value={code} inputMode="numeric" autoFocus className="input"
                    aria-label={t('auth.codeSixDigits')} autoComplete="one-time-code"
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => e.key === 'Enter' && handleVerify()}
                    style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 22, height: 56, fontWeight: 600 }} />

                {error && <p role="alert" className="error-text">{error}</p>}

                <button type="button" onClick={handleVerify} disabled={busy} className="btn btn-primary btn-lg btn-block">
                    {t('auth.confirm')}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <button type="button" onClick={() => switchMode('register')} className="link-btn" style={{ color: 'var(--ink-2)' }}>
                        {t('common.back')}
                    </button>
                    <button type="button" onClick={handleResend} disabled={resendIn > 0} className="link-btn">
                        {resendIn > 0 ? t('auth.resendIn', { s: resendIn }) : t('auth.resend')}
                    </button>
                </div>
            </>,
        )
    }

    return shell(
        <>
            <h1 className="auth-title">{mode === 'login' ? t('auth.signIn') : t('auth.signUp')}</h1>

            {/* QA: настоящая <form> — Enter из любого поля, менеджеры паролей
                и автозаполнение браузера (раньше Enter работал только в пароле) */}
            <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 10, width: '100%' }}>
                <input placeholder={t('auth.email')} value={email} type="email" className="input"
                    aria-label={t('auth.email')}
                    name="email" autoComplete={mode === 'login' ? 'username' : 'email'}
                    onChange={e => setEmail(e.target.value)} />
                {mode === 'register' && (
                    <input placeholder={t('auth.nameOptional')} value={name} className="input"
                        aria-label={t('auth.nameOptional')}
                        name="name" autoComplete="name" maxLength={100}
                        onChange={e => setName(e.target.value)} />
                )}
                <input placeholder={t('auth.password')} type="password" value={password} className="input"
                    aria-label={t('auth.password')}
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    onChange={e => setPassword(e.target.value)} />
                {mode === 'register' && (
                    <p className="field-hint">{t('auth.passwordMin')}</p>
                )}

                {error && <p role="alert" className="error-text">{error}</p>}

                <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
                    {mode === 'login' ? t('auth.signIn') : t('auth.signUp')}
                </button>
            </form>

            {/* Google OAuth (S7): бэкенд ответит 501, если ключи не настроены */}
            <button type="button" onClick={() => { window.location.href = `${API_URL}/auth/google/login` }}
                className="btn btn-lg btn-block" style={{ background: 'var(--raised)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                {t('auth.googleSignIn')}
            </button>

            {/* переключение вход <-> регистрация */}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} className="link-btn">
                {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
            </button>
        </>,
    )
}
