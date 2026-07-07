import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiFetch } from "../api/client"

export default function Auth() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleLogin = async () => {
        setError(null)
        try {
        const data= await apiFetch<{access_token: string}>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({email, password})
        })

        localStorage.setItem('access_token', data.access_token)
        navigate('/discover')
    } catch {
        setError('Неверный email или пароль')
    }}
    return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, gap: 12}}>
            <h2>Войти</h2>
            <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                style={{padding: 8, width: 280, borderRadius: 6, border: '1px solid #e5e7eb' }}/>
            <input placeholder="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={{padding:8, width: 280, borderRadius: 6, border: '1px solid #e5e7eb'}} />
            {error && <p style={{color: 'red', fontSize: 13}}>{error}</p>}
            <button onClick={handleLogin}
            style={{padding: '8px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer'}}>
                Войти
            </button>
        </div>
    )
}