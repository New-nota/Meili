import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
    changePassword, getLikedTrips, getMe, getMyTrips, updateMe, uploadAvatar,
} from '../api/users'
import { getRecommendedTrips } from '../api/recommendations'
import { cloneTrip } from '../api/trips'
import type { Trip } from '../types'
import LanguageSwitcher from '../components/LanguageSwitcher'

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
    border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16,
}

function TripCards({ trips, onOpen }: { trips: Trip[]; onOpen: (id: string) => void }) {
    const { t, i18n } = useTranslation()
    const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {trips.map(trip => (
                <div key={trip.id} onClick={() => onOpen(trip.id)}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
                    <strong style={{ fontSize: 14 }}>{trip.title || t('common.untitled')}</strong>
                    {trip.city && <div style={{ fontSize: 12, color: '#6b7280' }}>📍 {trip.city}</div>}
                    {trip.start_date && (
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                            {dateFmt.format(new Date(trip.start_date))}
                            {trip.end_date ? ` – ${dateFmt.format(new Date(trip.end_date))}` : ''}
                        </div>
                    )}
                </div>
            ))}
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

    const toggleStyle = (s: string) =>
        setStyles(prev => {
            const cur = prev ?? me.travel_style ?? []
            return cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]
        })

    const inputStyle: React.CSSProperties = {
        display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
        border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
    }

    return (
        <div className="discover-page" style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => navigate('/discover')} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>←</button>
                    <h2 style={{ margin: 0 }}>{t('profile.title')}</h2>
                </div>
                <LanguageSwitcher />
            </div>

            {/* Шапка профиля */}
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16 }}>
                {me.avatar_url
                    ? <img src={me.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{
                        width: 72, height: 72, borderRadius: '50%', background: '#3b82f6',
                        color: 'white', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 24, fontWeight: 'bold',
                      }}>{initials}</div>}
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 'bold' }}>{me.name || me.email}</div>
                    {me.home_city && <div style={{ fontSize: 13, color: '#6b7280' }}>📍 {me.home_city}</div>}
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{t('profile.memberSince', { date: memberSince })}</div>
                </div>
                <div>
                    <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => onAvatarPick(e.target.files?.[0])} />
                    <button onClick={() => fileRef.current?.click()} disabled={avatarBusy}
                        style={{ padding: '6px 12px', border: '1px solid #e5e7eb', background: 'white', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                        {avatarBusy ? t('profile.uploading') : t('profile.changePhoto')}
                    </button>
                </div>
            </div>

            {/* Личные данные */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.personalData')}</h3>
                <form onSubmit={saveProfile}>
                    <label style={{ fontSize: 13, color: '#6b7280' }}>{t('auth.email')}
                        <input value={me.email} readOnly disabled style={{ ...inputStyle, background: '#f9fafb' }} />
                    </label>
                    <label style={{ fontSize: 13, color: '#6b7280', display: 'block', marginTop: 10 }}>{t('profile.name')}
                        <input {...form.register('name')} style={inputStyle} />
                    </label>
                    <label style={{ fontSize: 13, color: '#6b7280', display: 'block', marginTop: 10 }}>{t('profile.homeCity')}
                        <input {...form.register('home_city')} style={inputStyle} />
                    </label>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10 }}>{t('profile.travelStyle')}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {TRAVEL_STYLES.map(s => (
                            <button type="button" key={s} onClick={() => toggleStyle(s)}
                                style={{
                                    padding: '4px 10px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                                    border: `1px solid ${selectedStyles.includes(s) ? '#3b82f6' : '#e5e7eb'}`,
                                    background: selectedStyles.includes(s) ? '#eff6ff' : 'white',
                                }}>
                                {t(`profile.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <button type="submit" style={{
                            padding: '8px 20px', background: '#3b82f6', color: 'white',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                            {t('common.save')}
                        </button>
                        {formMsg && <span style={{ fontSize: 13, color: formMsg === '✓' ? '#10b981' : 'red' }}>{formMsg}</span>}
                    </div>
                </form>

                {/* Смена пароля — только у локальных аккаунтов */}
                {me.has_password && (
                    <form onSubmit={savePassword} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('profile.changePassword')}</h4>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input type="password" placeholder={t('profile.oldPassword')}
                                {...pwdForm.register('old_password')}
                                style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140, marginTop: 0 }} />
                            <input type="password" placeholder={t('profile.newPassword')}
                                {...pwdForm.register('new_password')}
                                style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140, marginTop: 0 }} />
                            <button type="submit" style={{
                                padding: '8px 16px', background: 'white', color: '#374151',
                                border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                {t('common.save')}
                            </button>
                        </div>
                        {pwdForm.formState.errors.new_password && (
                            <p style={{ color: 'red', fontSize: 12, margin: '6px 0 0' }}>min 8</p>
                        )}
                        {pwdMsg && <p style={{ fontSize: 13, margin: '6px 0 0', color: pwdMsg === t('profile.passwordChanged') ? '#10b981' : 'red' }}>{pwdMsg}</p>}
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
                        <div key={key} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 'bold' }}>{val}</div>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>{t(`profile.${key}`)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Мои маршруты */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.myTrips')}</h3>
                {myTrips && myTrips.length > 0
                    ? <TripCards trips={myTrips} onOpen={id => navigate(`/trips/${id}`)} />
                    : (
                        <div style={{ textAlign: 'center', color: '#9ca3af', padding: 16 }}>
                            {t('profile.noTrips')}<br />
                            <button onClick={() => navigate('/discover')} style={{
                                marginTop: 8, padding: '6px 14px', background: '#3b82f6', color: 'white',
                                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                {t('profile.createTrip')}
                            </button>
                        </div>
                    )}
            </div>

            {/* Понравившиеся */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.likedTrips')}</h3>
                {liked && liked.length > 0
                    ? <TripCards trips={liked} onOpen={id => navigate(`/trips/${id}`)} />
                    : <div style={{ color: '#9ca3af', fontSize: 13 }}>{t('profile.noLiked')}</div>}
            </div>

            {/* Рекомендации (S5) — внизу страницы */}
            <div style={card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('profile.recommended')}</h3>
                {recommended && recommended.length > 0 ? (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {recommended.map(trip => (
                            <div key={trip.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                                <strong style={{ fontSize: 13 }}>{trip.title}</strong>
                                {trip.city && <div style={{ fontSize: 12, color: '#6b7280' }}>{trip.city}</div>}
                                <button onClick={async () => {
                                    const copy = await cloneTrip(trip.id)
                                    navigate(`/trips/${copy.id}`)
                                }} style={{
                                    marginTop: 6, padding: '4px 10px', background: '#3b82f6', color: 'white',
                                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                    {t('trip.clone')}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : <div style={{ color: '#9ca3af', fontSize: 13 }}>{t('profile.recommendedEmpty')}</div>}
            </div>
        </div>
    )
}
