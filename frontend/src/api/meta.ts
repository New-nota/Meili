import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Coverage } from '../utils/geocode'

// Факты о развёртывании (GET /meta, публичный). Покрытие маршрутов задаёт
// бэкенд из конфига (ROUTING_COVERAGE): регион больше не зашит во фронт.
interface Meta {
    routing_coverage: Coverage
}

export const getMeta = () => apiFetch<Meta>('/meta')

/** Где строятся маршруты; undefined, пока не загрузилось (= не мешаем). */
export function useRoutingCoverage(): Coverage | undefined {
    const { data } = useQuery({ queryKey: ['meta'], queryFn: getMeta, staleTime: Infinity })
    return data?.routing_coverage
}
