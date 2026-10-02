# SDLC 产物协作平台 — 前端（Web）

需求质检 + 用例登记 + 设计/门禁工作台的 Vue 3 单页应用。零运行时新依赖
（无 vue-router/状态库/UI 库；跨页跳转内核 `src/trace.js`；markdown 渲染 marked + DOMPurify，唯一例外 mermaid）。

后端在姊妹仓 `sdlc-platform-server`（FastAPI，8080）。

## 命令

```bash
npm install
npm run dev      # 5173，/api 代理到 http://127.0.0.1:8080（需后端已启动）
npm run build    # 产物 dist/
```

## 部署（同源托管）

后端从 `static/` 直出构建产物（同源无 CORS）：

```bash
npm run build
rsync -a --delete dist/ ../sdlc-platform-server/static/
```

## 结构

- `src/App.vue`：hash 路由（#/iters · #/iters/<name> · #/reqs · #/reqs/<id> · #/cases）+ 侧栏 + AI 助理抽屉
- `src/components/`：ReqDetail（八 tab 工作台）/ ReqList / CaseList / IterList / TaskPanel / Chat（AI 助理）等
- `src/trace.js`：全程可追溯跳转内核（切 tab → 滚动定位 → 高亮；失败诚实 toast）
- `src/api.js`：fetch 封装；`src/render.js`：marked + DOMPurify 消毒渲染
