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
      // 11-26 /prep → 팀 전처리 API(berth_prep, 엔진 저장소에서 `PREP_API_HOST=127.0.0.1 .venv/bin/python -m berth_prep serve`, 기본 8001).
      //   화면이 고른 기준 시각으로 과거 실적 → 배 × 부두 하역 속도를 받는다
      '/prep': { target: process.env.PREP_URL ?? 'http://127.0.0.1:8001', changeOrigin: true, rewrite: (p) => p.replace(/^\/prep/, '') },
      // 11-25 /risk → 팀 리스크 모델 API(berth_risk, 엔진 저장소에서 `RISK_API_HOST=127.0.0.1 .venv/bin/python -m berth_risk serve`, 기본 8002)
      '/risk': { target: process.env.RISK_URL ?? 'http://127.0.0.1:8002', changeOrigin: true, rewrite: (p) => p.replace(/^\/risk/, '') },
    },
  },
})
