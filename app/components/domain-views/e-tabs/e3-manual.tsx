/**
 * E3 设备生命周期 & 升级置换 — 运营操作说明手册(右上角「操作说明手册」按钮弹出)。
 * 面向初级运营者:本页是什么、怎么读任务产能曲线、每个参数调高/调低的业务影响、怎么调整一个参数
 * (单值输入原理 + 各段月份在哪改)、高敏参数与 B1 资金护栏、换机 术语中英对照、换机处理。
 * 当前值经 ctx.pE 实时读出，手册随后台当前配置同步，不写死。
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
  const cyc = pE("E.device.总周期月数");
  const s1 = pE("E.device.初期结束月");
  const s2 = pE("E.device.中期结束月");
  const subsidy = pE("E.device.capacity.subsidyDays");
  const ladderCuts = [1, 2, 3, 4].map((i) => pE(`E.tradein.ladder.cut${i}`));
  const ladderCredits = [1, 2, 3, 4, 5].map((i) => pE(`E.tradein.ladder.credit${i}`));
  const requireHigher = pE("E.tradein.requireHigherPrice");
  const exemptCount = ["phone", "cloud-share", "pc-gpu", "stellarbox-s1", "stellarbox-pro", "stellarbox-pro-v2", "stellarrack-p1", "stellarrack-p2"]
    .filter((kind) => pE(`E.device.capacity.applyTo.${kind}`) === "免递减").length;

  // 参数速查:含义 + 调高 / 调低的业务影响(运营视角,非工程视角)。
  const PARAMS: { zh: string; code: string; cur: string; up: string; down: string; hot?: boolean }[] = [
    { zh: "前期每月变化", code: "band1DeltaPct", cur: `${early}% / 月`, up: "前期能接的任务掉得更快，用户体验变差", down: "前期更平稳，用户更愿意留下，但换新更慢" },
    { zh: "中期每月变化", code: "band2DeltaPct", cur: `${mid}% / 月`, up: "中期下降加快", down: "中期更平稳" },
    { zh: "后期每月变化", code: "band3DeltaPct", cur: `${late}% / 月`, up: "后期降得更快 → 用户更早换新 → 换新收入更多（平台让利也更多）", down: "后期降得慢 → 换新变慢，收入减少", hot: true },
    { zh: "产能下限", code: "floorPct", cur: `${floor}%`, up: "下限提高，老设备一直有收益（平台应付款更多）", down: "下限降低，老设备更早接近停产" },
    { zh: "产能分段周期", code: "初期结束月 / 中期结束月 / 总周期月数", cur: `第 ${s1} / 第 ${s2} 月 / 显示 ${cyc} 个月`, up: "分界往后 → 各段更长，后期下降来得更晚", down: "分界往前 → 后期下降来得更早，用户更快换新" },
    { zh: "新机任务补贴天数", code: "subsidyDays", cur: `${subsidy} 天`, up: "「补贴中」显示更久，新用户更安心（只影响显示）", down: "更早显示产能百分比" },
    { zh: "产能是否逐月下降（按商品）", code: "applyTo.*", cur: `${exemptCount} 个不下降 / ${8 - exemptCount} 个下降`, up: "更多商品会下降 → 更多用户有换新动力", down: "更多商品不下降 → 始终 100%，保护入门体验" },
    { zh: "分档界线", code: "ladder.cut1–4", cur: `${ladderCuts.join("/")}%`, up: "界线往后 → 高抵扣档持续更久，换新动力更持久（平台让利更多）", down: "界线往前 → 抵扣更快变少，用户更急着换新" },
    { zh: "各档抵扣比例", code: "ladder.credit1–5", cur: `${ladderCredits.join("/")}%`, up: "调高任一档 → 换新更划算，换新的人更多，但每单收入减少（平台让利更多）", down: "调低 → 每单收入更高，但换新吸引力下降", hot: true },
    { zh: "仅限升级更高价设备", code: "requireHigherPrice", cur: requireHigher, up: "开 → 只能换更贵的机型，每单平台都有净收入（默认）", down: "关 → 允许换同价机型，抵扣可能接近新机价格，请先看兑付覆盖率" },
  ];

  // 换机 术语中英对照(呼应右栏「置换配置」中文化)。
  const TERMS: { code: string; zh: string; note: string }[] = [
    { code: "enabled", zh: "升级置换开关", note: "关闭后 App 上所有升级置换入口都会隐藏" },
    { code: "ladder.cut1–4", zh: "分档界线", note: "按「已赚回金额 ÷ 买入价」划分 5 档的 4 条界线" },
    { code: "ladder.credit1–5", zh: "各档抵扣比例", note: "每档抵扣买入价的百分之几，逐档递减：赚回越多抵扣越少，越早换新抵扣越多" },
    { code: "requireHigherPrice", zh: "仅限升级更高价设备", note: "只能换比旧机更贵的新机" },
    { code: "maxDevicesPerOrder", zh: "单笔最多抵扣台数", note: "买一台新机最多能用几台旧机抵扣" },
    { code: "eligibility", zh: "谁能升级置换", note: "哪些等级的用户可以升级置换" },
  ];

  return (
    <Modal title="操作说明 · 设备产能与升级置换" icon="doc" onClose={onClose} wide
      footer={null}>
      <div className="e3man">
        <p className="e3man-lead">
          这页管两件事：<b>设备能接的任务随使用时间逐月减少的节奏</b>，以及<b>旧机抵扣买新机（升级置换）的规则</b>。
          两者一起决定用户多快升级：后期产能下降让用户考虑换新，抵扣力度决定换新有多划算。
          修改确认后立即生效，<b>已给出的报价不变</b>。
        </p>

        <Sec n="1" title="怎么看产能曲线">
          <ul className="e3man-ul">
            <li><b>三个阶段</b>：前期（第 1–{s1} 月，缓慢下降）→ 中期（第 {Number(s1) + 1}–{s2} 月）→ 后期（第 {Number(s2) + 1} 月起，<b>快速下降</b>）。颜色从绿到黄到橙。</li>
            <li><b>最低产能 {floor}%</b>：降到这里就不再下降（虚线）。</li>
            <li>每个圆点是那个月的设备产能，大圆点是阶段分界。</li>
            <li>后期（橙色）能接的任务逐月减少，用户可以按需升级置换。</li>
            <li><b>新机任务补贴</b>：新设备激活后前 {subsidy} 天，App 只显示「补贴中」，不显示产能百分比（<b>只影响显示</b>，收益照常计算）。</li>
          </ul>
        </Sec>

        <Sec n="2" title="每个参数调高、调低会怎样">
          <div className="e3man-tbl">
            <div className="e3man-tr e3man-th"><span>参数</span><span>当前</span><span>调高 ↑</span><span>调低 ↓</span></div>
            {PARAMS.map((p) => (
              <div key={p.code} className={`e3man-tr${p.hot ? " hot" : ""}`}>
                <span className="e3man-pc"><span className="nm"><b>{p.zh}</b>{p.hot ? <em className="e3man-hot">敏感</em> : null}</span></span>
                <span className="mono">{p.cur}</span>
                <span><AutoGloss>{p.up}</AutoGloss></span>
                <span><AutoGloss>{p.down}</AutoGloss></span>
              </div>
            ))}
          </div>
        </Sec>

        <Sec n="3" title="怎么修改参数">
          <ul className="e3man-ul">
            <li>点该行右侧的<b>「调整」</b>，填写新值和操作理由（至少 8 字），确认后立即生效。</li>
            <li>一组相关的值（产能分段周期、提示升级的月损失金额、产能是否下降、分档界线、各档抵扣比例）会一起修改、一起保存。</li>
            <li><b>月份在哪改</b>：三个阶段的分界月份<b>在「产能分段周期」一起改</b>（当前前期到第 {s1} 月、中期到第 {s2} 月、显示 {cyc} 个月），须满足 前期 &lt; 中期 &lt; 显示月数，改后曲线自动更新；各阶段那一行只改每月下降多少。
            </li>
            <li>带 <b>⚡</b> 的「调整」会让平台多付钱（后期每月变化、各档抵扣比例），提交时会检查兑付覆盖率，低于红线将无法保存。</li>
          </ul>
        </Sec>

        <Sec n="4" title="标了「敏感」的参数">
          <p>
            标了<em className="e3man-hot">敏感</em>的参数（<b>后期每月变化</b>、<b>各档抵扣比例</b>、<b>升级置换开关</b>）影响最大：
          </p>
          <ul className="e3man-ul">
            <li><b>后期每月变化</b>：直接决定用户多快换新，以及换新带来的收入。</li>
            <li><b>各档抵扣比例</b>：调高任一档平台都会多让利。只要「仅限升级更高价」和「抵扣不能提现」这两条不同时放开，就不怕被套利。</li>
            <li><b>升级置换开关</b>：关闭后所有换新入口消失，会影响升级转化，操作前请告知增长同事。</li>
          </ul>
          <p className="e3man-note">
            「敏感」只是提醒你修改时要慎重，不是勾选状态。
          </p>
        </Sec>

        <Sec n="5" title="升级置换设置说明">
          <div className="e3man-terms">
            {TERMS.map((t) => (
              <div key={t.code} className="e3man-term">
                <div className="t"><b>{t.zh}</b></div>
                <div className="n"><AutoGloss>{t.note}</AutoGloss></div>
              </div>
            ))}
          </div>
        </Sec>

        <Sec n="6" title="换机处理（回收 / 换新 / 停用）">
          <ul className="e3man-ul">
            <li>回收、换新、停用都是<b>要么全部成功，要么全部撤回</b>（设备、余额、账单一起），不会做一半。</li>
            <li>换新抵扣<b>只能抵新机货款，不能提现</b>；<b>已回本的设备（超过界线 4）仍有第 5 档抵扣</b>，任何时候换新都有优惠。</li>
            <li>页面底部「换机处理情况」可以看 24 小时内的成功、失败和撤回数，失败的可以点进去查账单。</li>
          </ul>
        </Sec>
      </div>
    </Modal>
  );
}
