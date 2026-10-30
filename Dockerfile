# SDLC 平台前端镜像（node + vite preview，对齐团队其他项目部署形态——2026-10-30 拍板方案 A）。
# 单阶段：构建与运行同一镜像，容器内 `vite preview` 直出 dist；端口 5174。
# 前端无环境差异、无容器内反代——/api 由外部入口路由到后端服务（同源约束在入口层，见 README）。
# 已知取舍（相对 nginx 静态托管）：无 gzip / 无按路径缓存控制（index.html 若被中间层缓存，
# 重建后旧 HTML 引用已删 assets 会白屏）/ /api 漏配时 SPA fallback 返回 HTML 而非明确错误。
# 基础镜像走 SWR 的 docker.io 代理（公司内网拉取通路，与后端 Dockerfile 同款）。

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Vite is a build and preview dependency, so include devDependencies.
RUN npm ci --include=dev

COPY . .
RUN npm run build

EXPOSE 5174

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5174", "--strictPort"]
