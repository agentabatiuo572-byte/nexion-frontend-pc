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
      name: `调整${operatorCopyText(c.label)}`,
      op: "param",
      paramKey: e6CoeffKey(c.key),
      edit: {
        kind: "number", current: c.value, unit: operatorCopyText(c.unit),
        min: Number.MIN_VALUE,
        disallowCurrent: true,
      },
      detail: `${operatorCopyText(c.label)}：${operatorCopyText(c.desc)} 从下次结算开始生效，已结算的收益不变。${operatorCopyText(c.frontendEffect)}`,
    });
  };

  // 收益估算系数调整 → param(number edit)。
  const editYield = (p: (typeof yields)[number]) => {
    openActionConfirm({
      name: `调整${operatorCopyText(p.label)}`,
      op: "param",
      paramKey: e6YieldKey(p.key),
      edit: { kind: "number", current: p.value, unit: operatorCopyText(p.unit), min: Number.MIN_VALUE, disallowCurrent: true },
      detail: `${operatorCopyText(p.label)}用于估算收益；已结算的收益不变。`,
    });
  };

  if (e6Loading && !e6Config) {
    return <section className="pane"><div className="empty">正在加载…</div></section>;
  }
  if (e6Error) {
    return (
      <section className="pane" data-proof="e6-load-error">
        <div className="empty">设备配置加载失败:{e6Error}</div>
        <div className="row" style={{ justifyContent: "center", paddingBottom: 16 }}>
          <button type="button" className="adj" onClick={() => void refreshE6()}>重新加载</button>
        </div>
      </section>
    );
  }
  if (!e6Config) {
    return <section className="pane"><div className="empty">设置还没加载出来，暂时不能修改。</div></section>;
  }

  return (
    <div>
      <div id="phone-calibration"><PhoneCalibrationPanel ctx={ctx} /></div>
      <EStats items={[
        { k: "在线系数", v: coefficients.length, sub: "App 在线奖励", tone: "cyan" },
      ]} />

      <PhoneReplacementPolicyPanel />

      <section className="pane" style={{ marginTop: 14 }}>
        <div className="pane-h">
          <span className="ttl">在线加成系数</span>
          <span className="sub">只影响之后的结算</span>
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
          <AutoGloss>决定用户连续在线多久能拿满 App 在线加成。缩短时间会让平台多付钱，兑付覆盖率低于红线时无法保存；延长时间不受限制。已结算的收益不变，H5 手机算力奖励也不会恢复。</AutoGloss>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-yield-estimate">
        <div className="pane-h">
          <span className="ttl">收益估算参数</span>
          <span className="sub">已结算的收益不变</span>

        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 0" }}>
          <AutoGloss>以下参数用于估算收益，修改需要审批。</AutoGloss>
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
          <span className="ttl">修改记录与回滚</span>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px" }}>
          <AutoGloss>每次修改都会记录改前、改后的值和操作人。要回滚时，在操作记录里找到原来的值，回到这里重新填入并提交。</AutoGloss>
        </div>
        <div className="row" style={{ margin: "0 16px 14px", gap: 10, flexWrap: "wrap" }}>
          <Link className="adj" href="/platform/audit?domain=E&object=E.compute">查看修改记录</Link>
          <span className="sub">一次修改多项时，要么全部成功，要么都不生效。</span>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-effective-boundary">
        <div className="pane-h">
          <span className="ttl">什么时候生效</span>
          <span className="sub">不随运营阶段变化</span>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 14px" }}>
          <AutoGloss>批准后立即生效，不用等运营阶段切换。用户下次打开 App、切回 App 或下拉刷新时就会看到新设置。只影响之后的收益计算，已结算的不变。</AutoGloss>
        </div>
      </section>

      <p className="f-foot">
        <b>说明</b>：<AutoGloss>这页管理手机校准、换机、在线系数和收益估算参数，修改提交后需审批才生效。App 在启动、返回前台或用户下拉刷新时重拉公共配置。</AutoGloss>
      </p>
    </div>
  );
}
