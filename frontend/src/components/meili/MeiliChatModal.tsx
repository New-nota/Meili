import { useTranslation } from 'react-i18next'
import Logo from '../Logo'
import MeiliChat from './MeiliChat'

// S17: чат с Meili поверх страницы — планирование поездки с нуля (Discover,
// мастер создания). Диалог без trip_id: поездку создаст сам план через
// «Применить», и тогда мы её открываем.
interface Props {
    onClose: () => void
    onTripCreated: (tripId: string) => void
    initialInput?: string
}

export default function MeiliChatModal({ onClose, onTripCreated, initialInput }: Props) {
    const { t } = useTranslation()

    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 1000, padding: 16,
            background: 'color-mix(in srgb, var(--text-primary) 50%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                background: 'var(--surface)', borderRadius: 12,
                width: '100%', maxWidth: 520, height: 'min(80vh, 640px)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                }}>
                    <Logo size={20} />
                    <strong style={{ flex: 1, fontSize: 15 }}>{t('meili.planWith')}</strong>
                    <button onClick={onClose} aria-label={t('common.close')} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 18, color: 'var(--text-muted)', lineHeight: 1,
                    }}>✕</button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <MeiliChat
                        tripId={null}
                        initialInput={initialInput}
                        onApplied={tripId => { if (tripId) onTripCreated(tripId) }} />
                </div>
            </div>
        </div>
    )
}
