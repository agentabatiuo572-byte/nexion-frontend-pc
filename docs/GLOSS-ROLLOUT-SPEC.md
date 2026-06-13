# 术语 tooltip 全量铺开 · Agent 执行规格(第七轮收尾)

> 机制已建,本轮是**铺开 + 工程词清理**的体力活。每个 agent 领一组文件,在组内做 ①②③ 全部三件事。
> **读这份规格 + `lib/admin/glossary.ts`(词典 115 词)后再动手。只改分配给你的文件,绝不碰别的文件。**

---

## 0. 已有机制(背景,别重复造)

- `lib/admin/glossary.ts` — 术语→通俗解释 map(115 词,中英混)。`GLOSSARY_TERMS` 已按词长降序。
- `app/components/kit/gloss.tsx` — 两个组件:
  - `<Gloss>红冲</Gloss>` — 单个**已知术语**显式标注(词不在词典则原样)。
  - `<AutoGloss>{文本}</AutoGloss>` — **扫字符串**自动术语化(词不在词典原样、不破版面)。`children` 非 string 时原样透传。
- `globals.css .gloss` — 虚线下划线 + hover 浮层(全局)。
- **已接入(别再包,会重复)**:`design-kit.tsx` 的 `CardH.sub` / `Stat.k` / `Stat.sub` / `KV.k` / `OperationConfirmModal.action` / `OperationConfirmModal.detail` 内部**已自带 `<AutoGloss>`**。
  → 所以你在 view 里写 `<CardH sub="衰减曲线 / ..." />` 时,**不要**在调用处再包 `<AutoGloss>`;sub 的字符串会被 CardH 自动术语化。`<KV k="V-Rank" .../>` 同理。
- **禁止编辑** `design-kit.tsx` / `gloss.tsx` / `glossary.ts`(共享底层,main 统一管)。如果你发现词典缺词,**写进你的报告**,不要自己加。

---

## ① 散文本逐处包 `<AutoGloss>`

**目标**:不经过 design-kit 5 组件的「裸字符串文本」,若可能含词典术语,包一层 `<AutoGloss>`。

**先加 import**(若文件还没有):
```ts
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
```

**要包的位置**(典型):
- `<td>...descriptive 中文...</td>` 描述型单元格(非纯数字、非 mono key)。
- `<Badge tone="...">运行中</Badge>` 等状态/说明文字 → 多为大白话不命中词典,**命中才有意义**;拿不准就包,AutoGloss 不命中=原样无害。
- `tint` / `dashed` 解释块:`<div className="tint warn tiny">合并出口护栏:Direct Royalty ... 覆盖率 ...</div>` → 包整段文本。
- `.muted .tiny` 旁注:`<span className="muted tiny">供 D2 提现门 / G2 兑换门消费</span>`。
- 不走 CardH 的裸副标:`<div className="card-h"><span className="ttl">标题</span>...<span className="muted tiny">说明文字</span></div>` 里的说明文字。

**写法**:文本节点直接外包。
```tsx
// 前
<div className="tint warn tiny">越多档走 cascade · NEX 奖励派发放大流出,须核验 B1 覆盖率</div>
// 后
<div className="tint warn tiny"><AutoGloss>越多档走 cascade · NEX 奖励派发放大流出,须核验 B1 覆盖率</AutoGloss></div>
```
若一段里混了 `{变量}` 和文字(JSX 多节点),`AutoGloss` 只能吃**单个字符串**;这种**只包其中的字符串字面量子串**,或对关键术语用 `<Gloss>词</Gloss>` 点包。别硬把整个混合节点塞进 AutoGloss(非 string 会被透传,白包)。
```tsx
// 混合节点:把字符串部分单独包,变量保持原样
<div className="muted tiny">调度建议档 <span className="mono">{PHASE.current}</span>{phasePinned ? ` · 已锁定为 ${phasePin}` : " · 当前未锁定"}</div>
// 这里没术语,可不动;若有术语只点包该词,如 <Gloss>净敞口</Gloss>
```

**不要包**:纯数字、纯 mono code/key、业务记录 ID(`WD-9F3A21`/`U-88421`)、已被 5 组件自动处理的 prop。

---

## ② 工程词清理(主人已拍板)

### 2a. 删运营表里冗余的「技术 key 列」(主人:删冗余列,只留中文名)

**判据(三条全中才删)**:
1. 该列展示的是**程序员配置变量名**——camelCase / snake_case / UPPER_SNAKE,如 `trialOffsetCapUSD` `withdrawDailyCapUSD` `genesisDividendRate` `checkinPointsRange` `MIN_EFFICIENCY`;**且**
2. 同表**相邻已有**人类可读的中文「名称 / 标签」列指代同一行;**且**
3. 该列**不是** `/platform/params-registry`(A5 参数寄存器)页 —— A5 故意展示 key 作技术索引,**保留**(其 needle `回源真值`/`操作确认` 受保护)。

**操作**:删表头 `<th>...key...</th>` + 对应行的 `<td className="mono ...">{key}</td>`;**`<tr key={key}>` 的 React key 保留不动,paramKey 模板里的 `${key}` 保留不动**。
```tsx
// 前(h-view TRIAL_CONFIG)
<thead><tr><th>参数 key</th><th>名称</th><th>当前值</th><th>说明</th><th /></tr></thead>
<tbody>{TRIAL_CONFIG.map(([key, name, val, desc]) => { const eff = pget(`H.trial.${key}`) ?? val; return (
  <tr key={key}><td className="mono t-strong">{key}</td><td>{name}</td><td className="t-strong tnum">{eff}</td>...
// 后(删第一 th + 第一 td;key= 和 paramKey 不动)
<thead><tr><th>名称</th><th>当前值</th><th>说明</th><th /></tr></thead>
<tbody>{TRIAL_CONFIG.map(([key, name, val, desc]) => { const eff = pget(`H.trial.${key}`) ?? val; return (
  <tr key={key}><td>{name}</td><td className="t-strong tnum">{eff}</td>...
```

**拿不准就别删,留着 + 写进报告给 main 确认**。宁可少删(main 再扫),不可错删(断版面/丢信息)。
- 单个英文词(`discount`/`wheel`)、可读档名(`Day-One`/`Weekly`)、枚举值、业务记录 ID(`WD-*`/`U-*`/订单号)→ **不算技术变量名,保留**。

### 2b. 句子散文里的裸变量名 → 换中文名

操作确认 `detail` / `tint` / `sub` / 卡说明等**句子**里出现裸变量名,用同作用域的中文 `name` 变量或中文词替换。
```tsx
// 前
detail: `${key} 当前 ${eff} · server-canonical,仅对新发起的试用生效`
// 后(name 是同 map 回调里的中文名变量)
detail: `${name} 当前 ${eff} · server-canonical,仅对新发起的试用生效`
```
字面量裸变量同理:`sub="衰减曲线 / MIN_EFFICIENCY"` → `sub="衰减曲线 / 最低效能下限"`(给个达意中文)。
> `server-canonical` **是词典词**(有 tooltip)+ **是 verify needle**,**保留原文不动**,会被 AutoGloss/5组件自动加浮层。

### 2c. 删可见/hover 文本里的 PRD 出处 & 代号噪音(主人:删出处碎片,留有用描述)

- `CodeTag title="对应 PRD F2 · §8.3.1"` → 删掉「对应 PRD X · §Y」纯出处碎片。
  - title 里若还有运营**有用描述**(如 `对应 PRD E3 · §6.3 · 任务类型/单价/门槛 增删改查` 的「任务类型/单价/门槛 增删改查」)→ **保留有用部分**,只删出处:`title="任务类型 / 单价 / 门槛 · 增删改查"`。
  - 删完若 title 空了 → **整个 `title` attr 删掉**(`<CodeTag>网络版税</CodeTag>`)。
- 其它**可见或 hover** 文本里的 `§x.x` 锚点、`CGM-*` 代号、`NODE_ENV`、裸 `422`/`rps` → 删除或改通俗中文。
- **注释里的 `CGM:` / `§` / PRD 引用(`/* ... */`、`//`、文件头 JSDoc)不是 UI,一律不动。**

---

## ③ Btn 按钮文字术语

`<Btn>` 的可见文字若**本身是/含词典术语**(如 `只读代入` `impersonate` `红冲` `熔断`)→ 包 `<Gloss>` 或 `<AutoGloss>`:
```tsx
<Btn ...><Gloss>只读代入</Gloss></Btn>
```
普通动词按钮(`调整`/`启用`/`停用`/`上线`/`下线`/`新增活动`)**不是术语,不动**。只点包命中词典的。

---

## 🔴 硬护栏(违反=断功能/断回测,严禁)

1. **绝不改**:`paramKey:` 值、对象字面量的 key、`key={...}` React key、store/mock 数据的键名、变量标识符、函数名、`op`/`fixedVal` 等字段值。只动**给人看的文本节点和显示型字符串字面量**。
2. **绝不改注释**(`//`、`/* */`、JSDoc 文件头)——非 UI。
3. **绝不改 verify needle 原文**(下列短语必须在渲染 HTML 里**连续出现**)。AutoGloss 包裹它们**安全**(文本在 span 内连续);但 ② 重写/删列**不许动到**这些短语,也不许把含 needle 的列当"技术列"删掉:
   ```
   运营总览 server-canonical 兑付覆盖率 高敏操作动态 风险雷达 转化漏斗 扩张期 KPI 验收墙
   双账本总览 应付负债结构 提现审核队列 WD-9F3A21 资金与财务 用户与账户 Marcus Lee
   账户操作 风险画像 审计时间线 投入卡 逐笔充值流水 提现卡 设备卡 收益台账 邀请卡 等级卡
   财务持仓卡 互动卡 账户·安全·合规卡 订单·商城·收据·试用卡 通知·偏好卡 平台参数寄存器
   回源真值 操作确认 提现参数 提现冷却 放大流出 模块 充值对账 警戒 review 净敞口 红线 环比
   最大流失 净敞口曲线 搜索 userId 资金池水位 分销与团队 设备与商城 金融产品 反多账户 规格就绪
   ```
4. **不要运行 tsc / verify**(main 统一回测)。你只管做出**语法正确、import 有效**的编辑。
5. **不双包**:5 组件(CardH.sub / Stat.k / Stat.sub / KV.k / 操作确认.action / 操作确认.detail)的 prop 已自动 AutoGloss,调用处别再包。

---

## ✅ 完成前自检 + 报告格式

自检:
- [ ] import 行已加(若用了 AutoGloss/Gloss)。
- [ ] 没碰任何 `paramKey:` / 对象键 / `key={}` / 注释 / needle 原文。
- [ ] 删的 key 列都满足 2a 三条判据;拿不准的没删、写进报告。
- [ ] 没编辑分配清单外的文件。

报告(返回给 main)按文件列:
```
<文件名>
  ① AutoGloss 包裹:N 处(简述位置)
  ② 删 key 列:N 处(哪些表) / 散文换中文:N 处 / 删 §出处:N 处
  ③ Btn 术语:N 处
  ⚠ 存疑留给 main:<列出拿不准没动的点 + 词典缺词建议>
```
