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
            <div role="alert" className="page" style={{ display: 'grid', justifyItems: 'center', gap: 12, textAlign: 'center', paddingTop: 96 }}>
                <h1 style={{ fontSize: 26 }}>{t('errors.crashTitle')}</h1>
                <p style={{ color: 'var(--ink-2)', maxWidth: 420, fontSize: 15.5 }}>{t('errors.crashText')}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{t('errors.reload')}</button>
                    <button type="button" className="btn" onClick={() => { window.location.href = '/discover' }}>{t('nav.myTrips')}</button>
                </div>
            </div>
        )
    }
}

export default withTranslation()(ErrorBoundaryInner)
