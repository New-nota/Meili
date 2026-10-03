// S16: три доменных режима перемещения (costing Valhalla — забота бэкенда)
export type TransportMode = 'walking' | 'driving' | 'transit'
export const TRANSPORT_MODES: TransportMode[] = ['walking', 'driving', 'transit']

export interface Stop {
    id: string
    trip_id: string
    place_id: string
    day_id: string               // S16: стоп всегда принадлежит дню
    position: number
    place_name: string | null
    place_lat: number | null
    place_lon: number | null
    place_address: string | null
    transport_to_next: TransportMode | null
    duration_minutes: number     // S16: есть всегда (из места, иначе 60)
    duration_is_custom: boolean  // S16: false -> рисуем «≈»
    notes: string | null
    is_booked: boolean
    // QA: сумма подтверждённой брони — показывается вместо оценки
    booked_amount?: string | null
    priority: number              // S8 WP-4: 0 обычный, 1 важный, 2 обязательный
    included_in_route: boolean    // false = «не влезло в день» (selective)
    estimated_cost: string | null // S9 WP-A: оценка стоимости активности
    // ТЗ-E: auto|manual; ТЗ-Meili добавляет viator|price_level|estimate
    cost_source: 'auto' | 'manual' | 'viator' | 'price_level' | 'estimate'
    cost_min: string | null       // ТЗ-Meili: диапазон-оценка «≈ 400–700»
    cost_max: string | null
    cost_is_estimate: boolean
    place_pricing_model: string | null      // ТЗ-E: free -> «Бесплатно», не «нет данных»
}

export interface Trip {
    id: string
    title: string
    description: string | null
    city: string
    country: string | null
    city_lat: number | null       // S11: центр карты по выбранному городу
    city_lon: number | null
    adults_count: number
    children_count: number
    children_ages: number[] | null
    is_public: boolean
    transport_default: TransportMode
    start_date: string | null
    end_date: string | null
    currency: string              // S9 WP-A: одна валюта на поездку
    budget_total: string | null
    liked_by_me?: boolean         // S13: состояние ❤ (только в GET /trips/{id})
    // S16: для строки маршрута в профиле
    stops_count: number
    planned_total: string | null  // «Запланировано» (compute_budget)
    is_draft: boolean             // поездка без дат
    likes_count: number           // S16 §2.4: сколько людей лайкнуло
}

export interface Place {
    id: string
    name: string
    lat: number | null
    lon: number | null
    address: string | null
    category: string | null
}