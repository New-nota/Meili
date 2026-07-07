// Состав группы поездки — показывается в панели бронирования,
// чтобы пользователь бронировал на нужное число человек.
interface Props {
    adults: number
    children: number
}

export default function GroupSummary({ adults, children }: Props) {
    const parts = [`${adults} взросл${adults === 1 ? 'ый' : 'ых'}`]
    if (children > 0) parts.push(`${children} дет${children === 1 ? 'ский' : 'ей'}`)
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: '#374151', padding: '6px 0',
        }}>
            <span>👥</span>
            <span>{parts.join(' · ')}</span>
        </div>
    )
}
