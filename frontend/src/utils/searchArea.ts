import { createContext, useContext } from 'react'
import type { LatLon } from './geocode'

// Центр поездки для поиска адресов/мест (город из мастера). Поиски сидят
// глубоко (TripPlanner → DayPlan → PlaceSearch/LocationPicker), поэтому
// контекст, а не проброс пропса. Нет города — null, поиск по всему миру.
export const SearchAreaContext = createContext<LatLon | null>(null)

export const useSearchArea = () => useContext(SearchAreaContext)
