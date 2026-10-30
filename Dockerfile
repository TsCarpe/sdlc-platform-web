# SDLC 平台前端镜像（nginx 纯静态托管 dist）。
# 形态 C（2026-10-30 调整）：容器只发静态资源；/api 同源由外部入口承担——后端纯 API 无 CORS
# 中间件，浏览器必须同源拿页面与接口，故外部 ingress/nginx 须两条路由：/ → 本服务、/api → 后端服务
# （SSE 不缓冲与 1800s 读超时随之上移到入口层，见 README 部署段）。
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
# 纯静态：无模板、无环境变量——前端不存在环境差异，一套配置处处一致
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
