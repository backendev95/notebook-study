import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: funciona en GitHub Pages (usuario.github.io/notebook-study/) y en cualquier otro hosting
  base: './',
  plugins: [
    react(),
    // App instalable (PWA): ícono en la pantalla de inicio, pantalla completa y uso sin conexión
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Notebook Study',
        short_name: 'Cuadernos',
        description: 'Cuadernos cuadriculados para estudiar: escribe, dibuja y pega imágenes donde quieras.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#2b2a33',
        theme_color: '#2b2a33',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // la app completa queda guardada en el teléfono para abrir sin internet
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        cleanupOutdatedCaches: true,
        // nunca guardar en caché las llamadas a Supabase
        navigateFallbackDenylist: [/supabase\.co/],
      },
    }),
  ],
})
