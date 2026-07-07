import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA (S7): оффлайн-кэш статики через service worker (Workbox).
    // API-запросы не кэшируем — маршруты и брони должны быть свежими.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WanderOwn',
        short_name: 'WanderOwn',
        description: 'Планировщик маршрутов путешествий',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // тайлы карты и Nominatim не кэшируем service worker-ом:
        // у MapLibre свой кэш, а гео-данные быстро устаревают
        navigateFallbackDenylist: [/^\/api/],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
})
