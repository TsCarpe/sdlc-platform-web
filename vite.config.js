import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// SDLC 平台前端（独立项目）。构建产物 dist/ 由部署方拷贝到后端 server/static/（同源托管，无 CORS）
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080' }
  }
})
