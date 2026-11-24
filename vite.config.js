import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages는 /<repo>/ 아래에서 서비스되므로 상대 경로로 빌드한다.
// /engine → 팀 최적화 엔진 API(berth_sim.api, 기본 127.0.0.1:8000). 엔진은 CORS를 열지 않아 개발 서버가 대신 부른다.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/engine': { target: process.env.ENGINE_URL ?? 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\/engine/, '') },
    },
  },
})
