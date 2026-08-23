// Знак Hermod (ТЗ-rename, шаг 4). Геометрия заморожена — не менять:
// H с пролётом-мостом вниз, кольца на 4 углах, замковый камень в низе пролёта.
// Знак-M (Logo.tsx) — теперь аватар ассистента Meili, в шапке сервиса не живёт.
interface Props {
    size?: number
    withWordmark?: boolean
    vertical?: boolean   // вертикальный лок-ап: знак сверху, слово снизу (Auth)
}

function Mark({ size = 48 }: { size?: number }) {
    // <48px кольца превращаются в сплошные точки (как у знака Meili)
    const dots = size < 48
    return (
        <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
            <line x1="28" y1="22" x2="28" y2="78" stroke="var(--accent)" strokeWidth="5"/>
            <line x1="72" y1="22" x2="72" y2="78" stroke="var(--accent)" strokeWidth="5"/>
            <polyline points="28,48 50,58 72,48" fill="none"
                stroke="var(--accent)" strokeWidth="5" strokeLinejoin="miter"
                strokeLinecap="butt" strokeMiterlimit="9"/>
            {[[28, 22], [72, 22], [28, 78], [72, 78]].map(([cx, cy]) => (
                dots
                    ? <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" fill="var(--accent)"/>
                    : <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6"
                        fill="var(--surface)" stroke="var(--accent)" strokeWidth="3"/>
            ))}
            {/* замковый камень */}
            <circle cx="50" cy="58" r="3.6" fill="var(--accent)"/>
        </svg>
    )
}

export default function HermodLogo({ size = 48, withWordmark = false, vertical = false }: Props) {
    if (!withWordmark) return <Mark size={size} />
    return (
        <div style={{
            display: 'flex',
            flexDirection: vertical ? 'column' : 'row',
            alignItems: 'center',
            gap: vertical ? 4 : 8,
        }}>
            <Mark size={size} />
            <span style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: vertical ? size * 0.5 : size * 0.55,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1,
            }}>
                Hermod
            </span>
        </div>
    )
}
