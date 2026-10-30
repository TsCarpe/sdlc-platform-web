import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// SDLC 平台前端（独立项目，独立部署：nginx 镜像自包含静态托管 + /api 同源反代，见 deploy/）
export default defineConfig({
  plugins: [vue()],
  base: '/', // History 路由深链刷新时资源必须从站点根加载，不能用相对路径
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: true, // 监听 0.0.0.0，允许局域网 IP 访问
    port: 5173,
    // 本机后端 sdlc-platform-server（8888，见 README）；切环境后端时改此行
    // proxy: { '/api': 'http://127.0.0.1:8888' }
    proxy: { '/api': 'http://172.21.32.233:8888' }   // 远端后端
  }
})