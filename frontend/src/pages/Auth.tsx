import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { apiFetch, API_URL, setAccessToken, ApiError } from "../api/client"
import LanguageSwitcher from "../components/LanguageSwitcher"
import HermodLogo from "../components/HermodLogo"

// Вход и регистрация. S14: жёсткий гейт — register шлёт 6-значный код на
// почту (юзер в БД не создаётся), токены выдаёт только /auth/verify.
type Mode = 'login' | 'register' | 'verify'

const RESEND_COOLDOWN_S = 60

export default function Auth() {
    const { t } = useTranslation()
    const [mode, setMode] = useState<Mode>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [code, setCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    // отсчёт до следующего «выслать заново»
    const [resendIn, setResendIn] = useState(0)
    const timerRef = useRef<number | undefined>(undefined)
    const navigate = useNavigate()

    // возврат из Google OAuth: бэкенд редиректит на /auth#token=<jwt>
    useEffect(() => {
        const match = window.location.hash.match(/token=([^&]+)/)
        if (match) {
            setAccessToken(match[1])
            window.history.replaceState(null, '', window.location.pathname)
            navigate('/discover')
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
    const showApiError = (e: unknown) => {
        const detail = e instanceof ApiError
            ? (e.body as { detail?: string })?.detail : undefined
        setError(typeof detail === 'string'
            ? t(`errors.${detail}`, t('common.error'))
            : t('common.error'))
    }

    const handleSubmit = async () => {
        setError(null)
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
            if (mode === 'login') {
                setError(t('auth.invalidCredentials'))
            } else {
                showApiError(e)
            }
        } finally {
            setBusy(false)
        }
    }

    const handleVerify = async () => {
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

            <input placeholder={t('auth.email')} value={email}
                onChange={e => setEmail(e.target.value)} style={inputStyle} />
            {mode === 'register' && (
                <input placeholder={t('auth.nameOptional')} value={name}
                    onChange={e => setName(e.target.value)} style={inputStyle} />
            )}
            <input placeholder={t('auth.password')} type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={inputStyle} />
            {mode === 'register' && (
                <p style={{fontSize: 12, color: 'var(--text-muted)', margin: 0}}>
                    {t('auth.passwordMin')}
                </p>
            )}

            {error && <p style={{color: 'var(--accent)', fontSize: 13}}>{error}</p>}

            <button onClick={handleSubmit} disabled={busy}
            style={{padding: '8px 24px', background: busy ? 'var(--text-muted)' : 'var(--accent)',
                color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius)',
                cursor: busy ? 'wait' : 'pointer', fontWeight: 500}}>
                {mode === 'login' ? t('auth.signIn') : t('auth.signUp')}
            </button>

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
