import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'

// QA: общая страховка — любое исключение при рендере (неожиданный null из
// API, битый ответ стороннего сервиса) раньше давало белый экран всего
// приложения без единого слова. Теперь — понятный экран и выход из него.
// resetKey (путь роутера) сбрасывает ошибку при переходе на другую страницу.

interface Props extends WithTranslation {
    children: ReactNode
    resetKey?: string
}

interface State {
    error: Error | null
}

class ErrorBoundaryInner extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack)
    }

    componentDidUpdate(prev: Props) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null })
        }
    }

    render() {
        const { t } = this.props
        if (!this.state.error) return this.props.children
        return (
            <div role="alert" style={{
                padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 12, textAlign: 'center', color: 'var(--text-primary)',
            }}>
                <h2 style={{ margin: 0 }}>{t('errors.crashTitle')}</h2>
                <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 420 }}>{t('errors.crashText')}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => window.location.reload()} style={{
                        padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}>{t('errors.reload')}</button>
                    <button onClick={() => { window.location.href = '/discover' }} style={{
                        padding: '8px 16px', background: 'none', color: 'var(--text-primary)',
                        border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                    }}>{t('nav.myTrips')}</button>
                </div>
            </div>
        )
    }
}

export default withTranslation()(ErrorBoundaryInner)
