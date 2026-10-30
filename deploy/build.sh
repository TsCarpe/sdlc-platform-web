#!/bin/bash
# 构建推送 SDLC 平台前端镜像（nginx 纯静态；形态 C——/api 由外部入口路由，见 README 部署段）。
# 与后端 deploy/build.sh 同约定：CI 暂跳过——本脚本是镜像唯一产出口；交付镜像由 Jenkins 流水线产
# （本仓不放流水线定义）。构建在容器内完成（node:22 多阶段），本地只需 docker。
# 无环境配置：前端不存在环境差异（后端地址由外部入口持有），ENV 仅作 tag 前缀区分构建来源。
# 用法：ENV=prod REGISTRY=… ORG=… PUSH=1 deploy/build.sh   # Jenkins 流水线形态（构建并推，需先 docker login SWR）
#       ENV=dev deploy/build.sh                             # 只构建（附带 local 便利 tag）
# 参数（env）：ENV（默认 dev，仅 tag 前缀）/ REGISTRY（默认 cn-north-4 SWR）/ ORG（默认 hlyz）/
#             TAG（默认 环境名-日期-短rev）
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
ORG="${ORG:-hlyz}"
ENV="${ENV:-dev}"
TAG="${TAG:-${ENV}-$(date +%Y%m%d%H%M)-$(git rev-parse --short HEAD)}"
IMAGE="$REGISTRY/$ORG/sdlc-platform-web:$TAG"

echo "== 前置探测 =="
for cmd in docker git; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "缺 $cmd 命令" >&2; exit 1; }
done
# SWR 代理可用性早失败：拉不到基础镜像构建必然红，早暴露好过 build 到一半才炸
NODE_BASE="swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine"
NGINX_BASE="swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/nginx:1.27-alpine"
docker pull -q "$NODE_BASE" >/dev/null && echo "node 基础镜像代理 OK"
docker pull -q "$NGINX_BASE" >/dev/null && echo "nginx 基础镜像代理 OK"

echo "== docker build：$IMAGE =="
docker build -f Dockerfile -t "$IMAGE" -t sdlc-platform-web:local .

if [ "${PUSH:-0}" = "1" ]; then
  echo "== push SWR（需先 docker login）=="
  docker push "$IMAGE"
fi

echo
echo "IMAGE_URL=$REGISTRY/$ORG/sdlc-platform-web"
echo "IMAGE_TAG=$TAG"
echo "本地验证：docker run -d -p 18080:80 sdlc-platform-web:local（/api 需外部入口路由，直连会得显式 502 提示）"
