import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { apiFetch, API_URL, setAccessToken, ApiError } from "../api/client"
import LanguageSwitcher from "../components/LanguageSwitcher"
import Logo from "../components/Logo"

// Вход и регистрация (без верификации почты — она отложена; бэкенд
// сразу выдаёт access + refresh-cookie, письмо-подтверждение — позже).
type Mode = 'login' | 'register'

export default function Auth() {
    const { t } = useTranslation()
    const [mode, setMode] = useState<Mode>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
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

    const switchMode = (next: Mode) => {
        setMode(next)
        setError(null)
    }

    const handleSubmit = async () => {
        setError(null)
        if (mode === 'register' && password.length < 8) {
            setError(t('auth.passwordMin'))
            return
        }
        setBusy(true)
        try {
            const path = mode === 'login' ? '/auth/login' : '/auth/register'
            const body = mode === 'login'
                ? { email, password }
                : { email, password, name: name || null }
            const data = await apiFetch<{ access_token: string }>(path, {
                method: 'POST',
                body: JSON.stringify(body),
            })
            setAccessToken(data.access_token)
            navigate('/discover')
        } catch (e) {
            if (mode === 'login') {
                setError(t('auth.invalidCredentials'))
            } else {
                // регистрация: код с бэка (email_taken) или общая ошибка
                const code = e instanceof ApiError
                    ? (e.body as { detail?: string })?.detail : undefined
                setError(typeof code === 'string'
                    ? t(`errors.${code}`, t('common.error'))
                    : t('common.error'))
            }
        } finally {
            setBusy(false)
        }
    }

    const inputStyle: React.CSSProperties = {
        padding: 8, width: 280, maxWidth: '85vw',
        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'var(--surface-raised)',
    }

    return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, gap: 12}}>
            <div style={{position: 'absolute', top: 16, right: 16}}>
                <LanguageSwitcher />
            </div>
            <Logo size={64} withWordmark vertical />
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
