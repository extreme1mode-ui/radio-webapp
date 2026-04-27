import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // KBS API requests go through the Vite dev server to avoid browser CORS issues.
      '/api/kbs': {
        target: 'https://cfpwwwapi.kbs.co.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kbs/, ''),
      },
      // MBC API requests also go through the Vite dev server.
      '/api/mbc': {
        target: 'https://sminiplay.imbc.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mbc/, ''),
      },
    },
  },
})
