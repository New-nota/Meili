import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Редизайн «Лес»: одно всплывающее меню на весь проект (действия стопа,
// способ перегона, выбор локации). Портал + position: fixed — иначе меню
// режется overflow панели и «уезжает» вместе с transform от dnd-kit.

export type MenuEntry =
    | { type: 'label'; label: string }
    | { type: 'sep' }
    | {
        type?: 'item'
        label: string
        icon?: ReactNode
        checked?: boolean
        disabled?: boolean
        danger?: boolean
        onSelect: () => void
    }

interface TriggerProps {
    ref: React.Ref<HTMLButtonElement>
    onClick: (e: React.MouseEvent) => void
    'aria-haspopup': 'menu'
    'aria-expanded': boolean
}

interface Props {
    items: MenuEntry[]
    trigger: (props: TriggerProps) => ReactNode
    align?: 'start' | 'end'
    label?: string          // aria-label самого меню
}

export default function Menu({ items, trigger, align = 'end', label }: Props) {
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    // позиция: под кнопкой; не влезает вниз — над ней; не вылезает за края
    useLayoutEffect(() => {
        if (!open || !btnRef.current || !menuRef.current) return
        const b = btnRef.current.getBoundingClientRect()
        const m = menuRef.current.getBoundingClientRect()
        const gap = 6
        let top = b.bottom + gap
        if (top + m.height > window.innerHeight - 8) top = Math.max(8, b.top - gap - m.height)
        let left = align === 'end' ? b.right - m.width : b.left
        left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8)
        setPos({ top, left })
    }, [open, align])

    useEffect(() => {
        if (!open) return
        const first = menuRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')
        first?.focus()
        const onDown = (e: PointerEvent) => {
            const t = e.target as Node
            if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
            setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus() }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const list = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])]
                const i = list.indexOf(document.activeElement as HTMLButtonElement)
                const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
                list[next]?.focus()
            }
        }
        // скролл панели уводит кнопку — меню закрываем, а не держим в воздухе
        const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false) }
        window.addEventListener('pointerdown', onDown)
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
            window.removeEventListener('pointerdown', onDown)
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('scroll', onScroll, true)
            window.removeEventListener('resize', onScroll)
        }
    }, [open])

    return (
        <>
            {trigger({
                ref: btnRef,
                onClick: e => { e.stopPropagation(); setPos(null); setOpen(o => !o) },
                'aria-haspopup': 'menu',
                'aria-expanded': open,
            })}
            {open && createPortal(
                <div ref={menuRef} className="menu" role="menu" aria-label={label}
                    style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
                    {items.map((it, i) => {
                        if (it.type === 'label') return <div key={i} className="menu-label">{it.label}</div>
                        if (it.type === 'sep') return <div key={i} className="menu-sep" role="separator" />
                        return (
                            <button key={i} type="button" className="menu-item"
                                role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                                aria-checked={it.checked}
                                disabled={it.disabled}
                                style={it.danger ? { color: 'var(--danger)' } : undefined}
                                onClick={e => { e.stopPropagation(); setOpen(false); it.onSelect() }}>
                                {it.icon}
                                <span style={{ flex: 1 }}>{it.label}</span>
                            </button>
                        )
                    })}
                </div>,
                document.body,
            )}
        </>
    )
}
