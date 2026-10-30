# AGENTS.md

## 验证产物纪律

- **截图、playwright 快照等验证产物不要写进仓内**——写到 `/tmp` 等仓外路径（用户明确要求）。
  仓内 `output/` 与 `.playwright-cli/` 已在 .gitignore，但仍优先用仓外路径，别在仓里落文件。

## 常用命令

- `npm run dev`：vite 5173（/api 代理到 127.0.0.1:8888，需后端 sdlc-platform-server 已启动）
- `npm run lint` / `npm test`（vitest）：JS/测试需 Node ≥ 20（jsdom ESM 要求；机器默认 node18 会报 ERR_REQUIRE_ESM）
- 浏览器实测：后端 8888 + 前端 5173；工作台页 `/reqs/<REQ-ID>`（如 REQ-2026-1164 有真实澄清数据）
