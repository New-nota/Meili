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
            aria-label="Language"
            className="select input-sm"
            style={{ width: 'auto' }}
        >
            {SUPPORTED_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
            ))}
        </select>
    )
}
