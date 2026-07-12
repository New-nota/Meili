import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { apiFetch, API_URL, setAccessToken } from "../api/client"
import LanguageSwitcher from "../components/LanguageSwitcher"
import Logo from "../components/Logo"

export default function Auth() {
    const { t } = useTranslation()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
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

    const handleLogin = async () => {
        setError(null)
        try {
        const data= await apiFetch<{access_token: string}>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({email, password})
        })

        setAccessToken(data.access_token)
        navigate('/discover')
    } catch {
        setError(t('auth.invalidCredentials'))
    }}
    return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, gap: 12}}>
            <div style={{position: 'absolute', top: 16, right: 16}}>
                <LanguageSwitcher />
            </div>
            <Logo size={64} withWordmark vertical />
            <h2>{t('auth.signIn')}</h2>
            <input placeholder={t('auth.email')} value={email} onChange={e => setEmail(e.target.value)}
                style={{padding: 8, width: 280, maxWidth: '85vw', borderRadius: 6, border: '1px solid var(--border)' }}/>
            <input placeholder={t('auth.password')} type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={{padding:8, width: 280, maxWidth: '85vw', borderRadius: 6, border: '1px solid var(--border)'}} />
            {error && <p style={{color: 'var(--accent)', fontSize: 13}}>{error}</p>}
            <button onClick={handleLogin}
            style={{padding: '8px 24px', background: 'var(--accent)', color: 'var(--surface)', border: 'none', borderRadius: 6, cursor: 'pointer'}}>
                {t('auth.signIn')}
            </button>
            {/* Google OAuth (S7): бэкенд ответит 501, если ключи не настроены */}
            <button onClick={() => { window.location.href = `${API_URL}/auth/google/login` }}
            style={{padding: '8px 24px', background: 'var(--surface-raised)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8}}>
                <span style={{fontWeight: 'bold', color: 'var(--accent)'}}>G</span>
                {t('auth.googleSignIn')}
            </button>
        </div>
    )
}
