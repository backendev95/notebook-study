import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Rutas relativas: funciona en GitHub Pages (usuario.github.io/notebook-study/) y en cualquier otro hosting
  base: './',
})
