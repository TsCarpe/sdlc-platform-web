# SDLC 平台前端镜像（nginx 自包含：静态托管 dist + /api 同源反代到后端容器）。
# 形态 A（2026-10-30 拍板）：后端纯 API 镜像无 CORS 中间件，浏览器必须同源拿到页面与 /api，
# 故 /api 转发收进前端镜像——运维只需暴露前端 Service，零外层路由配置。
# 上游参数化：API_UPSTREAM 环境变量（K8s 覆盖即可换环境），走 nginx 官方镜像 envsubst 模板机制
# 启动时注入字面量（proxy_pass 必须字面量才能用系统 DNS；写运行时变量需另配 resolver）。
# 基础镜像走 SWR 的 docker.io 代理（公司内网拉取通路，与后端 Dockerfile 同款）。

# ---------- 构建层 ----------
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine AS build
WORKDIR /app
# 依赖层先装（保层缓存）：npm ci 按 package-lock 精确复现（vite5 要求 node>=18，22-alpine 满足；
# 本地 node 24 与镜像 22 的 lock 互相兼容）
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY . .
RUN npm run build   # 产物 dist/（vite.config outDir，构建自带清空）

# ---------- 运行层 ----------
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/nginx:1.27-alpine
# 后端地址三环境三镜像（对齐后端 baked 模式）：deploy/env.<ENV> 的 API_UPSTREAM 经 build.sh
# --build-arg 注入此处 ARG；仍是 ENV，运行时可被 K8s 覆盖兜底（baked 默认 + 运行时覆盖两全）
ARG API_UPSTREAM=http://sdlc-platform-server:8888
ENV API_UPSTREAM=${API_UPSTREAM}
# 官方 entrypoint 把 /etc/nginx/templates/*.template envsubst 到 conf.d/——只替换已定义的
# 环境变量，$uri 等 nginx 内建变量安全
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
