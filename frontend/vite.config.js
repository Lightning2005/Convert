import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Запросы на /api в dev и в preview идут через бэкенд, поэтому фронтенду не
  // нужен ни абсолютный адрес API, ни CORS. Если VITE_API_BASE_URL задан, он
  // перекрывает и цель прокси, и прямые запросы с клиента.
  const apiTarget = loadEnv(mode, process.cwd()).VITE_API_BASE_URL || 'http://127.0.0.1:8000'
  const proxy = { '/api': { target: apiTarget, changeOrigin: true } }

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: { proxy },
    preview: { proxy },
  }
})
