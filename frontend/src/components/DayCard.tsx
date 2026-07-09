import { useState } from 'react'
import type { Stop } from '../types'
import {
    optimizeDay, updateDay, type TripDay, type TripLocation,
} from '../api/days'
import { updateStop } from '../api/trips'
import { ApiError } from '../api/client'
import LocationPicker from './LocationPicker'

// Карточка дня (S8 WP-3): старт → стопы → финиш, оптимизация в пределах дня.
interface Props {
    tripId: string
    day: TripDay
    allDays: TripDay[]
    locations: TripLocation[]
    expanded: boolean
    onToggle: () => void
    onChanged: () => void       // перезагрузить дни/локации
    onSelectStop: (stop: Stop) => void
}

export default function DayCard({
    tripId, day, allDays, locations, expanded, onToggle, onChanged, onSelectStop,
}: Props) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleOptimize = async () => {
        setBusy(true)
        setError(null)
        try {
            await optimizeDay(tripId, day.id, 'full')
            onChanged()
        } catch (e) {
            if (e instanceof ApiError && e.status === 422) {
                setError('Этот день выходит за зону покрытия карт: раздели его на два дня или оставь переезд между городами без промежуточных остановок')
            } else if (e instanceof ApiError && e.status === 400) {
                setError((e.body as { detail?: string })?.detail ?? 'Не удалось оптимизировать')
            } else {
                setError('Ошибка оптимизации')
            }
        } finally {
            setBusy(false)
        }
    }

    const moveStopToDay = async (stopId: string, targetDayId: string) => {
        await updateStop(tripId, stopId, { day_id: targetDayId })
        onChanged()
    }

    const setLocation = async (field: 'start_location_id' | 'end_location_id', locId: string) => {
        await updateDay(tripId, day.id, { [field]: locId })
        onChanged()
    }

    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('ru', {
        weekday: 'short', day: 'numeric', month: 'short',
    })

    return (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8 }}>
            {/* заголовок-аккордеон */}
            <div onClick={onToggle} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', cursor: 'pointer',
                background: expanded ? '#eff6ff' : 'white', borderRadius: 8,
            }}>
                <strong style={{ fontSize: 13 }}>
                    День {day.day_index + 1} · {dateLabel}
                </strong>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {day.stops.length} ост. {expanded ? '▲' : '▼'}
                </span>
            </div>

            {expanded && (
                <div style={{ padding: '8px 12px' }}>
                    <LocationPicker
                        tripId={tripId} label="🏁 Старт" value={day.start_location}
                        locations={locations}
                        onSelect={id => setLocation('start_location_id', id)}
                        onLocationAdded={onChanged}
                    />
                    <div style={{ fontSize: 12, color: '#9ca3af', margin: '2px 0 6px 4px' }}>
                        в {day.start_time.slice(0, 5)}
                    </div>

                    {/* стопы дня */}
                    {day.stops.map((stop, i) => (
                        <div key={stop.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                        }}>
                            <div style={{
                                width: 20, height: 20, background: '#3b82f6', borderRadius: '50%',
                                color: 'white', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 11, fontWeight: 'bold', flexShrink: 0,
                            }}>{i + 1}</div>
                            <span onClick={() => onSelectStop(stop)}
                                style={{ fontSize: 13, cursor: 'pointer', flex: 1 }}>
                                {stop.place_name || 'Без названия'}
                                {stop.is_booked && <span title="Забронировано"> 🎟</span>}
                            </span>
                            {/* перенос в другой день */}
                            <select value={day.id} title="Перенести в день"
                                onChange={e => moveStopToDay(stop.id, e.target.value)}
                                style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4, background: 'white' }}>
                                {allDays.map(d => (
                                    <option key={d.id} value={d.id}>Д{d.day_index + 1}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                    {day.stops.length === 0 && (
                        <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0' }}>
                            Нет остановок — добавь через поиск, выбрав этот день
                        </p>
                    )}

                    <LocationPicker
                        tripId={tripId} label="🏁 Финиш" value={day.end_location}
                        locations={locations}
                        onSelect={id => setLocation('end_location_id', id)}
                        onLocationAdded={onChanged}
                    />

                    {error && <p style={{ color: 'red', fontSize: 12, marginTop: 6 }}>{error}</p>}

                    <button onClick={handleOptimize} disabled={busy || day.stops.length === 0}
                        style={{
                            marginTop: 8, padding: '6px 12px', width: '100%',
                            background: busy ? '#9ca3af' : '#3b82f6', color: 'white',
                            border: 'none', borderRadius: 6,
                            cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13,
                        }}>
                        {busy ? '⏳...' : '✨ Оптимизировать день'}
                    </button>
                </div>
            )}
        </div>
    )
}
