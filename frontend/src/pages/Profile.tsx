import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Plus } from 'lucide-react'
import HermodLogo from '../components/HermodLogo'
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

const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16,
}

// S16 §2: заголовок блока — слева h2, справа действия
function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 8, gap: 8,
        }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            <span style={{ display: 'flex', gap: 6 }}>{children}</span>
        </div>
    )
}

const ghostButton: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--accent)', fontSize: 13, padding: '4px 8px', borderRadius: 6,
}

// пустое состояние блока: иконка в круге, заголовок, подпись, действие
function EmptyState({ icon, title, subtitle, action }: {
    icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode
}) {
    return (
        <div style={{ textAlign: 'center', padding: '28px 16px' }}>
            <div style={{
                width: 44, height: 44, borderRadius: '50%', margin: '0 auto 10px',
                background: 'var(--surface)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
            }}>
                {icon}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
            {action && <div style={{ marginTop: 12 }}>{action}</div>}
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

    const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe })
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

    if (!me) return <div style={{ padding: 32 }}>{t('common.loading')}</div>

    const selectedStyles = styles ?? me.travel_style ?? []
    const initials = (me.name || me.email).slice(0, 2).toUpperCase()
    const memberSince = new Intl.DateTimeFormat(i18n.language, {
        month: 'long', year: 'numeric',
    }).format(new Date(me.created_at))

    const saveProfile = form.handleSubmit(async values => {
        setFormMsg(null)
        try {
            await updateMe({
                name: values.name || undefined,
                home_city: values.home_city || undefined,
                travel_style: selectedStyles,
            })
            await queryClient.invalidateQueries({ queryKey: ['me'] })
            setFormMsg('✓')
        } catch {
            setFormMsg(t('trip.saveError'))
        }
    })

    const savePassword = pwdForm.handleSubmit(async values => {
        setPwdMsg(null)
        try {
            await changePassword(values.old_password, values.new_password)
            setPwdMsg(t('profile.passwordChanged'))
            pwdForm.reset()
        } catch (e) {
            const code = (e as { body?: { detail?: string } })?.body?.detail
            setPwdMsg(code ? t(`errors.${code}`, code) : t('common.error'))
        }
    })

    const onAvatarPick = async (file: File | undefined) => {
        if (!file) return
        setAvatarBusy(true)
        try {
            await uploadAvatar(file)
            await queryClient.invalidateQueries({ queryKey: ['me'] })
        } catch (e) {
            setFormMsg(t(`errors.${(e as Error).message}`, t('common.error')))
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

    const inputStyle: React.CSSProperties = {
        display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
        border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
    }

    return (
        <div className="discover-page" style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => navigate('/discover')} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}>←</button>
                    {/* лок-ап сервиса (ТЗ-rename, шаг 4) */}
                    <span onClick={() => navigate('/discover')} style={{ cursor: 'pointer', display: 'flex' }}>
                        <HermodLogo size={26} withWordmark />
                    </span>
                    <h2 style={{ margin: 0 }}>{t('profile.title')}</h2>
                </div>
                {/* S18: язык и выход живут только здесь (с Discover убраны) */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <LanguageSwitcher />
                    <button onClick={async () => { await logout(); navigate('/auth') }}
                        style={{
                            padding: '6px 14px', background: 'none', color: 'var(--text-muted)',
                            border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        }}>
                        {t('nav.logout')}
                    </button>
                </div>
            </div>

            {/* Шапка профиля */}
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16 }}>
                {me.avatar_url
                    ? <img src={me.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{
                        width: 72, height: 72, borderRadius: '50%', background: 'var(--accent)',
                        color: 'var(--surface)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 24, fontWeight: 'bold',
                      }}>{initials}</div>}
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 'bold' }}>{me.name || me.email}</div>
                    {me.home_city && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>📍 {me.home_city}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('profile.memberSince', { date: memberSince })}</div>
                </div>
                <div>
                    <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => onAvatarPick(e.target.files?.[0])} />
                    <button onClick={() => fileRef.current?.click()} disabled={avatarBusy}
                        style={{ padding: '6px 12px', border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                        {avatarBusy ? t('profile.uploading') : t('profile.changePhoto')}
                    </button>
                </div>
            </div>

            {/* Личные данные */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.personalData')}</h3>
                <form onSubmit={saveProfile}>
                    <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('auth.email')}
                        <input value={me.email} readOnly disabled style={{ ...inputStyle, background: 'var(--surface)' }} />
                    </label>
                    <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}>{t('profile.name')}
                        <input {...form.register('name')} style={inputStyle} />
                    </label>
                    <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}>{t('profile.homeCity')}
                        <input {...form.register('home_city')} style={inputStyle} />
                    </label>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>{t('profile.travelStyle')}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {TRAVEL_STYLES.map(s => (
                            <button type="button" key={s} onClick={() => toggleStyle(s)}
                                style={{
                                    padding: '4px 10px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                                    border: `1px solid ${selectedStyles.includes(s) ? 'var(--accent)' : 'var(--border)'}`,
                                    background: selectedStyles.includes(s) ? 'var(--surface)' : 'var(--surface-raised)',
                                }}>
                                {t(`profile.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <button type="submit" style={{
                            padding: '8px 20px', background: 'var(--accent)', color: 'var(--surface)',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                            {t('common.save')}
                        </button>
                        {formMsg && <span style={{ fontSize: 13, color: formMsg === '✓' ? 'var(--accent)' : 'var(--accent-hover)' }}>{formMsg}</span>}
                    </div>
                </form>

                {/* Смена пароля — только у локальных аккаунтов */}
                {me.has_password && (
                    <form onSubmit={savePassword} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--surface)' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('profile.changePassword')}</h4>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input type="password" placeholder={t('profile.oldPassword')}
                                {...pwdForm.register('old_password')}
                                style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140, marginTop: 0 }} />
                            <input type="password" placeholder={t('profile.newPassword')}
                                {...pwdForm.register('new_password')}
                                style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140, marginTop: 0 }} />
                            <button type="submit" style={{
                                padding: '8px 16px', background: 'var(--surface-raised)', color: 'var(--text-primary)',
                                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                {t('common.save')}
                            </button>
                        </div>
                        {pwdForm.formState.errors.new_password && (
                            <p style={{ color: 'var(--accent)', fontSize: 12, margin: '6px 0 0' }}>min 8</p>
                        )}
                        {pwdMsg && <p style={{ fontSize: 13, margin: '6px 0 0', color: pwdMsg === t('profile.passwordChanged') ? 'var(--accent)' : 'var(--accent-hover)' }}>{pwdMsg}</p>}
                    </form>
                )}
            </div>

            {/* Статистика */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.stats')}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                    {([
                        ['statsTrips', me.stats.trips_count],
                        ['statsVisited', me.stats.visited_places_count],
                        ['statsLikesGiven', me.stats.likes_given],
                        ['statsLikesReceived', me.stats.likes_received],
                    ] as const).map(([key, val]) => (
                        <div key={key} style={{ background: 'var(--surface)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 'bold' }}>{val}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(`profile.${key}`)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* S16 §2.2: Мои маршруты — вертикальный список строк без окантовки */}
            <section style={{ marginBottom: 24 }}>
                <SectionHead title={t('profile.myTrips.title')}>
                    <button onClick={() => setCreating(true)} style={ghostButton}>
                        {t('profile.myTrips.create')}
                    </button>
                    <button onClick={() => navigate('/discover')} style={ghostButton}>
                        {t('profile.myTrips.viewAll')} →
                    </button>
                </SectionHead>
                {myTrips && myTrips.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                            <button onClick={() => setCreating(true)} style={{
                                padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                {t('profile.myTrips.create')}
                            </button>
                        } />
                )}
            </section>

            {/* S16 §2.3: Понравившиеся */}
            <section style={{ marginBottom: 24 }}>
                <SectionHead title={t('profile.liked.title')} />
                {liked && liked.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                <section style={{ marginBottom: 24 }}>
                    <SectionHead title={t('profile.similar.title')} />
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                        {t('profile.similar.subtitle')}
                    </div>
                    <div className="recommended-grid">
                        {recommended.map(trip => (
                            <RecommendedTripCard key={trip.id} trip={trip}
                                onOpen={id => navigate(`/trips/${id}/preview`)} />
                        ))}
                    </div>
                </section>
            )}

            {creating && (
                <CreateTripModal
                    onClose={() => setCreating(false)}
                    onCreated={trip => navigate(`/trips/${trip.id}`)} />
            )}

            {/* toast об ошибке действия (снятие лайка) */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--text-primary)', color: 'var(--surface)',
                    padding: '10px 16px', borderRadius: 8, fontSize: 13, zIndex: 1200,
                }}>
                    {toast}
                </div>
            )}
        </div>
    )
}
