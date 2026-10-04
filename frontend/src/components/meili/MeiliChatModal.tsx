import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import Logo from '../Logo'
import MeiliChat from './MeiliChat'
import type { TripDraft } from '../../api/meili'

// S17: чат с Meili поверх страницы — планирование поездки с нуля (Discover,
// мастер создания). Диалог без trip_id: поездку создаст сам план через
// «Применить», и тогда мы её открываем.
interface Props {
    onClose: () => void
    onTripCreated: (tripId: string) => void
    initialInput?: string
    draft?: TripDraft | null
}

export default function MeiliChatModal({ onClose, onTripCreated, initialInput, draft }: Props) {
    const { t } = useTranslation()

    // Escape закрывает чат, как и остальные модалки (мастер, удаление)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    return (
        <div onClick={onClose} className="modal-scrim">
            <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('meili.planWith')}
                className="modal-sheet" style={{ maxWidth: 560, height: 'min(82vh, 680px)', padding: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px 20px', borderBottom: '1px solid var(--line)' }}>
                    <Logo size={22} />
                    <strong style={{ flex: 1, fontSize: 17 }}>{t('meili.planWith')}</strong>
                    <button type="button" onClick={onClose} aria-label={t('common.close')} className="icon-btn">
                        <X />
                    </button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <MeiliChat
                        tripId={null}
                        initialInput={initialInput}
                        draft={draft}
                        onApplied={tripId => { if (tripId) onTripCreated(tripId) }} />
                </div>
            </div>
        </div>
    )
}
