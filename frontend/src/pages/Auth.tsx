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

    const inputStyle: React.CSSProperties = {
        padding: 8, width: 280, maxWidth: '85vw',
        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'var(--surface-raised)',
    }

    // --- Экран ввода кода (S14) ---------------------------------------------
    if (mode === 'verify') {
        return (
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, gap: 12}}>
                <div style={{position: 'absolute', top: 16, right: 16}}>
                    <LanguageSwitcher />
                </div>
                <HermodLogo size={64} withWordmark vertical />
                <h2>{t('auth.verifyTitle')}</h2>
                <p style={{fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: 300, textAlign: 'center'}}>
                    {t('auth.codeSentTo', { email })}
                </p>

                <input placeholder="••••••" value={code} inputMode="numeric" autoFocus
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => e.key === 'Enter' && handleVerify()}
                    style={{...inputStyle, textAlign: 'center', letterSpacing: 8,
                        fontSize: 20, fontVariantNumeric: 'tabular-nums', width: 200}} />

                {error && <p style={{color: 'var(--accent)', fontSize: 13}}>{error}</p>}

                <button onClick={handleVerify} disabled={busy}
                    style={{padding: '8px 24px', background: busy ? 'var(--text-muted)' : 'var(--accent)',
                        color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius)',
                        cursor: busy ? 'wait' : 'pointer', fontWeight: 500}}>
                    {t('auth.confirm')}
                </button>

                <button onClick={handleResend} disabled={resendIn > 0}
                    style={{background: 'none', border: 'none',
                        cursor: resendIn > 0 ? 'default' : 'pointer',
                        color: resendIn > 0 ? 'var(--text-muted)' : 'var(--accent)',
                        fontSize: 13, padding: 0}}>
                    {resendIn > 0
                        ? t('auth.resendIn', { s: resendIn })
                        : t('auth.resend')}
                </button>

                <button onClick={() => switchMode('register')}
                    style={{background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', fontSize: 13, padding: 0}}>
                    {t('common.back')}
                </button>
            </div>
        )
    }

    return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, gap: 12}}>
            <div style={{position: 'absolute', top: 16, right: 16}}>
                <LanguageSwitcher />
            </div>
            <HermodLogo size={64} withWordmark vertical />
            <h2>{mode === 'login' ? t('auth.signIn') : t('auth.signUp')}</h2>

            {/* QA: настоящая <form> — Enter из любого поля, менеджеры паролей
                и автозаполнение браузера (раньше Enter работал только в пароле) */}
            <form onSubmit={handleSubmit} noValidate
                style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12}}>
                <input placeholder={t('auth.email')} value={email} type="email"
                    name="email" autoComplete={mode === 'login' ? 'username' : 'email'}
                    onChange={e => setEmail(e.target.value)} style={inputStyle} />
                {mode === 'register' && (
                    <input placeholder={t('auth.nameOptional')} value={name}
                        name="name" autoComplete="name" maxLength={100}
                        onChange={e => setName(e.target.value)} style={inputStyle} />
                )}
                <input placeholder={t('auth.password')} type="password" value={password}
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    onChange={e => setPassword(e.target.value)}
                    style={inputStyle} />
                {mode === 'register' && (
                    <p style={{fontSize: 12, color: 'var(--text-muted)', margin: 0}}>
                        {t('auth.passwordMin')}
                    </p>
                )}

                {error && <p role="alert" style={{color: 'var(--accent)', fontSize: 13, margin: 0}}>{error}</p>}

                <button type="submit" disabled={busy}
                style={{padding: '8px 24px', background: busy ? 'var(--text-muted)' : 'var(--accent)',
                    color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius)',
                    cursor: busy ? 'wait' : 'pointer', fontWeight: 500}}>
                    {mode === 'login' ? t('auth.signIn') : t('auth.signUp')}
                </button>
            </form>

            {/* переключение вход <-> регистрация */}
            <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                style={{background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--accent)', fontSize: 13, padding: 0}}>
                {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
            </button>

            {/* Google OAuth (S7): бэкенд ответит 501, если ключи не настроены */}
            <button onClick={() => { window.location.href = `${API_URL}/auth/google/login` }}
            style={{padding: '8px 24px', background: 'var(--surface-raised)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8}}>
                <span style={{fontWeight: 'bold', color: 'var(--accent)'}}>G</span>
                {t('auth.googleSignIn')}
            </button>
        </div>
    )
}
