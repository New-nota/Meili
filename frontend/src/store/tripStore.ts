import { create } from 'zustand'

// S16 §3.3: состояние редактора поездки.
// Одновременно переименовывается не больше одного дня: открытие второго
// закрывает первый (с сохранением — это делает сам DayHeader на blur).
interface TripState {
    renamingDayId: string | null
    startRenaming: (dayId: string) => void
    stopRenaming: () => void
}

export const useTripStore = create<TripState>(set => ({
    renamingDayId: null,
    startRenaming: dayId => set({ renamingDayId: dayId }),
    stopRenaming: () => set({ renamingDayId: null }),
}))
