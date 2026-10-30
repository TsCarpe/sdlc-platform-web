# SDLC 产物协作平台 — 前端（Web）

需求质检 + 用例登记 + 设计/门禁工作台的 Vue 3 单页应用。零运行时新依赖
（无 vue-router/状态库/UI 库；跨页跳转内核 `src/trace.js`；markdown 渲染 marked + DOMPurify，唯一例外 mermaid）。

后端在姊妹仓 `sdlc-platform-server`（FastAPI，8888）。

## 命令

```bash
npm install
npm run dev      # 5173，/api 代理到 http://127.0.0.1:8888（需后端已启动）
npm run build    # 产物 dist/
```

## 部署（独立镜像，nginx 自包含）

两工程独立部署（2026-10-30 形态 A）：本仓出 nginx 镜像——静态托管 `dist/` + `/api` 同源反代到后端容器
（后端纯 API 无 CORS 中间件，浏览器必须同源拿页面与接口）。后端地址三环境三镜像（对齐后端 baked
模式）：`deploy/env.{dev,test,prod}` 的 `API_UPSTREAM` 构建期注入镜像，运行时仍可被环境变量覆盖兜底。

```bash
ENV=dev deploy/build.sh                                   # 只构建（附 local 便利 tag）
ENV=prod REGISTRY=… ORG=… PUSH=1 deploy/build.sh          # 构建并推 SWR（Jenkins 流水线形态）
docker run -p 8080:80 sdlc-platform-web:local             # 本地验证（上游已 baked，无需传 -e）
```

SPA fallback、`/assets` 长缓存、`index.html` no-cache、SSE 不缓冲（30min 读超时）均复刻自后端
`_mount_static`/`static_cache`，见 `deploy/nginx.conf.template`。

## 结构

- `src/App.vue`：hash 路由（#/iters · #/iters/<name> · #/reqs · #/reqs/<id> · #/cases）+ 侧栏 + AI 助理抽屉
- `src/components/`：ReqDetail（八 tab 工作台）/ ReqList / CaseList / IterList / TaskPanel / Chat（AI 助理）等
- `src/trace.js`：全程可追溯跳转内核（切 tab → 滚动定位 → 高亮；失败诚实 toast）
- `src/api.js`：fetch 封装；`src/render.js`：marked + DOMPurify 消毒渲染
