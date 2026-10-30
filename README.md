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

## 部署（独立镜像 + 外部入口路由）

两工程独立部署（2026-10-30 形态 C）：本仓出 nginx 镜像，**只托管静态资源**；`/api` 由外部入口
（ingress / 外部 nginx）路由到后端服务。后端纯 API 无 CORS 中间件——页面与 `/api` 必须同源到达
浏览器，这是入口层的硬约束。

```bash
ENV=dev deploy/build.sh                                   # 只构建（附 local 便利 tag）
ENV=prod REGISTRY=… ORG=… PUSH=1 deploy/build.sh          # 构建并推 SWR（Jenkins 流水线形态）
docker run -p 8080:80 sdlc-platform-web:local             # 本地验证（/api 未路由 → 显式 502 提示）
```

### 外部入口必配

两条路由，同一 host（保证同源）：

| 路径 | 指向 |
|---|---|
| `/`（含深链） | 前端服务 :80 |
| `/api/` | 后端服务 :8888 |

**SSE 必须配在入口层**，否则聊天流/任务进度会被默认 60s 读超时掐断（后端 SSE 生命周期上限 30min）：

- nginx：`proxy_buffering off; proxy_read_timeout 1800s;`
- ingress-nginx：`nginx.ingress.kubernetes.io/proxy-buffering: "off"` + `nginx.ingress.kubernetes.io/proxy-read-timeout: "1800"`

镜像内 `deploy/nginx.conf` 已承接 SPA fallback、`/assets` 长缓存、`index.html` no-cache（复刻后端
`_mount_static`/`static_cache`）；未路由的 `/api` 返回显式 502 文案，便于排障。

## 结构

- `src/App.vue`：hash 路由（#/iters · #/iters/<name> · #/reqs · #/reqs/<id> · #/cases）+ 侧栏 + AI 助理抽屉
- `src/components/`：ReqDetail（八 tab 工作台）/ ReqList / CaseList / IterList / TaskPanel / Chat（AI 助理）等
- `src/trace.js`：全程可追溯跳转内核（切 tab → 滚动定位 → 高亮；失败诚实 toast）
- `src/api.js`：fetch 封装；`src/render.js`：marked + DOMPurify 消毒渲染
