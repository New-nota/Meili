// Знак-M — аватар ассистента Meili (ТЗ-rename, шаг 4). Раньше был лого
// сервиса (S10); в шапках теперь HermodLogo, знак-M живёт там, где
// представлен ИИ: чат, подписи помощника. Геометрия заморожена — не менять.
interface Props {
    size?: number
    withWordmark?: boolean
    vertical?: boolean   // вертикальный лок-ап: знак сверху, слово снизу (Auth)
}

function Mark({ size = 48 }: { size?: number }) {
    // версия «кольца» — для размеров >=48px
    return (
        <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
            <polyline points="18,78 32,24 50,54 68,24 82,78" fill="none"
                stroke="var(--moss)" strokeWidth="5" strokeLinejoin="miter"
                strokeLinecap="butt" strokeMiterlimit="9"/>
            <circle cx="18" cy="78" r="6" fill="var(--surface)" stroke="var(--moss)" strokeWidth="3"/>
            <circle cx="32" cy="24" r="6" fill="var(--surface)" stroke="var(--moss)" strokeWidth="3"/>
            <circle cx="50" cy="54" r="6" fill="var(--surface)" stroke="var(--moss)" strokeWidth="3"/>
            <circle cx="68" cy="24" r="6" fill="var(--surface)" stroke="var(--moss)" strokeWidth="3"/>
            <circle cx="82" cy="78" r="6" fill="var(--surface)" stroke="var(--moss)" strokeWidth="3"/>
        </svg>
    )
}

export default function Logo({ size = 48, withWordmark = false, vertical = false }: Props) {
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
                fontWeight: 500,
                fontSize: vertical ? size * 0.5 : size * 0.55,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1,
            }}>
                Meili
            </span>
        </div>
    )
}
