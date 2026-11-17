import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages는 /<repo>/ 아래에서 서비스되므로 상대 경로로 빌드한다.
export default defineConfig({
  base: './',
  plugins: [react()],
})
