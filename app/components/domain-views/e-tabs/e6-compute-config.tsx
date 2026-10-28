import { operatorCopyText } from "@/lib/admin/operator-copy";
/**
 * E6 · 算力与设备配置(server-canonical 聚合视图)。
 * 手机绑定换机 / 手机校准 / App 在线加成系数 / 收益估算。
 * 所有写入经 OperationConfirmModal,由 shell(e-view)统一落 A2 审计 + Idempotency-Key。
 *
 * 数据源:ctx.e6Config(后端 GET /api/admin/devices/compute-config 聚合视图),
 * 已含元数据 + 当前值,前端直接渲染,不再依赖本地 mock / pget 派生。
 * 写入:paramKey 由 e6-client 生成函数产出(与后端 ComputeConfigRegistry 1:1),
 * 值规则权威校验在后端 validateComputeValue。
 */
import Link from "next/link";
import { PhoneReplacementPolicyPanel } from "./phone-replacement-policy-panel";
import { PhoneCalibrationPanel } from "./phone-calibration-panel";
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";
import { e6CoeffKey, e6YieldKey } from "@/lib/admin/e6-client";

export function E6ComputeConfig({ ctx }: { ctx: EViewCtx }) {
  const {
    canWriteE6, e6Config, e6Loading, e6Error, refreshE6, openActionConfirm,
  } = ctx;
  const coefficients = (e6Config?.coefficients ?? []).filter((c) => c.key !== "h5BaseFactor");
  const yields = e6Config?.yieldEstimate ?? [];
  const ready = !!e6Config; // 后端聚合视图已加载

  const editCoefficient = (c: (typeof coefficients)[number]) => {
    openActionConfirm({
      name: `${operatorCopyText(c.label)}调整`,
      op: "param",
      paramKey: e6CoeffKey(c.key),
      edit: {
        kind: "number", current: c.value, unit: operatorCopyText(c.unit),
        min: Number.MIN_VALUE,
        disallowCurrent: true,
      },
      detail: `${operatorCopyText(c.label)}: ${operatorCopyText(c.desc)} 调整后对后续结算生效,不回溯已结算收益。${operatorCopyText(c.frontendEffect)}`,
    });
  };

  // 收益估算系数调整 → param(number edit)。
  const editYield = (p: (typeof yields)[number]) => {
    openActionConfirm({
      name: `${operatorCopyText(p.label)}调整`,
      op: "param",
      paramKey: e6YieldKey(p.key),
      edit: { kind: "number", current: p.value, unit: operatorCopyText(p.unit), min: Number.MIN_VALUE, disallowCurrent: true },
      detail: `${operatorCopyText(p.label)}用于后续收益估算;不回溯已结算收益。`,
    });
  };

  if (e6Loading && !e6Config) {
    return <section className="pane"><div className="empty">正在读取服务端 E6 配置...</div></section>;
  }
  if (e6Error) {
    return (
      <section className="pane" data-proof="e6-load-error">
        <div className="empty">E6 配置读取失败:{e6Error}</div>
        <div className="row" style={{ justifyContent: "center", paddingBottom: 16 }}>
          <button type="button" className="adj" onClick={() => void refreshE6()}>重新加载</button>
        </div>
      </section>
    );
  }
  if (!e6Config) {
    return <section className="pane"><div className="empty">服务端尚未返回 E6 配置，当前不显示可操作控件。</div></section>;
  }

  return (
    <div>
      <div id="phone-calibration"><PhoneCalibrationPanel ctx={ctx} /></div>
      <EStats items={[
        { k: "在线系数", v: coefficients.length, sub: "App 稳定性", tone: "cyan" },
      ]} />

      <PhoneReplacementPolicyPanel />

      <section className="pane" style={{ marginTop: 14 }}>
        <div className="pane-h">
          <span className="ttl">在线加成系数</span>
          <span className="sub">调整后只影响后续结算</span>
          <span className="r"><CodeTag>可审计调参</CodeTag></span>
        </div>
        {coefficients.map((c) => (
          <div className="pkv" key={c.key}>
            <div className="lhs">
              <span className="zh">{operatorCopyText(c.label)}</span>
              <span className="desc"><AutoGloss>{operatorCopyText(c.desc)}</AutoGloss></span>
            </div>
            <span className="v">{ready ? c.value : "—"}<span className="u">{operatorCopyText(c.unit)}</span></span>
            {canWriteE6 && <button type="button" className="adj" data-proof={`e6-coeff-${c.key}`} onClick={() => editCoefficient(c)}>调整</button>}
          </div>
        ))}
        <div className="tint cyan tiny" style={{ margin: "12px 16px 14px" }}>
          <AutoGloss>连续在线满额时长决定 App 稳定性加成爬满需要多久。缩短满额时长属于资金放大方向,B1 覆盖率低于红线时服务器会拒绝本次调整;收紧与回滚方向保持可用。调整不回溯已结算收益，不恢复 H5 手机算力奖励。</AutoGloss>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-yield-estimate">
        <div className="pane-h">
          <span className="ttl">收益估算参数</span>
          <span className="sub">修改不回溯已结算记录</span>

        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 0" }}>
          <AutoGloss>以下参数用于收益估算，修改须经审批。</AutoGloss>
        </div>
        <div data-proof="e6-yield-estimate-params" style={{ margin: "0 16px 14px" }}>
          {yields.map((p) => (
            <div className="pkv" key={p.key}>
              <div className="lhs">
                <span className="zh">{operatorCopyText(p.label)}</span>
              </div>
              <span className="v">{ready ? p.value : "—"}<span className="u">{operatorCopyText(p.unit)}</span></span>
              {canWriteE6 && <button type="button" className="adj" onClick={() => editYield(p)}>调整</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-version-rollback">
        <div className="pane-h">
          <span className="ttl">版本记录与回滚</span>
          <span className="sub">A2 操作单 + A4 事件构成不可变版本链</span>
          <span className="r"><CodeTag tone="electric">可追溯</CodeTag><CodeTag>可回滚</CodeTag></span>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px" }}>
          <AutoGloss>每次批准都记录参数键、变更前值、变更后值、理由、操作人、防重复提交编号和时间,同一防重复提交编号重复提交不会产生第二个版本。需要回滚时,在 A2 审计中找到目标版本的变更前值,回到本页填入该值并重新提交理由与审批;回滚本身会生成新版本,不会删除或篡改旧记录。</AutoGloss>
        </div>
        <div className="row" style={{ margin: "0 16px 14px", gap: 10, flexWrap: "wrap" }}>
          <Link className="adj" href="/platform/audit?domain=E&object=E.compute">查看 E6 版本记录</Link>
          <span className="sub">并发写由 A2 目标锁、配置行锁和防重复提交编号串行化;批量修改要么全部成功,要么全部不写。</span>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-effective-boundary">
        <div className="pane-h">
          <span className="ttl">生效阶段与调用链边界</span>
          <span className="sub">全局配置,不跟随 H1 阶段切换</span>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 14px" }}>
          <AutoGloss>A2 批准并写入后立即成为服务端当前版本,不等待 H1 的阶段/月度切换。App/H5 在启动、返回前台或用户下拉刷新时重拉配置后读取新值;E1 目录、E2 任务、E3 生命周期与 E5 运维状态仍各自按本域规则运行,E6 不绕过它们的上架、路由、容量或设备状态保护。新值只参与后续算力展示与收益计算,不重算历史已结算记录。</AutoGloss>
        </div>
      </section>

      <p className="f-foot">
        <b>配置边界</b>:<AutoGloss>本页维护手机校准、换机、在线系数和收益估算参数,所有改动都进入 A2 待确认并留审计。App/H5 在启动、返回前台或用户下拉刷新时重拉公共配置。</AutoGloss>
      </p>
    </div>
  );
}
