// MapLibre 6 (ревью: 5.x — critical XSS в DOM.sanitize) — ESM без
// default-экспорта, и воркер — отдельный модуль, адрес которого библиотека
// вычисляет от import.meta.url. Vite при пред-бандлинге переносит модуль, и
// адрес ломался: «Worker failed to load», тайлы не грузились. Собираем
// воркер силами Vite (?worker&url — и в dev, и в прод-сборке) и отдаём
// адрес явно. Карта в проекте создаётся только через этот модуль.
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

maplibregl.setWorkerUrl(workerUrl)

export default maplibregl
