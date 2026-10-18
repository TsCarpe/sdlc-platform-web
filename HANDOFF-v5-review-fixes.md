# V5 Review 修复交接单（2026-10-18）

> 交接自 DESIGN-V5 三期三仓全面 review 会话（26 条分级清单，7 条已修复，3 条并发修复待开工）。
> 本文档自包含——新会话读完即可开工，无需原会话上下文。
>
> **2026-10-18 更新：批2（#3/#4/#5）已完成并部署**——两批合一个 commit（用户裁决），web 基线 135 passed，线上 hash `D9Pc1Qkh`。剩余排期项见文末。
>
> **2026-10-18 终态：批3（排期项全表 13 条）已完成并部署**——批1+2 前置提交（web `0b8817e` / server `2f2ef35` / skills `5886880`）→ 批3 web `b0fd501`（147 passed，+12 用例）/ server `6f2b1be`（156 passed + 1 skipped，+8 用例）。方案经对抗评估修订（#23 弃手写引号状态机改 shlex 令牌流——手写版会把 fail-closed 改 fail-open：`curl \"; cmd` 中 `\"` 是 sh 转义字面引号、`;` 是真分隔符）。黑盒 verify-v5/change/gate/m2 + verify-all 全绿，线上 hash `C5geUMET`。#7-#9/#11-#13/#16/#19-#25 全修；#26 记档不修（用户裁决）；仅剩手验项：#21 长文档摘引点击居中、#7 手点过滤组合已定论块常驻。

## 背景

DESIGN-V5「澄清工作台」重构（2026-10-16~17 三期，web/server/skills 三仓）完成后的全面 review 产出 26 条分级发现。严重 1 条 + 重要 5 条 + 建议 14 条 + nit 6 条。批1 已修 7 条，批2 已修 #3/#4/#5（并发交错同根因），其余排期/记档。

## ⚠️ 前置事项（批1 时点记录；批2 完成后已按用户裁决两批合一个 commit 提交）

1. ~~**先 commit 当前工作树的 7 条修复**（上一会话已完成但未提交）~~。只收以下文件：
   - **web**（sdlc-platform-web）：`src/composables/trace-jump.js`、`src/composables/group-collapse.js`、`src/components/WorkbenchTab.vue`、`tests/req-detail.spec.js`、`tests/workbench.spec.js`，外加 untracked 的 `design-mock/`（交互原型入库，设计文档引用它）
   - **server**（sdlc-platform-server）：`src/platform_sdlc/services/change.py`、`tests/test_v5_clarify.py`、`scripts/verify-all.sh`、`docs/DESIGN-V5-澄清工作台.md`。**不要**收 `.playwright-mcp/`、`tasks/`（非本批产物）
   - **skills**（claude-sdlc-skills）：**只收 `skills/sdlc-sync/SKILL.md`**。⚠️ 工作树里 dimensions.md / incrementalal-guide.md / evals/* / outputs/ 是**其他会话的在途改动，绝对不要碰、不要一起提交**
   - 建议 commit message：`修复：V5 review 批1——audit:跳转父组折叠静默失效/空态右栏/danglingPids口径/pull-answers补status等 7 项（26 条清单见 HANDOFF）`
2. **skills 仓有其他 claude-sdlc-skills-* 会话在跑**，改 skills 仓前先 `git status` 确认别人的改动仍在途。
3. **8080 部署链**（修复要生效必须走全）：web `npm run build` → `cp -R dist/. <server仓>/static/` → 杀 uvicorn 进程同命令重启（`nohup .venv/bin/uvicorn platform_sdlc.main:create_app --factory --host 0.0.0.0 --port 8080 > /tmp/sdlc-8080.log 2>&1 &`）→ curl 首页核对 `assets/index-*.js` hash 与 dist 一致。当前线上 hash：`B5gO1AyN`。

## 批2 任务：#3/#4/#5 并发交错（同根因——blur PUT 不进串行链）【✅ 2026-10-18 已完成】

三条都在 `sdlc-platform-web/src/components/WorkbenchTab.vue`，根因同一：`saveAnswer`/`saveExtra`（textarea blur 保存）直发 PUT 不进 per-seq 串行链，与链内点选 PUT / 处置 PUT 自由竞速。设计文档 §2.3 裁决「blur 不进链（在途丢弃）」时未讨论跨路径交错——三条是设计盲区的实现体现。

### #3【重要】点选 PUT 在途回写切视图，销毁正在输入的 extra textarea【已修】
- 位置：`WorkbenchTab.vue:239-244`（.then 回写 `it.status='answered'`）+ 518/527/547-551（v-if 分支切换）
- 场景：点选项 A（PUT 在途，status 仍 pending 选项区可交互）→ 点「以上都不对」展开 textarea 输入补充 → PUT 返回回写 status='answered' → 模板切 done-ans 分支卸载 textarea（Vue 卸载聚焦元素**不派发 blur**）→ saveExtra 不执行，输入滞留 extra reactive；此后点「重新作答」→ reopen 的 `delete extra[it.seq]`（:369）彻底丢失。
- **修法（批2）**：pickOption .then 回写后调 `flushPendingExtra(it, captured)`——最新装配 ≠ 捕获值即替 textarea 补一次链内 PUT（替身 blur，body 带 status:'answered'）；链深 `chainDepth[seq] > 0`（连点/blur 已在链）则不补——后续 PUT 的 makeBody 必然捎带最新值。另修同族路径：`toggleExtra` 收起 extra 面板 = 卸载无 blur → 收起即替身 saveExtra（幂等零 PUT）。

### #4【重要】处置 PUT 与在途 blur PUT 竞速——驳回/挂起可被后到作答 PUT 整行覆写【已修】
- 位置：`WorkbenchTab.vue:306-332`（saveAnswer 直发、body 无 status）+ 342-357（confirmDispose 进链）+ server `requirement.py:313-337`（set_answer 无 status 且 answer 非空 → final_status='answered'、note='' → set_disposition **整行覆写**）
- 场景：textarea 输入后点「驳回」→ blur 先于 click，作答 PUT 已直发（disposeDlg 尚 null 拦不住已发出的请求）→ 弹窗确认 → 处置 PUT 入链发出 → 两 PUT 并发；blur PUT 后到则驳回被静默打回 answered 且**理由被清**。窗口=PUT 在途 1-3 秒（慢网），后果数据丢失。
- **修法（批2）**：saveAnswer 与 saveExtra 统一入 enqueuePut 串行链（blur PUT 先入链先发、处置 PUT 排队后到——整行覆写语义下后到处置=正确终态）；§2.3 在途丢弃语义保留：savingSeqs 在途/排队期间连续 blur 丢弃（丢弃的是重复请求，排队中 makeBody 发送时装配捎带最新值）。

### #5【重要】saveExtra 与在途点选 PUT 网络乱序——extra 丢失【已修】
- 位置：`WorkbenchTab.vue:253-263`（saveExtra 直发）+ 219-225（串行链）
- 场景：点 A（PUT1 捕获时 extra=''）→ PUT1 在途期间展开 extra 输入并 blur（PUT2 直发含 extra）→ PUT2 先到 PUT1 后到 → 终值=PUT1（无 extra）；捕获语义使本地与库一致地无 extra——用户输入静默丢失。
- **修法（批2）**：saveExtra 直发改 enqueuePut 入链 + makeBody 发送时装配（最后值胜跨路径贯彻）；乱序被串行结构性消灭。enqueuePut run 改为透传发送时 body（await 方回写=实际发送值）。
- **测试（批2）**：`tests/workbench.spec.js` 原「连点+在途补充」改写为 #5 乱序终值锁（排队不并发→release 串行发出→终值含 extra）；新增 #3 锁（卸载补存）、#4 锁（处置排队+终态驳回理由保留）、在途丢弃语义回归锁——共 4 用例，web 基线 132 → **135 passed**。

### 验证基线（批2 改完实测全绿）
- web：`npm test -- --run` → **135 passed**（批1 基线 132 + 新增 3）
- server：`cd sdlc-platform-server && uv run pytest` → **148 passed + 1 skipped**（未改 server 代码，回归确认）
- 黑盒：`node scripts/verify-change.mjs` + `node scripts/verify-v5.mjs` 均通过（8080）
- 部署链走完：线上 hash `D9Pc1Qkh`（旧 `B5gO1AyN`）

## 排期项（本轮不做，后续批）

- #7 过滤视图下已定论块随空组消失（`WorkbenchTab.vue:143-155`）
- #8 dimFilter 残留 + hasLayers 翻转左栏全空无法解除（:127-149；修法 watch hasLayers 变 false 清 dimFilter）
- #9 pickOption PUT 失败 picked 视觉残留（:233-246；失败回调 delete picked）
- #11 options 元素级零校验零归一——白名单体系漏网面（server `requirement.py:174` + `change.py` _machine_clarify；修法补 option_view 四键白名单两路同构）
- #12 optionText 空白串通过非空判别（server `common.py:196-199`；修法 `if not text.strip()`）
- #13 载荷字符串化绕开 _as_text + answer_text_of(None) 返 None（server `common.py:179-204`）
- #16 状态机泳道化未做（设计 §3 承诺二期但 §8 未列——设计内部脱节，需在设计文档记档 backlog）
- #19 gate「无实质变更复审 409」分支零测试覆盖（verify-gate 注释自认「此处不测」）
- #20 测试强度两项：`test_v5_clarify.py:527` 恒真 or 断言（改 `assert merge["danglingPids"] == 0`——注意批1 已把该用例 flows 改为 pids:["L01"]，527 行所在用例是另一个）；verify-v5 静态断言 includes 级
- nit 记档 6 条：#21 CtxPane offsetTop 口径偏移 / #22 杂项四条（无 media 图片按钮无反应、capOpen 不重置、LaneFlow gap 无 src 文案、linkifyRefs data-ref 属性逃逸面）/ #23 curl URL 分号误切 / #24 浮点 layer 归空 / #25 速查卡与动作级强度分层（79620d3 已记档）/ #26 m2 断言退状态码（记档不修——409 语义断言系 322dff4 有意权衡（文案可再演进），2026-10-18 用户裁决维持）

## 附：26 条完整清单索引

严重：#1 audit:跳转已定论卡父组折叠静默失效【已修】
重要：#2 空态右栏不渲染【已修】｜#3 extra 输入丢失【已修·批2】｜#4 处置竞速吞驳回【已修·批2】｜#5 extra 乱序丢失【已修·批2】｜#6 pull-answers 误呈现已答【已修】
建议：#7-#9 web 体验｜#10 danglingPids 口径【已修】｜#11-#13 server 边界｜#14 验收数字【已修】｜#15 2-4 口径【已修】｜#16 状态机泳道｜#17 design-mock 入库【已修】｜#18 resume 后验【已修】｜#19/#20 测试覆盖
nit：#21-#26 记档不修

批1 修复明细：#1 = trace-jump.js 兜底扩 `clientHeight===0` + group-collapse.js revealGrpFor 命中带 raw 组时 `openGrps.add(g.raw)`；#2 = WorkbenchTab 空态独立轻量 grid 分支（左 EmptyState 右 CtxPane）；#10 = change.py live_seqs 补 local_seqs_live；#18 = verify-all.sh restore() resume 后验。

批2 修复明细（#3/#4/#5，全在 WorkbenchTab.vue）：统一根因——saveExtra/saveAnswer 直发 PUT 改入 enqueuePut 串行链（makeBody 发送时装配=最后值胜，savingSeqs 保留在途丢弃）；enqueuePut run 透传发送时 body；pickOption 回写挂 flushPendingExtra（chainDepth 判重 + 替身补存）；toggleExtra 收起即替身 saveExtra。测试：workbench.spec.js 改写 1 + 新增 3 用例（乱序终值/卸载补存/处置排队/在途丢弃回归）。
