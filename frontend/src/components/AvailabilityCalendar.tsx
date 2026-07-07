// Выбор даты визита. Реальная доступность появится со встроенным API
// партнёров (этап 2 С6) — сейчас это дата-намерение, она сохраняется
// в остановке (visit_date) и уходит в booking_details брони.
interface Props {
    value: string | null
    onChange: (date: string) => void
}

export default function AvailabilityCalendar({ value, onChange }: Props) {
    const today = new Date().toISOString().slice(0, 10)
    return (
        <div style={{ padding: '6px 0' }}>
            <label style={{ fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📅</span>
                <input
                    type="date"
                    value={value ?? ''}
                    min={today}
                    onChange={e => onChange(e.target.value)}
                    style={{
                        padding: '4px 8px', border: '1px solid #e5e7eb',
                        borderRadius: 6, fontSize: 13,
                    }}
                />
            </label>
        </div>
    )
}
