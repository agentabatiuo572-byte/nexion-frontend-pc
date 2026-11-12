/**
 * E3 设备使用与升级置换 — 操作说明手册（页头「操作说明手册」打开）。
 * 写给第一次用这页的运营：这页管什么、怎么看产能曲线、每项调高调低会怎样、怎么提交修改、升级置换怎么算、最近 24 小时怎么看。
 * 当前值经 ctx.pE 实时读出，随后台配置变；每句行为说明对着重构说明「后端事实」写。
 */
import { BookOpen } from "lucide-react";
import { Button, Modal, Table, Td, Th, Tr } from "@/app/components/rd";
import type { EViewCtx } from "./types";

function configuredMonth(value: string) {
  const month = Number(value);
  return Number.isInteger(month) && month > 0 ? month : null;
}

export function E3Manual({ ctx, onClose }: { ctx: EViewCtx; onClose: () => void }) {
  const { pE } = ctx;
  const early = pE("E.device.capacity.band1DeltaPct");
  const mid = pE("E.device.capacity.band2DeltaPct");
  const late = pE("E.device.capacity.band3DeltaPct");
  const floor = pE("E.device.capacity.floorPct");
  const cyc = configuredMonth(pE("E.device.cycleMonths")) ?? "—";
  const s1 = configuredMonth(pE("E.device.stageEarlyEnd"));
  const s2 = configuredMonth(pE("E.device.stageMidEnd"));
  const earlyMonths = s1 === null ? "—" : `第 1–${s1} 月`;
  const midMonths = s1 === null || s2 === null ? "—" : `第 ${s1 + 1}–${s2} 月`;
  const lateMonths = s2 === null ? "—" : `第 ${s2 + 1} 月起`;
  const subsidy = pE("E.device.capacity.subsidyDays");
  const ladderCuts = [1, 2, 3, 4].map((i) => pE(`E.tradein.ladder.cut${i}`));
  const ladderCredits = [1, 2, 3, 4, 5].map((i) => pE(`E.tradein.ladder.credit${i}`));
  const exemptCount = ["phone", "cloud-share", "pc-gpu", "stellarbox-s1", "stellarbox-pro", "stellarbox-pro-v2", "stellarrack-p1", "stellarrack-p2"]
    .filter((kind) => pE(`E.device.capacity.applyTo.${kind}`) === "免递减").length;

  // 每项调高、调低会怎样：只写后端能保证的结果，不写用户情绪和销量这类推断。
  const PARAMS: { zh: string; cur: string; up: string; down: string }[] = [
    { zh: "前期每月变化", cur: `${early}% / 月`, up: "前期产能更高（平台多付任务收益）", down: "前期产能更低" },
    { zh: "中期每月变化", cur: `${mid}% / 月`, up: "中期产能更高（平台多付任务收益）", down: "中期产能更低" },
    { zh: "后期每月变化", cur: `${late}% / 月`, up: "后期产能更高（平台多付任务收益）", down: "后期产能更低" },
    { zh: "产能下限", cur: `${floor}%`, up: "老设备产能更高（平台多付任务收益）；不保证一直有任务或收益", down: "老设备产能可以更低" },
    { zh: "三段的分界月份", cur: `前期到第 ${s1 ?? "—"} 月 · 中期到第 ${s2 ?? "—"} 月`, up: "分界往后，下降来得晚", down: "分界往前，下降来得早" },
    { zh: "新机任务补贴天数", cur: `${subsidy} 天`, up: "App 显示「补贴中」更久（只改显示）", down: "更早显示产能百分比" },
    { zh: "哪些商品逐月下降", cur: `${8 - exemptCount} 类下降 / ${exemptCount} 类始终 100%`, up: "更多商品下降：这些设备产能更低", down: "更多商品始终 100%：平台多付任务收益" },
    { zh: "分档界线", cur: `${ladderCuts.join(" / ")}%`, up: "界线往后：高抵扣档持续更久（平台多让利）", down: "界线往前：抵扣更快变少" },
    { zh: "各档抵扣比例", cur: `${ladderCredits.join(" / ")}%`, up: "任一档调高：平台多让利", down: "每单折抵更少" },
  ];

  return (
    <Modal title="操作说明手册 · 设备使用与升级置换" icon={BookOpen} wide onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      <div className="e3p-manual">
        <p>这页管两件事：<b>设备产能随使用月数怎么变</b>，以及<b>旧设备抵扣买新设备（升级置换）的规则</b>。所有修改都先提交审批，另一位有批准权限的管理员批准后才生效；这页不代用户换机，也不处理单台设备。</p>

        <section>
          <h3>1. 怎么看产能曲线</h3>
          <ul>
            <li>三段：前期（{earlyMonths}）每月 {early}%，中期（{midMonths}）每月 {mid}%，后期（{lateMonths}）每月 {late}%。</li>
            <li>每个月按当前产能乘以（1 + 每月变化 ÷ 100）：负数下降，0 不变，正数上升；不低于下限 {floor}%。</li>
            <li>只对参与逐月下降的商品生效，免递减的商品始终 100%。图上画 {cyc} 个月，这个数只决定图的长度。</li>
            <li>App 目前不接受超过 100% 的产能：每月变化设成正数让产能超过 100% 时，App 显示不了（已提后端）。</li>
            <li>新机任务补贴：新设备从购买时间（没有时从激活时间）算起 {subsidy} 天，App 显示「补贴中」。只改显示，不改产能和收益。</li>
          </ul>
        </section>

        <section>
          <h3>2. 每项调高、调低会怎样</h3>
          <p>按带正负号的数比较：-6% 调到 -3% 是调高（下降变慢），+3% 调到 +6% 也是调高。</p>
          <Table label="每项调高、调低会怎样">
            <thead><tr><Th>参数</Th><Th>现在</Th><Th>调高</Th><Th>调低</Th></tr></thead>
            <tbody>{PARAMS.map((p) => <Tr key={p.zh}><Td>{p.zh}</Td><Td>{p.cur}</Td><Td>{p.up}</Td><Td>{p.down}</Td></Tr>)}</tbody>
          </Table>
        </section>

        <section>
          <h3>3. 怎么提交修改</h3>
          <ul>
            <li>点那一行的「调整」，填新值和操作理由，提交审批。提交成功只表示申请已收录，规则还没变。</li>
            <li>另一位有批准权限的管理员在「操作记录与审批」里批准后才生效，发起人不能批自己的申请。批准后回这页点「刷新」看新规则。</li>
            <li>成组的值（三段分界月份、哪些商品逐月下降、分档界线、各档抵扣比例、提示升级的月损失金额）一个按钮改一组，一起提交、一起批准。只有提案权的账号目前提交不了成组修改（已提后端）。</li>
            <li>确认框里标「会让平台多付钱」的修改，批准执行时后端检查兑付覆盖率，产能类还检查各商品的任务奖励上限，不通过就不执行。</li>
          </ul>
        </section>

        <section>
          <h3>4. 升级置换怎么算</h3>
          <ul>
            <li>按旧设备「已赚回 ÷ 实付价」分 5 档：小于界线 1 是第 1 档，等于某条界线算下一档，不小于界线 4 是第 5 档。</li>
            <li>折抵 = 旧设备实付价 × 那一档的比例，最多抵到新设备价格；只减新设备的应付，不进余额、不能提现。第 5 档可以设成 0。</li>
            <li>「只能换更贵的新设备」开启时，新设备价格要高于旧设备实付价；关闭后可以换同价或更便宜的，应付可能是 0。</li>
            <li>「每单最多抵扣台数」目前每单只按 1 台处理；「谁能升级置换」选全部用户时，也仍要满足设备和商品条件。</li>
            <li>修改只影响之后的报价和提交，用户提交时按当时的规则重新算，已完成的置换不回溯。</li>
          </ul>
        </section>

        <section>
          <h3>5. 最近 24 小时怎么看</h3>
          <ul>
            <li>回收、置换、停用三类各看成功、失败、恢复；恢复对回收和停用是之后被恢复的次数，对置换是回退的申请数。</li>
            <li>「近 30 天高频置换账户」只是参考计数，不代表被拦截；要核查到「异常套利与刷量排查」。</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
