import type { L4LiveFact } from "./l4-live-data";

const GROUPS: ReadonlyArray<{ key: L4LiveFact["group"]; title: string; subtitle: string; missing: string }> = [
  {
    key: "device",
    title: "设备运营事实",
    subtitle: "设备目录、订单和用户设备当前快照",
    missing: "尚无设备事实可供核验。",
  },
  {
    key: "task",
    title: "任务运营事实",
    subtitle: "算力任务和任务目录当前快照",
    missing: "尚无任务事实可供核验。",
  },
  {
    key: "network",
    title: "网络与团队事实",
    subtitle: "团队关系和佣金事件当前快照",
    missing: "尚无团队与佣金事实可供核验。",
  },
  {
    key: "phase",
    title: "阶段配置事实",
    subtitle: "仅显示已启用配置，不等同于效果分析",
    missing: "尚无阶段配置事实可供核验。",
  },
  {
    key: "tradein",
    title: "E3 置换闭环事实",
    subtitle: "配置变更、置换申请和完成结果当前快照",
    missing: "尚无 E3 置换事实可供核验。",
  },
];

export function L4LiveFacts({ facts }: { facts: L4LiveFact[] }) {
  return (
    <div>
      <div className="ltint warn" style={{ marginBottom: 12, fontSize: 12 }}>
        <b>当前仅支持实时快照</b> · 服务器尚未提供日、周、月历史序列和阶段切换效果序列，因此本页不开放周期与阶段筛选，也不会推算环比、承接率、收益影响、团队 GMV 或阶段跳变。
      </div>

      <div className="two-col">
        {GROUPS.map((group) => {
          const rows = facts.filter((fact) => fact.group === group.key);
          return (
            <section className="l-card" key={group.key}>
              <div className="l-h">
                <span className="ttl">{group.title}</span>
                <span className="sub">· {group.subtitle}</span>
                <div className="r"><span className="lcode electric">服务器当前事实</span></div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="l-tbl" style={{ minWidth: 620 }}>
                  <thead><tr><th>指标</th><th className="num">当前值</th><th>业务含义</th><th>数据源</th></tr></thead>
                  <tbody>
                    {rows.map((fact) => (
                      <tr key={fact.key}>
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{fact.label}</td>
                        <td className="num mono" style={{ color: "var(--cyan)" }}>{fact.value.toLocaleString("zh-CN")}</td>
                        <td>{fact.description}</td>
                        <td><span className="lcode">{fact.sourceLabel}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="ltint" style={{ margin: 12 }}>{group.missing}</div>}
              </div>
            </section>
          );
        })}
      </div>

      <section className="l-card">
        <div className="l-b">
          <div className="ltint warn" style={{ fontSize: 12 }}>
            <b>跨模块历史分析待统一接入</b> · 设备机型与产出衰减、六类任务承接与饱和度、团队层级分布与团队 GMV、阶段留存与转化效果，都需要各业务域提供同口径历史序列。当前页面明确降级，不使用目录数量替代活跃量，也不使用累计记录拼接周期趋势。
          </div>
          <div className="ltint" style={{ fontSize: 12, marginTop: 10 }}>
            <b>导出范围</b> · “运营当前汇总”只包含本页服务器事实。团队关系明细暂不可导出；真实明细快照、服务器行数估算和审批链接入后才能开放。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L4 是只读分析面</b>：当前可核验内容均为服务器当前事实；未接入的历史效果保持明确降级。</p>
    </div>
  );
}
