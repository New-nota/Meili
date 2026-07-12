import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'

// Дропдаун выбора языка (S9 WP-C): смена мгновенная, выбор — в localStorage.
export default function LanguageSwitcher() {
    const { i18n } = useTranslation()
    const current = i18n.resolvedLanguage ?? i18n.language

    return (
        <select
            value={current}
            onChange={e => i18n.changeLanguage(e.target.value)}
            title="Language"
            style={{
                padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6,
                fontSize: 13, background: 'var(--surface-raised)', cursor: 'pointer',
            }}
        >
            {SUPPORTED_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
            ))}
        </select>
    )
}
