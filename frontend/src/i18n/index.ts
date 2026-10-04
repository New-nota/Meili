// i18n (S9 WP-C): язык переключается дропдауном, выбор живёт в localStorage.
// Добавление нового языка = новый JSON в locales/ + строка в supportedLngs.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setRequestLanguage } from '../api/client'

import ru from './locales/ru/translation.json'
import en from './locales/en/translation.json'
import de from './locales/de/translation.json'
import fr from './locales/fr/translation.json'
import es from './locales/es/translation.json'

export const SUPPORTED_LANGUAGES = [
    { code: 'ru', label: 'Русский' },
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
] as const

// язык интерфейса — бэкенду (PDF/.ics/письма) и в <html lang> (index.html
// стартует с ru: скринридеры и переносы иначе читают английский как русский).
// Подписка ДО init — первое languageChanged летит из самого init
const syncLanguage = (lng: string) => {
    setRequestLanguage(lng)
    document.documentElement.lang = lng
}
i18n.on('languageChanged', syncLanguage)

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            ru: { translation: ru },
            en: { translation: en },
            de: { translation: de },
            fr: { translation: fr },
            es: { translation: es },
        },
        supportedLngs: ['ru', 'en', 'de', 'fr', 'es'],
        fallbackLng: 'en',
        nonExplicitSupportedLngs: true,
        interpolation: { escapeValue: false },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'wanderown_lng',
        },
    })

export default i18n
