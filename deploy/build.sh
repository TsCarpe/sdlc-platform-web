#!/bin/bash
# 构建推送 SDLC 平台前端镜像（nginx 自包含：静态托管 dist + /api 反代；后端 EXEC-PLAN-K8s
# 阶段 1 前端侧交付物）。与后端 deploy/build.sh 同约定：CI 暂跳过——本脚本是镜像唯一产出口；
# 交付镜像由 Jenkins 流水线产（本仓不放流水线定义）。
# 构建在容器内完成（node:22 多阶段），本地只需 docker。
# 三环境三镜像（对齐后端 baked 模式）：deploy/env.<ENV> 的 API_UPSTREAM 构建期注入镜像 ENV 层，
# 运行时仍可被 K8s 环境变量覆盖兜底。
# 用法：ENV=prod REGISTRY=… ORG=… PUSH=1 deploy/build.sh   # Jenkins 流水线形态（构建并推，需先 docker login SWR）
#       ENV=dev deploy/build.sh                             # 只构建（附带 local 便利 tag）
# 参数（env）：ENV（dev|test|prod，默认 dev——读 deploy/env.<ENV>）/ REGISTRY（默认 cn-north-4 SWR）/
#             ORG（默认 hlyz）/ TAG（默认 环境名-日期-短rev）/
#             ENV_FILE（高级覆盖：直接指定配置文件路径，绕过 deploy/env.<ENV> 约定）
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

ENV_FILE="${ENV_FILE:-deploy/env.$ENV}"
echo "== 读配置（ENV=${ENV}）：$ENV_FILE =="
[ -f "$ENV_FILE" ] || { echo "配置文件不存在：${ENV_FILE}（dev/test/prod 入仓随 git pull 即有）" >&2; exit 1; }
# 配置门禁：上游必填非空 http(s)（空串注入后 proxy_pass 语法错，与其起不来不如构建期红）
API_UPSTREAM="$(grep -E '^API_UPSTREAM=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' )"
grep -Eq '^https?://.+' <<<"$API_UPSTREAM" \
  || { echo "API_UPSTREAM 未配置或非法（${ENV_FILE}，须 http(s):// 开头非空）" >&2; exit 1; }
echo "API_UPSTREAM=$API_UPSTREAM"

echo "== docker build：$IMAGE =="
docker build -f Dockerfile --build-arg API_UPSTREAM="$API_UPSTREAM" -t "$IMAGE" -t sdlc-platform-web:local .

if [ "${PUSH:-0}" = "1" ]; then
  echo "== push SWR（需先 docker login）=="
  docker push "$IMAGE"
fi

echo
echo "IMAGE_URL=$REGISTRY/$ORG/sdlc-platform-web"
echo "IMAGE_TAG=$TAG"
echo "本地验证：docker run -d -p 18080:80 -e API_UPSTREAM=http://<后端>:8888 sdlc-platform-web:local"
