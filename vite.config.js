import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// SDLC 平台前端（独立项目）。构建产物 dist/ 由部署方拷贝到后端 server/static/（同源托管，无 CORS）
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: true, // 监听 0.0.0.0，允许局域网 IP 访问
    port: 5173,
    // 临时：本地页面打到环境后端。改回本机时恢复 http://127.0.0.1:8080
    proxy: { '/api': 'http://127.0.0.1:8080' }
    // proxy: { '/api': 'http://172.21.32.198:8888' }
  }
})
