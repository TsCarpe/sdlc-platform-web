# AGENTS.md

## 验证产物纪律

- **截图、playwright 快照等验证产物不要写进仓内**——写到 `/tmp` 等仓外路径（用户明确要求）。
  仓内 `output/` 与 `.playwright-cli/` 已在 .gitignore，但仍优先用仓外路径，别在仓里落文件。

## 常用命令

- `npm run dev`：vite 5173（/api 代理到 127.0.0.1:8888，需后端 sdlc-platform-server 已启动）
- `npm run lint` / `npm test`（vitest）：JS/测试需 Node ≥ 20（jsdom ESM 要求；机器默认 node18 会报 ERR_REQUIRE_ESM）
- 浏览器实测：后端 8888 + 前端 5173；工作台页 `/reqs/<REQ-ID>`（如 REQ-2026-1164 有真实澄清数据）

## 快速上手手册（/guide）

- `src/components/QuickStart.vue` 逐字引用真实按钮/页签文案（「开始质检」「采纳（进入待澄清）」「发布（终态锁定）」等）：
  改这些文案时同步改手册。示意图复用真实样式类、示例数据只用中性虚构；序号钉 ↔ 示意图对应与示意图惰性由 `tests/quick-start.spec.js` 守护。
