/**
 * E3 设备生命周期 & 以旧换新 — 运营操作说明手册(右上角「操作说明手册」按钮弹出)。
 * 面向初级运营者:本页是什么、怎么读任务产能曲线、每个参数调高/调低的业务影响、怎么调整一个参数
 * (单值输入原理 + 各段月份在哪改)、高敏参数与 B1 资金护栏、换机 术语中英对照、原子换机事务。
 * 当前值经 ctx.pE 实时读出(server-canonical 配置),手册随后台配置同步,不写死。
 */
import type { ReactNode } from "react";
import { Modal } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";

function Sec({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="e3man-sec">
      <div className="e3man-h"><span className="e3man-n">{n}</span><h3>{title}</h3></div>
      <div className="e3man-bd">{children}</div>
    </section>
  );
}

export function E3Manual({ ctx, onClose }: { ctx: EViewCtx; onClose: () => void }) {
  const { pE } = ctx;
  const early = pE("E.device.capacity.band1DeltaPct");
  const mid = pE("E.device.capacity.band2DeltaPct");
  const late = pE("E.device.capacity.band3DeltaPct");
  const floor = pE("E.device.capacity.floorPct");
  const cyc = pE("E.device.cycleMonths");
  const s1 = pE("E.device.stageEarlyEnd");
  const s2 = pE("E.device.stageMidEnd");
  const subsidy = pE("E.device.capacity.subsidyDays");
  const ladderCuts = [1, 2, 3, 4].map((i) => pE(`E.tradein.ladder.cut${i}`));
  const ladderCredits = [1, 2, 3, 4, 5].map((i) => pE(`E.tradein.ladder.credit${i}`));
  const requireHigher = pE("E.tradein.requireHigherPrice");
  const promoMult = pE("E.tradein.promoMult");
  const exemptCount = ["phone", "cloud-share", "pc-gpu", "stellarbox-s1", "stellarbox-pro", "stellarbox-pro-v2", "stellarrack-p1", "stellarrack-p2"]
    .filter((kind) => pE(`E.device.capacity.applyTo.${kind}`) === "免递减").length;

  // 参数速查:含义 + 调高 / 调低的业务影响(运营视角,非工程视角)。
  const PARAMS: { zh: string; code: string; cur: string; up: string; down: string; hot?: boolean }[] = [
    { zh: "段1 产能变化", code: "band1DeltaPct", cur: `${early}% / 月`, up: "前期可接任务量掉得更快,体感变差", down: "前期更平缓,留存更好但换机更慢" },
    { zh: "段2 产能变化", code: "band2DeltaPct", cur: `${mid}% / 月`, up: "中段任务量边际下降加速", down: "中段更平缓" },
    { zh: "段3 产能变化", code: "band3DeltaPct", cur: `${late}% / 月`, up: "深降更陡 → 更快推向置换 → 更多换机现金流(放大资金流出)", down: "深降放缓 → 换机变慢、现金流减少", hot: true },
    { zh: "产能下限", code: "floorPct", cur: `${floor}%`, up: "地板抬高,老设备仍有产出(应付负债更高)", down: "地板压低,老设备更早趋近停产" },
    { zh: "产能分段周期", code: "stageEarlyEnd / stageMidEnd / cycleMonths", cur: `m${s1} / m${s2} / ${cyc}月`, up: "界点 / 视窗后移 → 各段变长、深降更晚", down: "前移 → 深降更早、曲线压缩、更快换机" },
    { zh: "新机任务补贴天数", code: "subsidyDays", cur: `${subsidy} 天`, up: "补贴标注窗口更长 → 新机安心期更长(纯展示,不改结算)", down: "窗口更短 → 产能百分比更早露出" },
    { zh: "参与任务递减(SKU)", code: "applyTo.*", cur: `${exemptCount} 免 / ${8 - exemptCount} 参与`, up: "更多 SKU 参与递减 → 升级压力覆盖面更广", down: "更多 SKU 免递减 → 恒 100% 产能,保护入门体验" },
    { zh: "阶梯分档界点", code: "ladder.cut1–4", cur: `${ladderCuts.join("/")}%`, up: "界点后移 → 高抵扣档覆盖更久,升级激励更持久(放大资金流出)", down: "界点前移 → 抵扣更快滑向低档,升级紧迫感更强" },
    { zh: "各档抵扣率", code: "ladder.credit1–5", cur: `${ladderCredits.join("/")}%`, up: "任一档上调 → 置换更划算、渗透率升,但新机净收款降(放大资金流出)", down: "下调 → 净收款高,置换吸引力下降", hot: true },
    { zh: "仅限升级更高价设备", code: "requireHigherPrice", cur: requireHigher, up: "开 → 抵扣只服务升级,每笔置换平台净收新款(默认)", down: "关 → 允许平换,抵扣可能逼近应付款,须先核 B1 覆盖率" },
    { zh: "置换活动倍率", code: "promoMult", cur: `${promoMult}×`, up: "活动加成更高 → 置换冲动更强(放大资金流出)", down: "加成回落 → 置换回归常态" },
  ];

  // 换机 术语中英对照(呼应右栏「置换配置」中文化)。
  const TERMS: { code: string; zh: string; note: string }[] = [
    { code: "enabled", zh: "置换总开关", note: "关闭后前端全部置换入口隐藏(设备列表 / 结算拦截同步失效)" },
    { code: "ladder.cut1–4", zh: "阶梯分档界点", note: "产出比(累计产出 ÷ 实付价)的 4 个分档界点,区间左闭右开、连续无重叠" },
    { code: "ladder.credit1–5", zh: "各档抵扣率", note: "5 档抵扣比例(按实付价的 %),逐档递减 —— 产出越多抵扣越小,越早升级抵扣越多" },
    { code: "requireHigherPrice", zh: "仅限升级更高价设备", note: "置换目标必须严格高于本机实付价(抵扣只服务升级)" },
    { code: "maxDevicesPerOrder", zh: "单笔最多抵扣台数", note: "一笔升级订单最多可用几台旧机抵扣" },
    { code: "eligibility", zh: "置换资格门槛", note: "谁可发起置换(持有等级门槛)" },
    { code: "promoMult", zh: "置换活动倍率", note: "置换活动的加成倍率,改后对新报价生效" },
    { code: "promo.* (5 参)", zh: "置换弹窗节奏", note: "弹窗冷却天 / 每会话上限 / 延迟秒 / 设备最低龄天 / 入口路由(只控推送节奏,不限制用户随时主动置换)" },
    { code: "inventory.softMax", zh: "库存软上限告警", note: "回收旧机库存软上限,超过即告警(0 = 禁用)" },
  ];

  return (
    <Modal title="操作说明手册 · 设备生命周期 & 以旧换新" icon="doc" onClose={onClose} wide
      footer={null}>
      <div className="e3man">
        <p className="e3man-lead">
          本页(<b>E3</b>)管两套相互咬合的规则:<b>设备可接任务产能随月递减的节奏</b>(AI 任务池持续升级,低阶任务量逐月减少)+ <b>旧机折价抵扣换新机(Trade-in)的规则</b>。
          两者共同决定用户的「升级节奏」——段3 深降把用户推向置换决策点,折抵力度决定置换的吸引力。
          所有参数 <AutoGloss>server-canonical</AutoGloss>,改动经<AutoGloss>操作确认</AutoGloss>后即对全网新报价 / 估值器生效(<b>不回溯已生效报价</b>)。
        </p>

        <Sec n="1" title="怎么读任务产能曲线">
          <ul className="e3man-ul">
            <li><b>三段节奏</b>:段1(m1–{s1},平缓)→ 段2(m{Number(s1) + 1}–{s2},中速)→ 段3(m{Number(s2) + 1} 起,<b>深降</b>,开区间)。颜色由绿→黄→橙。</li>
            <li><b>FLOOR {floor}%</b>:任务产能降到此下限即不再下降(虚线)。</li>
            <li>曲线上每个圆点 = 该月设备的任务产能;放大的点是各段分界(m0 / m{s1} / m{s2} / m{cyc})。</li>
            <li>深降段(橙色)是把用户推向 <AutoGloss>trade-in</AutoGloss> 的关键——可接任务量预期下挫驱动换机升级。</li>
            <li><b>新机任务补贴</b>:新激活设备前 {subsidy} 天为补贴期,前端只显示补贴标注、不显示产能百分比(<b>纯展示层</b>,结算按曲线连续计算,不受影响)。</li>
          </ul>
        </Sec>

        <Sec n="2" title="每个参数:调高 / 调低的影响">
          <div className="e3man-tbl">
            <div className="e3man-tr e3man-th"><span>参数</span><span>当前</span><span>调高 ↑</span><span>调低 ↓</span></div>
            {PARAMS.map((p) => (
              <div key={p.code} className={`e3man-tr${p.hot ? " hot" : ""}`}>
                <span className="e3man-pc"><span className="nm"><b>{p.zh}</b>{p.hot ? <em className="e3man-hot">高敏</em> : null}</span><code>{p.code}</code></span>
                <span className="mono">{p.cur}</span>
                <span><AutoGloss>{p.up}</AutoGloss></span>
                <span><AutoGloss>{p.down}</AutoGloss></span>
              </div>
            ))}
          </div>
        </Sec>

        <Sec n="3" title="怎么调整一个参数(单值 / 多字段 · 月份在哪改)">
          <ul className="e3man-ul">
            <li>点该行右侧 <b>「调整」</b> → 弹「<AutoGloss>操作确认</AutoGloss>」→ 填<b>目标新值</b> + <b>操作理由(≥8 字)</b> → 确认即生效并写入 <AutoGloss>A2 审计</AutoGloss>。</li>
            <li><b>单值 / 多字段</b>:单个标量的参数(各段产能变化 / 补贴天数 / 倍率…)弹<b>单值输入</b>;<b>一组相关的多个值</b>——产能分段周期、任务锁定阈、参与任务递减、阶梯界点 / 抵扣率或置换弹窗节奏——弹<b>多字段输入</b>,以一张 A2 审批单原子校验并整组写入,不会留下半套配置。</li>
            <li><b>月份怎么改</b>:三段的起止<b>月份在「产能分段周期」一行一次调齐</b> —— <code>stageEarlyEnd / stageMidEnd / cycleMonths</code> 三字段(当前 段1末 m{s1} · 段2末 m{s2} · 视窗 {cyc} 月)。改后各段范围与曲线<b>自动重算</b>(须 段1末 &lt; 段2末 &lt; 视窗月数);各段产能行只改每月变化幅度%。
            </li>
            <li>带 <b>⚡</b> 的「调整」是<AutoGloss>放大流出</AutoGloss>动作(段3 深降 / 各档抵扣率 / 置换活动倍率),确认前会先校验 <b>B1 备付金<AutoGloss>覆盖率</AutoGloss></b>,低于<AutoGloss>红线</AutoGloss>会被拒绝。</li>
          </ul>
        </Sec>

        <Sec n="4" title="高敏参数与「高敏」标">
          <p>
            带<em className="e3man-hot">高敏</em>标的参数——<b>段3 产能变化</b>、<b>各档抵扣率</b> 与 <b>置换总开关</b>——是本页风险最高的杠杆:
          </p>
          <ul className="e3man-ul">
            <li><b>段3 产能变化(深降)</b>:直接决定换机节奏与换机现金流,是<AutoGloss>放大流出</AutoGloss>的核心。</li>
            <li><b>各档抵扣率</b>:上调任一档都直接放大置换补贴支出;阶梯<AutoGloss>套利</AutoGloss>免疫的前提是「仅限升级更高价」+「抵扣不入余额」两条不变量不被同时放开。</li>
            <li><b>置换总开关</b>:关闭即全网置换入口消失,影响升级转化主通路,操作前须知会增长运营。</li>
          </ul>
          <p className="e3man-note">
            「高敏」标只是<b>提示「重点关注、改动慎重」</b>,<b>不是「选中 / 已勾选」状态</b>——它不会被点选,也无需取消(原先整行琥珀高亮易被误读为选中态,已移除)。
          </p>
        </Sec>

        <Sec n="5" title="换机 置换配置 · 术语中英对照">
          <div className="e3man-terms">
            {TERMS.map((t) => (
              <div key={t.code} className="e3man-term">
                <div className="t"><b>{t.zh}</b><code>{t.code}</code></div>
                <div className="n"><AutoGloss>{t.note}</AutoGloss></div>
              </div>
            ))}
          </div>
        </Sec>

        <Sec n="6" title="原子换机事务(回收 / 置换 / 停用)">
          <ul className="e3man-ul">
            <li>三类换机(recycle / replace / deactivate)走后端 <b>单事务</b>:任一步失败<b>全<AutoGloss>回滚</AutoGloss></b>(设备数组 + 余额 + 账单),防止半完成。</li>
            <li>置换抵扣 <b>仅抵新机货款、不入可提余额</b>(资金不变量);<b>已回本设备(产出比 ≥ 界点4)仍保留第 5 档抵扣</b>——任何时点下架都有升级激励,无「归零只能退役」态。</li>
            <li>页面底部「原子换机事务监控」看 24h 成功 / 失败 / 回滚;失败样本可跳 D4 账单查轨迹。</li>
          </ul>
        </Sec>
      </div>
    </Modal>
  );
}
