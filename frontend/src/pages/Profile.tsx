import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Check, Heart, LogOut, MapPin, Plus, RefreshCw } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
    changePassword, getLikedTrips, getMe, getMyTrips, updateMe, uploadAvatar,
} from '../api/users'
import { getRecommendedTrips } from '../api/recommendations'
import { unlikeTrip } from '../api/trips'
import { logout } from '../api/client'
import type { Trip } from '../types'
import { apiErrorMessage } from '../utils/apiError'
import LanguageSwitcher from '../components/LanguageSwitcher'
import CreateTripModal from '../components/CreateTripModal'
import TripRow from '../components/trip/TripRow'
import LikedTripRow from '../components/trip/LikedTripRow'
import RecommendedTripCard from '../components/trip/RecommendedTripCard'

// Страница профиля (S9 WP-D): шапка, личные данные (RHF+Zod), статистика,
// мои маршруты, понравившиеся, рекомендации.

const TRAVEL_STYLES = ['culture', 'nature', 'food', 'active', 'family', 'nightlife'] as const

const profileSchema = z.object({
    name: z.string().max(80).optional().or(z.literal('')),
    home_city: z.string().max(80).optional().or(z.literal('')),
})
type ProfileForm = z.infer<typeof profileSchema>

const passwordSchema = z.object({
    old_password: z.string().min(1),
    new_password: z.string().min(8),
})
type PasswordForm = z.infer<typeof passwordSchema>

// S16 §2: заголовок блока — слева заголовок, справа действия
function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <h2 className="section-title">{title}</h2>
            <span style={{ display: 'flex', gap: 4 }}>{children}</span>
        </div>
    )
}

// пустое состояние блока: что здесь будет и что сделать
function EmptyState({ icon, title, subtitle, action }: {
    icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode
}) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: '2px 14px', alignItems: 'center',
            padding: '18px 20px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)' }}>
            <span style={{ gridRow: 'span 2', width: 44, height: 44, borderRadius: '50%', background: 'var(--raised)',
                display: 'grid', placeItems: 'center', color: 'var(--moss)' }}>{icon}</span>
            <b style={{ fontSize: 15.5 }}>{title}</b>
            <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{subtitle}</span>
            {action && <div style={{ gridColumn: 2, marginTop: 10 }}>{action}</div>}
        </div>
    )
}

export default function Profile() {
    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const fileRef = useRef<HTMLInputElement>(null)
    const [avatarBusy, setAvatarBusy] = useState(false)
    const [formMsg, setFormMsg] = useState<string | null>(null)
    const [pwdMsg, setPwdMsg] = useState<string | null>(null)
    const [styles, setStyles] = useState<string[] | null>(null)
    const [creating, setCreating] = useState(false)
    const [toast, setToast] = useState<string | null>(null)

    const { data: me, error: meError, refetch: refetchMe } = useQuery({ queryKey: ['me'], queryFn: getMe })
    const { data: myTrips } = useQuery({ queryKey: ['me-trips'], queryFn: getMyTrips })
    const { data: liked } = useQuery({ queryKey: ['me-liked'], queryFn: getLikedTrips })
    const { data: recommended } = useQuery({
        queryKey: ['me-recommended'], queryFn: () => getRecommendedTrips(undefined),
    })

    const form = useForm<ProfileForm>({
        resolver: zodResolver(profileSchema),
        values: { name: me?.name ?? '', home_city: me?.home_city ?? '' },
    })
    const pwdForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })

    // QA: упавшая загрузка профиля раньше висела вечным «Загрузка...»
    if (meError && !me) return (
        <div className="page" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
            <p className="error-text" role="alert">{apiErrorMessage(meError, t)}</p>
            <button type="button" onClick={() => refetchMe()} className="btn btn-sm"><RefreshCw />{t('common.retry')}</button>
        </div>
    )
    if (!me) return <div className="page" style={{ color: 'var(--ink-3)' }}>{t('common.loading')}</div>

    const selectedStyles = styles ?? me.travel_style ?? []
    const initials = (me.name || me.email).slice(0, 2).toUpperCase()
    // ru: «с октября 2026 г.» — родительный падеж месяца даёт только формат с
    // числом, поэтому форматируем с днём и выкидываем день
    const memberSince = i18n.language.startsWith('ru')
        ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' })
            .formatToParts(new Date(me.created_at))
            .filter(p => p.type !== 'day').map(p => p.value).join('').trim()
        : new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(new Date(me.created_at))

    const saveProfile = form.handleSubmit(async values => {
        setFormMsg(null)
        try {
            // QA: пустое поле раньше уходило как undefined («не трогать») —
            // стереть имя или город было невозможно. Пусто = null = стереть
            await updateMe({
                name: values.name?.trim() || null,
                home_city: values.home_city?.trim() || null,
                travel_style: selectedStyles,
            })
            await queryClient.invalidateQueries({ queryKey: ['me'] })
            setFormMsg(t('profile.saved'))
        } catch (e) {
            setFormMsg(apiErrorMessage(e, t, t('trip.saveError')))
        }
    })

    const savePassword = pwdForm.handleSubmit(async values => {
        setPwdMsg(null)
        try {
            await changePassword(values.old_password, values.new_password)
            setPwdMsg(t('profile.passwordChanged'))
            pwdForm.reset()
        } catch (e) {
            setPwdMsg(apiErrorMessage(e, t))
        }
    })

    const onAvatarPick = async (file: File | undefined) => {
        if (!file) return
        // те же правила, что на бэке (storage.py) — без лишней загрузки
        if (!file.type.startsWith('image/')) { setFormMsg(t('errors.avatar_bad_type')); return }
        if (file.size > 5 * 1024 * 1024) { setFormMsg(t('errors.avatar_too_large')); return }
        setAvatarBusy(true)
        setFormMsg(null)
        try {
            await uploadAvatar(file)
            await queryClient.invalidateQueries({ queryKey: ['me'] })
        } catch (e) {
            setFormMsg(apiErrorMessage(e, t))
        } finally {
            setAvatarBusy(false)
        }
    }

    // S16 §2.3: снятие лайка — оптимистично; при ошибке строка возвращается
    const removeLike = async (tripId: string) => {
        const prev = queryClient.getQueryData<Trip[]>(['me-liked'])
        queryClient.setQueryData<Trip[]>(['me-liked'],
            old => (old ?? []).filter(x => x.id !== tripId))
        try {
            await unlikeTrip(tripId)
            queryClient.invalidateQueries({ queryKey: ['me'] })  // счётчик лайков
        } catch {
            queryClient.setQueryData(['me-liked'], prev)
            setToast(t('profile.liked.removeError'))
            setTimeout(() => setToast(null), 3000)
        }
    }

    const toggleStyle = (s: string) =>
        setStyles(prev => {
            const cur = prev ?? me.travel_style ?? []
            return cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]
        })

    const okMsg = (m: string | null) => m === t('profile.saved') || m === t('profile.passwordChanged')

    return (
        <div className="page">
            <header className="page-head">
                <button type="button" onClick={() => navigate('/discover')} className="icon-btn filled"
                    aria-label={t('nav.myTrips')} title={t('nav.myTrips')}>
                    <ArrowLeft />
                </button>
                <h1>{t('profile.title')}</h1>
                {/* S18: язык и выход живут только здесь (с Discover убраны) */}
                <LanguageSwitcher />
                {/* на узком экране — только значок, чтобы шапка не ломалась на две строки */}
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t('nav.logout')} title={t('nav.logout')}
                    onClick={async () => { await logout(); navigate('/auth') }}>
                    <LogOut /><span className="hide-narrow">{t('nav.logout')}</span>
                </button>
            </header>

            {/* Шапка профиля */}
            <section style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {me.avatar_url
                    ? <img src={me.avatar_url} alt="" style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div aria-hidden="true" style={{
                        width: 76, height: 76, borderRadius: '50%', background: 'var(--moss)',
                        color: 'var(--raised)', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 700,
                      }}>{initials}</div>}
                <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em' }}>{me.name || me.email}</div>
                    {me.home_city && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14.5, color: 'var(--ink-2)' }}>
                            <MapPin size={15} />{me.home_city}
                        </div>
                    )}
                    <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>{t('profile.memberSince', { date: memberSince })}</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => {
                        onAvatarPick(e.target.files?.[0])
                        // QA: без сброса повторный выбор ТОГО ЖЕ файла (после
                        // ошибки) не вызывал onChange — кнопка «не работала»
                        e.target.value = ''
                    }} />
                <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-sm"
                    disabled={avatarBusy || me.avatar_upload_enabled === false}
                    title={me.avatar_upload_enabled === false ? t('errors.storage_not_configured') : undefined}>
                    <Camera />{avatarBusy ? t('profile.uploading') : t('profile.changePhoto')}
                </button>
            </section>

            {/* Статистика — одной полосой */}
            <section aria-label={t('profile.stats')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 4, marginTop: 24, padding: '14px 8px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)' }}>
                {([
                    ['statsTrips', me.stats.trips_count],
                    ['statsVisited', me.stats.visited_places_count],
                    ['statsLikesGiven', me.stats.likes_given],
                    ['statsLikesReceived', me.stats.likes_received],
                ] as const).map(([key, val]) => (
                    <div key={key} style={{ padding: '4px 12px' }}>
                        <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{t(`profile.${key}`)}</div>
                        <div style={{ fontSize: 22, fontWeight: 750 }}>{val}</div>
                    </div>
                ))}
            </section>

            {/* S16 §2.2: Мои маршруты — вертикальный список строк без окантовки */}
            <section style={{ marginTop: 40 }}>
                <SectionHead title={t('profile.myTrips.title')}>
                    <button type="button" onClick={() => setCreating(true)} className="btn btn-sm btn-ghost">
                        <Plus />{t('profile.myTrips.create')}
                    </button>
                    <button type="button" onClick={() => navigate('/discover')} className="btn btn-sm btn-ghost">
                        {t('profile.myTrips.viewAll')}
                    </button>
                </SectionHead>
                {myTrips && myTrips.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -16px' }}>
                        {myTrips.map(trip => (
                            <TripRow key={trip.id} trip={trip}
                                onOpen={id => navigate(`/trips/${id}`)} />
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={<Plus size={22} />}
                        title={t('profile.myTrips.empty.title')}
                        subtitle={t('profile.myTrips.empty.subtitle')}
                        action={
                            <button type="button" onClick={() => setCreating(true)} className="btn btn-sm btn-primary">
                                {t('profile.myTrips.create')}
                            </button>
                        } />
                )}
            </section>

            {/* S16 §2.3: Понравившиеся */}
            <section style={{ marginTop: 40 }}>
                <SectionHead title={t('profile.liked.title')} />
                {liked && liked.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -16px' }}>
                        {liked.map(trip => (
                            <LikedTripRow key={trip.id} trip={trip}
                                onOpen={id => navigate(`/trips/${id}/preview`)}
                                onRemove={removeLike} />
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={<Heart size={20} />}
                        title={t('profile.liked.empty.title')}
                        subtitle={t('profile.liked.empty.subtitle')} />
                )}
            </section>

            {/* S16 §2.4: Похожие выбирают — сетка карточек без превью карты */}
            {recommended && recommended.length > 0 && (
                <section style={{ marginTop: 40 }}>
                    <SectionHead title={t('profile.similar.title')} />
                    <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '-4px 0 14px' }}>
                        {t('profile.similar.subtitle')}
                    </p>
                    <div className="recommended-grid">
                        {recommended.map(trip => (
                            <RecommendedTripCard key={trip.id} trip={trip}
                                onOpen={id => navigate(`/trips/${id}/preview`)} />
                        ))}
                    </div>
                </section>
            )}

            {/* Личные данные — ниже контента: правят их редко */}
            <section style={{ marginTop: 48 }}>
                <SectionHead title={t('profile.personalData')} />
                <form onSubmit={saveProfile} style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
                    <label className="field">
                        <span className="field-label">{t('auth.email')}</span>
                        <input value={me.email} readOnly disabled className="input" />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('profile.name')}</span>
                        <input {...form.register('name')} className="input" />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('profile.homeCity')}</span>
                        <input {...form.register('home_city')} className="input" />
                    </label>
                    <div className="field">
                        <span className="field-label">{t('profile.travelStyle')}</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {TRAVEL_STYLES.map(s => (
                                <button type="button" key={s} onClick={() => toggleStyle(s)} className="chip"
                                    aria-pressed={selectedStyles.includes(s)}>
                                    {t(`profile.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button type="submit" className="btn btn-primary">{t('common.save')}</button>
                        {formMsg && (
                            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14,
                                color: okMsg(formMsg) ? 'var(--ok)' : 'var(--danger)' }}>
                                {okMsg(formMsg) && <Check size={16} />}{formMsg}
                            </span>
                        )}
                    </div>
                </form>

                {/* Смена пароля — только у локальных аккаунтов */}
                {me.has_password && (
                    <form onSubmit={savePassword} style={{ marginTop: 28, maxWidth: 520 }}>
                        <h3 style={{ fontSize: 16, marginBottom: 10 }}>{t('profile.changePassword')}</h3>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input type="password" placeholder={t('profile.oldPassword')} aria-label={t('profile.oldPassword')}
                                {...pwdForm.register('old_password')} className="input" style={{ flex: 1, minWidth: 160, width: 'auto' }} />
                            <input type="password" placeholder={t('profile.newPassword')} aria-label={t('profile.newPassword')}
                                {...pwdForm.register('new_password')} className="input" style={{ flex: 1, minWidth: 160, width: 'auto' }} />
                            <button type="submit" className="btn">{t('common.save')}</button>
                        </div>
                        {pwdForm.formState.errors.old_password && (
                            <p className="error-text" style={{ marginTop: 6 }}>{t('profile.oldPasswordRequired')}</p>
                        )}
                        {pwdForm.formState.errors.new_password && (
                            <p className="error-text" style={{ marginTop: 6 }}>{t('auth.passwordMin')}</p>
                        )}
                        {pwdMsg && <p role="status" style={{ fontSize: 14, marginTop: 6, color: okMsg(pwdMsg) ? 'var(--ok)' : 'var(--danger)' }}>{pwdMsg}</p>}
                    </form>
                )}
            </section>

            {creating && (
                <CreateTripModal
                    onClose={() => setCreating(false)}
                    onCreated={trip => navigate(`/trips/${trip.id}`)} />
            )}

            {/* toast об ошибке действия (снятие лайка) */}
            {toast && (
                <div role="status" style={{
                    position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--ink)', color: 'var(--raised)',
                    padding: '11px 18px', borderRadius: 'var(--radius)', fontSize: 14, zIndex: 1200, boxShadow: 'var(--shadow-2)',
                }}>
                    {toast}
                </div>
            )}
        </div>
    )
}
