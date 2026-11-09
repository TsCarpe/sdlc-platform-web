<script setup>
// 快速上手（图文操作手册）：需求链路五步——提交需求 → AI 质检 → 逐题澄清 → 合成定稿 → 审阅发布。
// 配图为界面示意图：复用平台真实样式类拼装（与真界面同形），示例数据为中性虚构；黄色序号钉
// 与左侧操作步骤一一对应（spec 守护）。示意图整体惰性：aria-hidden + 无可聚焦元素 + 不响应指针，
// 信息以文字步骤为准。目录复用 TocPane + useTocScroll（与标准文档页同一套滚动高亮协议）。
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
// import NodeStrip from './NodeStrip.vue'
import TocPane from './TocPane.vue'
import { useTocScroll } from '../composables/toc-scroll.js'

const emit = defineEmits(['go'])

const STEPS = [
  { id: 'qs-s1', no: 1, title: '提交需求', desc: '粘贴文本或飞书文档链接' },
  { id: 'qs-s2', no: 2, title: 'AI 质检', who: 'both', desc: '梳理 + 体检，产出澄清问题' },
  { id: 'qs-s3', no: 3, title: '逐题澄清', desc: '点选 AI 推荐答案或自己写' },
  { id: 'qs-s4', no: 4, title: '合成定稿', who: 'ai', desc: '以原文为底稿合入全部结论' },
  { id: 'qs-s5', no: 5, title: '审阅发布', desc: '定稿锁定，下游自动开工' }
]
const WHO = { ai: 'AI 自动合成', both: 'AI 执行' }
const step = Object.fromEntries(STEPS.map(s => [s.no, s]))

const toc = [
  { id: 'qs-flow', level: 1, text: '流程总览' },
  ...STEPS.map(s => ({ id: s.id, level: 1, text: `${s.no}. ${s.title}` })),
  { id: 'qs-next', level: 1, text: '发布之后' },
  { id: 'qs-faq', level: 1, text: '常见问题' }
]

// const publishedNodes = [
//   { label: '质检', st: 'done' }, { label: '澄清', st: 'done' }, { label: '发布', st: 'done' },
//   { label: '设计', st: 'todo' }, { label: '用例', st: 'doing' }, { label: '门禁', st: 'todo' }, { label: '放行', st: 'todo' }
// ]

const NEXT = [
  { icon: 'flask', title: '用例', text: '发布后自动生成测试用例草稿，到「用例」页签审阅登记' },
  { icon: 'git-branch', title: '设计', text: 'A/B 级需求在「设计」页签配置目标代码仓、生成技术设计并定稿；C 级可声明轻量跳过' },
  { icon: 'check-circle', title: '门禁', text: '设计定稿、用例全部定稿、需求点全覆盖三条件全绿后「开评审」，逐条裁决后放行' },
  { icon: 'refresh-cw', title: '变更', text: '已发布需求要改，在「变更」页签提变更单，只重检受影响章节后重新发布，不用重新开卡' }
]

const FAQ = [
  { q: '提交后迟迟看不到「开始质检」按钮？',
    a: '流水线上有任务在排队或执行时（例如提交后自动排队的「原文导入」），主按钮会暂时隐藏。等任务完成、状态圆点变绿，「开始质检」就会出现。' },
  { q: '任务失败了怎么办？',
    a: '展开流水线的「任务历史」，可以看到失败原因和处理提示；按提示处理后点「重试」即可。因需求已发布而作废的任务不可重试。' },
  { q: '提交后发现原文写错了？',
    a: '发布前：在「原始需求」页签点「编辑原文」直接修改，保存后按页面提示「重新质检」。发布后：到「变更」页签提变更单，确认后只重检受影响的章节。' },
  { q: '重新质检会冲掉已经答过的题吗？',
    a: '不会。重新质检后，题号与问题文本都没变的题保留原答复，只有问题文本变化的题需要重新作答；由评论升级来的澄清题不受影响。' },
  { q: '写操作提示 401 或被拒绝？',
    a: '服务端开启了写保护：在侧栏底部「写令牌」中粘贴令牌即可，令牌只保存在本机浏览器。' }
]

const root = ref(null)
const { activeHead, showTop, goToc, toTop } = useTocScroll({
  tab: ref('guide'),
  headEls: () => (root.value ? [...root.value.querySelectorAll('.qs-anchor')] : []),
  goOrigin: () => {}
})
</script>

<template>
  <div class="qs" ref="root">
    <div class="qs-layout">
      <div class="qs-main">
        <section class="card qs-hero">
          <span class="qs-kicker"><AppIcon name="book-open" :size="12" />快速上手 · 需求链路</span>
          <h2>从一份原始需求，到开发可以直接开工的标准需求文档</h2>
          <p>你只需要做 4 件事：提交原文、启动质检并采纳、逐题澄清、审阅发布。原文导入、AI 质检、标准文档合成都在后台完成——AI 的每一份产出都先以草稿回传，经你确认才生效。</p>
          <p class="qs-aud">产品经理负责提交与澄清；研发、测试直接阅读发布后的标准需求文档。</p>
          <div class="qs-hero-act">
            <button class="btn primary" @click="emit('go', 'iters')">去生成标准需求文档<AppIcon name="arrow-right" :size="13" /></button>
            <!-- <span class="qs-muted">文中界面图均为示意，数据为虚构示例</span> -->
          </div>
        </section>

        <h2 class="qs-h qs-anchor" id="qs-flow">流程总览</h2>
        <ol class="qs-flow">
          <li v-for="s in STEPS" :key="s.id">
            <button class="qs-flow-node" @click="goToc(s.id)">
              <span class="qs-flow-top">
                <span class="qs-no">{{ s.no }}</span>
                <span class="qs-who" v-if="s.who">{{ WHO[s.who] }}</span>
              </span>
              <b>{{ s.title }}</b>
              <span class="qs-flow-desc">{{ s.desc }}</span>
            </button>
          </li>
        </ol>
        <section class="qs-step">
          <header class="qs-step-h">
            <span class="qs-step-no">1</span>
            <div class="qs-step-ht">
              <h2 class="qs-anchor" :id="step[1].id">{{ step[1].title }}</h2>
              <p>先建迭代，再把需求原文交给平台</p>
            </div>
          </header>
          <div class="qs-step-b">
            <div class="qs-text">
              <ol class="qs-ops">
                <li><i class="qs-pin">1</i><span>在「迭代列表」右上角点 <b>「新建迭代」</b>，填写迭代名（如 v2.1.0）后创建</span></li>
                <li><i class="qs-pin">2</i><span>在列表里点开这个<b>空迭代</b></span></li>
                <li><i class="qs-pin">3</i><span>填写需求名称，选择提交渠道——<b>粘贴文本</b>或<b>飞书文档链接</b>，点 <b>「提交需求并绑定迭代」</b></span></li>
              </ol>
              <!-- <div class="qs-result">
                <b><AppIcon name="check-circle" :size="13" />你会得到</b>
                <p>需求卡建好，状态为「已提交」。平台随即自动导入原文，按标题、段落、列表、表格逐块结构化，展示在「原始需求」页签——之后所有出处引用都能一键跳回原文对应条款。</p>
              </div> -->
              <div class="qs-tips">
                <b><AppIcon name="info" :size="13" />小贴士</b>
                <ul>
                  <li>飞书文档需对组织内可读；没有权限时导入会失败，并在流水线里提示原因</li>
                  <li>飞书文档的图片、表格和评论会一并导入，原文越完整，AI 质检越准</li>
                </ul>
              </div>
            </div>
            <figure class="qs-fig" role="img" aria-label="示意图：迭代列表点「新建迭代」，点开空迭代，填写并提交需求">
              <div class="qs-mock" aria-hidden="true">
                <div class="qs-mock-top"><AppIcon name="panel" :size="13" /><b>迭代列表</b></div>
                <div class="qs-mock-b">
                  <div class="qs-mock-row">
                    <span class="qs-fake-input"><AppIcon name="search" :size="12" />搜索迭代名 / 需求名 / 需求编号</span>
                    <span class="qs-hot"><span class="btn small primary"><AppIcon name="plus" :size="12" />新建迭代</span><i class="qs-pin">1</i></span>
                  </div>
                  <div class="qs-hot blk">
                    <div class="iter-row">
                      <div class="iter-main">
                        <div class="iter-name"><b>v2.1.0</b><span class="sub">会员中心二期</span></div>
                        <div class="iter-req"><span class="badge b-gray">空迭代</span><span class="qs-muted">尚未提交需求——进入后可在页内提交</span></div>
                      </div>
                      <AppIcon name="chevron-right" :size="15" />
                    </div>
                    <i class="qs-pin">2</i>
                  </div>
                  <div class="card">
                    <h3><AppIcon name="clipboard-list" :size="14" />提交需求（绑定到 v2.1.0）</h3>
                    <div class="field"><label><em>*</em>需求名称</label><span class="qs-fake-input">会员积分兑换</span></div>
                    <div class="field"><label>提交渠道</label>
                      <div class="seg">
                        <span class="seg-opt on"><i class="qs-radio on"></i><span><span class="seg-t">粘贴文本</span><br><span class="seg-d">直接粘贴需求原文</span></span></span>
                        <span class="seg-opt"><i class="qs-radio"></i><span><span class="seg-t">飞书文档链接</span><br><span class="seg-d">从飞书拉取原文快照</span></span></span>
                      </div>
                    </div>
                    <div class="field"><label><em>*</em>需求文本</label>
                      <span class="qs-fake-input ta">3. 积分规则<br>3.1 用户可使用积分兑换商城商品，积分按年度结算。<br>3.2 积分有效期一年，到期自动作废……</span></div>
                    <span class="qs-hot"><span class="btn primary">提交需求并绑定迭代</span><i class="qs-pin">3</i></span>
                  </div>
                </div>
              </div>
              <figcaption>界面示意 · 虚构示例数据</figcaption>
            </figure>
          </div>
        </section>
        <section class="qs-step">
          <header class="qs-step-h">
            <span class="qs-step-no">2</span>
            <div class="qs-step-ht">
              <h2 class="qs-anchor" :id="step[2].id">{{ step[2].title }}</h2>
              <p>AI 先读懂需求，再逐层体检，把没写清楚的地方整理成澄清问题</p>
            </div>
            <span class="qs-who">{{ WHO[step[2].who] }}</span>
          </header>
          <div class="qs-step-b">
            <div class="qs-text">
              <ol class="qs-ops">
                <li><i class="qs-pin">1</i><span>「原文导入」完成后，在 <b>「线上流水线」</b> 点 <b>「开始质检」</b>，确认创建任务</span></li>
                <li><i class="qs-pin">2</i><span>质检完成后，<b>「需求摘要」</b> 页签出现「!」角标，点进去核对草稿</span></li>
                <li><i class="qs-pin">3</i><span>核对无误，点 <b>「采纳（进入待澄清）」</b></span></li>
              </ol>
              <!-- <div class="qs-result">
                <b><AppIcon name="check-circle" :size="13" />你会得到</b>
                <p>需求摘要（角色、功能点地图、主流程泳道、状态机、FR 需求点）、体检问题与澄清清单正式生效，需求进入「待澄清」；标题旁会显示按阻断 / 严重问题数评定的原文质量星级。</p>
              </div> -->
              <!-- <p class="qs-outcome">采纳后，需求摘要、体检问题和澄清清单正式生效，需求状态变为「待澄清」。摘要包含角色、功能点地图、主流程泳道、状态机和 FR 需求点。需求标题旁会显示原文质量星级，阻断和严重问题越少，星级越高。</p> -->
              <div class="qs-tips">
                <b><AppIcon name="info" :size="13" />小贴士</b>
                <ul>
                  <li>有任务在排队或执行时，流水线主按钮会暂时隐藏，任务完成后自动出现</li>
                  <li>泳道图中的虚线节点是原文没写清的断点，点击直达对应澄清题</li>
                </ul>
              </div>
            </div>
            <figure class="qs-fig" role="img" aria-label="示意图：在线上流水线点「开始质检」，质检完成后在「需求摘要」页签采纳质检三件套草稿">
              <div class="qs-mock" aria-hidden="true">
                <div class="qs-mock-top"><AppIcon name="panel" :size="13" /><span class="qs-crumb">迭代列表 /</span><b>v2.1.0</b></div>
                <div class="qs-mock-b">
                  <div class="detail-h"><span class="qs-mock-h">会员积分兑换</span><span class="chip">REQ-2026-018</span><span class="badge b-gray">已提交</span></div>
                  <div class="card taskpanel">
                    <div class="tp-bar">
                      <div class="tp-title"><AppIcon name="layers" :size="15" />线上流水线</div>
                      <div class="tp-stages">
                        <span class="tp-stage"><i class="st-dot done"></i>原文导入</span>
                        <span class="tp-stage"><i class="st-dot"></i>需求质检</span>
                        <span class="tp-stage"><i class="st-dot"></i>标准文档合成</span>
                      </div>
                      <div class="tp-actions"><span class="qs-hot"><span class="btn small primary"><AppIcon name="play" :size="12" />开始质检</span><i class="qs-pin">1</i></span></div>
                    </div>
                  </div>
                  <div class="qs-mock-sep">质检完成后</div>
                  <div class="tabs">
                    <span class="tab">原始需求</span>
                    <span class="qs-hot"><span class="tab on">需求摘要<span class="n draft">!</span></span><i class="qs-pin">2</i></span>
                    <span class="tab">澄清工作台</span>
                    <span class="tab">标准需求文档</span>
                  </div>
                  <div class="draftbar">
                    <span class="badge b-amber">待确认</span><b>质检三件套草稿</b>
                    <span class="chip">澄清问题 12</span><span class="chip">需求点 9</span><span class="chip">体检问题 15</span>
                    <span class="tp-act">
                      <span class="btn small danger">丢弃</span>
                      <span class="qs-hot"><span class="btn primary"><AppIcon name="check-circle" :size="13" />采纳（进入待澄清）</span><i class="qs-pin">3</i></span>
                    </span>
                  </div>
                </div>
              </div>
              <figcaption>界面示意 · 虚构示例数据</figcaption>
            </figure>
          </div>
        </section>
        <section class="qs-step">
          <header class="qs-step-h">
            <span class="qs-step-no">3</span>
            <div class="qs-step-ht">
              <h2 class="qs-anchor" :id="step[3].id">{{ step[3].title }}</h2>
              <p>把「不清楚」变成「已确定」，多数问题点一下就能答完</p>
            </div>
          </header>
          <div class="qs-step-b wide">
            <div class="qs-text">
              <ol class="qs-ops">
                <li><i class="qs-pin">1</i><span>打开 <b>「澄清工作台」</b>，每道题都附有 AI 拟好的选项，标 <b>「✦ AI 推荐」</b> 的附推荐理由，<b>点选即保存</b></span></li>
                <li><i class="qs-pin">2</i><span>选项都不合适时点 <b>「以上都不对，我要自己写」</b>；认定不是问题点 <b>「驳回（不是问题）」</b>（需填理由）；本期不做点 <b>「挂起（转遗留假设）」</b></span></li>
                <li><i class="qs-pin">3</i><span>右侧 <b>「原始需求 · 上下文」</b> 自动高亮当前题的出处，不用来回翻原文</span></li>
              </ol>
            </div>
            <div class="qs-text">
              <!-- <div class="qs-result">
                <b><AppIcon name="check-circle" :size="13" />你会得到</b>
                <p>进度条走满即完成——作答、驳回、挂起都算已处置。全部处置完，平台自动开始合成标准需求文档。</p>
              </div> -->
              <div class="qs-tips">
                <b><AppIcon name="info" :size="13" />小贴士</b>
                <ul>
                  <li>澄清问题按原文章节分组：红色「阻断」优先，黄色「存疑」、蓝色「建议」其次</li>
                  <li>打开「答完自动下一题」可连续作答，「跳到下一待处置」帮你找出漏答的题</li>
                  <li>对原文有疑问也可以直接评论；需要正式追踪时点「升级澄清」，评论会变成一道澄清题</li>
                </ul>
              </div>
            </div>
            <figure class="qs-fig" role="img" aria-label="示意图：澄清工作台中点选 AI 推荐选项，右侧原始需求上下文高亮当前题出处">
              <div class="qs-mock" aria-hidden="true">
                <div class="qs-mock-top"><AppIcon name="panel" :size="13" /><span class="qs-crumb">v2.1.0 /</span><b>澄清工作台</b></div>
                <div class="qs-mock-b qs-wb">
                  <div class="qs-wb-q">
                    <div class="wb-prog">
                      <div class="row1">
                        <span class="lbl"><AppIcon name="info" :size="13" /><b class="ttl">澄清进度</b><span class="hint">逐题作答 · 点选即保存</span></span>
                        <span class="n"><b>4</b><span class="tot">/12</span></span>
                      </div>
                      <div class="bar"><span class="bar-fill" style="width:33%"></span></div>
                    </div>
                    <div class="check-item red">
                      <div class="ci-head"><span class="badge b-red">阻断</span><span class="chip">P03</span><span class="theme-tag">积分规则</span></div>
                      <div class="q">积分有效期「一年」按自然年清零，还是自获得之日起滚动 12 个月？</div>
                      <div class="ctx">出处：<span class="cite anchored">详述3·积分有效期<span class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></span></div>
                      <div class="opts">
                        <div class="qs-hot blk">
                          <div class="opt rec"><span class="radio"></span><span class="body"><span class="rec-tag">✦ AI 推荐</span><b>A · 按自然年清零（每年 12 月 31 日）</b><span class="why">推荐理由：3.1「积分按年度结算」与自然年口径一致</span></span></div>
                          <i class="qs-pin">1</i>
                        </div>
                        <div class="opt"><span class="radio"></span><span class="body"><b>B · 自获得之日起滚动 12 个月</b></span></div>
                      </div>
                      <div class="ans-ops">
                        <span class="qs-hot"><span class="btn small link">驳回（不是问题）</span><span class="btn small link">挂起（转遗留假设）</span><span class="more-answer">以上都不对，我要自己写 ▾</span><i class="qs-pin">2</i></span>
                      </div>
                    </div>
                  </div>
                  <div class="qs-hot blk qs-wb-ctx">
                    <div class="qs-ctx">
                      <div class="ctx-head"><AppIcon name="file-text" :size="14" /><div class="ctx-ht"><b>原始需求 · 上下文</b></div><span class="follow on"><span class="dot"></span>跟随定位</span></div>
                      <div class="qs-ctx-body">
                        <div class="ctx-blk ctx-h">3. 积分规则</div>
                        <div class="ctx-blk ctx-li">3.1 用户可使用积分兑换商城商品，积分按年度结算</div>
                        <div class="ctx-blk ctx-li ctx-hl">3.2 积分有效期一年，到期自动作废</div>
                        <div class="ctx-blk ctx-li">3.3 兑换成功后不可退回</div>
                        <div class="ctx-blk ctx-li">3.4 积分不足时不能兑换</div>
                      </div>
                    </div>
                    <i class="qs-pin">3</i>
                  </div>
                </div>
              </div>
              <figcaption>界面示意 · 虚构示例数据</figcaption>
            </figure>
          </div>
        </section>
        <section class="qs-step">
          <header class="qs-step-h">
            <span class="qs-step-no">4</span>
            <div class="qs-step-ht">
              <h2 class="qs-anchor" :id="step[4].id">{{ step[4].title }}</h2>
              <p>以原文为底稿，把全部澄清结论合进正文，生成完整定稿</p>
            </div>
            <span class="qs-who">{{ WHO[step[4].who] }}</span>
          </header>
          <div class="qs-step-b">
            <div class="qs-text">
              <ol class="qs-ops">
                <li><i class="qs-pin">1</i><span>全部问题处置完后，平台自动排队 <b>「标准文档合成」</b> 任务，无需手动操作</span></li>
                <li><i class="qs-pin">2</i><span>合成完成后，<b>「标准需求文档」</b> 页签出现「!」角标</span></li>
              </ol>
              <!-- <div class="qs-result">
                <b><AppIcon name="check-circle" :size="13" />你会得到</b>
                <p>一份开发拿来就能开工、AI 也能独立读懂的定稿草稿：原文的数值、枚举、例外条款一条不丢；已确认的结论就地合入并标注来源题号；被推翻的原文保留删除线和定案说明；挂起和未定的口径汇总为「遗留假设」。</p>
              </div> -->
              <!-- <p class="qs-outcome">合成结果先保存为草稿，审阅发布后才生效。原文中的数值、枚举和例外条款都会保留，澄清结论的写法见下方的合成前后对比。</p> -->
              <div class="qs-tips">
                <b><AppIcon name="info" :size="13" />小贴士</b>
                <ul>
                  <li>自动任务被取消了？在流水线「⋯」菜单里点「生成标准文档」补排</li>
                </ul>
              </div>
            </div>
            <figure class="qs-fig" role="img" aria-label="示意图：标准文档合成任务自动执行，完成后「标准需求文档」页签出现提示">
              <div class="qs-mock" aria-hidden="true">
                <div class="qs-mock-top"><AppIcon name="panel" :size="13" /><span class="qs-crumb">迭代列表 /</span><b>v2.1.0</b></div>
                <div class="qs-mock-b">
                  <div class="qs-hot blk">
                    <div class="card taskpanel">
                      <div class="tp-bar">
                        <div class="tp-title"><AppIcon name="layers" :size="15" />线上流水线</div>
                        <div class="tp-stages">
                          <span class="tp-stage"><i class="st-dot done"></i>原文导入</span>
                          <span class="tp-stage"><i class="st-dot done"></i>需求质检</span>
                          <span class="tp-stage"><i class="st-dot running"></i>标准文档合成</span>
                        </div>
                      </div>
                      <div class="tp-task"><span class="spin"></span><b>标准文档合成</b><span class="chip">自动</span>执行中</div>
                    </div>
                    <i class="qs-pin">1</i>
                  </div>
                  <div class="qs-mock-sep">合成完成后</div>
                  <div class="tabs">
                    <span class="tab">原始需求</span>
                    <span class="tab">需求摘要</span>
                    <span class="tab">澄清工作台<span class="n">✓</span></span>
                    <span class="qs-hot"><span class="tab on">标准需求文档<span class="n draft">!</span></span><i class="qs-pin">2</i></span>
                  </div>
                </div>
              </div>
              <figcaption>界面示意 · 虚构示例数据</figcaption>
            </figure>
          </div>
          <div class="qs-ba-wrap">
            <div class="qs-ba-h">合成前后对比（示例）</div>
            <figure class="qs-ba" role="img" aria-label="示意图：原始需求与标准需求文档定稿的逐条对比">
              <div class="qs-ba-col" aria-hidden="true">
                <div class="qs-ba-t"><AppIcon name="file-text" :size="13" />原始需求</div>
                <div class="doc">
                  <p>3.2 积分有效期一年，到期自动作废。</p>
                  <p>3.3 兑换成功后不可退回。</p>
                  <p>3.4 积分不足时不能兑换。</p>
                </div>
              </div>
              <div class="qs-ba-arrow" aria-hidden="true"><AppIcon name="arrow-right" :size="18" /></div>
              <div class="qs-ba-col after" aria-hidden="true">
                <div class="qs-ba-t"><AppIcon name="check-circle" :size="13" />标准需求文档（定稿）</div>
                <div class="doc">
                  <p>3.2 积分按自然年计算，每年 12 月 31 日 24:00 统一清零。✅（<span class="reflink">P03</span>）</p>
                  <p><del>3.3 兑换成功后不可退回。</del><span class="qs-ba-note">废弃：以 P07 结论为准</span></p>
                  <p>3.3 兑换后未发货可申请退回；已发货商品按售后流程处理。✅（<span class="reflink">P07</span>）</p>
                  <p>⚠️ <span class="reflink">需求.A02</span>：积分不足时兑换按钮置灰〔P11·挂起〕</p>
                </div>
              </div>
            </figure>
            <div class="qs-legend">
              <span><b>✅（Pxx）</b>已确认的澄清结论，标出来源题号</span>
              <span><b><del>删除线</del></b>被结论推翻的原文条款，附定案说明</span>
              <span><b>⚠️ 需求.Axx</b>遗留假设：挂起或尚未定案的口径</span>
            </div>
          </div>
        </section>
        <section class="qs-step">
          <header class="qs-step-h">
            <span class="qs-step-no">5</span>
            <div class="qs-step-ht">
              <h2 class="qs-anchor" :id="step[5].id">{{ step[5].title }}</h2>
              <p>确认无误后再发布，发布即锁定文档</p>
            </div>
          </header>
          <div class="qs-step-b">
            <div class="qs-text">
              <ol class="qs-ops">
                <li><i class="qs-pin">1</i><span>在 <b>「标准需求文档」</b> 页签切到 <b>「渲染预览」</b> 通读全文，需要修改就切回 <b>「编辑」</b></span></li>
                <li><i class="qs-pin">2</i><span>改完点 <b>「保存草稿」</b></span></li>
                <li><i class="qs-pin">3</i><span>确认无误，点 <b>「发布（终态锁定）」</b></span></li>
              </ol>
              <!-- <div class="qs-result">
                <b><AppIcon name="check-circle" :size="13" />你会得到</b>
                <p>需求进入「已发布」，答复与定稿锁定；正文中的 FR / P / 需求.A 编号都能点击跳回原文和澄清记录。平台随即自动排队「用例生成」，设计与门禁页签同时解锁。</p>
                <NodeStrip :nodes="publishedNodes" />
              </div> -->
              <!-- <p class="qs-outcome">发布后需求状态变为「已发布」，文档和澄清答复都不能再直接修改。正文中的 FR、P、需求.A 编号可以点击，跳回对应的原文条款和澄清记录。平台会自动排队「用例生成」任务，「设计」和「门禁」页签同时解锁。</p> -->
              <div class="qs-tips">
                <b><AppIcon name="info" :size="13" />小贴士</b>
                <ul>
                  <li>编辑内容与 AI 草稿不一致时，发布前会提示差异，确认后以编辑内容为准</li>
                  <li>发布后需求有变化不用重新开卡：在「变更」页签提变更单，只重检受影响章节</li>
                </ul>
              </div>
            </div>
            <figure class="qs-fig" role="img" aria-label="示意图：标准需求文档草稿的渲染预览、保存草稿与发布">
              <div class="qs-mock" aria-hidden="true">
                <div class="qs-mock-top"><AppIcon name="panel" :size="13" /><span class="qs-crumb">v2.1.0 /</span><b>标准需求文档</b></div>
                <div class="qs-mock-b">
                  <div class="draftbar">
                    <span class="badge b-amber">待发布</span><b>标准需求文档草稿</b>
                    <span class="tp-act">
                      <span class="btn small danger">丢弃</span>
                      <span class="qs-hot"><span class="btn primary"><AppIcon name="send" :size="13" />发布（终态锁定）</span><i class="qs-pin">3</i></span>
                    </span>
                  </div>
                  <div class="tp-modes">
                    <span class="qs-hot"><span class="btn small">编辑</span><span class="btn small tp-on">渲染预览</span><i class="qs-pin">1</i></span>
                    <span class="qs-flex"></span>
                    <span class="qs-hot"><span class="btn small"><AppIcon name="pencil" :size="11" />保存草稿</span><i class="qs-pin">2</i></span>
                  </div>
                  <div class="doc qs-mock-doc">
                    <h1>会员积分兑换 · 标准需求文档（定稿）</h1>
                    <p class="qs-doc-meta">需求编号 REQ-2026-018 ｜ 迭代 v2.1.0 ｜ 答复进度 12/12</p>
                    <h2>一、需求概述与边界</h2>
                    <p>本期支持会员使用积分兑换商城商品，覆盖积分有效期、兑换退回、积分不足三类规则……</p>
                    <h2>三、积分规则</h2>
                    <p>3.2 积分按自然年计算，每年 12 月 31 日 24:00 统一清零。✅（<span class="reflink">P03</span>）</p>
                  </div>
                </div>
              </div>
              <figcaption>界面示意 · 虚构示例数据</figcaption>
            </figure>
          </div>
        </section>

        <h2 class="qs-h qs-anchor" id="qs-next">发布之后</h2>
        <p class="qs-lead">标准需求文档是下游所有环节的唯一输入。发布后，用例、设计、门禁在同一个迭代工作台里接着走：</p>
        <div class="qs-next">
          <div class="qs-next-item" v-for="n in NEXT" :key="n.title">
            <span class="qs-next-ico"><AppIcon :name="n.icon" :size="15" /></span>
            <b>{{ n.title }}</b>
            <p>{{ n.text }}</p>
          </div>
        </div>

        <h2 class="qs-h qs-anchor" id="qs-faq">常见问题</h2>
        <div class="qs-faq">
          <details class="qs-faq-item" v-for="f in FAQ" :key="f.q">
            <summary><AppIcon name="chevron-right" :size="13" />{{ f.q }}</summary>
            <p>{{ f.a }}</p>
          </details>
        </div>

        <div class="card qs-end">
          <p>准备好了？新建一个迭代，五步拿到你的第一份标准需求文档。</p>
          <button class="btn primary" @click="emit('go', 'iters')">去迭代列表<AppIcon name="arrow-right" :size="13" /></button>
        </div>
      </div>
      <TocPane :items="toc" :active-id="activeHead" @go="goToc" />
    </div>

    <Transition name="fade">
      <button class="to-top" v-if="showTop" @click="toTop" title="回到顶部" aria-label="回到顶部">
        <AppIcon name="arrow-up" :size="15" />
      </button>
    </Transition>
  </div>
</template>
