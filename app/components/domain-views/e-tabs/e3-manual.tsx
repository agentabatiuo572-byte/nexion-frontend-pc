/**
 * E3 设备使用与升级置换 — 操作说明手册（页头「操作说明手册」打开）。
 * 写给第一次用这页的运营：这页管什么、怎么看产能曲线、每项调高调低会怎样、怎么提交修改、升级置换怎么算、最近 24 小时怎么看。
 * 当前值经 ctx.pE 实时读出，随后台配置变；每句行为说明对着重构说明「后端事实」写。
 */
import type { ReactNode } from "react";
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
    { zh: "三段的分界月份", cur: `前期到第 ${s1 ?? "—"} 月 · 中期到第 ${s2 ?? "—"} 月`, up: "多出来的月份改按前一段的比例算", down: "让出去的月份改按后一段的比例算" },
    { zh: "新机任务补贴天数", cur: `${subsidy} 天`, up: "App 显示「补贴中」更久（只改显示）", down: "更早显示产能百分比" },
    { zh: "哪些商品逐月下降", cur: `${8 - exemptCount} 类下降 / ${exemptCount} 类始终 100%`, up: "更多商品按曲线算：曲线低于 100% 的月份产能更低", down: "更多商品始终 100%：曲线低于 100% 的月份平台多付任务收益" },
    { zh: "分档界线", cur: `${ladderCuts.join(" / ")}%`, up: "界线往后：高抵扣档持续更久（平台多让利）", down: "界线往前：抵扣更快变少" },
    { zh: "各档抵扣比例", cur: `${ladderCredits.join(" / ")}%`, up: "任一档调高：平台多让利", down: "每单折抵更少" },
  ];

  const ROW = (k: string, v: ReactNode) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>;
  return (
    <Modal title="操作说明手册" icon={BookOpen} wide onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      <div className="e3p-manual">
        <dl>
          {ROW("这页管什么", "产能随使用月数怎么变，旧设备怎么抵扣买新设备（升级置换）。")}
          {ROW("这页不做什么", "不代用户换机，不处理单台设备，不批准，不导出。")}
        </dl>

        <section>
          <h3>1. 怎么看产能曲线</h3>
          <dl>
            {ROW("三段", `前期（${earlyMonths}）每月 ${early}%，中期（${midMonths}）每月 ${mid}%，后期（${lateMonths}）每月 ${late}%。`)}
            {ROW("怎么算", `每个月乘以（1 + 每月变化 ÷ 100），不低于下限 ${floor}%。负数下降，正数上升。`)}
            {ROW("对谁生效", "参与逐月下降的商品；免递减的始终 100%。")}
            {ROW("图画多长", `${cyc} 个月，只决定图的长度，不截断产能。`)}
            {ROW("补贴天数", `参与递减的新设备从购买（没有时从激活）起 ${subsidy} 天显示「补贴中」。`)}
          </dl>
        </section>

        <section>
          <h3>2. 每项调高、调低会怎样</h3>
          <p>按带正负号的数比较：-6% 调到 -3% 是调高。</p>
          <Table label="每项调高、调低会怎样">
            <thead><tr><Th>参数</Th><Th>现在</Th><Th>调高</Th><Th>调低</Th></tr></thead>
            <tbody>{PARAMS.map((p) => <Tr key={p.zh}><Td>{p.zh}</Td><Td>{p.cur}</Td><Td>{p.up}</Td><Td>{p.down}</Td></Tr>)}</tbody>
          </Table>
        </section>

        <section>
          <h3>3. 怎么提交修改</h3>
          <dl>
            {ROW("提交", "点那一行的「调整」，填新值和理由。提交只是建审批单，批准前规则不变。")}
            {ROW("谁来批", "另一位超级管理员（需有审批批准权限）在「操作记录与审批」批准，发起人不能自批。")}
            {ROW("批准以后", "回这页点「刷新」看新规则，页面不会自己变。")}
            {ROW("成组修改", "分界月份、逐月下降的商品、分档界线、抵扣比例一组一起提交。")}
            {ROW("多付钱的修改", "批准时查兑付覆盖率，产能类还查任务奖励上限，不通过不执行。")}
          </dl>
        </section>

        <section>
          <h3>4. 升级置换怎么算</h3>
          <dl>
            {ROW("分档", "累计收益 ÷ 旧设备当前售价。小于界线 1 是第 1 档，等于界线时进入下一档。")}
            {ROW("折抵", "旧设备当前售价 × 档位比例，最多抵到新设备售价，不进余额。第 5 档可以是 0。")}
            {ROW("只能换更贵的", "开启时新设备当前售价必须高于旧设备同型号的当前售价。关闭后应付可能是 0。")}
            {ROW("抵扣台数", "目前每单只按 1 台处理。")}
            {ROW("谁能换", "选「全部用户」也仍要满足设备和商品条件。")}
            {ROW("什么时候生效", "只影响之后的报价和提交；没提交的报价金额变了要重新报价，已完成的不变。")}
          </dl>
        </section>

        <section>
          <h3>5. 最近 24 小时怎么看</h3>
          <dl>
            {ROW("恢复", "回收、停用是之后被恢复的次数；置换是回退的申请数。")}
            {ROW("高频置换账户", "只是参考计数，不代表被拦截。")}
          </dl>
        </section>
      </div>
    </Modal>
  );
}
